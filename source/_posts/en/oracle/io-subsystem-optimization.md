---
title: "I/O Subsystem Optimization: End-to-End Tuning from ASM to the Linux I/O Stack"
date: 2026-03-18 10:00:00
lang: en
categories: Oracle
tags: [I/O, ASM, Linux, 性能调优, 存储, db file sequential read]
---

In the field of Oracle database performance optimization, CPU and memory issues can often be identified and resolved through relatively straightforward methods, whereas the I/O subsystem is the most elusive and far-reaching performance bottleneck. As an OCM-certified DBA, my years of production experience have taught me deeply: **the vast majority of serious database performance problems ultimately boil down to the I/O layer**. This article systematically introduces end-to-end optimization methods for the Oracle I/O subsystem, from theory to practice.

<!-- more -->

## I. Problem Background

### I/O Is the Ultimate Bottleneck of Database Performance

No matter how refined the SQL optimization is, no matter how well the SGA is configured, all data changes must ultimately be persisted to storage devices. When the I/O subsystem becomes a bottleneck, the overall database performance degrades dramatically.

In production environments, the most common I/O-related wait events include:

- **db file sequential read**: Typically associated with index access, indicating single-block I/O reads. The most common causes are index range scans and table data access via ROWID
- **db file scattered read**: Typically associated with full table scans, indicating multi-block I/O reads, corresponding to the `DB_FILE_MULTIBLOCK_READ_COUNT` parameter
- **log file sync**: The wait for LGWR to write the Redo Log Buffer to Online Redo Log, directly affecting transaction commit latency
- **db file parallel write**: The wait for DBWR to write dirty blocks to data files

### Business Impact of Storage Performance Issues

When the I/O subsystem experiences performance bottlenecks, the business-level symptoms typically include:

1. **Severe transaction response time fluctuations**: Transactions that normally respond in milliseconds occasionally spike to seconds or even higher
2. **Significantly increased batch task execution times**: ETL, reporting, and other batch processing tasks take twice as long or more
3. **Overall system throughput decline**: As concurrent user count increases, system performance drops off a cliff rather than degrading linearly

A case I once encountered: a core business system frequently experienced "enq: TX - row lock contention" during peak business hours. It appeared to be a lock contention issue, but in-depth analysis revealed the root cause was a decline in the storage array Cache hit ratio, causing I/O latency to spike from 1ms to over 50ms, which increased LGWR write latency, leading to increased log file sync waits, extended transaction lock-holding times, and ultimately manifesting as lock contention.

## II. Theoretical Analysis

### 2.1 Oracle I/O Model

#### Asynchronous I/O and Synchronous I/O

Oracle database supports two modes for I/O operations:

- **Synchronous I/O**: After initiating an I/O request, the process blocks and waits until the I/O completes before continuing execution. This approach has a simple programming model, but wastes significant CPU time waiting for I/O in high-concurrency scenarios
- **Asynchronous I/O**: After initiating an I/O request, the process returns immediately without waiting for the I/O to complete, and obtains I/O completion status through callbacks or polling mechanisms. This approach allows the process to handle other tasks while waiting for I/O completion, significantly improving CPU utilization

In Oracle, the enabling of asynchronous I/O is controlled by the following parameters:

```sql
-- 查看当前异步 I/O 配置
SELECT name, value FROM v$parameter 
WHERE name IN ('disk_asynch_io', 'filesystemio_options');

-- filesystemio_options 参数值含义：
-- NONE          : 禁用 Direct I/O 和异步 I/O
-- ASYNCH        : 启用异步 I/O，使用 Buffered I/O
-- DIRECTIO      : 启用 Direct I/O，使用同步 I/O  
-- SETALL        : 同时启用 Direct I/O 和异步 I/O（推荐）
```

#### Direct I/O and Buffered I/O

- **Buffered I/O**: Data passes through the operating system Page Cache before being written to disk. The advantage is that it leverages the OS caching mechanism; the disadvantage is that data undergoes double copying (OS Cache → SGA) and there are data consistency risks
- **Direct I/O**: Data bypasses the operating system Page Cache and is written directly from user space to the disk device. This avoids double caching and reduces CPU overhead and memory copying

