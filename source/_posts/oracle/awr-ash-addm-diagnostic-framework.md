---
title: AWR/ASH/ADDM 诊断框架：从采样到根因的完整方法论
date: 2026-06-07 10:00:00
categories: Oracle
tags: [AWR, ASH, ADDM, 性能调优, 诊断, 等待事件]
---

## 一、问题背景

在日常数据库运维中，性能问题是最常见也最具挑战性的故障类型。一个典型的场景：业务方反馈"系统慢了"，DBA 登录数据库后面对的是数百个等待事件、数千条 SQL、上百个会话——**信息过载与关键指标缺失同时存在**。

没有系统方法论时，典型的低效排查路径是这样的：

1. 看 `V$SESSION`，发现很多会话，但不知道哪个是瓶颈
2. 手工抓 `V$SQL`，按执行时间排序，但不确定是否在采样窗口内
3. 反复登出登入，执行各种查询，等结果出来时问题可能已经消失
4. 最终凭经验猜测，缺乏数据支撑

这种"人肉诊断"模式的效率极低，且高度依赖个人经验。Oracle 从 10g 开始引入的 **AWR/ASH/ADDM 三位一体诊断体系**，正是为了解决这个问题。它们构成了一个从宏观到微观、从数据采集到智能分析的完整闭环：

- **AWR** 负责宏观工作负载统计（每小时快照）
- **ASH** 负责微观会话采样（每秒采样）
- **ADDME** 负责智能诊断建议（基于 AWR 数据的自动分析）

理解并掌握这三者的原理与协作方式，是从"经验驱动"走向"数据驱动"诊断的关键一步。

<!-- more -->

## 二、理论分析

### 2.1 AWR (Automatic Workload Repository)

#### 采样机制

AWR 的核心是**快照（Snapshot）**机制。默认每 **60 分钟**由 MMON（Manageability Monitor）后台进程自动采集一次数据库工作负载统计数据，写入 SYSAUX 表空间中的 AWR 相关表。

每个快照包含的统计维度：

| 维度 | 说明 |
|------|------|
| 时间模型统计 | DB Time, CPU Time, Parse Time 等 |
| 等待事件统计 | Wait Events 的总等待时间和次数 |
| SQL 统计 | Top SQL 的执行次数、耗时、逻辑读等 |
| 系统统计 | I/O、网络、内存、Redo 等系统级指标 |
| 段统计 | 热点段、锁等待段等 |
| 参数变更 | 快照期间变更的初始化参数 |

#### 核心视图

```sql
-- 查看快照信息
SELECT snap_id, begin_interval_time, end_interval_time, snap_level
FROM   dba_hist_snapshot
ORDER BY snap_id DESC
FETCH FIRST 10 ROWS ONLY;

-- 查看历史SQL统计
SELECT snap_id, sql_id, executions_delta, elapsed_time_delta,
       buffer_gets_delta, disk_reads_delta
FROM   dba_hist_sqlstat
WHERE  snap_id = (SELECT MAX(snap_id) FROM dba_hist_sqlstat)
ORDER BY elapsed_time_delta DESC
FETCH FIRST 20 ROWS ONLY;

-- 查看历史等待事件
SELECT snap_id, event_name, total_waits_fg, time_waited_micro_fg
FROM   dba_hist_system_event
WHERE  snap_id = (SELECT MAX(snap_id) FROM dba_hist_system_event)
ORDER BY time_waited_micro_fg DESC
FETCH FIRST 20 ROWS ONLY;
```

#### AWR 报告结构

一份完整的 AWR 报告通常包含以下关键章节：

1. **Report Summary** — 数据库基本信息、快照时间范围、DB Time 概览
2. **Load Profile** — 每秒/每事务的负载指标
3. **Instance Efficiency Percentages** — Buffer Hit, Library Hit 等命中率
4. **Top 5/10 Timed Foreground Events** — 最重要的等待事件
5. **SQL Statistics** — 按不同维度排序的 Top SQL
6. **Instance Activity Stats** — 实例级活动统计
7. **IO Statistics** — 表空间和文件级 I/O 统计
8. **Advisory Statistics** — 内存、PGA、Shared Pool 等顾问建议

