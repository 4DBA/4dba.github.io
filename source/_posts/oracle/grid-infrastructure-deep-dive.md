---
title: Grid Infrastructure 深度解析：OCR/Voting Disk/SCAN 与集群启动逻辑
date: 2026-01-19 10:00:00
categories: Oracle
tags: [Grid Infrastructure, RAC, OCR, Voting Disk, SCAN, GPNP, 集群]
---

Oracle Grid Infrastructure (GI) 是 RAC 架构的基石，负责集群管理、存储管理、网络管理三大核心功能。然而，很多 DBA 对 GI 的理解仅停留在 `crsctl start/stop` 的层面，一旦遇到 OCR 损坏、Voting Disk 丢失、SCAN IP 漂移等生产故障，往往束手无策。本文将从底层机制出发，深入剖析 GI 的核心组件与启动逻辑，帮助读者建立对 GI 架构的系统性认知。

<!-- more -->

## 一、问题背景

在日常运维中，我们经常遇到这样的场景：

- 某次存储故障导致 OCR 所在磁盘组不可用，整个 RAC 集群瞬间宕机
- 网络抖动触发 Voting Disk 仲裁失败，节点被逐出集群
- SCAN IP 无法解析，大量应用连接失败

这些问题的根源在于我们对 GI 底层机制的理解不够深入。**只会用 `srvctl` 和 `crsctl` 管理集群，却不了解它们背后的运行逻辑，就像会开车却不懂发动机原理——平时没问题，出故障就抓瞎。**

> 本文基于 Oracle 12c/19c 版本，部分内容在 11gR2 中有差异，会在文中注明。参考了 roger wiki 的 RAC 内部机制分析以及多篇 MOS 文档。

---

## 二、理论分析

### 2.1 GI 架构概览

在深入各组件之前，先用文字描述一下 GI 的整体架构：

```
┌─────────────────────────────────────────────────────┐
│                    应用层 / 数据库层                    │
│              Oracle RAC Database Instances            │
├─────────────────────────────────────────────────────┤
│                   资源管理层 (CRSD)                     │
│     Database / Service / Listener / VIP / SCAN VIP    │
├─────────────────────────────────────────────────────┤
│                   集群同步层 (OCSSD)                    │
│        CSS (Cluster Synchronization Services)          │
│              Voting Disk / 网络心跳                      │
├─────────────────────────────────────────────────────┤
│                   集群注册表层                           │
│              OCR (Cluster Registry)                    │
│              GPNP (Grid Plug and Play)                 │
├─────────────────────────────────────────────────────┤
│                   基础服务层 (OHASD)                     │
│          OHASD -> CSSDAGENT -> OCSSD                   │
│              ASM / 网络 / 存储管理                       │
├─────────────────────────────────────────────────────┤
│                   操作系统 / 网络 / 存储                  │
└─────────────────────────────────────────────────────┘
```

GI 的层次关系可以概括为：**OHASD 是最底层的守护进程，负责启动整个集群栈；OCSSD 负责节点间的心跳同步和脑裂仲裁；CRSD 负责管理所有集群资源；ASM 负责存储管理。** 这些组件的启动有严格的顺序依赖关系，下文会详细分析。

---

### 2.2 OCR (Oracle Cluster Registry)

#### 2.2.1 OCR 的作用与存储结构

OCR 是整个 RAC 集群的"配置中心"，存储了以下关键信息：

- 集群节点列表与节点编号
- 数据库、实例、Service 的配置信息
- VIP、SCAN VIP、Listener 的网络配置
- ASM 磁盘组配置
- 资源的属性（如 `AUTO_START`、`START_DEPENDENCIES` 等）

**OCR 的存储结构经历了重大演变：**

| 版本 | 存储位置 | 冗余方式 |
|------|----------|----------|
| 10g/11gR1 | 共享裸设备/OCFS | OCR + OCR Mirror（最多2份） |
| 11gR2+ | ASM 磁盘组 | Normal Redundancy = 3份副本，High = 5份 |
| 12c+ | ASM 磁盘组 | 同 11gR2，但引入了 OCR 备份存储在 ASM 中 |

在 11.2.0.2+ 中，OCR 默认存储在 ASM 磁盘组中（通常是 `+CRS` 磁盘组），Oracle 会在磁盘组中创建一个名为 `SYSTEMDG` 的文件来存储 OCR。这种设计的好处是利用了 ASM 的镜像机制来保护 OCR，而不再需要单独管理 OCR Mirror。

#### 2.2.2 OCR 的备份机制

