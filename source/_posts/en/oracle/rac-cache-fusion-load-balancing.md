---
title: "RAC Cache Fusion Deep Dive and Load Balancing Best Practices"
date: 2026-02-05 10:00:00
categories: Oracle
tags: [RAC, Cache Fusion, GCS, 负载均衡, Service, 性能调优]
lang: en
---

Oracle RAC (Real Application Clusters) is Oracle's core architecture for achieving high availability and horizontal scaling. In a RAC cluster, **Cache Fusion** is the most critical technology—it enables multiple instances to exchange data blocks directly through a high-speed interconnect network without writing to disk first. However, many DBAs are helpless when encountering Global Cache (GC) wait events such as `gc buffer busy` and `gc cr request`, and the root cause lies in insufficient understanding of Cache Fusion's underlying mechanisms. At the same time, improper load balancing configuration is also a common issue in RAC environments, often resulting in one node being overloaded while others are idle, wasting cluster resources.

This article starts from the principles and combines production experience to provide an in-depth analysis of Cache Fusion's working mechanisms and load balancing best practices.

<!-- more -->

---

## 1. Background

In a single-instance database, data blocks exist only in one Buffer Cache, and all sessions access the same in-memory copy. However, in a RAC environment, each instance has its own independent Buffer Cache. When Instance 1 needs to access a data block that is currently cached in Instance 2's memory, it must obtain a copy of that block from Instance 2 through the Cache Fusion mechanism.

Although this process is transparent to the application, it involves a series of complex operations including inter-instance communication, lock coordination, and consistent read construction. If the design or configuration is improper, the following problems are likely to occur:

- **Excessive GC wait events**: Wait events such as `gc buffer busy acquire` and `gc cr request` occupy the top positions in the Top 5 wait events, severely slowing down SQL execution.
- **Hot data contention**: Multiple instances frequently read and write the same set of data blocks, causing the LMS process to become a bottleneck.
- **Load imbalance**: All connections are concentrated on one node while the other node is nearly idle, resulting in low cluster resource utilization.
- **Large transaction impact**: Locks held by long-running transactions are not released, causing GC requests from other instances to wait for extended periods.

---

## 2. Theoretical Analysis

### 2.1 Cache Fusion Principles

#### Evolution from Disk-based to Cache-based

Before Oracle 8i, in the Parallel Server era, when instances needed to share data, dirty blocks had to be written back to disk first, and then the other instance could read from disk—this was **Disk-based Cache Coherency**. This approach had extremely high I/O overhead and was the main performance bottleneck of early RAC.

Oracle 8i introduced Cache Fusion Phase I, enabling in-memory transfer of Current Blocks. Oracle 9i's Cache Fusion Phase II further supported direct transfer of CR Blocks, completely eliminating the dependence of data exchange on disk. This is **Cache-based Cache Coherency**—data blocks are passed directly between instances' Buffer Caches via the private network.

#### Global Cache Service (GCS) and Global Enqueue Service (GES)

RAC's global coordination relies on two core services:

- **GCS (Global Cache Service)**: Responsible for global consistency management of data blocks. It coordinates the transfer and locking of data blocks between instances and is the core dispatcher of Cache Fusion.
- **GES (Global Enqueue Service)**: Responsible for coordination and management of global locks (Enqueues), including dictionary cache locks, DDL locks, transaction locks, and other non-data-block-level lock resources.

The metadata of GCS and GES is stored in the **GRD (Global Resource Directory)**. The GRD is distributed across the shared memory of all instances, with each instance responsible for managing a portion of the resources.

#### The Core Role of the LMS (Lock Manager Server) Process

The LMS process is the most critical worker process in Cache Fusion. Its responsibilities include:

1. **Processing GC requests from other instances**: When Instance A needs a data block on Instance B, Instance B's LMS process is responsible for sending the data block to Instance A via the Interconnect.
2. **Managing GCS resources**: Maintaining the lock mode and role information of data blocks.
3. **Constructing CR Blocks**: When a requested block has been modified but the requesting side needs a consistent read version, the LMS is responsible for constructing the CR Block using Undo information.

The number of LMS processes is controlled by the parameter `_lm_lms` (11g+) or `GCS_SERVER_PROCESSES`, with the default value automatically calculated based on CPU core count. In high-concurrency RAC environments, it is generally recommended to manually increase the number of LMS processes.

