---
title: RAC + ASM on Multipath 存储：从多路径配置到磁盘组管理的完整指南
date: 2026-01-26 10:00:00
categories: Oracle
tags: [RAC, ASM, Multipath, 存储, 多路径, 冗余策略]
---

## 一、问题背景

Oracle RAC (Real Application Clusters) 配合 ASM (Automatic Storage Management) 是目前业界最经典的高可用数据库架构。RAC 解决了计算层的高可用与横向扩展，ASM 则在存储层提供了自动化的卷管理、条带化和镜像能力。然而，很多 DBA 在搭建 RAC 时往往将注意力集中在集群软件和数据库实例上，忽略了存储层——尤其是**多路径（Multipath）**——的正确配置。

<!-- more -->


存储层配置不当会导致一系列严重问题：

- **磁盘路径单点故障**：HBA 卡、光纤线缆或存储控制器的任何一环出现故障，都会导致 IO 中断，RAC 节点直接被驱逐。
- **ASM 磁盘发现失败**：如果存储映射变更后未正确配置设备发现路径，ASM 实例将无法找到磁盘，导致磁盘组 dismount。
- **权限问题**：在 Linux 环境中，裸设备的 owner/group 权限不正确会导致 Oracle 无法打开磁盘，安装过程直接报错 `ORA-15025`、`ORA-27041` 等。

在生产环境中，存储阵列通常通过**双控制器**向主机暴露 LUN，主机端则通过**双 HBA 卡**连接存储。这就意味着同一块 LUN 在操作系统层面会看到多个 SCSI 设备（如 `/dev/sdb`、`/dev/sdc`、`/dev/sdd`、`/dev/sde`）。Multipath 的作用正是将这些底层物理路径聚合为一个逻辑设备，同时提供路径故障切换和负载均衡能力。

本文将从理论到实践，完整讲解在 RAC + ASM 架构中如何正确配置 Multipath 存储，并给出磁盘组创建和管理的完整操作指南。

---

## 二、理论分析

### 2.1 Linux Multipath 原理

Linux 下的多路径功能由 **DM (Device Mapper) Multipath** 提供，它是内核 `device-mapper` 框架的一部分。其架构可以简单理解为：

```
应用层 (Oracle ASM)
       ↓
/dev/mapper/mpathX  (Multipath 逻辑设备)
       ↓
device-mapper 内核模块 (路径选择、故障切换)
       ↓
/dev/sdX (多个 SCSI 路径设备)
       ↓
HBA 卡 → FC 交换机 → 存储控制器
```

**Active-Passive 模式**下，只有一条路径处于活动状态处理 IO，其余路径处于待命状态。当活动路径故障时，自动切换到备用路径。这种模式的路径切换时间较长（通常需要几秒），但实现简单、稳定性高。

**Active-Active 模式**下，所有路径同时处理 IO，实现真正的负载均衡。这要求存储阵列支持 ALUA (Asymmetric Logical Unit Access) 或明确支持并发 IO。大多数中高端存储（如 EMC Unity、HDS VSP、华为 OceanStor）都支持 ALUA。

Multipath 的核心配置参数包括：

- **path_checker**：路径健康检查方式，常用 `tur`（TEST UNIT READY 命令）或 `readsector0`
- **path_grouping_policy**：路径分组策略，`failover`（主备）、`multibus`（多路径共享）、`group_by_prio`（按优先级分组）
- **failback**：故障恢复策略，`immediate`（立即回切）、`manual`（手动）、或指定秒数
- **no_path_retry**：所有路径不可用时的重试策略，`queue` 表示排队等待，数字表示重试次数

### 2.2 ASM 磁盘发现机制

ASM 在启动时需要发现可用的磁盘，这一过程由 `ASM_DISKSTRING` 参数控制。该参数支持通配符，例如：

```sql
ALTER SYSTEM SET asm_diskstring = '/dev/mapper/mpath*' SCOPE=SPFILE;
-- 或使用 ASMFD
ALTER SYSTEM SET asm_diskstring = 'AFD:*' SCOPE=SPFILE;
```

ASM 发现磁盘后，会读取磁盘的**前两个 AU** 来获取 ASM 磁盘头信息。磁盘头结构称为 **kfdhdb**（Kernel File Directory Header Block），其中包含：