OCR 有三种备份方式：

**1) 自动备份**

CRSD 进程会按照以下策略自动备份 OCR：

- **每 4 小时**：保留最近 3 次备份
- **每天一次**：保留最近 1 天的备份
- **每周一次**：保留最近 1 周的备份

备份文件存储在 `$GRID_HOME/cdata/<cluster_name>/` 目录下。

**2) 手动备份**

```bash
# 手动备份 OCR
ocrconfig -manualbackup

# 查看手动备份列表
ocrconfig -showbackup manual

node1 2026/06/05 10:30:15 /u01/app/19c/grid/cdata/rac-cluster/backup_20260605_103015.ocr
```

**3) 逻辑导出**

```bash
# 导出 OCR 到文件（建议在重大变更前执行）
ocrconfig -export /tmp/ocr_export_$(date +%Y%m%d).bak
```

> **最佳实践**：每次 CRS 变更（添加/删除节点、修改网络配置）前，手动执行 `ocrconfig -manualbackup` 和 `ocrconfig -export`。MOS Doc ID 394654.1 详细介绍了 OCR 的备份与恢复策略。

#### 2.2.3 OCR 恢复流程

当 OCR 出现损坏时，可以使用以下流程恢复：

```bash
# 1. 停止所有节点的 CRS
crsctl stop crs -f

# 2. 在一个节点上以 exclusive 模式启动 CRS
crsctl start crs -excl

# 3. 查看可用的 OCR 备份
ocrconfig -showbackup

# 4. 恢复 OCR
ocrconfig -restore /u01/app/19c/grid/cdata/rac-cluster/backup_20260604_040000.ocr

# 5. 停止 exclusive 模式的 CRS
crsctl stop crs -f

# 6. 在所有节点正常启动 CRS
crsctl start crs
```

> **注意**：如果使用的是 12c+ 且 OCR 存储在 ASM 中，恢复时需要确保 ASM 磁盘组已经 mount。

---

### 2.3 Voting Disk

#### 2.3.1 Voting Disk 的作用

Voting Disk 是 RAC 集群的"仲裁者"，承担两个核心职责：

**1) 节点健康检查**

每个节点的 OCSSD 进程会定期向 Voting Disk 写入心跳信息（称为 **disk heartbeat**）。如果某个节点在 `Misscount`（默认 30 秒）内没有写入心跳，其他节点会认为该节点"死亡"，并将其从集群中驱逐。

**2) 脑裂仲裁（Split Brain Resolution）**

当集群网络发生分区（网络分裂）时，可能出现两个分区都认为自己是"活的"。此时，Voting Disk 的仲裁机制发挥作用：

- 每个分区的节点都会尝试读取 Voting Disk 中其他节点的心跳信息
- 拥有**多数节点**（> N/2）的分区胜出，继续运行
- 少数节点分区被驱逐（eviction）

```
节点A ──┐         ┌── 节点B
节点C ──┤ 网络分区 ├── 节点D
        └─────────┘
分区1: 2个节点 → 胜出，继续运行
分区2: 2个节点 → 投票决定，取决于 Voting Disk 的仲裁结果
```

> **关键参数**：
> - `Misscount`：默认 30 秒（12c+ 中可配置），超过此时间未写入 Voting Disk 则认为节点死亡
> - `Disktimeout`：默认 200 秒，Voting Disk I/O 操作的超时时间
> - `Reboottime`：节点被驱逐后的等待重启时间，默认 3 秒

#### 2.3.2 Voting Disk 的存储演变

与 OCR 类似，Voting Disk 在 11gR2+ 中也存储在 ASM 磁盘组中：

```bash
# 查询 Voting Disk 位置
crsctl query css votedisk

##  STATE    File Universal Id                File Name Disk group
--  -----    -----------------                --------- ---------
 1. ONLINE   a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6 (DATA01) [DATA]
 2. ONLINE   b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7 (DATA02) [DATA]
 3. ONLINE   c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8 (DATA03) [DATA]
Located 3 voting file(s).
```

**冗余要求：**
- External Redundancy：至少 1 个 Voting Disk
- Normal Redundancy：至少 3 个 Voting Disk（推荐）
- High Redundancy：至少 5 个 Voting Disk

> **重要提醒**：在 11gR2 之前，Voting Disk 可以存储在裸设备或 OCFS 上，需要手动管理冗余。11gR2 之后，Voting Disk 的冗余完全由 ASM 管理。MOS Doc ID 1388755.1 详细说明了 11gR2 中 Voting Disk 存储在 ASM 中的变化。