#### LMD (Lock Manager Daemon) Process

The LMD process is responsible for handling GES-related lock requests. It is the daemon process for lock management. When a session needs to acquire a global lock, the LMD receives the request and coordinates lock granting through the GRD. Although the LMD does not directly participate in data block transfer, its performance directly affects the speed of global lock acquisition.

### 2.2 Data Block Flow in RAC

#### PCM Lock Modes

RAC uses PCM (Parallel Cache Management) locks to manage concurrent access to data blocks. There are four modes:

| Mode | Meaning | Description |
|------|---------|-------------|
| **Null (N)** | No access | Does not hold any lock on the block |
| **Shared (S)** | Shared read | Can read Current Block, multiple instances can hold S mode simultaneously |
| **Shared Sub-Xact (SSX)** | Sub-transaction shared | Introduced in 11g, used to support finer-grained concurrent writes |
| **Exclusive (X)** | Exclusive write | Can modify the data block, only one instance can hold X mode at a time |

Each data block's GCS resource records three key pieces of information: **Lock Mode** (currently held mode), **Role** (Local or Global), and **Past Image (PI)**.

#### Current Block Request Flow

When Instance 1 needs to read a Current Block currently cached in Instance 2:

```
实例1 (请求方)                    实例2 (持有方)                    磁盘
    |                                 |                              |
    |--- 1. 发送 GC 请求 --->         |                              |
    |    (请求S模式Current Block)      |                              |
    |                                 |                              |
    |                                 | 2. LMS处理请求               |
    |                                 |    检查锁模式和角色           |
    |                                 |                              |
    |                                 | 3. 若有PI，写PI到磁盘        |
    |                                 |    (Role=Global时) ---------> |
    |                                 |                              |
    |<-- 4. 通过Interconnect ---      |                              |
    |    发送Current Block            |                              |
    |                                 |                              |
    | 5. 实例1获得S模式锁            | 锁模式降级为S                 |
    |    并读取数据块                  |                              |
```

#### CR Block Request Flow

When Instance 1 needs to read a CR Block (consistent read version):

```
实例1 (请求方)                    实例2 (持有方)
    |                                 |
    |--- 1. 发送 GC CR 请求 --->      |
    |    (附带SCN信息)                |
    |                                 |
    |                                 | 2. LMS使用Undo信息构造CR Block
    |                                 |    (在实例2的内存中完成)
    |                                 |
    |<-- 3. 发送CR Block ---          |
    |    (通过Interconnect)           |
    |                                 |
    | 4. 实例1缓存CR Block           |
    |    持有S模式                    |
```

CR Block construction is performed by the LMS on the holding instance, which means the requesting side is not affected by the holding side's current transaction. This is also a significant advantage of Cache Fusion over Disk-based solutions.

#### Read-Read, Read-Write, Write-Write Scenarios

- **Read-Read**: Both instances need to read the same data block. In this case, both instances can hold S mode locks without waiting, and the data block is directly copied between instances. This is the scenario with the least overhead.

- **Read-Write**: Instance 1 wants to read, while Instance 2 currently holds X mode (is modifying). Instance 2 needs to downgrade the lock to S, and may also need to construct a CR Block to send to Instance 1. If Instance 2's transaction has been committed but the block has not been written back, it may need to write a Past Image.

- **Write-Write**: Both instances need to modify the same data block. This requires transferring X mode from one instance to another, involving lock mode conversion, PI writing, and data block transfer—this is the scenario with the highest overhead. Frequent Write-Write contention is the main source of GC performance issues.

### 2.3 GC Wait Events

Understanding GC wait events is the key to diagnosing RAC performance issues:

#### gc buffer busy acquire / gc buffer busy release

- **gc buffer busy acquire**: The session finds that the Buffer is busy when trying to acquire a GC Buffer (held by another session or currently being transferred) and needs to wait. This typically indicates excessively high concurrent access to the same data block.
- **gc buffer busy release**: The session encounters a wait when releasing a GC Buffer, typically occurring when the LMS is processing a request for that block.

#### gc cr request / gc current request