#### AWR 基线管理

基线（Baseline）是一组被标记保存的快照，用于后续对比分析。基线的价值在于建立"正常状态"的参照系：

```sql
-- 创建固定基线
BEGIN
  DBMS_WORKLOAD_REPOSITORY.CREATE_BASELINE(
    start_snap_id => 1000,
    end_snap_id   => 1050,
    baseline_name => 'NORMAL_WORKLOAD_202606'
  );
END;
/

-- 创建移动窗口基线（用于自适应阈值）
BEGIN
  DBMS_WORKLOAD_REPOSITORY.MODIFY_BASELINE_WINDOW_SIZE(
    window_size => 30  -- 30天
  );
END;
/

-- 查看基线信息
SELECT baseline_id, baseline_name, start_snap_id, end_snap_id
FROM   dba_hist_baseline;
```

### 2.2 ASH (Active Session History)

#### 采样机制

ASH 是 Oracle 诊断体系中最具实战价值的组件。它**每秒**对所有活动会话（非 IDLE 状态）进行采样，记录会话的等待事件、SQL 信息、执行计划步骤等详细数据。

关键设计特点：

- **采样而非全量记录**：每秒只记录活动会话，数据量可控
- **循环缓冲区**：内存中使用环形缓冲区（在 SGA 中），旧数据会被覆盖
- **异步持久化**：MMON 进程定期将 ASH 数据刷到 AWR 历史表

#### 核心视图对比

| 视图 | 数据范围 | 保留时间 | 数据来源 |
|------|---------|---------|---------|
| `V$ACTIVE_SESSION_HISTORY` | 当前在内存中的数据 | 约 1 小时（取决于活动会话量） | SGA 循环缓冲区 |
| `DBA_HIST_ACTIVE_SESS_HISTORY` | 已持久化的历史数据 | 受 AWR 保留策略控制（默认 8 天） | AWR 快照写入 |

#### 采集的关键信息

每个 ASH 采样点记录的信息极为丰富：

```
SAMPLE_TIME        -- 采样时间
SESSION_ID         -- 会话ID
SESSION_SERIAL#    -- 会话序列号
USER_ID            -- 用户ID
SQL_ID             -- 当前执行的SQL
SQL_PLAN_HASH_VALUE -- 执行计划HASH
SQL_OPCODE         -- SQL操作类型（SELECT/INSERT/UPDATE等）
WAIT_CLASS         -- 等待事件类别
EVENT              -- 具体等待事件
P1, P2, P3         -- 等待事件参数
SESSION_STATE      -- ON_CPU / WAITING
BLOCKING_SESSION   -- 阻塞会话
MODULE / ACTION    -- 应用模块信息
```

### 2.3 ADDM (Automatic Database Diagnostic Monitor)

#### Top-Down 分析逻辑

ADDM 采用自顶向下的分析方法，其核心算法如下：

```
1. 计算两个相邻快照之间的 DB Time 变化
2. 识别 DB Time 增长的主要贡献者
3. 按以下层级逐级下钻：
   等待事件类别 (Wait Class)
     → 具体等待事件 (Wait Event)
       → SQL 语句 (SQL_ID)
         → 执行计划 (Plan Hash Value)
           → 根因分析 (Root Cause)
4. 生成带有优先级的诊断建议
```

#### 建议的优先级与分类

ADDM 建议分为几个主要类别：

| 类别 | 说明 | 示例 |
|------|------|------|
| Finding | 发现的问题 | "SQL 执行消耗了 60% 的 DB Time" |
| Recommendation | 具体建议 | "为 SQL xxx 创建索引" |
| Action | 可执行的操作 | "执行 CREATE INDEX 语句" |

每条 Finding 附带 **Impact** 评分，表示该问题对 DB Time 的影响百分比。Impact 越高，优先级越高。

#### ADDM vs 手工分析