For Oracle databases, **Direct I/O is strongly recommended**. Oracle has its own comprehensive caching management mechanism (SGA/Buffer Cache), and the OS Page Cache is not only redundant but also causes memory waste and additional CPU overhead.

#### DBWR and LGWR I/O Modes

- **DBWR (Database Writer)**: Responsible for writing dirty blocks from the Buffer Cache to data files. DBWR supports asynchronous I/O and batch writing (Write Batch) to improve write efficiency. In high-concurrency OLTP systems, DBWR write capability directly affects Checkpoint efficiency and available Buffer Cache space
- **LGWR (Log Writer)**: Responsible for writing the Redo Log Buffer content to Online Redo Log files. LGWR's I/O mode directly affects transaction commit latency (log file sync wait time). LGWR requires a low-latency, high-priority I/O path

### 2.2 ASM Striping

#### ASM Fine-grained vs Coarse-grained Striping

ASM (Automatic Storage Management) provides two striping granularity levels:

| Feature | Fine-grained | Coarse-grained |
|---------|-------------|----------------|
| Stripe Size | 128KB | 1 AU (typically 1MB/4MB) |
| Use Case | OLTP (small I/O, random read/write) | DSS/Data Warehouse (large I/O, sequential read/write) |
| Stripe Width | Across all disks | Across all disks |
| I/O Distribution | More uniform | Relatively concentrated |

#### ASM AU Size Selection

The choice of ASM Allocation Unit (AU) size has a significant impact on performance:

- **1MB** (default): Suitable for most OLTP scenarios
- **4MB**: Suitable for large data warehouses, reduces metadata overhead
- **8MB/16MB/32MB/64MB**: Ultra-large-scale databases

```sql
-- 查看磁盘组的 AU 大小
SELECT name, allocation_unit_size/1024/1024 AS au_size_mb 
FROM v$asm_diskgroup;

-- 创建磁盘组时指定 AU 大小
CREATE DISKGROUP DATA 
  NORMAL REDUNDANCY
  DISK '/dev/sdb1', '/dev/sdc1'
  ATTRIBUTE 'au_size' = '4M';
```

#### Rebalance Mechanism and Performance Impact

When an ASM disk group changes (adding/removing disks, disk failures), ASM automatically executes a Rebalance operation to redistribute data and maintain load balancing. The Rebalance operation consumes significant I/O resources and impacts online business operations.

```sql
-- 查看 Rebalance 操作进度
SELECT * FROM v$asm_operation;

-- 手动控制 Rebalance 速度（Power 值 0-11，0 表示暂停）
ALTER DISKGROUP DATA REBALANCE POWER 4;

-- 在低峰期执行 Rebalance
ALTER DISKGROUP DATA REBALANCE POWER 8 WAIT;
```

### 2.3 Linux I/O Stack

#### I/O Scheduler Selection

The Linux kernel provides multiple I/O schedulers that significantly affect database performance:

- **mq-deadline**: Multi-queue version of the Deadline scheduler, sets deadlines for each I/O request, balancing read/write fairness and latency guarantees. **Recommended for most Oracle database scenarios**
- **none (noop)**: Performs no scheduling, sends I/O requests directly to the device. **Recommended for NVMe SSD and SAN storage**, as these devices already have sophisticated scheduling logic built in
- **kyber**: Target-latency-based scheduler, suitable for fast devices
- **bfq**: Budget Fair Queuing, suitable for desktop and interactive scenarios, not recommended for databases

```bash
# 查看当前 I/O Scheduler
cat /sys/block/sda/queue/scheduler

# 临时修改 I/O Scheduler
echo mq-deadline > /sys/block/sda/queue/scheduler

# 永久修改（通过 GRUB 参数）
# 编辑 /etc/default/grub，在 GRUB_CMDLINE_LINUX 中添加：
# elevator=mq-deadline
```

#### File System Selection

| File System | Features | Use Case |
|-------------|----------|----------|
| XFS | High performance, supports large files, excellent concurrency | **Recommended for Oracle data files** |
| EXT4 | Mature, stable, widely supported | General-purpose |
| ASM | Oracle native storage management | **Production environment first choice** |

