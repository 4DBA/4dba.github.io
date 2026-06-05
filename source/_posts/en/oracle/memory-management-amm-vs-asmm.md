---
title: "Deep Dive into Oracle Memory Management: AMM vs ASMM Best Practices for Large Memory Servers"
date: 2026-03-13 10:00:00
categories: Oracle
tags: [内存管理, SGA, PGA, AMM, ASMM, OOM, HugePages]
lang: en
---

In the daily operations of Oracle databases, memory management is one of the most fundamental yet critical aspects. Improper memory configuration not only leads to degraded database performance but can also trigger OOM Killer to directly terminate database processes, causing severe production incidents. This article provides a comprehensive analysis of Oracle's three memory management modes (AMM, ASMM, and Manual Management), from principles to practice, along with configuration templates for servers of different specifications and OOM prevention strategies.

<!-- more -->

## 1. Problem Background

### 1.1 Memory Configuration is the Foundation of Oracle Performance

The performance of an Oracle database depends heavily on proper memory configuration. The SGA (System Global Area) determines data cache hit ratios and SQL parsing efficiency, while the PGA (Program Global Area) directly impacts the performance of operations such as sorting and hash joins. A database with improper memory configuration will struggle to deliver expected performance, even with powerful CPUs and high-speed storage.

In real-world production environments, we frequently encounter the following issues:

- **Low Buffer Cache hit ratio**: Excessive physical I/O causes slow database response
- **Shared Pool fragmentation**: Frequent SQL hard parsing, severe Library Cache contention
- **Insufficient PGA**: Excessive disk sorting (Temp tablespace overflow), extremely poor complex query performance
- **Memory over-allocation**: Triggers Linux OOM Killer, forcing database process termination

### 1.2 The AMM vs ASMM Selection Dilemma

Oracle provides three memory management modes:

| Mode | Management Approach | Key Parameters |
|------|-------------------|----------------|
| AMM | Unified automatic management of SGA+PGA | MEMORY_TARGET |
| ASMM | Automatic SGA + Automatic PGA | SGA_TARGET + PGA_AGGREGATE_TARGET |
| Manual | Independent configuration of each component | Individual component parameters |

Many DBAs face a selection dilemma when setting up new environments: AMM seems the most convenient, but is it really suitable for production? How should you choose between ASMM and manual management?

### 1.3 Production Incident Caused by OOM Killer

I once handled a typical production incident: a client's Oracle database was running on a server with 256GB of memory, using AMM mode with MEMORY_TARGET set to 200GB. One early morning, the database suddenly crashed, and the alert log showed that processes were terminated by OOM Killer.

The root cause was: AMM relies on `/dev/shm` (tmpfs). When system memory pressure increases, memory occupied by tmpfs cannot be swapped out, causing OOM Killer to prioritize Oracle processes for termination. If ASMM + HugePages had been used instead, memory would have been locked in physical memory, and this problem would not have occurred.

## 2. Theoretical Analysis

### 2.1 SGA Memory Structure

The SGA is Oracle's shared memory region for the instance, accessed by all server processes. The SGA consists of the following core components:

**Buffer Cache**

The Buffer Cache is the largest component of the SGA, used to cache data blocks from data files. When users query data, Oracle first checks whether the needed data blocks are already in the Buffer Cache:

- **Cache Hit**: Read directly from memory, extremely fast
- **Cache Miss**: Requires reading from disk, 100-1000x slower

The Buffer Cache uses the LRU (Least Recently Used) algorithm to manage cached blocks. Tuning points:
- Set size via `DB_CACHE_SIZE`
- Monitor `V$BUFFER_POOL_STATISTICS` to check hit ratio
- Hit ratio should be maintained above 95%

**Shared Pool**

The Shared Pool contains two key sub-structures:

- **Library Cache**: Caches SQL and PL/SQL execution plans, reducing hard parsing
- **Data Dictionary Cache**: Caches data dictionary information, reducing recursive SQL

Shared Pool tuning points:
- Size set via `SHARED_POOL_SIZE`
- Monitor `V$LIBRARYCACHE`, focusing on `RELOADS` and `INVALIDATIONS`
- Avoid using large amounts of literal SQL (use bind variables instead)

**Large Pool**

