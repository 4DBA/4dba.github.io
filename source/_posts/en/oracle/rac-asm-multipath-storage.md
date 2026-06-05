---
title: "RAC + ASM on Multipath Storage: Complete Guide from Multipath Configuration to Disk Group Management"
date: 2026-01-26 10:00:00
categories: Oracle
tags: [RAC, ASM, Multipath, 存储, 多路径, 冗余策略]
lang: en
---

## 1. Background

Oracle RAC (Real Application Clusters) combined with ASM (Automatic Storage Management) is the industry's most classic high-availability database architecture. RAC addresses high availability and horizontal scaling at the compute layer, while ASM provides automated volume management, striping, and mirroring capabilities at the storage layer. However, many DBAs tend to focus their attention on cluster software and database instances when setting up RAC, overlooking the correct configuration of the storage layer—especially **Multipath**.

Improper storage layer configuration can lead to a series of serious problems:

- **Single point of failure in disk paths**: Any failure in the HBA card, fiber optic cable, or storage controller will cause IO interruption, and RAC nodes will be evicted directly.
- **ASM disk discovery failure**: If the storage mapping changes and the device discovery path is not correctly configured, the ASM instance will be unable to find disks, causing the disk group to dismount.
- **Permission issues**: In Linux environments, incorrect owner/group permissions on raw devices will prevent Oracle from opening disks, and the installation process will directly report errors such as `ORA-15025`, `ORA-27041`, etc.

In production environments, storage arrays typically expose LUNs to hosts through **dual controllers**, while the host side connects to storage through **dual HBA cards**. This means the same LUN will appear as multiple SCSI devices at the OS level (e.g., `/dev/sdb`, `/dev/sdc`, `/dev/sdd`, `/dev/sde`). The purpose of Multipath is to aggregate these underlying physical paths into a single logical device, while providing path failover and load balancing capabilities.

This article provides a complete guide, from theory to practice, on how to correctly configure Multipath storage in a RAC + ASM architecture, along with comprehensive operational guidance for disk group creation and management.

---

## 2. Theoretical Analysis

### 2.1 Linux Multipath Principles

Multipath functionality in Linux is provided by **DM (Device Mapper) Multipath**, which is part of the kernel's `device-mapper` framework. Its architecture can be simply understood as:

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

In **Active-Passive mode**, only one path is active and processing IO, while the remaining paths are in standby state. When the active path fails, it automatically switches to the standby path. This mode has a longer path switchover time (typically a few seconds) but is simple to implement and highly stable.

In **Active-Active mode**, all paths process IO simultaneously, achieving true load balancing. This requires the storage array to support ALUA (Asymmetric Logical Unit Access) or explicitly support concurrent IO. Most mid-to-high-end storage systems (such as EMC Unity, HDS VSP, Huawei OceanStor) support ALUA.

Key configuration parameters for Multipath include:

- **path_checker**: Path health check method, commonly `tur` (TEST UNIT READY command) or `readsector0`
- **path_grouping_policy**: Path grouping policy, `failover` (active-standby), `multibus` (shared multipath), `group_by_prio` (group by priority)
- **failback**: Failback policy, `immediate` (immediate failback), `manual`, or specified number of seconds
- **no_path_retry**: Retry policy when all paths are unavailable, `queue` means queue and wait, a number means retry count

### 2.2 ASM Disk Discovery Mechanism

ASM needs to discover available disks at startup, a process controlled by the `ASM_DISKSTRING` parameter. This parameter supports wildcards, for example:

```sql
ALTER SYSTEM SET asm_diskstring = '/dev/mapper/mpath*' SCOPE=SPFILE;
-- 或使用 ASMFD
ALTER SYSTEM SET asm_diskstring = 'AFD:*' SCOPE=SPFILE;
```

After ASM discovers a disk, it reads the **first two AUs** of the disk to obtain the ASM disk header information. The disk header structure is called **kfdhdb** (Kernel File Directory Header Block), which contains:

- Disk name, disk number
- Disk group name and number it belongs to
- AU size
- Version compatibility information
- Location of Allocation Table (AT) and Free Space Table (FST)

**AU (Allocation Unit)** is ASM's minimum allocation unit, with a default size of 1MB (4MB supported from 12c onwards). ASM's striping is divided into two granularities:

- **Fine-grained striping**: 128KB stripe, suitable for small IO random read/write in OLTP systems
- **Coarse-grained striping**: AU-sized stripe, suitable for large IO sequential read/write in data warehouses

### 2.3 ASM Redundancy Strategies

ASM provides three redundancy strategies, each with different applicable scenarios:

**External Redundancy**: Does not provide ASM-level mirroring, relying entirely on the underlying storage's RAID protection. Suitable for scenarios with existing enterprise storage RAID protection (RAID 10, RAID 5, etc.). Highest space utilization at 100%.