#### Asynchronous I/O Configuration

In Linux systems, the concurrency of asynchronous I/O is controlled by the kernel parameter `fs.aio-max-nr`:

```bash
# 查看当前设置
sysctl fs.aio-max-nr

# 修改为更大值（推荐至少 1048576）
echo "fs.aio-max-nr = 1048576" >> /etc/sysctl.conf
sysctl -p

# 查看当前已使用的 AIO 请求数
cat /proc/sys/fs/aio-nr
```

### 2.4 Storage Multipathing

In SAN storage environments, there are typically multiple physical paths between hosts and storage arrays. Using Multipath (DM-Multipath) enables path redundancy and I/O load balancing.

#### Load Balancing Strategies

Commonly used load balancing strategies include:

- **round-robin**: Round-robin method, distributes I/O evenly across all paths
- **service-time**: Dynamically allocates I/O based on path service time, paths with lower latency receive more I/O
- **queue-length**: Allocates I/O based on queue length on each path

```bash
# /etc/multipath.conf 配置示例
defaults {
    polling_interval    30
    path_grouping_policy  multibus
    path_selector       "round-robin 0"
    failback            immediate
    no_path_retry       5
    rr_min_io           100
}
```

## III. Practical Operations

### 3.1 I/O Performance Diagnostics

#### iostat and iowait Comprehensive Diagnostic Script

The following is a commonly used I/O performance diagnostic script for production environments, combining `iostat` and system-level I/O metrics:

```bash
#!/bin/bash
# io_diagnosis.sh - Oracle I/O 性能诊断脚本
# 用法: ./io_diagnosis.sh [采样间隔秒数] [采样次数]

INTERVAL=${1:-5}
COUNT=${2:-12}

echo "============================================"
echo "  Oracle I/O 子系统性能诊断报告"
echo "  采集时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo "  采样间隔: ${INTERVAL}s, 采样次数: ${COUNT}"
echo "============================================"

# 1. CPU iowait 概览
echo ""
echo "--- CPU I/O Wait 概览 ---"
echo "us    sy    id    wa    st"
mpstat 1 ${COUNT} | grep -v "CPU\|^$" | tail -${COUNT} | \
  awk '{printf "%-6s%-6s%-6s%-6s%-6s\n", $3, $5, $12, $6, $7}'

# 2. 各磁盘 I/O 详细统计
echo ""
echo "--- 磁盘 I/O 详细统计 (iostat -xz) ---"
iostat -xz ${INTERVAL} ${COUNT} | grep -E "Device|sd[a-z]|nvme"

# 3. I/O 等待最高的进程
echo ""
echo "--- I/O 等待最高的 Top 10 进程 ---"
iotop -b -o -n ${COUNT} -d ${INTERVAL} 2>/dev/null | head -20 || \
  echo "(iotop 不可用，请安装: yum install iotop)"

# 4. Oracle I/O 等待事件
echo ""
echo "--- Oracle I/O 相关等待事件 (需要 sqlplus) ---"
echo "请在 SQL*Plus 中执行以下查询："
cat << 'SQL'
SELECT event, total_waits, time_waited_micro/1000000 AS time_waited_sec,
       ROUND(average_wait/1000, 2) AS avg_wait_ms
FROM v$system_event
WHERE event IN (
    'db file sequential read',
    'db file scattered read', 
    'log file sync',
    'db file parallel write',
    'log file parallel write',
    'direct path read',
    'direct path write'
)
ORDER BY time_waited_micro DESC;
SQL
```

Key metrics from `iostat` output:

- **%util**: Disk busy percentage. Consistently above 80% indicates the disk is approaching saturation
- **await**: Average I/O wait time (milliseconds). HDD should be below 10ms, SSD should be below 1ms
- **avgqu-sz**: Average I/O queue length. Higher values indicate busier I/O
- **r/s, w/s**: Read/write operations per second (IOPS)
- **rkB/s, wkB/s**: Read/write throughput per second

#### Database Internal I/O Monitoring