- **gc cr request**: The session needs to obtain a CR Block from a remote instance and is waiting for the remote instance to return it via the Interconnect.
- **gc current request**: The session needs to obtain a Current Block from a remote instance and is waiting for the transfer to complete.

High values for these two wait events directly reflect Cache Fusion's data transfer overhead. If they are consistently high, you need to check Interconnect bandwidth, the number of LMS processes, and whether hot blocks exist.

#### gc cr multi block request

During multi-block reads (such as full table scans), multiple CR Blocks need to be obtained from remote instances. If this wait event is high, it indicates that many multi-block read operations are hitting the remote instance's cache.

#### gc cr block congested / gc current block congested

These two wait events indicate that the LMS process is experiencing congestion, with requests waiting too long in the LMS queue. This is usually related to insufficient LMS process count, tight CPU resources, or improper LMS process priority settings.

#### Diagnostic Methods

1. Check the wait event distribution in `GV$SESSION_WAIT`.
2. Analyze the "Global Cache Load Profile" section in the AWR report.
3. Check GC statistics in `GV$SYSSTAT`.
4. Check the Interconnect network throughput and latency.

### 2.4 Service-Level Load Balancing

#### Service Concept and Purpose

Oracle Service is a mechanism for logically grouping database workloads. Through Services, different types of application loads can be distributed to different RAC nodes, enabling fine-grained load management. Services are not only the foundation of load balancing but also support advanced features such as TAF, FAN, and Resource Manager.

#### Server-Side Load Balancing

Server-side load balancing is implemented by the Local Listener. When a client connects to a node's Listener, that Listener can redirect the connection to other nodes based on each node's load conditions. Configuration:

```
# listener.ora - 配置REMOTE_LISTENER
REMOTE_LISTENER = LISTENERS_CLUSTER
```

Each node's PMON process periodically registers instance load information (Load Balance Advisory) with both the Local Listener and Remote Listeners.

#### Client-Side Load Balancing

Client-side load balancing is implemented through `LOAD_BALANCE=YES` in the TNS configuration. The client randomly selects an address to connect to when establishing a connection:

```sql
ORCL =
  (DESCRIPTION =
    (ADDRESS_LIST =
      (LOAD_BALANCE = YES)
      (ADDRESS = (PROTOCOL = TCP)(HOST = node1-vip)(PORT = 1521))
      (ADDRESS = (PROTOCOL = TCP)(HOST = node2-vip)(PORT = 1521))
    )
    (CONNECT_DATA = (SERVICE_NAME = ORCL_SVC))
  )
```

#### Runtime Connection Load Balancing

Runtime Connection Load Balancing (RCLB) is an advanced feature introduced in Oracle 11g, based on JDBC/OCI connection pools. When new connections are created or idle connections are recycled in the connection pool, the optimal node is dynamically selected based on real-time load metrics (runtime, CPU usage, session count, etc.) of each node. RCLB relies on the FAN notification mechanism.

---

## 3. Hands-On Operations

### 3.1 Cache Fusion Monitoring

#### GC Statistics in GV$SYSSTAT

The following script shows the GC statistics overview for each instance:

```sql
-- 查看GC相关统计信息
SELECT inst_id, name, value
FROM gv$sysstat
WHERE name IN (
    'gc cr blocks served',
    'gc cr blocks received',
    'gc current blocks served',
    'gc current blocks received',
    'gc cr block build time',
    'gc cr block send time',
    'gc cr block flush time',
    'gc current block pin time',
    'gc current block send time',
    'gc current block flush time',
    'gc cr blocks lost',
    'gc current blocks lost',
    'gc blocks corrupt'
)
ORDER BY name, inst_id;
```

Key metric interpretation:

- **gc cr/current blocks served**: Number of data blocks this instance has provided to other instances as the holder.
- **gc cr/current blocks received**: Number of data blocks this instance has obtained from other instances as the requester.
- **gc block send/flush time**: Send and flush times for data block transfer (unit: 1/100 second).
- **gc blocks lost**: Number of blocks lost during transfer. A non-zero value indicates serious Interconnect issues.

#### AWR Analysis of GC Wait Events

```sql
-- 查看GC等待事件的详细统计
SELECT event_name,
       total_waits,
       total_timeouts,
       time_waited_micro / 1000000 AS time_waited_sec,
       ROUND(time_waited_micro / total_waits / 1000, 2) AS avg_wait_ms
FROM gv$system_event
WHERE event_name LIKE 'gc%'
  AND total_waits > 0
ORDER BY time_waited_micro DESC;
```