---

### 2.4 SCAN (Single Client Access Name)

#### 2.4.1 SCAN 的原理

SCAN 是 11gR2 引入的客户端连接抽象层，其核心设计思想是：**让客户端连接与集群节点解耦**。

```
客户端应用
    │
    ▼
SCAN Name: scan.example.com
    │
    ├── SCAN VIP 1 (192.168.1.100) → SCAN Listener 1 → Node1 Local Listener → Instance1
    ├── SCAN VIP 2 (192.168.1.101) → SCAN Listener 2 → Node2 Local Listener → Instance2
    └── SCAN VIP 3 (192.168.1.102) → SCAN Listener 3 → Node1 Local Listener → Instance1
```

**SCAN 的关键特性：**

- **3 个 SCAN VIP**：Oracle 推荐配置 3 个 SCAN VIP，通过 DNS 解析返回 3 个 IP 地址（round-robin）
- **2 个 SCAN Listener**：默认情况下，Oracle 只会启动 2 个 SCAN Listener（在不同节点上），因为 2 个 Listener 就能服务 3 个 VIP
- **DNS 或 GNS 解析**：SCAN Name 必须通过 DNS 或 GNS (Grid Naming Service) 解析

```bash
# 验证 SCAN 配置
srvctl config scan

SCAN name: scan.example.com, Network: 1
Subnet IPv4: 192.168.1.0/255.255.255.0/eth0, static
Subnet IPv6:
SCAN 1 IPv4 VIP: 192.168.1.100/255.255.255.0
SCAN 2 IPv4 VIP: 192.168.1.101/255.255.255.0
SCAN 3 IPv4 VIP: 192.168.1.102/255.255.255.0

srvctl config scan_listener

SCAN Listener LISTENER_SCAN1 exists. Port: TCP:1521
SCAN Listener LISTENER_SCAN2 exists. Port: TCP:1521
SCAN Listener LISTENER_SCAN3 exists. Port: TCP:1521
```

#### 2.4.2 SCAN Listener 与 Local Listener 的关系

这是很多 DBA 容易混淆的地方。理解这个关系对性能调优和故障排查至关重要：

```
客户端 → SCAN Listener → Local Listener → 数据库实例
```

**完整连接流程：**

1. 客户端使用 SCAN Name 连接数据库（如 `jdbc:oracle:thin:@scan.example.com:1521/service_name`）
2. DNS 返回 3 个 SCAN VIP 中的一个（round-robin）
3. 客户端连接到对应的 SCAN Listener
4. SCAN Listener 根据负载均衡算法选择一个 Local Listener
5. SCAN Listener 将请求重定向（redirect）到 Local Listener
6. Local Listener 建立与数据库实例的连接

```bash
# 查看 SCAN Listener 的状态
srvctl status scan_listener

SCAN Listener LISTENER_SCAN1 is enabled
SCAN Listener LISTENER_SCAN1 is running on node node2
SCAN Listener LISTENER_SCAN2 is enabled
SCAN Listener LISTENER_SCAN2 is running on node node1
SCAN Listener LISTENER_SCAN3 is enabled
SCAN Listener LISTENER_SCAN3 is running on node node2

# 查看 Local Listener 的配置
srvctl config listener -l LISTENER

Name: LISTENER
Type: Database Listener
Network: 1, Owner: grid
Home: <CRS home>
End points: TCP:1521
Listener is enabled.
Listener is individually enabled on nodes:
Listener is individually disabled on nodes:
```

#### 2.4.3 SCAN 的负载均衡机制

SCAN 提供了两层负载均衡：

**第一层：DNS Round-Robin**

客户端解析 SCAN Name 时，DNS 返回 3 个 IP 中的一个。这是最基本的负载分散机制。

**第二层：SCAN Listener 智能路由**

SCAN Listener 会根据各节点的负载情况，将连接请求路由到负载最低的节点。这个信息来自 PMON 进程注册到 Listener 中的 `Load` 指标。

> **11.2 vs 12c 的差异**：12c 引入了 **Remote Listener** 的概念，Local Listener 和 SCAN Listener 都注册到 Remote Listener，实现了更灵活的连接路由。此外，12c 的 SCAN 支持 IPv6 和 TLS 加密连接。

#### 2.4.4 SCAN IP 变更流程

生产环境中，SCAN IP 变更是一个常见需求（如网络迁移）。正确的变更流程如下：