**Normal Redundancy**: Provides 2-way mirror, ASM distributes two copies of each extent across different Failure Groups. At least two failure groups are required. Space utilization is 50%. Suitable for scenarios without storage-level mirroring, or scenarios with additional data protection requirements.

**High Redundancy**: Provides 3-way mirror, with three copies distributed across three failure groups. Space utilization is 33%. Suitable for core business systems with extremely high data availability requirements.

Space calculation formula:

```
可用空间 = 磁盘组原始空间 × (1 / 冗余因子) - 文件系统开销
```

For example, a disk group with 10 x 1TB disks in Normal Redundancy has available space of approximately `(10 × 1TB × 0.5) - overhead ≈ 4.5TB`.

### 2.4 ASM Permission Management

ASM requires correct permission configuration to access disk devices. In Linux environments, there are three main approaches:

**udev rules approach**: Write udev rules to set the owner of Multipath devices to `oracle:oinstall` and permissions to `0660`. This is the most traditional and universal approach, suitable for all Oracle versions.

**ASMFD (ASM Filter Driver)**: Introduced in Oracle 12c, this is a dedicated driver that intercepts IO to ASM disks at the kernel level, preventing accidental overwriting of ASM disk headers. ASMFD also simplifies disk management by eliminating the need to manually configure permissions. Recommended for use in 12c and later versions.

```sql
-- ASMFD 配置示例
$ asmcmd afd_label DATA01 /dev/mapper/mpathb
$ asmcmd afd_scan
$ asmcmd afd_lslbl
```

**oracleasm approach**: Uses the ASMLib toolkit, marking disks with the `oracleasm createdisk` command. Suitable for RHEL/OEL systems, but native ASMLib support is no longer available from RHEL 8 onwards, requiring third-party sources. During configuration, note that `ORACLEASM_SCANORDER="dm"` should be set to prioritize scanning Multipath devices.

---

## 3. Hands-On Operations

### 3.1 Multipath Configuration

#### Obtaining SCSI Device WWID

First, you need to determine the SCSI ID (WWID) of the storage-mapped LUN for precise configuration in multipath.conf:

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

#### Complete multipath.conf Configuration

The following is a complete `/etc/multipath.conf` configuration example suitable for Oracle RAC environments:

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

#### Verifying Multipath Configuration

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

### 3.2 ASM Disk Preparation

#### Option 1: Using udev to Configure Disk Permissions

In RHEL 7/8, create the udev rules file `/etc/udev/rules.d/99-oracle-asmdevices.rules`:

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

#### Option 2: ASMFD Configuration Workflow

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

#### Option 3: oracleasm createdisk

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

### 3.3 ASM Disk Group Creation

#### Disk Group Creation Statements for Three Redundancy Levels

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

#### Compatibility Attribute Description

- **compatible.asm**: Minimum compatible version for the ASM instance. Once set, it cannot be rolled back. Affects ASM cluster feature capabilities.
- **compatible.rdbms**: Minimum compatible version for the database instance. If the database version is lower than this value, the disk group cannot be mounted.
- **au_size**: Allocation Unit size. 4MB is supported from 12c onwards, and for large tablespaces it can reduce extent map fragmentation.

#### Striping and Performance Optimization

ASM's striping mode uses **Coarse striping** (AU granularity) by default since 11g. For OLTP systems, Fine striping can be set at the file level:

```sql
-- 在数据库层面创建表空间时使用 Fine-grained striping
-- 需要通过文件属性控制，通常建议让 ASM 自动管理
```

Best practice is to place data files and archive logs in different disk groups (DATA vs FRA) to avoid IO contention.

### 3.4 ASM Management

#### Common asmcmd Commands

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

#### Disk Add/Delete/Replace Workflow

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

#### Automated Monitoring Scripts

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

## 4. Result Verification

After completing all configurations, the entire storage link must be verified layer by layer:

#### 4.1 Multipath Layer Verification

```bash
# 确认所有路径均为 active/ready
multipath -ll | grep -E "(active|faulty|failed)"
# 所有路径应显示 "active ready running"

# 检查路径数量是否与预期一致
multipath -ll | grep -c "ready"
# 应等于 HBA 卡数 × 存储控制器数（通常为 4 条路径）

# 模拟路径故障测试
echo 1 > /sys/block/sdb/device/delete
# 等待几秒后 multipath -ll 确认路径切换正常
# 然后重新扫描 SCSI 设备恢复
echo "- - -" > /sys/class/scsi_host/host3/scan
```

#### 4.2 ASM Layer Verification

```sql
-- 检查磁盘组状态
SELECT name, state, type, total_mb, free_mb
FROM V$ASM_DISKGROUP;
-- state 应为 MOUNTED

-- 检查磁盘状态
SELECT name, path, header_status, mode_status, state, total_mb, free_mb
FROM V$ASM_DISK
ORDER BY group_number, disk_number;
-- header_status 应为 MEMBER，mode_status 应为 ONLINE

-- 检查 ASM 实例参数
SELECT name, value FROM V$PARAMETER
WHERE name IN ('asm_diskstring', 'asm_power_limit', 'asm_diskgroups');
```