#### LMS Process Performance Monitoring

```sql
-- 查看LMS进程的状态和CPU使用情况
SELECT pid, pname, username, 
       ROUND((sysdate - logon_time) * 24, 2) AS hours_running,
       status
FROM gv$process
WHERE pname LIKE 'LMS%'
ORDER BY inst_id, pname;

-- 查看LMS进程的响应时间
SELECT inst_id, name, value
FROM gv$sysstat
WHERE name LIKE '%lms%'
   OR name LIKE '%gcs%message%'
ORDER BY inst_id, name;
```

### 3.2 Service Creation and Configuration

#### srvctl add service Configuration Example

```bash
# 创建Service，将OLTP负载分配到节点1和节点2
srvctl add service -db ORCL \
    -service OLTP_SVC \
    -preferred ORCL1,ORCL2 \
    -available ORCL3 \
    -role PRIMARY \
    -policy AUTOMATIC \
    -clbgoal SHORT \
    -rlbgoal SERVICE_TIME \
    -failovertype SELECT \
    -failoverretry 3 \
    -failoverdelay 5

# 启动Service
srvctl start service -db ORCL -service OLTP_SVC

# 创建报表专用Service，仅运行在节点3
srvctl add service -db ORCL \
    -service REPORT_SVC \
    -preferred ORCL3 \
    -available ORCL1 \
    -role PRIMARY \
    -policy AUTOMATIC
```

Parameter descriptions:
- **preferred**: Preferred running nodes.
- **available**: Failover target nodes.
- **clbgoal**: Client Load Balance Goal, `SHORT` means based on instantaneous load.
- **rlbgoal**: Runtime Load Balance Goal, `SERVICE_TIME` means based on service response time.

#### TAF Configuration

```sql
-- 服务端TAF配置（基于Service）
-- 通过srvctl配置时已包含failovertype等参数

-- 客户端TAF配置
OLTP_SVC =
  (DESCRIPTION =
    (ADDRESS = (PROTOCOL = TCP)(HOST = node1-vip)(PORT = 1521))
    (ADDRESS = (PROTOCOL = TCP)(HOST = node2-vip)(PORT = 1521))
    (CONNECT_DATA =
      (SERVICE_NAME = OLTP_SVC)
      (FAILOVER_MODE =
        (TYPE = SELECT)
        (METHOD = BASIC)
        (RETRIES = 3)
        (DELAY = 5)
      )
    )
  )
```

#### FAN Configuration

FAN (Fast Application Notification) allows applications to quickly detect cluster events (node crashes, Service status changes, etc.). Configuring FAN requires ensuring:

```sql
-- 检查FAN相关设置
SELECT name, value FROM v$parameter 
WHERE name IN ('service_names', 'local_listener', 'remote_listener');

-- 确认ONS配置
srvctl config nodeapps | grep -i ons
```

### 3.3 Load Balancing Optimization

#### LOAD_BALANCE=YES vs LOAD_BALANCE=FACTOR

`LOAD_BALANCE=YES` is simple random load balancing, while `LOAD_BALANCE=FACTOR` introduced in 12c allows load distribution based on node weights:

```sql
-- 12c+ 配置基于权重的负载均衡
OLTP_SVC =
  (DESCRIPTION =
    (ADDRESS_LIST =
      (LOAD_BALANCE = YES)
      (ADDRESS = (PROTOCOL = TCP)(HOST = node1-vip)(PORT = 1521))
      (ADDRESS = (PROTOCOL = TCP)(HOST = node2-vip)(PORT = 1521))
    )
    (CONNECT_DATA =
      (SERVICE_NAME = OLTP_SVC)
    )
  )
```

#### Data Partitioning Strategy to Reduce GC Contention

The most effective method to reduce GC contention is data partitioning. Use hash partitioning to distribute data across different instances:

```sql
-- 按客户ID哈希分区，不同分区路由到不同实例
-- 配合Service使用，每个Service绑定到特定实例

-- 示例：OLTP_SVC处理A-M开头的客户，OLTP_SVC2处理N-Z
-- 通过应用层路由或Oracle Application Continuity实现

-- 更直接的方案：使用Sequence的不同Cache值减少索引争用
CREATE SEQUENCE order_seq CACHE 1000 NOORDER;
-- NOORDER避免跨实例的序列值排序争用
```

### 3.4 GC Problem Diagnosis

#### AWR Report GC-Related Metrics Interpretation

There are several key sections in the AWR report related to Cache Fusion:

**1. Global Cache Load Profile**

```
Per Second                       Per Transaction
----------------------         ----------------------
Global Cache blocks served:       1,245.67          89.34
Global Cache blocks received:     1,032.45          73.92
GC CR Block Build Time (ms):         2.34           0.17
GC CR Block Flush Time (ms):         5.67           0.41
GC CR Block Send Time (ms):          1.23           0.09
GC Current Block Pin Time (ms):      3.45           0.25
GC Current Block Send Time (ms):     1.56           0.11
GC Current Block Flush Time (ms):    6.78           0.49
```

Interpretation key points:
- **blocks served/received**: Reflects the amount of data exchange between instances. A large difference indicates load imbalance.
- **Build Time**: Average time to construct a CR Block. High values indicate Undo segment pressure.
- **Flush Time**: Data block flush time. High values may indicate insufficient LMS CPU.
- **Send Time**: Network transfer time. High values indicate insufficient Interconnect bandwidth or high latency.

**2. Global Cache Efficiency Percentage**

```
Global Cache Efficiency Percentage (Target=100%):  92.34%
```

When this value is below 95%, it needs attention. Below 90% indicates severe GC contention.

**3. Interconnect Traffic Stats**

```
Interconnect throughput:
    Send: 256.78 MB/sec
    Receive: 234.56 MB/sec
    Send + Receive: 491.34 MB/sec
```

If Interconnect bandwidth usage exceeds 70%, consider upgrading the network or optimizing data access patterns.

#### oradebug LMS Diagnostics

```sql
-- 查找LMS进程的SPID
SELECT p.pid, p.spid, s.program
FROM gv$process p, gv$session s
WHERE p.addr = s.paddr
  AND p.pname LIKE 'LMS%'
  AND s.inst_id = p.inst_id;

-- 使用oradebug跟踪LMS（需SYSDBA权限）
-- 在LMS所在实例执行
oradebug setospid <LMS_SPID>
oradebug event 10046 trace name context forever, level 12
-- 等待一段时间后
oradebug event 10046 trace name context off
-- 分析trace文件中LMS的处理耗时
```

#### Hot Block Handling

```sql
-- 查找热点数据块
SELECT p1 "file#", p2 "block#", p3 "class#", COUNT(*)
FROM gv$session_wait
WHERE event LIKE 'gc%buffer%'
GROUP BY p1, p2, p3
HAVING COUNT(*) > 10
ORDER BY COUNT(*) DESC;

-- 进一步确认热点块所属对象
SELECT owner, segment_name, partition_name, segment_type
FROM dba_extents
WHERE file_id = &file_id
  AND &block_id BETWEEN block_id AND block_id + blocks - 1;
```

Common strategies for handling hot blocks:
1. **Data repartitioning**: Distribute hot data across different partitions.
2. **Reverse Key Index**: Scatter index insertion hotspots.
3. **Sequence NOORDER**: Avoid cross-instance ordering contention.
4. **Table partitioning + application routing**: Route data from different partitions to different instances through Services.

---

## 4. Result Verification

After optimization is complete, a systematic verification of the results is needed:

#### GC Wait Event Check

```sql
-- 实时检查GC等待事件
SELECT sw.inst_id, sw.event, COUNT(*) AS wait_count,
       ROUND(AVG(sw.wait_time_micro) / 1000, 2) AS avg_wait_ms
FROM gv$session_wait sw
WHERE sw.event LIKE 'gc%'
GROUP BY sw.inst_id, sw.event
ORDER BY wait_count DESC;

-- 对比优化前后的GC统计
SELECT s.inst_id, s.name, 
       s.value AS current_value,
       s.value - &baseline_value AS delta
FROM gv$sysstat s
WHERE s.name IN (
    'gc cr blocks served',
    'gc current blocks served',
    'gc cr block build time',
    'gc current block send time'
)
ORDER BY s.name, s.inst_id;
```