- 磁盘名称、磁盘编号
- 所属磁盘组名称和编号
- AU 大小
- 版本兼容性信息
- 分配表（AT）和空闲空间表（FST）的位置

**AU (Allocation Unit)** 是 ASM 的最小分配单元，默认大小为 1MB（12c 及以后支持 4MB）。ASM 的条带化分为两种粒度：

- **Fine-grained striping**：128KB 条带，适合 OLTP 系统的小 IO 随机读写
- **Coarse-grained striping**：AU 大小条带，适合数据仓库的大 IO 顺序读写

### 2.3 ASM 冗余策略

ASM 提供三种冗余策略，每种策略有不同的适用场景：

**External Redundancy**：不提供 ASM 级别的镜像，完全依赖底层存储的 RAID 保护。适用于已有企业级存储 RAID 保护的场景（RAID 10、RAID 5 等）。空间利用率最高，为 100%。

**Normal Redundancy**：提供 2-way mirror，ASM 将每个 extent 的两份副本分布在不同的故障组（Failure Group）中。至少需要两个故障组。空间利用率为 50%。适用于没有存储级镜像的场景，或对数据保护有额外要求的场景。

**High Redundancy**：提供 3-way mirror，三个副本分布在三个故障组中。空间利用率为 33%。适用于对数据可用性要求极高的核心业务系统。

空间计算公式：

```
可用空间 = 磁盘组原始空间 × (1 / 冗余因子) - 文件系统开销
```

例如，10 块 1TB 磁盘的磁盘组，Normal Redundancy 的可用空间约为 `(10 × 1TB × 0.5) - 开销 ≈ 4.5TB`。

### 2.4 ASM 权限管理

ASM 访问磁盘设备需要正确的权限配置。Linux 环境下有三种主要方案：

**udev rules 方案**：通过编写 udev 规则，将 Multipath 设备的 owner 设置为 `oracle:oinstall`，权限设置为 `0660`。这是最传统也是最通用的方案，适用于所有 Oracle 版本。

**ASMFD (ASM Filter Driver)**：Oracle 12c 引入的专用驱动，在内核层拦截对 ASM 磁盘的 IO，防止意外覆写 ASM 磁盘头。ASMFD 还简化了磁盘管理，无需手动配置权限。推荐在 12c 及以后版本中使用。

```sql
-- ASMFD 配置示例
$ asmcmd afd_label DATA01 /dev/mapper/mpathb
$ asmcmd afd_scan
$ asmcmd afd_lslbl
```

**oracleasm 方案**：使用 ASMLib 工具包，通过 `oracleasm createdisk` 命令标记磁盘。适用于 RHEL/OEL 系统，但自 RHEL 8 起不再提供原生 ASMLib 支持，需要第三方源。配置时需注意设置 `ORACLEASM_SCANORDER="dm"` 以优先扫描 Multipath 设备。

---

## 三、实战操作

### 3.1 多路径配置

#### 获取 SCSI 设备的 WWID

首先需要确定存储映射的 LUN 对应的 SCSI ID（WWID），以便在 multipath.conf 中进行精确配置：

```bash
# 方法一：使用 scsi_id 命令（RHEL 6/7）
/lib/udev/scsi_id -g -u -d /dev/sdb
# 输出示例：360060160f8a03800c8e6c5b7e3c3e411

# 方法二：使用 /sys 文件系统（RHEL 8+）
/lib/udev/scsi_id --whitelisted --device=/dev/sdb

# 方法三：查看所有 SCSI 设备信息
cat /sys/block/sd*/device/vendor
lsscsi
```

#### 完整的 multipath.conf 配置

以下是一个适用于 Oracle RAC 环境的 `/etc/multipath.conf` 完整配置示例：