The Large Pool is used for the following scenarios:
- RMAN backup and recovery operations
- Shared Server mode UGA
- Parallel query message buffers
- I/O Slave processes

Size set via `LARGE_POOL_SIZE`. If using RMAN backups or parallel queries, consider increasing it appropriately.

**Redo Log Buffer**

The Redo Log Buffer caches redo records of database changes, periodically written to online redo log files by the LGWR process. Size set via `LOG_BUFFER`. Generally no manual adjustment is needed unless encountering the log buffer space wait event.

**Streams Pool and Java Pool**

- **Streams Pool**: Used for Oracle Streams and Advanced Queueing. If these features are not used, it can be set to 0
- **Java Pool**: Used for JVM-related operations. If Java stored procedures run in the database, appropriate configuration is needed

### 2.2 PGA Memory Structure

The PGA is the private memory area for each server process, not shared with other processes. The PGA primarily contains:

**Sort Area**

Used for sorting operations in SQL, such as ORDER BY, GROUP BY, DISTINCT, etc. When the sort data exceeds the Sort Area size, it overflows to the Temp tablespace (disk sorting), causing a sharp performance decline.

**Hash Area**

Used for Hash Join operations. Similarly, when data volume exceeds the Hash Area, it overflows to disk.

**Session Cursor**

Each open cursor consumes PGA memory, including:
- Cursor state information
- Private copy of the SQL execution plan
- Bind variable values

**Role of PGA_AGGREGATE_TARGET**

The `PGA_AGGREGATE_TARGET` parameter sets the total target size for all PGAs in the instance. Oracle dynamically allocates PGA memory based on each session's actual needs, but the total does not exceed this target value.

Tuning points:
- Monitor `PGA TARGET` and `OVER ALLOC COUNT` in `V$PGASTAT`
- If `OVER ALLOC COUNT` continues to grow, the PGA target is set too low
- Complex queries (OLAP scenarios) require larger PGA

### 2.3 AMM (Automatic Memory Management)

AMM is the memory management mode introduced in Oracle 11g, managing SGA and PGA uniformly through the `MEMORY_TARGET` and `MEMORY_MAX_TARGET` parameters.

**Core Parameters**

```sql
-- Set current memory target (dynamic parameter, can be modified online)
ALTER SYSTEM SET MEMORY_TARGET = 16G;

-- Set maximum memory target (static parameter, requires restart)
ALTER SYSTEM SET MEMORY_MAX_TARGET = 20G;
```

**AMM Implementation Mechanism: /dev/shm (tmpfs)**

AMM uses Linux's shared memory filesystem (tmpfs) to manage memory. Oracle maps the SGA to files under the `/dev/shm` directory, which has the following characteristics:

1. **Memory locking**: Data in tmpfs is locked in physical memory (or swap), not managed by page cache
2. **Filesystem overhead**: Requires additional filesystem metadata overhead
3. **Size limit**: By default, `/dev/shm` size is 50% of physical memory

Check current `/dev/shm` size:

```bash
df -h /dev/shm
# Filesystem      Size  Used Avail Use% Mounted on
# tmpfs            64G   20G   44G  32% /dev/shm
```

**Mutual Exclusivity between AMM and HugePages**

This is AMM's most important limitation: **AMM does not support HugePages**.

HugePages is a large page memory mechanism provided by the Linux kernel (default 2MB/page, configurable 1GB/page), offering the following advantages over standard 4KB pages:

- Reduced TLB (Translation Lookaside Buffer) misses
- Reduced page table entries, lower memory management overhead
- Memory locked, not subject to swap out

However, HugePages requires applications to use `mmap()` for direct shared memory mapping, which is incompatible with AMM's tmpfs approach. For large memory servers (>64GB), the inability to use HugePages represents a significant performance loss.

**AMM Applicable Scenarios**

- Development and testing environments
- Small memory servers (<=32GB)
- Scenarios not requiring fine-tuning
- Quick environment setup needs

### 2.4 ASMM (Automatic Shared Memory Management)

ASMM is Oracle's recommended production memory management mode, managing SGA and PGA separately through `SGA_TARGET` and `PGA_AGGREGATE_TARGET`.

**Core Parameters**

```sql
-- SGA automatic management (static parameter)
ALTER SYSTEM SET SGA_TARGET = 48G SCOPE=SPFILE;

-- PGA automatic management (dynamic parameter)
ALTER SYSTEM SET PGA_AGGREGATE_TARGET = 16G;
```