```sql
-- 查看各数据文件的 I/O 统计
SELECT f.file#,
       d.name AS file_name,
       f.phyrds  AS physical_reads,
       f.phywrts AS physical_writes,
       f.readtim AS read_time_cs,
       f.writetim AS write_time_cs,
       CASE WHEN f.phyrds > 0 
            THEN ROUND(f.readtim * 10 / f.phyrds, 2) 
            ELSE 0 END AS avg_read_ms,
       CASE WHEN f.phywrts > 0 
            THEN ROUND(f.writetim * 10 / f.phywrts, 2) 
            ELSE 0 END AS avg_write_ms
FROM v$filestat f, v$datafile d
WHERE f.file# = d.file#
ORDER BY f.phyrds + f.phywrts DESC
FETCH FIRST 20 ROWS ONLY;

-- 详细的 I/O 按文件类型统计（12c+）
SELECT filetype_name,
       SUM(small_read_megabytes) AS small_read_mb,
       SUM(large_read_megabytes) AS large_read_mb,
       SUM(small_write_megabytes) AS small_write_mb,
       SUM(large_write_megabytes) AS large_write_mb,
       ROUND(AVG(small_sync_read_latency), 2) AS avg_sync_read_ms
FROM v$iostat_file
GROUP BY filetype_name
ORDER BY small_read_mb + large_read_mb DESC;
```

#### AWR Report I/O Section Interpretation

Key I/O-related sections in AWR reports:

1. **Tablespace I/O Statistics**: I/O throughput and latency per tablespace, identify hot tablespaces
2. **File I/O Statistics**: I/O distribution per data file, check for I/O hotspot files
3. **Buffer Pool Statistics**: Buffer Cache hit ratio; too low indicates frequent physical reads
4. **Instance Activity Stats**: Focus on `physical reads`, `physical writes`, `redo size` and other metrics

### 3.2 ASM Optimization

#### ASM Disk Group Management and Rebalance

```sql
-- 查看所有磁盘组状态
SELECT name, state, type, total_mb, free_mb,
       ROUND(free_mb/total_mb*100, 2) AS free_pct
FROM v$asm_diskgroup;

-- 查看磁盘组中各磁盘的 I/O 分布
SELECT dg.name AS diskgroup,
       d.path,
       d.reads,
       d.writes,
       d.read_errs,
       d.write_errs,
       d.read_time,
       d.write_time,
       d.bytes_read/1024/1024 AS read_mb,
       d.bytes_written/1024/1024 AS write_mb
FROM v$asm_disk d, v$asm_diskgroup dg
WHERE d.group_number = dg.group_number
ORDER BY dg.name, d.reads + d.writes DESC;

-- 检查磁盘组 Rebalance 操作
SELECT group_number, operation, state, power, est_minutes
FROM v$asm_operation;

-- 调整 Rebalance Power（0=暂停, 1-11=速度递增）
-- 生产环境建议使用较低的 Power 值（2-4）以减少业务影响
ALTER DISKGROUP DATA REBALANCE POWER 2;

-- 添加新磁盘到磁盘组
ALTER DISKGROUP DATA ADD DISK '/dev/sdd1' NAME DATA_0004;

-- 查看 ASM 模板
SELECT dg.name AS diskgroup, t.name AS template, 
       t.redundancy, t.stripe
FROM v$asm_template t, v$asm_diskgroup dg
WHERE t.group_number = dg.group_number
ORDER BY dg.name, t.name;
```

#### ASM Disk Performance Monitoring

It is recommended to regularly monitor the uniformity of I/O distribution across ASM disks. If certain disks show significantly higher read/write volumes than others (deviation exceeding 20%), a Rebalance or disk layout replanning may be necessary.

### 3.3 Linux I/O Tuning

#### I/O Scheduler Configuration