| 维度 | ADDM | 手工 AWR 分析 |
|------|------|--------------|
| 速度 | 自动生成，秒级 | 人工阅读报告，分钟到小时级 |
| 全面性 | 自动覆盖所有维度 | 受限于人工经验和注意力 |
| 深度 | 提供到根因的完整链路 | 可能遗漏关联分析 |
| 灵活性 | 受限于内置算法 | 可以跨时间段、跨维度自由分析 |
| 适用场景 | 快速获取方向性建议 | 深入定制化分析 |

**最佳实践是两者结合**：先用 ADDM 快速定位方向，再用手工 AWR/ASH 深入验证。

### 2.4 三者的关系

AWR、ASH、ADDM 三者的关系可以用一个简单的比喻来理解：

```
┌─────────────────────────────────────────────┐
│              ADDM (智能分析师)               │
│   基于 AWR 数据自动生成诊断建议             │
│                                             │
│   ┌─────────────┐    ┌──────────────┐       │
│   │  AWR        │    │  ASH         │       │
│   │  (宏观相机)  │    │  (显微镜)    │       │
│   │             │    │              │       │
│   │ 每小时一张   │    │ 每秒一帧     │       │
│   │ 全景快照     │    │ 活动会话     │       │
│   │ 统计汇总     │    │ 采样详情     │       │
│   └─────────────┘    └──────────────┘       │
└─────────────────────────────────────────────┘
```

**时间点定位流程**：

1. 用户报告 "14:30 系统卡顿 5 分钟"
2. ADDM → 查看 14:00~15:00 的 ADDM 报告，获取 Top Finding
3. AWR → 查看该时段的 AWR 报告，确认 Top Wait Events 和 Top SQL
4. ASH → 精确定位 14:30~14:35 每秒的会话状态，找到阻塞链

## 三、实战操作

### 3.1 AWR 报告生成与分析

#### 生成 AWR 报告

```sql
-- 方式一：使用 awrrpt.sql（文本格式）
@$ORACLE_HOME/rdbms/admin/awrrpt.sql

-- 方式二：使用 awrrpti.sql（指定DBID和实例）
@$ORACLE_HOME/rdbms/admin/awrrpti.sql

-- 方式三：生成 HTML 格式
@$ORACLE_HOME/rdbms/admin/awrrpt.html
```

#### 关键章节解读示例

**Load Profile 示例**：

```
Load Profile                    Per Second    Per Transaction
~~~~~~~~~~~~~~~            ---------------    ---------------
DB Time(s):                        12.5               0.3
DB CPU(s):                          8.2               0.2
Redo size:                    524,288.0          12,582.9
Logical reads:                 45,678.0           1,096.3
Physical reads:                 3,456.0              82.9
User calls:                     2,345.0              56.3
Hard parses:                      125.0               3.0
```

**解读要点**：
- DB Time (12.5s) 远大于 DB CPU (8.2s)，说明有约 35% 的时间花在等待上
- Hard Parse 比例 = 125/总解析，若过高需关注绑定变量使用
- Physical reads/LLogical reads 比值反映缓存效率

**Top Timed Events 示例**：

```
Top 5 Timed Foreground Events
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
Event                          Waits    Time(s)  Avg wait  DB Time  Wait Class
------------------------------ ------  --------  --------  -------  ----------
db file sequential read       125,678   1,245.3    9.9ms     45.2%  User I/O
db file scattered read         45,230     523.1   11.6ms     19.0%  User I/O
enq: TX - row lock contention   1,250     389.2   311.4ms    14.1%  Application
log file sync                   8,900     156.7    17.6ms      5.7%  Commit
library cache lock                 89      98.5  1107.1ms     3.6%  Concurrency
```

**解读要点**：
- db file sequential read 占比 45.2%，是单块读（索引读），需检查索引效率
- enq: TX - row lock contention 平均等待 311ms，存在行锁竞争
- library cache lock 单次等待超 1 秒，可能存在硬解析或DDL竞争

**SQL Statistics 解读**：

重点关注以下维度排序：
- **Elapsed Time**：总耗时最长的 SQL，优先优化
- **CPU Time**：消耗 CPU 最多的 SQL
- **Buffer Gets**：逻辑读最多的 SQL，通常是全表扫描
- **Executions**：执行频率最高的 SQL，微小优化的累积效应大