```bash
# 1. 停止 SCAN 相关资源
srvctl stop scan_listener
srvctl stop scan

# 2. 修改 SCAN 配置
srvctl modify scan -scanname scan.newdomain.com

# 3. 如果需要修改 SCAN IP（不使用 DNS 的场景）
srvctl modify scan -scanname scan.example.com -netnum 1

# 4. 重新启动 SCAN 资源
srvctl start scan
srvctl start scan_listener

# 5. 验证配置
srvctl config scan
srvctl status scan_listener
```

> **重要**：修改 SCAN IP 后，必须同步更新 DNS 记录或 `/etc/hosts` 文件（仅测试环境）。生产环境强烈建议使用 DNS 解析。

---

### 2.5 GPNP Profile

#### 2.5.1 GPNP 的作用

GPNP (Grid Plug and Play) 是 11gR2 引入的集群配置管理框架，其核心作用是：

- **存储集群网络配置**：节点名称、网络接口、IP 地址等
- **支持动态添加/删除节点**：新节点加入集群时自动获取配置
- **与 OUI 集成**：安装 GI 时自动创建和分发 GPNP Profile

GPNP Profile 存储在 `$GRID_HOME/gpnp/<hostname>/profiles/peer/profile.xml` 文件中。

#### 2.5.2 profile.xml 文件解析

```xml
<?xml version="1.0" encoding="UTF-8"?>
<gpn:GpnPProfile
    xmlns:gpnp="http://www.oracle.com/GpnP/Profile"
    version="11.2.0.4.0"
    ...
    <gpnp:Network-Profile>
        <gpnp:HostNetwork id="gen" HostName="node1">
            <gpnp:Network id="net1"
                Adapter="eth0" IP="subnet" Prefix="24"
                Use="cluster_interconnect"/>
            <gpnp:Network id="net2"
                Adapter="eth1" IP="public" Prefix="24"
                Use="public"/>
        </gpnp:HostNetwork>
        <gpnp:Network id="net3"
            Adapter="eth2" IP="192.168.10.0" Prefix="24"
            Use="public"/>
    </gpnp:Network-Profile>
    <orcl:CSS-Profile id="css"
        DiscoveryString="+asm" LeaseDuration="400"/>
    <orcl:ASM-Profile id="asm"
        DiscoveryString="/dev/sd*" SPFile="+CRS/rac-cluster/ASMPARAMETERFILE/registry.253.xxx"/>
</gpn:GpnPProfile>
```

> **注意**：不要手动修改 profile.xml，这会导致集群配置不一致。如果 profile.xml 损坏，可以使用 `gpnptool` 工具从其他节点获取正确的版本。

```bash
# 查看 GPNP Profile
gpnptool get -o- 2>/dev/null | xmllint --format -

# 导出 GPNP Profile（用于故障排查）
gpnptool getpval -asm_dis -pval 2>/dev/null
```

---

### 2.6 GI 集群启动过程

理解 GI 的启动顺序是排查集群启动故障的关键。整个启动过程可以分为以下几个阶段：

```
[OS启动]
    │
    ▼
[init/systemd 启动 ohasd.service]
    │
    ▼
OHASD (Oracle High Availability Services Daemon)
    │
    ├──→ CSSDAGENT ──→ OCSSD (集群同步服务)
    │                      │
    │                      ├── 读取 Voting Disk
    │                      ├── 建立节点间心跳
    │                      └── 完成集群成员发现
    │
    ├──→ ORAROOTAGENT ──→ 网络资源（VIP、SCAN VIP、Node VIP）
    │
    ├──→ GPNPD (Grid Plug and Play Daemon)
    │       └── 加载 profile.xml
    │
    └──→ CTSSD (Cluster Time Synchronization Service)
            └── 时间同步检查
    │
    ▼
[OCSSD 就绪，集群成员确认]
    │
    ▼
CRSD (Cluster Ready Services Daemon)
    │
    ├──→ 读取 OCR
    │
    ├──→ ORAROOTAGENT
    │       ├── 启动 Node VIP
    │       ├── 启动 SCAN VIP
    │       └── 启动 Network Resource
    │
    └──→ ORAAGENT (grid 用户)
            ├── 启动 ASM 实例
            ├── 启动 SCAN Listener
            └── 启动 Local Listener
    │
    ▼
[CRSD 就绪，可以管理数据库资源]
    │
    ▼
ORAAGENT (oracle 用户)
    ├── 启动数据库实例
    ├── 启动数据库 Service
    └── 启动数据库 Listener（如果使用独立 Listener）
```