**ASMM Advantage: HugePages Support**

ASMM uses standard System V shared memory (`shmget`/`shmat`), fully supporting HugePages. For large memory servers, the performance improvement from HugePages is substantial:

- 90%+ reduction in TLB misses
- Reduced page table memory overhead (from 4KB pages to 2MB pages, 512x reduction)
- Eliminates risk of memory page swap out

**Auto-Adjustment Mechanism for Components**

When `SGA_TARGET` is set, the following components automatically adjust their sizes:
- Buffer Cache (`DB_CACHE_SIZE` as minimum)
- Shared Pool (`SHARED_POOL_SIZE` as minimum)
- Large Pool (`LARGE_POOL_SIZE` as minimum)
- Java Pool (`JAVA_POOL_SIZE` as minimum)
- Streams Pool (`STREAMS_POOL_SIZE` as minimum)

Oracle uses the Memory Advisor to dynamically adjust component sizes based on workload. When `SGA_TARGET` is not set, individual component parameters can also be set for manual management.

### 2.5 Manual Memory Management

Manual management mode requires setting each memory component's size individually:

```sql
ALTER SYSTEM SET DB_CACHE_SIZE = 32G SCOPE=SPFILE;
ALTER SYSTEM SET SHARED_POOL_SIZE = 8G SCOPE=SPFILE;
ALTER SYSTEM SET LARGE_POOL_SIZE = 2G SCOPE=SPFILE;
ALTER SYSTEM SET JAVA_POOL_SIZE = 512M SCOPE=SPFILE;
ALTER SYSTEM SET STREAMS_POOL_SIZE = 512M SCOPE=SPFILE;
ALTER SYSTEM SET PGA_AGGREGATE_TARGET = 16G;
```

**Applicable Scenarios: Fine-Tuning**

- Environments with deep understanding of workload
- Need strict control over memory allocation proportions for each component
- Mixed OLTP and OLAP workloads requiring different sizes for different components
- Diagnosing memory issues with specific components

## 3. Practical Operations

### 3.1 Memory Parameter Configuration Templates

The following configuration templates are based on the principle of "using 70-80% of physical memory for Oracle," with the remaining memory reserved for the operating system and other processes.

**Small Memory Server (<=64GB)**

Suitable for: Development/testing environments, small OLTP systems

```sql
-- Assuming 64GB physical memory, using ASMM
-- SGA: 40GB, PGA: 12GB
ALTER SYSTEM SET SGA_TARGET = 40G SCOPE=SPFILE;
ALTER SYSTEM SET SGA_MAX_SIZE = 40G SCOPE=SPFILE;
ALTER SYSTEM SET PGA_AGGREGATE_TARGET = 12G SCOPE=SPFILE;

-- Set component minimums (optional)
ALTER SYSTEM SET DB_CACHE_SIZE = 24G SCOPE=SPFILE;
ALTER SYSTEM SET SHARED_POOL_SIZE = 8G SCOPE=SPFILE;
ALTER SYSTEM SET LARGE_POOL_SIZE = 2G SCOPE=SPFILE;
ALTER SYSTEM SET JAVA_POOL_SIZE = 512M SCOPE=SPFILE;

-- Enable HugePages (optional, but recommended)
-- Linux memory parameters need to be configured in parallel
```

**Medium Memory Server (64-256GB)**

Suitable for: Medium production systems, mixed workloads

```sql
-- Assuming 128GB physical memory, using ASMM + HugePages
-- SGA: 80GB, PGA: 24GB
ALTER SYSTEM SET SGA_TARGET = 80G SCOPE=SPFILE;
ALTER SYSTEM SET SGA_MAX_SIZE = 80G SCOPE=SPFILE;
ALTER SYSTEM SET PGA_AGGREGATE_TARGET = 24G SCOPE=SPFILE;

-- Set component minimums
ALTER SYSTEM SET DB_CACHE_SIZE = 56G SCOPE=SPFILE;
ALTER SYSTEM SET SHARED_POOL_SIZE = 12G SCOPE=SPFILE;
ALTER SYSTEM SET LARGE_POOL_SIZE = 4G SCOPE=SPFILE;
ALTER SYSTEM SET JAVA_POOL_SIZE = 1G SCOPE=SPFILE;
ALTER SYSTEM SET STREAMS_POOL_SIZE = 1G SCOPE=SPFILE;

-- Configure HugePages
-- Need 40000 2MB HugePages (~80GB)
-- /etc/sysctl.conf: vm.nr_hugepages = 40000
```