#### AWR 对比报告

对比报告可以发现两个时间段的差异：

```sql
-- 生成对比报告
@$ORACLE_HOME/rdbms/admin/awrddrpt.sql
```

对比报告的价值：
- 对比正常时段 vs 故障时段，快速发现变化点
- 对比优化前 vs 优化后，量化优化效果
- 对比工作日 vs 周末，发现负载模式差异

### 3.2 ASH 数据分析

以下是实战中最常用的 ASH 查询脚本：

#### Top SQL by DB Time

```sql
-- 按DB Time排序的Top SQL（过去1小时）
SELECT sql_id,
       COUNT(*)                                               AS ash_samples,
       ROUND(COUNT(*) * 100 / SUM(COUNT(*)) OVER(), 2)       AS pct,
       MIN(sample_time)                                       AS first_seen,
       MAX(sample_time)                                       AS last_seen
FROM   v$active_session_history
WHERE  sample_time > SYSDATE - 1/24
AND    session_type = 'FOREGROUND'
AND    sql_id IS NOT NULL
GROUP BY sql_id
ORDER BY ash_samples DESC
FETCH FIRST 15 ROWS ONLY;
```

#### Top Wait Events

```sql
-- Top等待事件（过去30分钟）
SELECT event,
       wait_class,
       COUNT(*)                                               AS ash_samples,
       ROUND(COUNT(*) * 100 / SUM(COUNT(*)) OVER(), 2)       AS pct
FROM   v$active_session_history
WHERE  sample_time > SYSDATE - 30/1440
AND    session_state = 'WAITING'
AND    event IS NOT NULL
GROUP BY event, wait_class
ORDER BY ash_samples DESC
FETCH FIRST 20 ROWS ONLY;
```

#### 阻塞链分析

```sql
-- 阻塞链分析：找出阻塞源头
SELECT blocking_session,
       blocking_session_serial#,
       blocking_inst_id,
       COUNT(*)                   AS blocked_samples,
       MIN(sample_time)           AS start_time,
       MAX(sample_time)           AS end_time
FROM   gv$active_session_history
WHERE  sample_time > SYSDATE - 1/24
AND    blocking_session IS NOT NULL
GROUP BY blocking_session, blocking_session_serial#, blocking_inst_id
ORDER BY blocked_samples DESC
FETCH FIRST 10 ROWS ONLY;
```

#### 精确定位某一分钟的活动

```sql
-- 精确定位特定时间点的会话活动
-- 假设故障发生在 2026-06-07 14:30~14:35
SELECT TO_CHAR(sample_time, 'HH24:MI:SS') AS sample_ts,
       session_id,
       sql_id,
       event,
       wait_class,
       p1, p2, p3,
       blocking_session
FROM   dba_hist_active_sess_history
WHERE  sample_time BETWEEN TO_DATE('2026-06-07 14:30', 'YYYY-MM-DD HH24:MI')
                       AND TO_DATE('2026-06-07 14:35', 'YYYY-MM-DD HH24:MI')
ORDER BY sample_time, session_id;
```

#### 按模块分析

```sql
-- 按应用模块分析ASH活动
SELECT module,
       action,
       sql_id,
       event,
       COUNT(*) AS samples
FROM   v$active_session_history
WHERE  sample_time > SYSDATE - 1/24
AND    module IS NOT NULL
GROUP BY module, action, sql_id, event
ORDER BY samples DESC
FETCH FIRST 20 ROWS ONLY;
```

### 3.3 ADDM 使用

#### 创建 ADDM Task