#### 各守护进程的职责

| 进程 | 全称 | 职责 |
|------|------|------|
| OHASD | Oracle High Availability Services Daemon | 最底层守护进程，管理所有本地资源 |
| OCSSD | Oracle Cluster Synchronization Services Daemon | 集群同步、节点发现、脑裂仲裁 |
| CSSDAGENT | CSS Daemon Agent | 监控 OCSSD 健康状态，负责节点驱逐 |
| CRSD | Cluster Ready Services Daemon | 管理集群资源（数据库、Service、VIP 等） |
| CTSSD | Cluster Time Synchronization Service Daemon | 集群节点时间同步 |
| GPNPD | Grid Plug and Play Daemon | 管理 GPNP Profile |
| EVMD | Event Manager Daemon | 集群事件管理 |

#### 关键日志位置

排查 GI 启动问题时，需要关注以下日志：

```bash
# OHASD 日志（启动最早，最先查看）
$GRID_HOME/log/<hostname>/ohasd/ohasd.log

# OCSSD 日志（集群同步相关问题）
$GRID_HOME/log/<hostname>/cssd/ocssd.log

# CRSD 日志（资源管理相关问题）
$GRID_HOME/log/<hostname>/crsd/crsd.log

# ASM 日志（ASM 实例启动问题）
$GRID_HOME/log/<hostname>/asm/asm_<+ASM1>.log

# ALERT 日志（集群级别的告警）
$GRID_HOME/log/<hostname>/alert<hostname>.log

# 节点驱逐相关日志
$GRID_HOME/log/<hostname>/cssd/cssdOUT.log
```

---

## 三、实战操作

### 3.1 OCR 管理

#### 3.1.1 检查 OCR 状态

```bash
# 检查 OCR 完整性
ocrcheck

Status of Oracle Cluster Registry is as follows :
         Version                  :          4
         Total space (kbytes)     :     409600
         Used space (kbytes)      :       3456
         Available space (kbytes) :     406144
         ID                       : 1234567890
         Device/File Name         :       +CRS
                                    Device/File integrity check succeeded

         Device/File not configured

         Device/File not configured

         Device/File not configured

         Device/File not configured

         Cluster registry integrity check succeeded

         Logical corruption check bypassed due to insufficient quorum
```

> **解读**：12c+ 中，OCR 存储在 ASM 磁盘组中，`Device/File Name` 显示的是磁盘组名称（如 `+CRS`）。如果配置了 Normal Redundancy，ASM 会自动维护 3 份 OCR 副本。

#### 3.1.2 OCR 备份

```bash
# 手动备份 OCR
ocrconfig -manualbackup

node1     2026/06/05 10:30:15     /u01/app/19c/grid/cdata/rac-cluster/backup_20260605.ocr
node2     2026/06/04 22:00:10     /u01/app/19c/grid/cdata/rac-cluster/backup_20260604.ocr

# 查看自动备份
ocrconfig -showbackup auto

node1     2026/06/05 06:00:00     /u01/app/19c/grid/cdata/rac-cluster/backup00.ocr
node1     2026/06/05 02:00:00     /u01/app/19c/grid/cdata/rac-cluster/backup01.ocr
node1     2026/06/04 22:00:00     /u01/app/19c/grid/cdata/rac-cluster/backup02.ocr
node1     2026/06/04 18:00:00     /u01/app/19c/grid/cdata/rac-cluster/day.ocr
node1     2026/05/29 06:00:00     /u01/app/19c/grid/cdata/rac-cluster/week.ocr

# 逻辑导出 OCR（建议定期执行）
ocrconfig -export /tmp/ocr_export_20260605.bak
```

#### 3.1.3 添加/删除 OCR 镜像

```bash
# 查看当前 OCR 配置
ocrcheck
# 假设当前 OCR 在 +CRS 磁盘组，需要添加镜像到 +DATA 磁盘组

# 添加 OCR 到另一个 ASM 磁盘组（12c+ 中使用 ocrconfig -add）
ocrconfig -add +DATA

# 验证添加成功
ocrcheck

Status of Oracle Cluster Registry is as follows :
         Version                  :          4
         Total space (kbytes)     :     409600
         Used space (kbytes)      :       3456
         Available space (kbytes) :     406144
         ID                       : 1234567890
         Device/File Name         :       +CRS
                                    Device/File integrity check succeeded
         Device/File Name         :       +DATA
                                    Device/File integrity check succeeded

# 删除 OCR 镜像（注意：不能删除最后一份 OCR）
ocrconfig -delete +DATA
```