#### Service Status Check

```bash
# 检查Service运行状态
srvctl status service -db ORCL -service OLTP_SVC

# 检查Service详细配置
srvctl config service -db ORCL -service OLTP_SVC

# 查看Service的运行时统计
SELECT inst_id, service_name, COUNT(*) AS session_count
FROM gv$session
WHERE service_name IN ('OLTP_SVC', 'REPORT_SVC')
GROUP BY inst_id, service_name
ORDER BY service_name, inst_id;
```

#### Interconnect Performance Metrics

```sql
-- 检查Interconnect性能
SELECT name, value
FROM gv$sysstat
WHERE name IN (
    'IPC send bytes',
    'IPC recv bytes', 
    'IPC send count',
    'IPC recv count',
    'gc cr block receive time',
    'gc current block receive time'
)
ORDER BY name, inst_id;

-- 计算平均块传输时间
SELECT inst_id,
       ROUND(SUM(CASE WHEN name LIKE '%receive time%' THEN value END) * 10 /
             NULLIF(SUM(CASE WHEN name LIKE '%received%' THEN value END), 0), 2) 
       AS avg_transfer_ms
FROM gv$sysstat
WHERE name LIKE 'gc%block%receive%'
GROUP BY inst_id;
```

---

## 5. Lessons Learned

### Cache Fusion Optimization Priority

In actual production environments, Cache Fusion optimization should follow these priorities:

1. **Interconnect hardware first**: Ensure the use of high-speed interconnect (recommended 25GbE or InfiniBand), configure Jumbo Frame (MTU=9000), and verify no packet loss. Hardware is the foundation—no amount of software optimization can compensate for insufficient network bandwidth.

2. **Data access pattern optimization**: Reducing unnecessary cross-instance data access is the most fundamental optimization. Achieve "data follows the application" through data partitioning, application routing, and proper Service design.

3. **LMS process tuning**: Adjust the number of LMS processes based on GC load. If necessary, increase the OS priority of LMS processes (through `ORA_LMS_PRI` or Linux's `nice`/`chrt`).

4. **SQL optimization**: Reduce unnecessary full table scans and large range scans to lower gc cr multi block request. Optimize the execution plans of hotspot SQL.

### Service Design Best Practices

- Use a dedicated Service for each business module. Do not use the default `DB_SERVICE` for everything.
- Create separate Services for OLTP and batch jobs, and bind them to different instances.
- Configure appropriate TAF policies to ensure business continuity during failover.
- Regularly check Service session distribution to promptly detect load imbalance.

### SQL Optimization Strategies in RAC Environments

- **Avoid cross-instance large table joins**: Use Service routing to ensure that related table data is accessed on the same instance.
- **Reduce FULL TABLE SCAN**: Multi-block reads in RAC have several times the overhead of single instances (each block may be on a different instance).
- **Bind variables and cursor sharing**: Reduce Library Cache global lock contention caused by hard parsing.
- **Use Result Cache wisely**: Cache query results that change infrequently to reduce data block access.

### Impact of Large Transactions on GC and Optimization

Large transactions (Long-Running Transactions) are performance killers in RAC environments:

- Large transactions modify many data blocks, which are locked in X mode, causing all read requests from other instances to require GC transfer.
- Large transactions have large amounts of Undo information, significantly increasing the overhead of CR Block construction.
- Large transactions hold locks for extended periods, and blocking chains may cause cascading GC waits.

Optimization recommendations:
1. Split large transactions into multiple small batches for commit.
2. Use Direct Path Load or Partition Exchange to reduce the lock impact scope.
3. Route batch processing jobs to dedicated nodes through Services, isolating them from OLTP load.
4. Properly configure Undo tablespace and Undo Retention to avoid Undo segment contention.

---

> **Summary**: RAC Cache Fusion is an elegant but complex technology. DBAs must not only understand its underlying principles but also combine AWR analysis, SQL optimization, and Service design for systematic tuning in practice. Load balancing is not simply about setting `LOAD_BALANCE=YES`—it requires comprehensive design from multiple dimensions including business logic, data partitioning, and Service routing. Only by deeply understanding how data blocks flow within a RAC cluster can you be confident and targeted when facing GC wait events.
