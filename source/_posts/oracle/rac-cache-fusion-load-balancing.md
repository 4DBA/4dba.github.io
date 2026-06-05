---
title: RAC Cache Fusion 深度解析与负载均衡实战
lang: zh-CN
date: 2026-02-05 10:00:00
categories: Oracle
tags: [RAC, Cache Fusion, GCS, 负载均衡, Service, 性能调优]
---

Oracle RAC（Real Application Clusters）是 Oracle 数据库实现高可用与水平扩展的核心架构。在 RAC 集群中，**Cache Fusion** 是最核心的技术——它让多个实例通过高速互联网络（Interconnect）直接交换数据块，而无需先写入磁盘。然而，很多 DBA 在遇到 `gc buffer busy`、`gc cr request` 等 Global Cache（GC）等待事件时束手无策，根源在于对 Cache Fusion 底层机制理解不足。与此同时，负载均衡配置不当也是 RAC 环境中的常见问题，经常导致某一节点过载而其他节点闲置，白白浪费集群资源。

本文将从原理出发，结合生产实战经验，深入剖析 Cache Fusion 的工作机制与负载均衡的最佳实践。

<!-- more -->

---

## 一、问题背景

在单实例数据库中，数据块只存在一个 Buffer Cache 中，所有会话访问同一份内存副本。但在 RAC 环境中，每个实例拥有独立的 Buffer Cache，当实例 1 需要访问的数据块当前缓存在实例 2 的内存中时，就必须通过 Cache Fusion 机制从实例 2 获取该块的副本。

这个过程虽然对应用透明，但涉及实例间通信、锁协调、一致性读构造等一系列复杂操作。如果设计或配置不当，极易出现以下问题：

- **GC 等待事件过高**：`gc buffer busy acquire`、`gc cr request` 等等待占据 Top 5 等待事件前列，严重拖慢 SQL 执行速度。
- **热点数据争用**：多个实例频繁读写同一组数据块，导致 LMS 进程成为瓶颈。
- **负载不均衡**：连接全部集中到一个节点，另一节点几乎空闲，集群资源利用率低下。
- **大事务影响**：长事务持有的锁未释放，导致其他实例的 GC 请求长时间等待。

---

## 二、理论分析

### 2.1 Cache Fusion 原理

#### 从 Disk-based 到 Cache-based 的演进

在 Oracle 8i 之前的 Parallel Server 时代，当实例间需要共享数据时，必须先将脏块（Dirty Block）写回磁盘，另一个实例再从磁盘读取——这就是 **Disk-based Cache Coherency**。这种方式的 I/O 开销极大，是早期 RAC 性能的主要瓶颈。

Oracle 8i 引入了 Cache Fusion Phase I，实现了 Current Block 的内存间传输；Oracle 9i 的 Cache Fusion Phase II 进一步支持了 CR Block 的直接传输，彻底消除了数据交换对磁盘的依赖。这就是 **Cache-based Cache Coherency**——数据块直接通过私有网络在实例的 Buffer Cache 之间传递。

#### Global Cache Service (GCS) 与 Global Enqueue Service (GES)

RAC 的全局协调依赖两大核心服务：

- **GCS（Global Cache Service）**：负责数据块的全局一致性管理。它协调数据块在各实例间的传输与锁定，是 Cache Fusion 的核心调度器。
- **GES（Global Enqueue Service）**：负责全局锁（Enqueue）的协调管理，包括字典缓存锁、DDL 锁、事务锁等非数据块级别的锁资源。

GCS 和 GES 的元数据存储在 **GRD（Global Resource Directory）** 中，GRD 分布在所有实例的共享内存中，每个实例负责管理一部分资源。

#### LMS（Lock Manager Server）进程的核心角色

LMS 进程是 Cache Fusion 中最关键的工作进程，其职责包括：

1. **处理来自其他实例的 GC 请求**：当实例 A 需要实例 B 上的数据块时，由实例 B 的 LMS 进程负责将数据块通过 Interconnect 发送给实例 A。
2. **管理 GCS 资源**：维护数据块的锁模式和角色信息。
3. **构造 CR Block**：当请求的块被修改过但请求方需要一致性读版本时，LMS 负责利用 Undo 信息构造 CR Block。