```conf
# /etc/multipath.conf - Oracle RAC 环境配置
# 适用于 EMC/DELL PowerStore、HDS VSP、华为 OceanStor 等常见存储

defaults {
    udev_dir                /dev
    polling_interval        10
    path_selector           "round-robin 0"
    path_grouping_policy    multibus
    getuid_callout          "/lib/udev/scsi_id -g -u -d /dev/%n"
    path_checker            tur
    rr_min_io               100
    rr_min_io_rq            1
    max_fds                 8192
    no_path_retry           fail
    user_friendly_names     yes
    find_multipaths         yes
}

# 黑名单：排除本地磁盘和 USB 设备
blacklist {
    devnode "^(ram|raw|loop|fd|md|dm-|sr|scd|st)[0-9]*"
    devnode "^sd[a-b]$"        # 本地系统盘，根据实际环境调整
    device {
        vendor  "Dell"
        product "Virtual"
    }
    device {
        vendor  "ATA"
    }
}

# 黑名单例外：确保存储设备不被误排除
blacklist_exceptions {
    wwid    "360060160*"
    # wwid  "36000d310*"     # 根据存储厂商的 wwid 前缀调整
}

# 默认配置
multipaths {
    multipath {
        wwid                360060160f8a03800c8e6c5b7e3c3e411
        alias               asm_data01
        path_grouping_policy    group_by_prio
        path_selector           "round-robin 0"
        failback                immediate
        rr_weight               priorities
        no_path_retry           12
        prio                    alua
    }
    multipath {
        wwid                360060160f8a03800c8e6c5b7e3c3e412
        alias               asm_data02
        path_grouping_policy    group_by_prio
        path_selector           "round-robin 0"
        failback                immediate
        rr_weight               priorities
        no_path_retry           12
        prio                    alua
    }
    multipath {
        wwid                360060160f8a03800c8e6c5b7e3c3e501
        alias               asm_fra01
        path_grouping_policy    group_by_prio
        path_selector           "round-robin 0"
        failback                immediate
        rr_weight               priorities
        no_path_retry           12
        prio                    alua
    }
    multipath {
        wwid                360060160f8a03800c8e6c5b7e3c3e601
        alias               asm_ocr01
        path_grouping_policy    group_by_prio
        path_selector           "round-robin 0"
        failback                immediate
        rr_weight               priorities
        no_path_retry           queue
        prio                    alua
    }
}

devices {
    device {
        vendor                  "VNX"
        product                 ".*"
        path_grouping_policy    group_by_prio
        path_checker            tur
        path_selector           "round-robin 0"
        failback                immediate
        prio                    emc
        no_path_retry           12
        hardware_handler        "0"
    }
    # 华为 OceanStor 配置示例
    device {
        vendor                  "HUAWEI"
        product                 "XSG1"
        path_grouping_policy    group_by_prio
        path_checker            tur
        path_selector           "round-robin 0"
        failback                immediate
        prio                    alua
        no_path_retry           12
    }
}
```

#### 验证多路径配置

```bash
# 重载 multipath 配置
systemctl reload multipathd

# 查看多路径状态
multipath -ll

# 输出示例：
# asm_data01 (360060160f8a03800c8e6c5b7e3c3e411) dm-4 VNX,5300
# size=500G features='1 queue_if_no_path' hwhandler='1 alua'
# |- 3:0:0:0 sdb 8:16  active ready running
# |- 3:0:1:0 sdc 8:32  active ready running
# |- 4:0:0:0 sdd 8:48  active ready running
# `- 4:0:1:0 sde 8:64  active ready running

# 查看 multipath 设备拓扑
multipath -v3 -d      # dry-run 模式，不实际执行

# 查看 dm 设备信息
dmsetup ls
dmsetup status
```

### 3.2 ASM 磁盘准备

#### 方案一：使用 udev 配置磁盘权限

在 RHEL 7/8 中，创建 udev 规则文件 `/etc/udev/rules.d/99-oracle-asmdevices.rules`：

```bash
# /etc/udev/rules.d/99-oracle-asmdevices.rules
# 方式一：按 wwid 匹配（推荐）
ACTION=="add|change", ENV{DM_UUID}=="mpath-360060160f8a03800c8e6c5b7e3c3e411", OWNER="oracle", GROUP="oinstall", MODE="0660"
ACTION=="add|change", ENV{DM_UUID}=="mpath-360060160f8a03800c8e6c5b7e3c3e412", OWNER="oracle", GROUP="oinstall", MODE="0660"
ACTION=="add|change", ENV{DM_UUID}=="mpath-360060160f8a03800c8e6c5b7e3c3e501", OWNER="oracle", GROUP="oinstall", MODE="0660"
ACTION=="add|change", ENV{DM_UUID}=="mpath-360060160f8a03800c8e6c5b7e3c3e601", OWNER="oracle", GROUP="oinstall", MODE="0660"