#### 4.3 ASM Alert Log Check

```bash
# 查看 ASM alert 日志（12c+ 位置）
$ tail -100 $ORACLE_BASE/diag/asm/+asm/+ASM1/trace/alert_+ASM1.log

# 关注以下关键字：
# - "Disk group XXX mounted successfully"
# - "WARNING: Read Failed" — 表示有 IO 读取失败
# - "ORA-27072" — 文件 IO 错误
# - "rebalance completed" — rebalance 操作完成
```

#### 4.4 IO Performance Verification

```bash
# 使用 fio 测试 Multipath 设备的 IO 性能
fio --name=asm_test \
    --filename=/dev/mapper/asm_data01 \
    --direct=1 \
    --rw=randread \
    --bs=8k \
    --numjobs=4 \
    --size=1G \
    --runtime=60 \
    --group_reporting

# 使用 Oracle Orion 工具测试
# Orion 是 Oracle 官方提供的 IO 性能测试工具
$ orion -run advanced -testname asm_io \
    -num_disks 10 -size_small 8 -size_large 1024 \
    -type rand -matrix point \
    -num_large 1 -num_small 8
```

---

## 5. Lessons Learned

### 5.1 Storage Configuration Checklist

Before each RAC + ASM environment deployment, it is recommended to confirm each item in the following checklist:

| Check Item | Description | Status |
|-----------|-------------|--------|
| HBA card redundancy | At least 2 HBA cards per node | ☐ |
| Storage controller redundancy | LUNs mapped to dual controllers | ☐ |
| Multipath configuration | All storage LUNs accessed via Multipath devices | ☐ |
| Path status | multipath -ll all paths active | ☐ |
| Device permissions | oracle:oinstall 0660 | ☐ |
| ASM_DISKSTRING | Points to Multipath device paths | ☐ |
| SCSI ID uniqueness | Each LUN's WWID is unique | ☐ |
| udev rules | Rules consistent across all nodes | ☐ |
| I/O scheduler | Set to noop or none | ☐ |
| HugePages | Configure HugePages | ☐ |

### 5.2 ASM Disk Group Naming Convention

It is recommended to adopt a unified naming convention:

```
磁盘组前缀_用途编号
示例：
  +DATA01    — 第一组数据磁盘组
  +FRA01     — 闪回恢复区
  +OCR01     — OCR 和 Voting Disk
  +REDO01    — 专用 Redo 磁盘组（高 IOPS 场景）
```

### 5.3 Quick Troubleshooting for Common Storage Issues

**Issue 1: ASM Instance Cannot Discover Disks**

```bash
# 检查步骤：
# 1. 确认 Multipath 设备存在
ls -l /dev/mapper/asm_*
# 2. 确认权限正确
# 3. 确认 asm_diskstring 参数正确
# 4. 检查 ASM 实例参数中是否设置了正确的磁盘发现路径
```

**Issue 2: Path Switchover Causes RAC Node Eviction**

```bash
# 检查 Multipath 的 no_path_retry 设置
# 建议设置为 queue（排队等待），避免 IO 失败触发 CSS 超时
# 同时检查 CSS misscount 参数
$ crsctl get css misscount    # 默认 30 秒
```

**Issue 3: Disk Group Space Alert**

```sql
-- 紧急释放空间
-- 1. 删除不需要的归档日志和备份
-- 2. resize 数据文件
ALTER DATABASE DATAFILE '+DATA/prod/users01.dbf' RESIZE 10G;
-- 3. 添加新磁盘
ALTER DISKGROUP DATA ADD DISK '/dev/mapper/asm_data05' NAME DATA_005;
```

### 5.4 ASM Management Experience in Large-Scale Environments

When managing RAC clusters with more than 50 nodes, the following experience is very valuable:

1. **Use ASMFD instead of udev + oracleasm**: ASMFD provides better kernel-level protection and reduces the risk of configuration inconsistency.
2. **Don't make disk groups too large**: A single disk group should not exceed 20TB to avoid excessively long rebalance times.
3. **Set ASM_POWER_LIMIT appropriately**: Use lower power (2-4) for daily operations, increase to 8-11 during maintenance windows.
4. **Regularly check disk group consistency**: Verify periodically through `ALTER DISKGROUP ... CHECK`.
5. **Monitor IO latency**: Pay attention to read/write latency metrics in `V$ASM_DISK_STAT`.
6. **Establish Standard Operating Procedures (SOP)**: All storage changes must be documented with rollback plans.

---

> **Final Note**: Storage is the foundation of the database. The high-availability architecture of RAC + ASM is built on correct storage configuration. Multipath configuration may seem simple, but it sits at the lowest layer of the IO path, and when problems occur, the impact is enormous. I hope this article helps everyone avoid pitfalls in actual work. If you encounter complex storage issues, feel free to discuss in the comments section.