```sql
-- 方式一：使用DBMS_ADDM包（12c+）
DECLARE
  task_name VARCHAR2(100);
BEGIN
  task_name := DBMS_ADDM.ANALYZE_INST(
    begin_snap   => 1000,
    end_snap     => 1001,
    instance_number => 1,
    db_id        => NULL  -- 当前库
  );
  DBMS_OUTPUT.PUT_LINE('Task: ' || task_name);
END;
/

-- 方式二：使用DBMS_ADVISOR包（通用方式）
DECLARE
  task_id   NUMBER;
  task_name VARCHAR2(100) := 'ADDM_TASK_' || TO_CHAR(SYSDATE, 'YYYYMMDD_HH24MI');
BEGIN
  DBMS_ADVISOR.CREATE_TASK(
    advisor_name => 'ADDM',
    task_id      => task_id,
    task_name    => task_name
  );

  DBMS_ADVISOR.SET_TASK_PARAMETER(
    task_name => task_name,
    parameter => 'START_SNAPSHOT',
    value     => 1000
  );

  DBMS_ADVISOR.SET_TASK_PARAMETER(
    task_name => task_name,
    parameter => 'END_SNAPSHOT',
    value     => 1001
  );

  DBMS_ADVISOR.EXECUTE_TASK(task_name);
END;
/
```

#### 查看 ADDM 报告

```sql
-- 方式一：使用DBMS_ADDM获取文本报告
SELECT DBMS_ADDM.GET_REPORT('任务名称') FROM dual;

-- 方式二：通过视图查询Findings
SELECT task_name, finding_name, impact, message
FROM   dba_advisor_findings
WHERE  task_name LIKE 'ADDM%'
ORDER BY task_id DESC, impact DESC;
```

#### ADDM 报告解读示例

一份典型的 ADDM Finding 输出如下：

```
FINDING 1: 67% impact on DB Time
SQL statement "SELECT * FROM orders WHERE customer_id = :1 AND status = :2"
was consuming significant database time.
  RECOMMENDATION 1: SQL Tuning
    Action: Run SQL Tuning Advisor for SQL_ID abc123def
    Rationale: Estimated 45% improvement with new execution plan
  RECOMMENDATION 2: Schema Modification
    Action: CREATE INDEX idx_orders_cust_status ON orders(customer_id, status)
    Rationale: The current plan uses full table scan on ORDERS (3.2M rows)

FINDING 2: 15% impact on DB Time
Log file sync waits were consuming significant database time.
  RECOMMENDATION 1: Configuration
    Action: Increase redo log file size from 200M to 1G
    Rationale: Average log file parallel write latency is 12ms
```

### 3.4 综合诊断流程

#### 标准诊断 SOP

以下是从发现问题到定位根因的标准流程：

```
故障报告
  │
  ▼
Step 1: ADDM 快速诊断
  │  执行 ADDM 分析最近一个快照周期
  │  获取 Top Findings 和建议
  │
  ▼
Step 2: AWR 趋势确认
  │  生成 AWR 报告，确认 Load Profile
  │  查看 Top Timed Events
  │  识别 Top SQL（按 Elapsed Time, Buffer Gets）
  │
  ▼
Step 3: ASH 精确定位
  │  按时间点缩小 ASH 查询范围
  │  分析等待事件的具体参数（P1, P2, P3）
  │  追踪阻塞链（blocking_session）
  │  定位具体 SQL 和执行计划
  │
  ▼
Step 4: 根因确认与修复
  │  确认根因（索引缺失、绑定变量窥探、锁竞争等）
  │  执行修复操作
  │
  ▼
Step 5: 效果验证
     对比修复前后的 AWR 指标
     确认 ASH 中等待事件是否消失
     ADDM 重新分析确认问题已消除
```

#### 瞬时性能问题的 ASH 快速定位

当问题发生时（比如正在发生的锁等待），ASH 是最直接的工具：

```sql
-- 实时查看当前活动会话的等待情况
SELECT s.sid,
       s.serial#,
       s.sql_id,
       s.event,
       s.wait_class,
       s.seconds_in_wait,
       s.blocking_session,
       q.sql_text
FROM   v$session s
LEFT JOIN v$sql q ON s.sql_id = q.sql_id
WHERE  s.status = 'ACTIVE'
AND    s.wait_class != 'Idle'
ORDER BY s.seconds_in_wait DESC;
```

#### 周期性性能问题的 AWR 趋势分析

对于每天固定时段出现的性能问题：