LMS 进程的数量由参数 `_lm_lms`（11g+）或 `GCS_SERVER_PROCESSES` 控制，默认值根据 CPU 核数自动计算。在高并发的 RAC 环境中，通常建议手动增加 LMS 进程数。

#### LMD（Lock Manager Daemon）进程

LMD 进程负责处理 GES 相关的锁请求，它是锁管理的守护进程。当会话需要获取全局锁时，LMD 接收请求并通过 GRD 协调锁的授予。虽然 LMD 不直接参与数据块传输，但它的性能直接影响全局锁获取的速度。

### 2.2 数据块在RAC中的流转

#### PCM Lock 模式

RAC 使用 PCM（Parallel Cache Management）锁来管理数据块的并发访问，共有四种模式：

| 模式 | 含义 | 说明 |
|------|------|------|
| **Null (N)** | 无访问 | 不持有该块的任何锁 |
| **Shared (S)** | 共享读 | 可以读取 Current Block，多实例可同时持有 S 模式 |
| **Shared Sub-Xact (SSX)** | 子事务共享 | 11g 引入，用于支持更细粒度的并发写 |
| **Exclusive (X)** | 独占写 | 可以修改数据块，同一时刻只有一个实例能持有 X 模式 |

每个数据块的 GCS 资源记录了三个关键信息：**Lock Mode**（当前持有模式）、**Role**（Local 或 Global）和 **Past Image（PI）**。

#### Current Block 请求流程

当实例 1 需要读取一个当前缓存在实例 2 的 Current Block 时：

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

#### CR Block 请求流程

当实例 1 需要读取一个 CR Block（一致性读版本）时：

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

CR Block 的构造由 LMS 在持有方实例完成，这意味着请求方不会受到持有方当前事务的影响。这也是 Cache Fusion 相比 Disk-based 方案的显著优势。

#### Read-Read, Read-Write, Write-Write 场景

- **Read-Read（读-读）**：两个实例都需要读取同一数据块。此时两个实例都可以持有 S 模式锁，无需等待，数据块直接在实例间拷贝。这是开销最小的场景。

- **Read-Write（读-写）**：实例 1 要读，实例 2 当前持有 X 模式（正在修改）。实例 2 需要将锁降级为 S，同时可能需要构造 CR Block 发送给实例 1。如果实例 2 的事务已提交但块未写回，则可能需要写 Past Image。

- **Write-Write（写-写）**：两个实例都需要修改同一数据块。这需要将 X 模式从一个实例转移到另一个实例，涉及锁模式转换、PI 写入和数据块传输，是开销最大的场景。频繁的 Write-Write 争用是 GC 性能问题的主要来源。

### 2.3 GC等待事件

理解 GC 等待事件是诊断 RAC 性能问题的关键：

#### gc buffer busy acquire / gc buffer busy release

- **gc buffer busy acquire**：会话在尝试获取一个 GC Buffer 时发现该 Buffer 正忙（被其他会话持有或正在传输中），需要等待。通常意味着对同一数据块的并发访问过高。
- **gc buffer busy release**：会话在释放 GC Buffer 时遇到等待，通常发生在 LMS 正在处理该块的请求时。

#### gc cr request / gc current request

- **gc cr request**：会话需要从远程实例获取一个 CR Block，正在等待远程实例通过 Interconnect 返回。
- **gc current request**：会话需要从远程实例获取一个 Current Block，正在等待传输完成。

这两个等待事件的高值直接反映了 Cache Fusion 的数据传输开销。如果持续偏高，需要检查 Interconnect 带宽、LMS 进程数量以及是否存在热点块。

#### gc cr multi block request

多块读（如全表扫描）时，需要从远程实例获取多个 CR Block。如果该等待事件偏高，说明大量多块读操作都命中了远程实例的缓存。

#### gc cr block congested / gc current block congested

这两个等待事件表明 LMS 进程出现了拥塞，请求在 LMS 的队列中等待过久。通常与 LMS 进程数不足、CPU 资源紧张或 LMS 进程优先级设置不当有关。

#### 诊断方法

1. 检查 `GV$SESSION_WAIT` 中的等待事件分布。
2. 分析 AWR 报告中的 "Global Cache Load Profile" 段。
3. 查看 `GV$SYSSTAT` 中的 GC 统计信息。
4. 检查 Interconnect 网络的吞吐量和延迟。