# 方式二：按 alias 匹配
# ACTION=="add|change", ENV{DM_NAME}=="asm_data01", OWNER="oracle", GROUP="oinstall", MODE="0660"
# ACTION=="add|change", ENV{DM_NAME}=="asm_data02", OWNER="oracle", GROUP="oinstall", MODE="0660"
```

```bash
# 重载 udev 规则
udevadm control --reload-rules
udevadm trigger --type=devices --action=change

# 验证权限
ls -l /dev/mapper/asm_*
# brw-rw---- 1 oracle oinstall 253,  4 Jun  5 10:00 /dev/mapper/asm_data01
# brw-rw---- 1 oracle oinstall 253,  5 Jun  5 10:00 /dev/mapper/asm_data02
```

#### 方案二：ASMFD 配置流程

```bash
# 1. 配置 ASMFD 驱动（在 Grid Infrastructure 安装前执行）
$ asmcmd afd_configure
# 或在 GI 安装过程中选择 "Configure ASM Filter Driver"

# 2. 标记磁盘
$ asmcmd afd_label DATA01 /dev/mapper/asm_data01
$ asmcmd afd_label DATA02 /dev/mapper/asm_data02
$ asmcmd afd_label FRA01  /dev/mapper/asm_fra01
$ asmcmd afd_label OCR01  /dev/mapper/asm_ocr01

# 3. 扫描并验证
$ asmcmd afd_scan
$ asmcmd afd_lslbl
# ------------------------------------------------------------------------------------------------
# Label                     Duplicate  Path
# =================================================================================================
# DATA01                    No         /dev/mapper/asm_data01
# DATA02                    No         /dev/mapper/asm_data02
# FRA01                     No         /dev/mapper/asm_fra01
# OCR01                     No         /dev/mapper/asm_ocr01

# 4. 在 RAC 的所有节点执行 afd_scan
$ ssh racnode2 "asmcmd afd_scan"
```

#### 方案三：oracleasm createdisk

```bash
# 在所有节点执行
# 1. 配置 oracleasm
$ /etc/init.d/oracleasm configure
# Default user: oracle
# Default group: oinstall
# Start on boot: y
# Scan for disk on boot: y

# 2. 关键：配置扫描顺序，优先扫描 multipath 设备
# 编辑 /etc/sysconfig/oracleasm
ORACLEASM_SCANORDER="mpath dm"
ORACLEASM_SCANEXCLUDE="sd"

# 3. 创建 ASM 磁盘（在任一节点执行）
$ /etc/init.d/oracleasm createdisk DATA01 /dev/mapper/asm_data01
$ /etc/init.d/oracleasm createdisk DATA02 /dev/mapper/asm_data02
$ /etc/init.d/oracleasm createdisk FRA01  /dev/mapper/asm_fra01
$ /etc/init.d/oracleasm createdisk OCR01  /dev/mapper/asm_ocr01

# 4. 在其他节点扫描
$ /etc/init.d/oracleasm scandisks
$ /etc/init.d/oracleasm listdisks
```

### 3.3 ASM 磁盘组创建

#### 三种冗余级别的磁盘组创建语句

```sql
-- 1. External Redundancy：用于 DATA 磁盘组（存储层已有 RAID 10 保护）
CREATE DISKGROUP DATA EXTERNAL REDUNDANCY
  DISK '/dev/mapper/asm_data01' NAME DATA_001,
  DISK '/dev/mapper/asm_data02' NAME DATA_002
  ATTRIBUTE
    'compatible.asm'    = '19.0',
    'compatible.rdbms'  = '19.0',
    'au_size'           = '4M';

-- 2. Normal Redundancy：用于 FRA 磁盘组
CREATE DISKGROUP FRA NORMAL REDUNDANCY
  FAILGROUP FG1 DISK '/dev/mapper/asm_fra01' NAME FRA_001
  FAILGROUP FG2 DISK '/dev/mapper/asm_fra02' NAME FRA_002
  ATTRIBUTE
    'compatible.asm'    = '19.0',
    'compatible.rdbms'  = '19.0',
    'au_size'           = '4M';