```sql
-- 对比最近7天同一时段的DB Time趋势
SELECT TO_CHAR(sn.begin_interval_time, 'DY HH24:MI') AS snap_time,
       ROUND(SUM(st.db_time_delta)/1e6, 2)           AS db_time_sec,
       ROUND(SUM(st.cpu_time_delta)/1e6, 2)           AS cpu_time_sec
FROM   dba_hist_sys_time_model st
JOIN   dba_hist_snapshot sn
       ON st.snap_id = sn.snap_id
      AND st.instance_number = sn.instance_number
WHERE  sn.begin_interval_time > SYSDATE - 7
AND    st.stat_name = 'DB time'
GROUP BY sn.snap_id, sn.begin_interval_time
ORDER BY sn.begin_interval_time;
```

## 四、结果验证

### AWR 报告关键指标检查清单

| 检查项 | 重点关注 | 警告阈值 |
|--------|---------|---------|
| DB Time vs Elapsed Time | DB Time 是否超过 Elapsed Time | > 1x（多会话并发） |
| DB CPU % | CPU 在 DB Time 中的占比 | < 50%（说明等待严重） |
| Buffer Cache Hit Ratio | 缓存命中率 | < 90% |
| Library Cache Hit Ratio | 库缓存命中率 | < 95% |
| Hard Parse % | 硬解析占比 | > 5% |
| Redo Log Switch/hour | 日志切换频率 | > 6次/小时 |
| Top Wait Event 占比 | 第一等待事件占比 | > 30%（需关注） |
| Top SQL 占比 | 第一SQL的DB Time占比 | > 50%（集中度高） |

### ASH Top Events 验证

修复操作后，通过 ASH 验证等待事件是否消除：

```sql
-- 对比修复前后某等待事件的ASH采样数
-- 假设修复前时间段：10:00-11:00，修复后：11:00-12:00
SELECT '修复前' AS period,
       event,
       COUNT(*) AS samples
FROM   dba_hist_active_sess_history
WHERE  sample_time BETWEEN TO_DATE('2026-06-07 10:00', 'YYYY-MM-DD HH24:MI')
                       AND TO_DATE('2026-06-07 11:00', 'YYYY-MM-DD HH24:MI')
AND    event = 'enq: TX - row lock contention'
GROUP BY event
UNION ALL
SELECT '修复后' AS period,
       event,
       COUNT(*) AS samples
FROM   dba_hist_active_sess_history
WHERE  sample_time BETWEEN TO_DATE('2026-06-07 11:00', 'YYYY-MM-DD HH24:MI')
                       AND TO_DATE('2026-06-07 12:00', 'YYYY-MM-DD HH24:MI')
AND    event = 'enq: TX - row lock contention'
GROUP BY event;
```

### ADDM 建议执行后的效果验证

```sql
-- 创建修复后的ADDM任务，对比Finding数量和Impact
-- 如果原Finding的Impact大幅下降或消失，说明修复有效
SELECT task_name,
       finding_name,
       ROUND(impact, 2) AS impact_pct,
       message
FROM   dba_advisor_findings
WHERE  task_name IN ('ADDM_BEFORE', 'ADDM_AFTER')
ORDER BY task_name, impact DESC;
```

## 五、经验总结

### AWR 报告的 5 分钟速读法

在紧急情况下，按照以下顺序快速阅读 AWR 报告：

1. **看时间范围**（30秒） — 确认快照时间和持续时间
2. **看 Load Profile**（60秒） — DB Time vs Elapsed，判断整体负载
3. **看 Top 5 Timed Events**（120秒） — 确定主要瓶颈类型
4. **看 Top SQL by Elapsed**（90秒） — 找到最耗时的 SQL
5. **看 IO Statistics**（60秒） — 确认是否有 I/O 瓶颈

整个过程不超过 5 分钟，即可形成初步诊断方向。

### 常见等待事件速查表