### 2.4 Service级别负载均衡

#### Service 的概念与作用

Oracle Service 是将数据库工作负载逻辑分组的机制。通过 Service，可以将不同类型的应用负载分配到不同的 RAC 节点上，实现精细化的负载管理。Service 不仅是负载均衡的基础，还是 TAF、FAN、资源管理（Resource Manager）等高级功能的支撑。

#### Server-Side Load Balancing

服务端负载均衡由 Local Listener 实现。当客户端连接到某个节点的 Listener 时，该 Listener 可以根据各节点的负载情况将连接重定向到其他节点。配置方式：

```
# listener.ora - 配置REMOTE_LISTENER
REMOTE_LISTENER = LISTENERS_CLUSTER
```

每个节点的 PMON 进程会定期向 Local Listener 和 Remote Listener 注册实例的负载信息（Load Balance Advisory）。

#### Client-Side Load Balancing

客户端负载均衡通过 TNS 配置中的 `LOAD_BALANCE=YES` 实现，客户端在连接时随机选择一个地址进行连接：

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

运行时连接负载均衡（RCLB）是 Oracle 11g 引入的高级特性，基于 JDBC/OCI 的连接池实现。当连接池中创建新连接或回收空闲连接时，会根据节点的实时负载指标（运行时间、CPU 使用率、会话数等）动态选择最优节点。RCLB 依赖 FAN 通知机制工作。

---

## 三、实战操作

### 3.1 Cache Fusion 监控

#### GV$SYSSTAT 中的 GC 统计信息

以下脚本可以查看各实例的 GC 统计概况：

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

关键指标解读：

- **gc cr/current blocks served**：本实例作为持有方为其他实例提供的数据块数量。
- **gc cr/current blocks received**：本实例作为请求方从其他实例获取的数据块数量。
- **gc block send/flush time**：数据块传输的发送和刷盘时间（单位：1/100秒）。
- **gc blocks lost**：传输过程中丢失的块数，非零值说明 Interconnect 存在严重问题。

#### GC 等待事件的 AWR 分析

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

#### LMS 进程性能监控

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

### 3.2 Service 创建与配置

#### srvctl add service 配置示例

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

参数说明：
- **preferred**：首选运行节点。
- **available**：故障转移目标节点。
- **clbgoal**：Client Load Balance Goal，`SHORT` 表示基于瞬时负载。
- **rlbgoal**：Runtime Load Balance Goal，`SERVICE_TIME` 表示基于服务响应时间。

#### TAF 配置

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

#### FAN 配置

FAN（Fast Application Notification）允许应用快速感知集群事件（节点宕机、Service 状态变化等）。配置 FAN 需要确保：

```sql
-- 检查FAN相关设置
SELECT name, value FROM v$parameter 
WHERE name IN ('service_names', 'local_listener', 'remote_listener');

-- 确认ONS配置
srvctl config nodeapps | grep -i ons
```

### 3.3 负载均衡优化

#### LOAD_BALANCE=YES vs LOAD_BALANCE=FACTOR

`LOAD_BALANCE=YES` 是简单的随机负载均衡，而 12c 引入的 `LOAD_BALANCE=FACTOR` 允许基于节点权重进行负载分配：

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

#### 数据分区策略减少 GC 争用

减少 GC 争用的最有效方法是数据分区。通过哈希分区将数据分散到不同的实例：

```sql
-- 按客户ID哈希分区，不同分区路由到不同实例
-- 配合Service使用，每个Service绑定到特定实例

-- 示例：OLTP_SVC处理A-M开头的客户，OLTP_SVC2处理N-Z
-- 通过应用层路由或Oracle Application Continuity实现

-- 更直接的方案：使用Sequence的不同Cache值减少索引争用
CREATE SEQUENCE order_seq CACHE 1000 NOORDER;
-- NOORDER避免跨实例的序列值排序争用
```

### 3.4 GC 问题诊断

#### AWR 报告中 GC 相关指标解读

AWR 报告中有多个与 Cache Fusion 相关的关键段：

**1. Global Cache Load Profile（全局缓存负载概况）**

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

解读要点：
- **blocks served/received**：反映实例间数据交换量。差值过大说明负载不均衡。
- **Build Time**：构造 CR Block 的平均耗时。过高说明 Undo 段压力大。
- **Flush Time**：数据块刷盘时间。过高可能是 LMS CPU 不足。
- **Send Time**：网络传输时间。过高说明 Interconnect 带宽不足或延迟大。