-- 3. High Redundancy：用于 OCR/Voting Disk 磁盘组
CREATE DISKGROUP OCR HIGH REDUNDANCY
  FAILGROUP FG1 DISK '/dev/mapper/asm_ocr01' NAME OCR_001
  FAILGROUP FG2 DISK '/dev/mapper/asm_ocr02' NAME OCR_002
  FAILGROUP FG3 DISK '/dev/mapper/asm_ocr03' NAME OCR_003
  ATTRIBUTE
    'compatible.asm'    = '19.0',
    'compatible.rdbms'  = '19.0';
```

#### 兼容性属性说明

- **compatible.asm**：ASM 实例的最低兼容版本。设置后不可回退，影响 ASM 集群的功能特性。
- **compatible.rdbms**：数据库实例的最低兼容版本。如果数据库版本低于此值，将无法挂载该磁盘组。
- **au_size**：Allocation Unit 大小。12c 起支持 4MB，对大表空间能减少 extent map 的碎片化。

#### 条带化与性能优化

ASM 的条带化模式在 11g 以后默认使用 **Coarse striping**（AU 粒度）。对于 OLTP 系统，可以在文件级别设置 Fine striping：

```sql
-- 在数据库层面创建表空间时使用 Fine-grained striping
-- 需要通过文件属性控制，通常建议让 ASM 自动管理
```

最佳实践是将数据文件和归档日志放在不同的磁盘组（DATA vs FRA），避免 IO 竞争。

### 3.4 ASM 管理

#### asmcmd 常用命令

```bash
# 查看磁盘组状态
asmcmd lsdg

# 查看磁盘信息
asmcmd lsblk
# 或在 SQL 中：
# SQL> SELECT name, path, header_status, state, total_mb, free_mb FROM V$ASM_DISK;

# 查看实例信息
asmcmd lsinst

# 切换到特定磁盘组并浏览文件
asmcmd
ASMCMD> cd +DATA
ASMCMD> ls
ASMCMD> find +DATA -name "*.dbf"

# 手动 rebalance
ASMCMD> rebal -w   # 等待 rebalance 完成

# 查看 rebalance 进度
ASMCMD> lsop
```

#### 磁盘添加/删除/替换流程

```sql
-- 1. 添加新磁盘到现有磁盘组
ALTER DISKGROUP DATA ADD
  DISK '/dev/mapper/asm_data03' NAME DATA_003
  REBALANCE POWER 8;

-- 2. 监控 rebalance 进度
SELECT group_number, operation, state, power, est_minutes
FROM V$ASM_OPERATION;

-- 3. 删除磁盘（rebalance 会自动迁移数据）
ALTER DISKGROUP DATA DROP DISK DATA_003;

-- 4. 替换磁盘（先删后加）
ALTER DISKGROUP DATA
  DROP DISK DATA_001
  ADD DISK '/dev/mapper/asm_data04' NAME DATA_004
  REBALANCE POWER 8;

-- 5. 在线调整 rebalance 功率（0-11，0 表示暂停）
ALTER DISKGROUP ALL REBALANCE POWER 4;

-- 6. 挂载/卸载磁盘组
ALTER DISKGROUP DATA MOUNT;
ALTER DISKGROUP DATA DISMOUNT;

-- 7. 检查磁盘组一致性
ALTER DISKGROUP DATA CHECK ALL;
```

#### 自动化监控脚本

```sql
-- 检查所有磁盘组的空间使用率
SELECT name,
       type,
       total_mb,
       free_mb,
       ROUND((1 - free_mb / total_mb) * 100, 2) AS used_pct,
       ROUND(free_mb / DECODE(type, 'EXTERN', 1, 'NORMAL', 2, 'HIGH', 3), 2) AS effective_free_mb
FROM V$ASM_DISKGROUP
ORDER BY used_pct DESC;

-- 检查磁盘状态异常
SELECT name, path, header_status, mode_status, state
FROM V$ASM_DISK
WHERE header_status != 'MEMBER'
   OR mode_status != 'ONLINE'
   OR state != 'NORMAL';
```

---

## 四、结果验证

完成所有配置后，需要逐层验证整个存储链路：

#### 4.1 Multipath 层验证

```bash
# 确认所有路径均为 active/ready
multipath -ll | grep -E "(active|faulty|failed)"
# 所有路径应显示 "active ready running"