```bash
# 针对 NVMe SSD 使用 none 调度器
for dev in /sys/block/nvme*; do
    echo none > ${dev}/queue/scheduler
    echo "Set ${dev} to none scheduler"
done

# 针对 SAS/SATA HDD 使用 mq-deadline 调度器
for dev in /sys/block/sd*; do
    echo mq-deadline > ${dev}/queue/scheduler
    echo "Set ${dev} to mq-deadline scheduler"
done

# 调整 mq-deadline 调度器参数
# 读请求截止时间（毫秒）
echo 500 > /sys/block/sda/queue/iosched/read_expire
# 写请求截止时间（毫秒） 
echo 5000 > /sys/block/sda/queue/iosched/write_expire
# 写批次大小
echo 16 > /sys/block/sda/queue/iosched/writes_starved
```

#### File System Mount Options

For the XFS file system used by Oracle data files, the following mount options are recommended:

```bash
# /etc/fstab 中的 XFS 推荐挂载选项
/dev/mapper/data_lv  /oradata  xfs  rw,noatime,nodiratime,logbufs=8,logbsize=256k,allocsize=64m  0 0

# 选项说明：
# noatime     - 不更新文件访问时间戳，减少元数据写入
# nodiratime  - 不更新目录访问时间戳
# logbufs=8   - 增加日志缓冲区数量
# logbsize=256k - 增加日志缓冲区大小
# allocsize=64m - 预分配大小，优化大文件写入
```

#### Asynchronous I/O System Parameter Configuration

```bash
# /etc/sysctl.conf 中的 I/O 相关参数

# 异步 I/O 最大请求数
fs.aio-max-nr = 1048576

# 虚拟内存相关优化
vm.dirty_ratio = 5
vm.dirty_background_ratio = 2
vm.dirty_expire_centisecs = 300
vm.dirty_writeback_centisecs = 100

# 应用配置
sysctl -p

# 验证 Oracle 使用了异步 I/O
# 查看 Oracle 进程的 I/O 方式
strace -e io_submit,io_getevents -p <oracle_pid> -c
```

### 3.4 Oracle I/O Parameters

#### Key I/O Parameter Configuration

```sql
-- FILESYSTEMIO_OPTIONS: 控制文件系统的 I/O 方式
-- 推荐设置为 SETALL（同时启用 Direct I/O 和异步 I/O）
ALTER SYSTEM SET FILESYSTEMIO_OPTIONS='SETALL' SCOPE=SPFILE;

-- DISK_ASYNCH_IO: 启用磁盘异步 I/O
-- 使用 ASM 时默认为 TRUE
ALTER SYSTEM SET DISK_ASYNCH_IO=TRUE SCOPE=SPFILE;

-- DB_FILE_MULTIBLOCK_READ_COUNT: 多块读的块数
-- 影响全表扫描性能，一般设置为 16 或 32
-- 12c 以后可以设置为 0，由 Oracle 自动调优
ALTER SYSTEM SET DB_FILE_MULTIBLOCK_READ_COUNT=16 SCOPE=BOTH;

-- DB_WRITER_PROCESSES: DBWR 进程数量
-- 默认为 CPU_COUNT/8，高 I/O 负载环境可适当增加
ALTER SYSTEM SET DB_WRITER_PROCESSES=4 SCOPE=SPFILE;

-- 相关隐含参数（仅在特殊场景下使用，需 Oracle Support 确认）
-- _db_file_direct_io_count: Direct I/O 的大小
-- _lgwr_io_slaves: LGWR I/O 从进程数量

-- 验证参数生效
SHOW PARAMETER FILESYSTEMIO_OPTIONS;
SHOW PARAMETER DISK_ASYNCH_IO;
SHOW PARAMETER DB_FILE_MULTIBLOCK_READ_COUNT;
```

## IV. Results Verification

### I/O Latency Metric Comparison

Typical I/O latency comparison before and after optimization:

| Metric | Before Optimization | After Optimization | Improvement |
|--------|-------------------|-------------------|-------------|
| db file sequential read avg wait | 8.5ms | 1.2ms | 86% |
| db file scattered read avg wait | 12.3ms | 2.1ms | 83% |
| log file sync avg wait | 5.6ms | 0.8ms | 86% |
| iostat await (data disk) | 15ms | 2ms | 87% |
| Buffer Cache Hit Ratio | 92% | 99.5% | - |

### AWR Report I/O Metric Verification