**2. Global Cache Efficiency Percentage（全局缓存效率）**

```
Global Cache Efficiency Percentage (Target=100%):  92.34%
```

该值低于 95% 时需要关注，低于 90% 说明 GC 争用严重。

**3. Interconnect Traffic Stats**

```
Interconnect throughput:
    Send: 256.78 MB/sec
    Receive: 234.56 MB/sec
    Send + Receive: 491.34 MB/sec
```

如果 Interconnect 带宽使用率超过 70%，需要考虑升级网络或优化数据访问模式。

#### oradebug 诊断 LMS

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

#### 热点块处理

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

处理热点块的常见策略：
1. **数据重新分区**：将热点数据分散到不同的分区。
2. **反向键索引（Reverse Key Index）**：打散索引的插入热点。
3. **Sequence NOORDER**：避免跨实例排序争用。
4. **表分区 + 应用路由**：将不同分区的数据通过 Service 路由到不同实例。

---

## 四、结果验证

优化完成后，需要系统性地验证效果：

#### GC 等待事件检查

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

#### Service 状态检查

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

#### Interconnect 性能指标

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

## 五、经验总结

### Cache Fusion 优化的优先级

在实际生产环境中，Cache Fusion 的优化应遵循以下优先级：

1. **Interconnect 硬件优先**：确保使用高速互联（推荐 25GbE 或 InfiniBand），配置 Jumbo Frame（MTU=9000），验证无丢包。硬件是基础，软件优化再好也弥补不了网络带宽不足。

2. **数据访问模式优化**：减少不必要的跨实例数据访问是最根本的优化。通过数据分区、应用路由、合理设计 Service 来实现"数据跟着应用走"。

3. **LMS 进程调优**：根据 GC 负载调整 LMS 进程数，必要时提升 LMS 进程的 OS 优先级（通过 `ORA_LMS_PRI` 或 Linux 的 `nice`/`chrt`）。

4. **SQL 优化**：减少不必要的全表扫描和大范围扫描，降低 gc cr multi block request。优化热点 SQL 的执行计划。

### Service 设计的最佳实践

- 每个业务模块使用独立的 Service，不要全部使用默认的 `DB_SERVICE`。
- 为 OLTP 和 Batch 作业分别创建 Service，并绑定到不同的实例。
- 配置合理的 TAF 策略，确保故障转移时业务不中断。
- 定期检查 Service 的会话分布，及时发现负载不均衡。

### RAC 环境下的 SQL 优化策略

- **避免跨实例的大表关联**：通过 Service 路由确保关联表的数据在同一实例访问。
- **减少 FULL TABLE SCAN**：多块读在 RAC 中的开销是单实例的数倍（每个块可能在不同实例）。
- **绑定变量与游标共享**：减少硬解析带来的 Library Cache 全局锁争用。
- **合理使用 Result Cache**：对变化频率低的查询结果缓存，减少数据块访问。

### 大事务对 GC 的影响与优化

大事务（Long-Running Transaction）是 RAC 环境中的性能杀手：

- 大事务修改大量数据块，这些块被锁定在 X 模式，导致其他实例的读请求全部需要 GC 传输。
- 大事务的 Undo 信息量大，构造 CR Block 的开销显著增加。
- 大事务持有锁时间长，阻塞链可能导致级联的 GC 等待。

优化建议：
1. 将大事务拆分为多个小批次提交。
2. 使用 Direct Path Load 或 Partition Exchange 减少锁影响范围。
3. 将批处理作业通过 Service 路由到专用节点，与 OLTP 负载隔离。
4. 合理设置 Undo 表空间和 Undo Retention，避免 Undo 段争用。

---

> **总结**：RAC Cache Fusion 是一项精巧但复杂的技术，DBA 不仅要理解其底层原理，还要在实践中结合 AWR 分析、SQL 优化和 Service 设计进行系统性调优。负载均衡不是简单地设置 `LOAD_BALANCE=YES`，而是需要从业务逻辑、数据分区、Service 路由等多个维度综合设计。只有深入理解数据块在 RAC 集群中的流转规律，才能在面对 GC 等待事件时做到心中有数、对症下药。