**Large Memory Server (>256GB)**

Suitable for: Large OLTP/OLAP systems, data warehouses

```sql
-- Assuming 512GB physical memory, using ASMM + HugePages
-- SGA: 360GB, PGA: 80GB
ALTER SYSTEM SET SGA_TARGET = 360G SCOPE=SPFILE;
ALTER SYSTEM SET SGA_MAX_SIZE = 360G SCOPE=SPFILE;
ALTER SYSTEM SET PGA_AGGREGATE_TARGET = 80G SCOPE=SPFILE;

-- Set component minimums (adjust based on actual workload)
ALTER SYSTEM SET DB_CACHE_SIZE = 256G SCOPE=SPFILE;
ALTER SYSTEM SET SHARED_POOL_SIZE = 48G SCOPE=SPFILE;
ALTER SYSTEM SET LARGE_POOL_SIZE = 16G SCOPE=SPFILE;
ALTER SYSTEM SET JAVA_POOL_SIZE = 2G SCOPE=SPFILE;
ALTER SYSTEM SET STREAMS_POOL_SIZE = 4G SCOPE=SPFILE;

-- Configure 1GB HugePages (recommended for large memory servers)
-- Need 360 1GB HugePages
-- /etc/sysctl.conf: vm.nr_hugepages = 360
-- Kernel boot parameters: hugepagesz=1G hugepages=360
```

**HugePages Configuration Reference (/etc/sysctl.conf)**

```bash
# Calculate HugePages count based on SGA size
# 2MB HugePages: nr_hugepages = ceil(SGA_size_in_MB / 2)
# 1GB HugePages: Need to configure in kernel boot parameters

# Example: 80GB SGA using 2MB HugePages
vm.nr_hugepages = 41000  # Leave some margin

# /dev/shm not needed when AMM is disabled
# To adjust /dev/shm size
# tmpfs /dev/shm tmpfs defaults,size=100g 0 0
```

### 3.2 Switching from AMM to ASMM

When switching from AMM to ASMM in a production environment, a maintenance window is required. Here are the complete steps:

**Step 1: Evaluate Current Memory Usage**

```sql
-- View current memory configuration
SHOW PARAMETER MEMORY_TARGET;
SHOW PARAMETER MEMORY_MAX_TARGET;
SHOW PARAMETER SGA_TARGET;
SHOW PARAMETER PGA_AGGREGATE_TARGET;

-- View current sizes of each component
SELECT * FROM V$SGAINFO;
SELECT * FROM V$SGASTAT;
```

**Step 2: Calculate New ASMM Parameter Values**

```sql
-- View recommended values for SGA components
SELECT * FROM V$SGA_TARGET_ADVICE ORDER BY SGA_SIZE;

-- View recommended PGA values
SELECT * FROM V$PGA_TARGET_ADVICE ORDER BY PGA_TARGET_FOR_ESTIMATE;
```

**Step 3: Execute the Switch (Requires Downtime)**

```sql
-- 1. Shut down the database
SHUTDOWN IMMEDIATE;

-- 2. Create new spfile parameter file (backup original parameters)
CREATE PFILE='/tmp/init_ORCL_backup.ora' FROM SPFILE;

-- 3. Modify parameters (use pfile to start)
-- Edit /tmp/init_ORCL_new.ora, add the following:
-- *.sga_target=80G
-- *.sga_max_size=80G
-- *.pga_aggregate_target=24G
-- Remove or comment out memory_target and memory_max_target

-- 4. Start with new pfile
STARTUP PFILE='/tmp/init_ORCL_new.ora';

-- 5. Create new spfile
CREATE SPFILE FROM PFILE='/tmp/init_ORCL_new.ora';

-- 6. Verify parameters
SHOW PARAMETER SGA_TARGET;
SHOW PARAMETER PGA_AGGREGATE_TARGET;
SHOW PARAMETER MEMORY_TARGET;  -- Should be 0
```