> **MOS 参考**：Doc ID 394654.1 - OCR / Voting Disk Location and Management

---

### 3.2 Voting Disk 管理

#### 3.2.1 查看 Voting Disk 状态

```bash
crsctl query css votedisk

##  STATE    File Universal Id                File Name Disk group
--  -----    -----------------                --------- ---------
 1. ONLINE   a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6 (DATA01) [DATA]
 2. ONLINE   b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7 (DATA02) [DATA]
 3. ONLINE   c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8 (DATA03) [DATA]
Located 3 voting file(s).
```

#### 3.2.2 添加/删除 Voting Disk

```bash
# 添加 Voting Disk 到另一个 ASM 磁盘组
crsctl add css votedisk +FLASH

# 删除 Voting Disk
crsctl delete css votedisk a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6

# 注意：11gR2+ 中，如果 Voting Disk 存储在 ASM 磁盘组中，
# Voting Disk 的数量由磁盘组的冗余级别决定，无法手动增减。
# 只能将 Voting Disk 迁移到另一个冗余级别不同的磁盘组。
```

> **重要提醒**：在 11gR2+ 中，如果 Voting Disk 存储在 Normal Redundancy 的 ASM 磁盘组中，ASM 会自动维护 3 份 Voting Disk 副本。你无法手动添加或删除单个 Voting Disk，只能将 Voting Disk 整体迁移到另一个磁盘组。

---

### 3.3 SCAN 管理

#### 3.3.1 查看 SCAN 配置

```bash
# 查看 SCAN 配置
srvctl config scan

SCAN name: scan.example.com, Network: 1
Subnet IPv4: 192.168.1.0/255.255.255.0/eth0, static
Subnet IPv6:
SCAN 1 IPv4 VIP: 192.168.1.100/255.255.255.0
SCAN 2 IPv4 VIP: 192.168.1.101/255.255.255.0
SCAN 3 IPv4 VIP: 192.168.1.102/255.255.255.0

# 查看 SCAN Listener 状态
srvctl status scan_listener

SCAN Listener LISTENER_SCAN1 is enabled
SCAN Listener LISTENER_SCAN1 is running on node node2
SCAN Listener LISTENER_SCAN2 is enabled
SCAN Listener LISTENER_SCAN2 is running on node node1
SCAN Listener LISTENER_SCAN3 is enabled
SCAN Listener LISTENER_SCAN3 is running on node node2

# 验证 DNS 解析
nslookup scan.example.com

Server:         192.168.1.1
Address:        192.168.1.1#53

Name:   scan.example.com
Address: 192.168.1.100
Name:   scan.example.com
Address: 192.168.1.101
Name:   scan.example.com
Address: 192.168.1.102
```

#### 3.3.2 SCAN IP 变更完整流程

```bash
# 步骤 1：更新 DNS 记录（在 DNS 服务器上操作）
# 将 scan.example.com 的 A 记录修改为新的 IP 地址

# 步骤 2：停止 SCAN 相关资源
srvctl stop scan_listener
srvctl stop scan

# 步骤 3：修改 SCAN 配置（如果 SCAN Name 改变）
srvctl modify scan -scanname scan.newdomain.com

# 步骤 4：更新 SCAN VIP（如果 IP 地址改变，需要先获取资源名称）
srvctl modify scan -scanname scan.example.com

# 步骤 5：重新启动 SCAN 资源
srvctl start scan
srvctl start scan_listener

# 步骤 6：验证
srvctl status scan
srvctl status scan_listener
nslookup scan.example.com
```

---

### 3.4 GI 启动诊断

#### 3.4.1 启动失败诊断流程

当 GI 启动失败时，建议按照以下顺序排查：

```bash
# 步骤 1：查看 OHASD 日志
tail -100 $GRID_HOME/log/$(hostname)/ohasd/ohasd.log

# 步骤 2：查看集群 alert 日志
tail -100 $GRID_HOME/log/$(hostname)/alert$(hostname).log

# 步骤 3：查看 OCSSD 日志（如果集群同步失败）
tail -100 $GRID_HOME/log/$(hostname)/cssd/ocssd.log

# 步骤 4：检查 CRS 资源状态
crsctl stat res -t -init

# 步骤 5：检查 ASM 实例状态
srvctl status asm

# 步骤 6：检查磁盘组状态
asmcmd lsdg
```

#### 3.4.2 日志收集工具

Oracle 提供了 `diagcollection.sh` 工具，可以一键收集所有 GI 相关日志：