After optimization completion, verify the following key metrics through AWR reports:

```sql
-- 对比优化前后的 AWR 快照
-- 获取 I/O 相关的统计信息变化
SELECT sn.snap_id,
       sn.begin_interval_time,
       st.stat_name,
       st.value
FROM dba_hist_sysstat st, dba_hist_snapshot sn
WHERE st.snap_id = sn.snap_id
  AND st.stat_name IN (
      'physical read total bytes',
      'physical write total bytes',
      'physical read total IO requests',
      'physical write total IO requests',
      'redo size'
  )
  AND sn.begin_interval_time > SYSDATE - 1
ORDER BY sn.snap_id, st.stat_name;
```

Key areas to focus on:

1. **I/O latency reduction**: The average wait time for db file sequential read should drop below 2ms (SSD) or 8ms (HDD)
2. **I/O throughput improvement**: IOPS and throughput under equivalent business load should show noticeable improvement
3. **iowait reduction**: CPU iowait percentage should drop below 5%
4. **log file sync improvement**: Average wait time should drop below 2ms

### Performance Test Results

Use `fio` to run storage benchmarks to verify optimization effectiveness:

```bash
# 随机读测试（模拟 OLTP 索引访问）
fio --name=rand_read --ioengine=libaio --direct=1 --bs=8k \
    --size=10G --numjobs=8 --iodepth=32 --rw=randread \
    --group_reporting --runtime=300

# 随机读写混合测试（模拟 OLTP 混合负载）
fio --name=rand_rw --ioengine=libaio --direct=1 --bs=8k \
    --size=10G --numjobs=8 --iodepth=32 --rw=randrw --rwmixread=70 \
    --group_reporting --runtime=300

# 顺序读测试（模拟全表扫描）
fio --name=seq_read --ioengine=libaio --direct=1 --bs=1M \
    --size=50G --numjobs=4 --iodepth=16 --rw=read \
    --group_reporting --runtime=300
```

## V. Lessons Learned

### I/O Optimization Priority

Based on practical experience, I/O optimization should follow this priority order:

1. **Storage Hardware Layer** (most important): Choose appropriate storage media (NVMe SSD > SAS SSD > SAS HDD). This is the foundation of optimization; software-level tuning cannot compensate for hardware deficiencies
2. **Storage Configuration Layer**: Multipath configuration, SAN Zoning, LUN allocation strategy
3. **Operating System Layer**: I/O Scheduler, file system mount options, asynchronous I/O parameters
4. **ASM/Storage Management Layer**: ASM disk group striping, Rebalance strategy
5. **Oracle Database Layer**: FILESYSTEMIO_OPTIONS, DB_FILE_MULTIBLOCK_READ_COUNT and other parameters

### Storage Selection Recommendations

| Scenario | Recommended Storage | Recommended I/O Scheduler |
|----------|-------------------|--------------------------|
| OLTP Core System | NVMe SSD | none |
| OLTP General System | SAS SSD | none |
| Data Warehouse | SAS SSD + HDD Hybrid | mq-deadline (HDD), none (SSD) |
| Archive/Backup | HDD | mq-deadline |

### Quick I/O Problem Identification

When encountering I/O-related performance issues, follow this workflow for quick identification:

1. **Step 1**: Check `iostat` `%util` and `await` to confirm whether disk saturation exists
2. **Step 2**: Check AWR report Top Wait Events to confirm I/O wait event ranking and percentage
3. **Step 3**: Check `V$FILESTAT` / `V$IOSTAT_FILE` to locate hotspot data files
4. **Step 4**: Check operating system-level I/O Scheduler and file system mount options
5. **Step 5**: Check Multipath path status and load distribution

**Key Experience**: When dealing with I/O performance issues, always start troubleshooting from the operating system level rather than directly adjusting database parameters. In many cases, a simple I/O Scheduler change or mount option adjustment can bring significant performance improvement.

I/O subsystem optimization is a systematic endeavor that requires DBAs to have full-stack knowledge spanning from storage hardware to database parameters. I hope the content of this article helps everyone more efficiently identify and resolve I/O-related performance issues in their actual work.