| Wait Event | Wait Class | 常见原因 | 处理方向 |
|------------|-----------|---------|---------|
| db file sequential read | User I/O | 索引范围扫描、单块读 | 检查索引效率、I/O 子系统 |
| db file scattered read | User I/O | 全表扫描、多块读 | 添加索引、优化 SQL |
| enq: TX - row lock contention | Application | 行锁竞争 | 检查事务提交频率、应用逻辑 |
| enq: TM - contention | Application | 表级锁（DML 与 DDL 冲突） | 检查外键索引、DDL 时机 |
| log file sync | Commit | 事务提交等待日志写入 | 增大 redo log、优化 I/O |
| latch: shared pool | Concurrency | 硬解析过多、Shared Pool 碎片化 | 使用绑定变量、调整 Shared Pool |
| library cache pin/lock | Concurrency | SQL 解析竞争 | 减少硬解析、避免高并发 DDL |
| cursor: pin S wait on X | Concurrency | 绑定变量窥探导致的游标失效 | 关闭窥探或使用 SPM |
| gc buffer busy acquire | Cluster | RAC 节点间缓存争用 | 优化数据分布、减少跨节点访问 |
| direct path read | User I/O | 并行查询、大表直接路径读 | 调整并行度、优化 PGA |

### ASH 在紧急故障中的应用

在生产故障中，ASH 的实时性使其成为最有力的武器：

**场景一：系统突然变慢**

```sql
-- 1. 快速看当前什么等待事件最多
SELECT event, COUNT(*) cnt
FROM   v$active_session_history
WHERE  sample_time > SYSDATE - 5/1440  -- 最近5分钟
AND    session_type = 'FOREGROUND'
GROUP BY event
ORDER BY cnt DESC
FETCH FIRST 5 ROWS ONLY;

-- 2. 看这个等待事件关联的SQL
SELECT sql_id, COUNT(*) cnt
FROM   v$active_session_history
WHERE  sample_time > SYSDATE - 5/1440
AND    event = '&event_name'  -- 替换为上面发现的事件
GROUP BY sql_id
ORDER BY cnt DESC
FETCH FIRST 5 ROWS ONLY;
```

**场景二：找到谁在阻塞谁**

```sql
-- 查看完整的阻塞链
SELECT LPAD(' ', 2 * (LEVEL - 1)) || sid AS blocking_tree,
       sid, serial#, sql_id, event, blocking_session
FROM (
  SELECT DISTINCT
         session_id AS sid,
         session_serial# AS serial#,
         sql_id,
         event,
         blocking_session
  FROM   v$active_session_history
  WHERE  sample_time > SYSDATE - 2/1440
  AND    (blocking_session IS NOT NULL
         OR session_id IN (SELECT DISTINCT blocking_session
                           FROM v$active_session_history
                           WHERE sample_time > SYSDATE - 2/1440
                           AND blocking_session IS NOT NULL))
)
CONNECT BY PRIOR sid = blocking_session
START WITH blocking_session IS NULL;
```

### 性能基线管理最佳实践

1. **创建工作日基线**：标记正常工作日的工作时间段快照
2. **创建周末基线**：对比工作日与周末的负载差异
3. **创建月末基线**：业务月末结账期间的特殊负载模式
4. **设置自适应阈值**：基于基线数据设置告警阈值，而非固定值
5. **定期保留关键基线**：基线快照不要随 AWR 保留策略自动清除
6. **版本升级前创建基线**：升级前保存基线，升级后对比验证

```sql
-- 查看当前 AWR 保留策略
SELECT * FROM dba_hist_wr_control;

-- 调整保留时间为30天，快照间隔为30分钟
BEGIN
  DBMS_WORKLOAD_REPOSITORY.MODIFY_SNAPSHOT_SETTINGS(
    retention => 30 * 24 * 60,   -- 30天（单位：分钟）
    interval  => 30               -- 30分钟
  );
END;
/
```

---

**总结**：AWR/ASH/ADDM 是 Oracle DBA 的诊断三板斧。AWR 负责"看全景"，ASH 负责"看细节"，ADDM 负责"给建议"。掌握了这套方法论，面对性能问题时就不会手忙脚乱——先用 ADDM 看方向，再用 AWR 看趋势，最后用 ASH 精准定位，形成完整的数据驱动诊断闭环。