```bash
# 收集所有 GI 日志（需要 root 权限）
$GRID_HOME/bin/diagcollection.pl --collect --crs --crshome $GRID_HOME

# 收集结果会打包成 .tar.gz 文件，通常在 /tmp 目录下
# 文件名格式：crsData_<hostname>_<timestamp>.tar.gz
```

#### 3.4.3 紧急启动模式

当 CRS 无法正常启动时，可以使用 exclusive 模式进行紧急操作：

```bash
# 以 exclusive 模式启动 CRS（跳过 OCR 和 Voting Disk 的集群检查）
crsctl start crs -excl

# 在 exclusive 模式下，可以执行以下操作：
# - 恢复 OCR
# - 修改网络配置
# - 修复 ASM 磁盘组

# 完成修复后，停止 CRS
crsctl stop crs -f

# 正常启动 CRS
crsctl start crs
```

> **注意**：`crsctl start crs -excl` 会在当前节点启动一个简化的 CRS 栈，不进行集群成员验证。这在 OCR 或 Voting Disk 损坏时非常有用。

#### 3.4.4 常见启动故障及解决方案

**故障 1：OHASD 无法启动**

```bash
# 症状：crsctl start crs 报错
# CRS-4640: Oracle High Availability Services is already active
# CRS-4000: Start command failed, or completed with errors.

# 解决方案：
crsctl stop crs -f
# 如果无法停止，使用 kill
kill -9 $(pgrep -f ohasd)
# 重新启动
crsctl start crs
```

**故障 2：OCSSD 无法加入集群**

```bash
# 症状：ocssd.log 中出现
# CSSD]clssnmvDHBValidateNCopy: node 1, node1, has a disk HB, but no network HB
# CSSD]clssnmvDHBValidateNCopy: node 2, node2, has a disk HB, but no network HB

# 解决方案：检查网络连通性和防火墙
# 检查私有网络是否互通
ping -c 3 <node2-priv-ip>
# 检查防火墙是否放行
iptables -L -n | grep 1521
```

**故障 3：CRSD 启动失败（OCR 不可访问）**

```bash
# 症状：crsd.log 中出现
# CRS-1205: Auto-start failed for the CRS stack.
# CRS-2883: Resource 'ora.asm' failed during Clusterware stack start.

# 解决方案：使用 exclusive 模式启动，检查 ASM 磁盘组状态
crsctl start crs -excl
asmcmd lsdg
# 如果 ASM 磁盘组需要修复
sqlplus / as sysasm
ALTER DISKGROUP DATA MOUNT;
```

---

## 四、结果验证

GI 安装或变更后，需要执行以下验证命令确认集群状态正常：

```bash
# 1. 检查集群整体状态
crsctl check cluster -all

node1:
CRS-4537: Cluster Ready Services is online
CRS-4529: Cluster Synchronization Services is online
CRS-4533: Event Manager is online

node2:
CRS-4537: Cluster Ready Services is online
CRS-4529: Cluster Synchronization Services is online
CRS-4533: Event Manager is online

# 2. 检查 OCR 完整性
ocrcheck

Status of Oracle Cluster Registry is as follows :
         Version                  :          4
         Total space (kbytes)     :     409600
         Used space (kbytes)      :       3456
         Available space (kbytes) :     406144
         ID                       : 1234567890
         Device/File Name         :       +CRS
                                    Device/File integrity check succeeded
         Cluster registry integrity check succeeded

# 3. 检查 Voting Disk 状态
crsctl query css votedisk

##  STATE    File Universal Id                File Name Disk group
--  -----    -----------------                --------- ---------
 1. ONLINE   a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6 (DATA01) [DATA]
 2. ONLINE   b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7 (DATA02) [DATA]
 3. ONLINE   c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8 (DATA03) [DATA]
Located 3 voting file(s).

# 4. 检查 SCAN Listener 状态
srvctl status scan_listener

SCAN Listener LISTENER_SCAN1 is enabled
SCAN Listener LISTENER_SCAN1 is running on node node2
SCAN Listener LISTENER_SCAN2 is enabled
SCAN Listener LISTENER_SCAN2 is running on node node1
SCAN Listener LISTENER_SCAN3 is enabled
SCAN Listener LISTENER_SCAN3 is running on node node2

# 5. 检查所有 CRS 资源状态
crsctl stat res -t

# 6. 检查 ASM 磁盘组状态
asmcmd lsdg

# 7. 检查节点间网络连通性
oifcfg getif
eth0  192.168.1.0  global  public
eth1  10.10.10.0   global  cluster_interconnect
```