**Step 4: Configure HugePages**

```bash
# Calculate required HugePages count
# Example with 80GB SGA
# 2MB pages: 80*1024/2 = 40960, with margin set to 41000

# Modify /etc/sysctl.conf
echo "vm.nr_hugepages = 41000" >> /etc/sysctl.conf
sysctl -p

# Verify HugePages configuration
cat /proc/meminfo | grep -i huge

# Configure memlock limit for Oracle user
# /etc/security/limits.conf
# oracle soft memlock unlimited
# oracle hard memlock unlimited
```

### 3.3 Memory Monitoring

**V$SGAINFO - SGA Overview**

```sql
-- View current sizes of SGA components
SELECT NAME, BYTES/1024/1024/1024 AS SIZE_GB, RESIZEABLE
FROM V$SGAINFO
ORDER BY BYTES DESC;
```

**V$SGASTAT - SGA Detailed Statistics**

```sql
-- View detailed Shared Pool usage
SELECT POOL, NAME, BYTES/1024/1024 AS SIZE_MB
FROM V$SGASTAT
WHERE POOL = 'shared pool'
ORDER BY BYTES DESC
FETCH FIRST 20 ROWS ONLY;

-- View Buffer Cache usage
SELECT NAME, VALUE
FROM V$SYSSTAT
WHERE NAME IN ('db block gets from cache', 'consistent gets from cache',
               'physical reads cache');
```

**V$PGASTAT - PGA Statistics**

```sql
-- View overall PGA usage
SELECT NAME, VALUE/1024/1024/1024 AS VALUE_GB
FROM V$PGASTAT
WHERE NAME IN ('aggregate PGA target parameter',
               'total PGA allocated',
               'total PGA used for auto workareas',
               'over allocation count',
               'cache hit percentage');

-- Key metrics:
-- aggregate PGA target parameter: PGA target value
-- total PGA allocated: Actual total PGA allocated
-- over allocation count: PGA over-allocation count (should be 0 or very small)
-- cache hit percentage: PGA cache hit ratio (should be >90%)
```

**V$MEMORY_TARGET_ADVICE - AMM Memory Recommendations**

```sql
-- Only available in AMM mode
SELECT MEMORY_SIZE, MEMORY_SIZE_FACTOR, ESTD_DB_TIME,
       ESTD_DB_TIME_FACTOR, VERSION
FROM V$MEMORY_TARGET_ADVICE
ORDER BY MEMORY_SIZE;
```

### 3.4 OOM Prevention

OOM (Out of Memory) Killer is the Linux kernel's last resort when memory is critically low. Preventing OOM is an important DBA responsibility.

**1. oom_score_adj Configuration**

Each process has an OOM score — higher scores mean more likely to be killed. Oracle processes should have low OOM scores:

```bash
# View Oracle process OOM score
cat /proc/$(pgrep -f "ora_pmon")/oom_score
cat /proc/$(pgrep -f "ora_pmon")/oom_score_adj

# Set Oracle process OOM score to -1000 (never killed)
# Method 1: Via systemd service configuration (recommended)
# /etc/systemd/system/oracle.service
# [Service]
# OOMScoreAdjust=-1000

# Method 2: Via rc.local or startup script
echo -1000 > /proc/$(pgrep -f "ora_pmon")/oom_score_adj

# Method 3: Batch set all Oracle processes
for pid in $(pgrep -f "ora_"); do
    echo -1000 > /proc/$pid/oom_score_adj
done
```

**2. Linux overcommit_memory Setting**

`vm.overcommit_memory` controls the kernel's memory allocation strategy:

```bash
# /etc/sysctl.conf

# 0 (default): Heuristic overcommit, kernel decides whether to allow allocation based on available memory
# 1: Always allow overcommit (not recommended for database servers)
# 2: Strict mode, don't allow overcommit beyond swap + ratio% * RAM

# Recommended setting is 2 to limit memory over-allocation
vm.overcommit_memory = 2

# overcommit ratio, used with overcommit_memory=2
# Default 50, recommended setting is 80-90
vm.overcommit_ratio = 80

# Apply configuration
sysctl -p
```

**3. Complete OOM Protection Configuration for Oracle Processes**

Here is the complete OOM protection configuration solution:

```bash
#!/bin/bash
# oracle_oom_protect.sh - Oracle OOM protection script
# Recommended to place in /etc/rc.local or use systemd to execute

# Set OOM score of all Oracle processes to -1000
protect_oracle_processes() {
    local oracle_pids=$(pgrep -u oracle -f "ora_|oracle")
    
    if [ -z "$oracle_pids" ]; then
        echo "No Oracle processes found"
        return 1
    fi
    
    for pid in $oracle_pids; do
        if [ -f /proc/$pid/oom_score_adj ]; then
            echo -1000 > /proc/$pid/oom_score_adj 2>/dev/null
            if [ $? -eq 0 ]; then
                echo "Protected PID $pid ($(cat /proc/$pid/comm))"
            fi
        fi
    done
}

# Memory usage monitoring and alerting
check_memory_usage() {
    local threshold=90  # Alert threshold
    local usage=$(free | grep Mem | awk '{printf "%.0f", $3/$2 * 100}')
    
    if [ $usage -ge $threshold ]; then
        echo "WARNING: Memory usage is ${usage}%"
        # Add alert notification here
        # mail -s "Oracle Server Memory Alert" dba@company.com <<< "Memory usage: ${usage}%"
    fi
}

# Execute protection
protect_oracle_processes

# Periodically check memory (can be called via cron)
check_memory_usage
```

**4. Using cgroups for Memory Limits (Advanced)**

For containerized or more fine-grained control scenarios, cgroups can be used:

```bash
# Create Oracle-specific cgroup
mkdir -p /sys/fs/cgroup/memory/oracle

# Set memory limit (example: limit to 240GB)
echo $((240 * 1024 * 1024 * 1024)) > /sys/fs/cgroup/memory/oracle/memory.limit_in_bytes

# Add Oracle processes to cgroup
for pid in $(pgrep -u oracle); do
    echo $pid > /sys/fs/cgroup/memory/oracle/cgroup.procs
done
```

## 4. Result Verification

### 4.1 Memory Parameter Activation Confirmation

After configuration, verify all parameters are correctly activated:

```sql
-- Verify SGA configuration
SELECT NAME, VALUE/1024/1024/1024 AS VALUE_GB
FROM V$PARAMETER
WHERE NAME IN ('sga_target', 'sga_max_size', 'memory_target', 
               'db_cache_size', 'shared_pool_size', 'large_pool_size');

-- Verify PGA configuration
SELECT NAME, VALUE/1024/1024/1024 AS VALUE_GB
FROM V$PARAMETER
WHERE NAME IN ('pga_aggregate_target');

-- View actual memory allocation
SELECT COMPONENT, CURRENT_SIZE/1024/1024/1024 AS CURRENT_GB,
       MIN_SIZE/1024/1024/1024 AS MIN_GB,
       MAX_SIZE/1024/1024/1024 AS MAX_GB
FROM V$SGA_DYNAMIC_COMPONENTS
ORDER BY CURRENT_SIZE DESC;
```

### 4.2 HugePages Usage Verification

```bash
# View HugePages configuration and usage
grep -i huge /proc/meminfo

# Expected output (example):
# HugePages_Total:   41000
# HugePages_Free:     1000
# HugePages_Rsvd:      500
# HugePages_Surp:        0
# Hugepagesize:       2048 kB

# Verify Oracle is using HugePages
# Check alert log
tail -100 $ORACLE_BASE/diag/rdbms/$ORACLE_SID/$ORACLE_SID/trace/alert_$ORACLE_SID.log | grep -i huge

# Should see similar message:
# Starting ORACLE instance (normal)
# Large pages enabled for SGA
```

### 4.3 OOM Log Check

```bash
# Check system OOM logs
dmesg | grep -i "out of memory"
journalctl -k | grep -i "oom"

# Check Oracle alert log for memory-related errors
grep -i "ORA-04030\|ORA-04031\|memory\|swap" $ORACLE_BASE/diag/rdbms/$ORACLE_SID/$ORACLE_SID/trace/alert_$ORACLE_SID.log | tail -20

# ORA-04030: Out of process memory when trying to allocate bytes (PGA insufficient)
# ORA-04031: Unable to allocate shared memory (Shared Pool insufficient)

# Monitor swap usage
free -h
vmstat 1 5
```

## 5. Lessons Learned