---

## 五、经验总结

### 5.1 GI 日常巡检要点

建议将以下命令纳入日常巡检脚本：

```bash
#!/bin/bash
# GI 日常巡检脚本

echo "=== 集群状态检查 ==="
crsctl check cluster -all

echo "=== OCR 状态检查 ==="
ocrcheck

echo "=== Voting Disk 状态检查 ==="
crsctl query css votedisk

echo "=== SCAN Listener 状态 ==="
srvctl status scan_listener

echo "=== ASM 磁盘组状态 ==="
asmcmd lsdg

echo "=== CRS 资源状态 ==="
crsctl stat res -t

echo "=== 集群告警日志最近 50 行 ==="
tail -50 $GRID_HOME/log/$(hostname)/alert$(hostname).log
```

### 5.2 OCR/Voting Disk 备份策略

| 备份项目 | 频率 | 保留策略 | 工具 |
|----------|------|----------|------|
| OCR 自动备份 | 每 4 小时 | 保留最近 3 次 | CRSD 自动执行 |
| OCR 手动备份 | 每次变更前 | 永久保留 | `ocrconfig -manualbackup` |
| OCR 逻辑导出 | 每周一次 | 保留最近 4 周 | `ocrconfig -export` |
| GPNP Profile | 每次变更前 | 永久保留 | `gpnptool get` |

### 5.3 SCAN 配置的最佳实践

1. **始终使用 DNS 解析 SCAN Name**，不要在生产环境使用 `/etc/hosts`
2. **配置 3 个 SCAN VIP**，确保 DNS 返回 3 个 IP 地址
3. **定期验证 DNS 解析**：`nslookup scan.example.com` 应返回 3 个 IP
4. **SCAN Listener 的端口统一使用 1521**，避免应用连接配置复杂化
5. **不要将 SCAN VIP 绑定到特定节点**，让 Oracle 自动管理 SCAN Listener 的分布

### 5.4 常见 GI 故障的快速定位方法

| 故障现象 | 可能原因 | 排查方向 |
|----------|----------|----------|
| CRS 启动失败 | OCR 损坏 | 查看 ohsd.log、crsd.log |
| 节点频繁驱逐 | 网络抖动/存储超时 | 查看 cssd.log、检查 Misscount |
| SCAN IP 无法解析 | DNS 配置错误 | nslookup、检查 DNS 记录 |
| ASM 实例无法启动 | 磁盘组损坏 | 查看 asm alert log、asmcmd lsdg |
| VIP 漂移异常 | 网络配置错误 | oifcfg getif、检查网卡配置 |
| 集群时间不同步 | NTP/CTSS 配置问题 | 查看 ctssd.log、检查时钟偏移 |

### 5.5 推荐 MOS 文档

| Doc ID | 标题 | 适用场景 |
|--------|------|----------|
| 394654.1 | OCR / Voting Disk Location and Management | OCR/Voting Disk 管理 |
| 1068982.1 | How to restore OCR from backup | OCR 恢复 |
| 1388755.1 | Changes in 11.2.0.2 with Voting Disk on ASM | Voting Disk 存储变化 |
| 1481369.1 | SCAN VIP and Listener Configuration | SCAN 配置 |
| 1323538.1 | 11gR2 Clusterware Startup Sequence | 集群启动顺序 |

---

## 总结

GI 是 RAC 架构的核心，深入理解其底层机制对于 DBA 至关重要。本文从 OCR、Voting Disk、SCAN、GPNP、集群启动过程五个维度，系统性地分析了 GI 的内部工作原理，并提供了丰富的实战操作命令和故障排查方法。

**核心要点回顾：**

1. **OCR** 是集群配置中心，12c+ 存储在 ASM 中，利用 ASM 冗余机制保护
2. **Voting Disk** 是集群仲裁者，负责节点健康检查和脑裂解决
3. **SCAN** 是客户端连接抽象层，通过 DNS 解析和 SCAN Listener 实现负载均衡
4. **GPNP** 存储集群网络配置，支持动态节点管理
5. **集群启动** 有严格的顺序依赖：OHASD → CSSDAGENT → OCSSD → CRSD

掌握这些知识，不仅能帮助你在生产故障中快速定位问题，更能让你在架构设计和容量规划时做出更明智的决策。作为 OCM 认证的 DBA，我始终认为：**深入理解底层原理，才是区分高级 DBA 和普通 DBA 的关键。**