### 5.1 AMM vs ASMM Selection Recommendations

| Scenario | Recommended Mode | Reason |
|----------|-----------------|--------|
| Development/testing | AMM | Simple to use, quick setup |
| Small production (<=64GB) | ASMM | Supports HugePages, better performance |
| Medium-large production (>64GB) | ASMM | Must use HugePages, AMM cannot support it |
| OLAP/Data warehouse | ASMM | Large PGA requirements, needs independent control |
| Fine-tuning needs | Manual | Requires precise control over each component |

**Core Conclusion**: ASMM is strongly recommended for production environments. AMM's convenience is far outweighed by the performance benefits of HugePages, especially for servers with more than 64GB of memory.

### 5.2 Memory Allocation Golden Ratio

Based on years of DBA experience, here are reference ratios for memory allocation:

**General Principles**
- Oracle total memory (SGA + PGA): 70-80% of physical memory
- SGA proportion: 70-75% of Oracle total memory
- PGA proportion: 25-30% of Oracle total memory
- OS reservation: 20-30% of physical memory

**OLTP Systems**
- SGA : PGA = 80 : 20
- Buffer Cache: 60-70% of SGA
- Shared Pool: 20-25% of SGA

**OLAP Systems**
- SGA : PGA = 60 : 40
- Buffer Cache: 50-60% of SGA
- Shared Pool: 15-20% of SGA

**Mixed Workloads**
- SGA : PGA = 70 : 30
- Dynamically adjust based on actual workload

### 5.3 Common Memory Issue Troubleshooting

**Issue 1: ORA-04031 - Insufficient Shared Pool**

```sql
-- View Shared Pool fragmentation
SELECT * FROM V$SGASTAT WHERE POOL = 'shared pool' AND NAME = 'free memory';

-- Solutions:
-- 1. Increase SHARED_POOL_SIZE
-- 2. Use bind variables, reduce hard parsing
-- 3. Set CURSOR_SHARING=FORCE (temporary solution)
-- 4. Periodically flush Shared Pool (ALTER SYSTEM FLUSH SHARED_POOL; not recommended for frequent use)
```

**Issue 2: ORA-04030 - Insufficient PGA Memory**

```sql
-- View PGA usage
SELECT NAME, VALUE FROM V$PGASTAT WHERE NAME LIKE '%over%';

-- Solutions:
-- 1. Increase PGA_AGGREGATE_TARGET
-- 2. Optimize SQL, reduce sorting and hash operations
-- 3. Check for session leaks (unclosed cursors)
```

**Issue 3: Low Buffer Cache Hit Ratio**

```sql
-- Calculate Buffer Cache hit ratio
SELECT 
    ROUND((1 - (physical_reads / (db_block_gets + consistent_gets))) * 100, 2) AS hit_ratio
FROM (
    SELECT 
        SUM(CASE WHEN name = 'physical reads' THEN value ELSE 0 END) AS physical_reads,
        SUM(CASE WHEN name = 'db block gets' THEN value ELSE 0 END) AS db_block_gets,
        SUM(CASE WHEN name = 'consistent gets' THEN value ELSE 0 END) AS consistent_gets
    FROM V$SYSSTAT
    WHERE name IN ('physical reads', 'db block gets', 'consistent gets')
);

-- Hit ratio should be > 95%
-- If below 95%, consider increasing DB_CACHE_SIZE
```

**Issue 4: HugePages Not Being Used**

```bash
# Check if HugePages are sufficient
grep -i huge /proc/meminfo

# If HugePages_Free is 0, configuration is insufficient
# Need to increase nr_hugepages

# Check Oracle user memlock limit
ulimit -l
# Should be unlimited or sufficiently large

# Check if AMM is enabled (AMM disables HugePages)
sqlplus / as sysdba
SHOW PARAMETER MEMORY_TARGET;
# If not 0, need to switch to ASMM
```

---

Memory management is one of the core skills of an Oracle DBA. Choosing the right memory management mode, configuring parameters properly, and implementing OOM prevention are the foundations for ensuring stable database operation. For production environments, ASMM + HugePages is a proven best practice. The configuration templates and troubleshooting guide in this article are intended to help you better manage Oracle database memory resources.

*Author: OCM-certified Oracle DBA, focused on database operations and performance optimization. Blog: 4dba.top*
