---
title: "AWR/ASH/ADDM Diagnostic Framework: From Sampling to Root Cause"
lang: en
date: 2026-03-03 10:00:00
categories: Oracle
tags: [AWR, ASH, ADDM, 性能调优, 诊断, 等待事件]
---

## I. Background

In daily database operations, performance problems are the most common and most challenging type of failure. A typical scenario: the business team reports "the system is slow," and the DBA logs into the database facing hundreds of wait events, thousands of SQL statements, and hundreds of sessions — **information overload and critical indicator deficiency coexist**.

Without a systematic methodology, the typical inefficient troubleshooting path looks like this:

1. Check `V$SESSION`, find many sessions, but don't know which is the bottleneck
2. Manually capture `V$SQL`, sort by execution time, but unsure if it's within the sampling window
3. Repeatedly log out and log in, execute various queries, by the time results come back the problem may have disappeared
4. Ultimately guess based on experience, lacking data support

This "manual diagnosis" approach is extremely inefficient and highly dependent on individual experience. Oracle's **AWR/ASH/ADDM triad diagnostic system**, introduced from 10g onwards, was designed to solve exactly this problem. They form a complete closed loop from macro to micro, from data collection to intelligent analysis:

- **AWR** handles macro workload statistics (hourly snapshots)
- **ASH** handles micro session sampling (per-second sampling)
- **ADDM** handles intelligent diagnostic recommendations (automatic analysis based on AWR data)

Understanding and mastering the principles and collaboration of these three is the critical step from "experience-driven" to "data-driven" diagnosis.

<!-- more -->

## II. Theoretical Analysis

### 2.1 AWR (Automatic Workload Repository)

#### Sampling Mechanism

The core of AWR is the **Snapshot** mechanism. By default, every **60 minutes** the MMON (Manageability Monitor) background process automatically collects database workload statistics and writes them to AWR-related tables in the SYSAUX tablespace.

Statistical dimensions included in each snapshot:

| Dimension | Description |
|-----------|-------------|
| Time Model Statistics | DB Time, CPU Time, Parse Time, etc. |
| Wait Event Statistics | Total wait time and count of Wait Events |
| SQL Statistics | Top SQL execution count, elapsed time, logical reads, etc. |
| System Statistics | I/O, network, memory, redo system-level metrics |
| Segment Statistics | Hot segments, lock-waiting segments, etc. |
| Parameter Changes | Initialization parameters changed during the snapshot |

#### Core Views

```sql
-- View snapshot information
SELECT snap_id, begin_interval_time, end_interval_time, snap_level
FROM   dba_hist_snapshot
ORDER BY snap_id DESC
FETCH FIRST 10 ROWS ONLY;

-- View historical SQL statistics
SELECT snap_id, sql_id, executions_delta, elapsed_time_delta,
       buffer_gets_delta, disk_reads_delta
FROM   dba_hist_sqlstat
WHERE  snap_id = (SELECT MAX(snap_id) FROM dba_hist_sqlstat)
ORDER BY elapsed_time_delta DESC
FETCH FIRST 20 ROWS ONLY;

-- View historical wait events
SELECT snap_id, event_name, total_waits_fg, time_waited_micro_fg
FROM   dba_hist_system_event
WHERE  snap_id = (SELECT MAX(snap_id) FROM dba_hist_system_event)
ORDER BY time_waited_micro_fg DESC
FETCH FIRST 20 ROWS ONLY;
```

#### AWR Report Structure

A complete AWR report typically contains the following key sections:

1. **Report Summary** — Database basic information, snapshot time range, DB Time overview
2. **Load Profile** — Per-second/per-transaction load metrics
3. **Instance Efficiency Percentages** — Buffer Hit, Library Hit and other hit ratios
4. **Top 5/10 Timed Foreground Events** — The most important wait events
5. **SQL Statistics** — Top SQL sorted by different dimensions
6. **Instance Activity Stats** — Instance-level activity statistics
7. **IO Statistics** — Tablespace and file-level I/O statistics
8. **Advisory Statistics** — Memory, PGA, Shared Pool advisor recommendations

#### AWR Baseline Management

A Baseline is a set of marked and saved snapshots used for subsequent comparative analysis. The value of baselines lies in establishing a reference frame for "normal state":

```sql
-- Create a fixed baseline
BEGIN
  DBMS_WORKLOAD_REPOSITORY.CREATE_BASELINE(
    start_snap_id => 1000,
    end_snap_id   => 1050,
    baseline_name => 'NORMAL_WORKLOAD_202606'
  );
END;
/

-- Create a moving window baseline (for adaptive thresholds)
BEGIN
  DBMS_WORKLOAD_REPOSITORY.MODIFY_BASELINE_WINDOW_SIZE(
    window_size => 30  -- 30 days
  );
END;
/

-- View baseline information
SELECT baseline_id, baseline_name, start_snap_id, end_snap_id
FROM   dba_hist_baseline;
```

### 2.2 ASH (Active Session History)

#### Sampling Mechanism

ASH is the most practically valuable component in Oracle's diagnostic system. It samples all active sessions (non-IDLE state) **every second**, recording detailed data including wait events, SQL information, and execution plan steps.

Key design characteristics:

- **Sampling, not full recording**: Only records active sessions every second, keeping data volume controllable
- **Circular buffer**: Uses a ring buffer in memory (in SGA), old data is overwritten
- **Asynchronous persistence**: MMON process periodically flushes ASH data to AWR history tables

#### Core View Comparison

| View | Data Scope | Retention | Data Source |
|------|-----------|-----------|-------------|
| `V$ACTIVE_SESSION_HISTORY` | Currently in-memory data | Approximately 1 hour (depends on active session volume) | SGA circular buffer |
| `DBA_HIST_ACTIVE_SESS_HISTORY` | Persisted historical data | Controlled by AWR retention policy (default 8 days) | AWR snapshot writes |

#### Key Information Captured

Each ASH sampling point records extremely rich information:

```
SAMPLE_TIME        -- Sampling time
SESSION_ID         -- Session ID
SESSION_SERIAL#    -- Session serial number
USER_ID            -- User ID
SQL_ID             -- Currently executing SQL
SQL_PLAN_HASH_VALUE -- Execution plan hash
SQL_OPCODE         -- SQL operation type (SELECT/INSERT/UPDATE, etc.)
WAIT_CLASS         -- Wait event class
EVENT              -- Specific wait event
P1, P2, P3         -- Wait event parameters
SESSION_STATE      -- ON_CPU / WAITING
BLOCKING_SESSION   -- Blocking session
MODULE / ACTION    -- Application module info
```

### 2.3 ADDM (Automatic Database Diagnostic Monitor)

#### Top-Down Analysis Logic

ADDM uses a top-down analysis method with the following core algorithm:

```
1. Calculate the DB Time change between two adjacent snapshots
2. Identify the main contributors to DB Time growth
3. Drill down level by level:
   Wait Class
     → Wait Event
       → SQL Statement (SQL_ID)
         → Execution Plan (Plan Hash Value)
           → Root Cause Analysis
4. Generate prioritized diagnostic recommendations
```

#### Recommendation Priority and Classification

ADDM recommendations fall into several main categories:

| Category | Description | Example |
|----------|-------------|---------|
| Finding | Problem discovered | "SQL execution consumed 60% of DB Time" |
| Recommendation | Specific suggestion | "Create index for SQL xxx" |
| Action | Executable operation | "Execute CREATE INDEX statement" |

Each Finding includes an **Impact** score, representing the percentage of DB Time affected by this issue. Higher Impact means higher priority.

#### ADDM vs Manual Analysis

| Dimension | ADDM | Manual AWR Analysis |
|-----------|------|---------------------|
| Speed | Automatic generation, seconds | Manual report reading, minutes to hours |
| Completeness | Automatically covers all dimensions | Limited by human experience and attention |
| Depth | Provides complete chain to root cause | May miss cross-correlation analysis |
| Flexibility | Limited by built-in algorithms | Free cross-time, cross-dimension analysis |
| Best For | Quick directional recommendations | In-depth customized analysis |

**Best practice is to combine both**: Use ADDM for quick directional identification, then use manual AWR/ASH for in-depth verification.

### 2.4 The Relationship Between the Three

The relationship between AWR, ASH, and ADDM can be understood with a simple analogy:

```
┌─────────────────────────────────────────────┐
│              ADDM (Intelligent Analyst)      │
│   Auto-generates diagnostic recommendations │
│   based on AWR data                         │
│                                             │
│   ┌─────────────┐    ┌──────────────┐       │
│   │  AWR        │    │  ASH         │       │
│   │  (Macro     │    │  (Microscope)│       │
│   │   Camera)   │    │              │       │
│   │             │    │              │       │
│   │ One per hour│    │ One per      │       │
│   │ Panoramic   │    │ second       │       │
│   │ snapshot    │    │ Active       │       │
│   │ Statistics  │    │ session      │       │
│   │ summary     │    │ sampling     │       │
│   │             │    │ details      │       │
│   └─────────────┘    └──────────────┘       │
└─────────────────────────────────────────────┘
```

**Time-Point Location Workflow**:

1. User reports "system stuttered for 5 minutes at 14:30"
2. ADDM → Check the 14:00~15:00 ADDM report, get Top Findings
3. AWR → Check the AWR report for that period, confirm Top Wait Events and Top SQL
4. ASH → Precisely locate session state per second during 14:30~14:35, find blocking chain

## III. Hands-On Operations

### 3.1 AWR Report Generation and Analysis

#### Generating AWR Reports

```sql
-- Method 1: Use awrrpt.sql (text format)
@$ORACLE_HOME/rdbms/admin/awrrpt.sql

-- Method 2: Use awrrpti.sql (specify DBID and instance)
@$ORACLE_HOME/rdbms/admin/awrrpti.sql

-- Method 3: Generate HTML format
@$ORACLE_HOME/rdbms/admin/awrrpt.html
```

#### Key Section Interpretation Example

**Load Profile Example**:

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

**Interpretation Points**:
- DB Time (12.5s) is much greater than DB CPU (8.2s), indicating about 35% of time is spent waiting
- Hard Parse ratio = 125/total parses; if too high, check bind variable usage
- Physical reads / Logical reads ratio reflects cache efficiency

**Top Timed Events Example**:

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

**Interpretation Points**:
- db file sequential read accounts for 45.2%, it's a single-block read (index read) — check index efficiency
- enq: TX - row lock contention averages 311ms wait — row lock contention exists
- library cache lock single wait exceeds 1 second — possible hard parse or DDL contention

**SQL Statistics Interpretation**:

Focus on the following dimension sorts:
- **Elapsed Time**: SQL with longest total elapsed time — prioritize optimization
- **CPU Time**: SQL consuming the most CPU
- **Buffer Gets**: SQL with the most logical reads — usually full table scans
- **Executions**: SQL with highest execution frequency — small optimizations have large cumulative effects

#### AWR Comparison Reports

Comparison reports can reveal differences between two time periods:

```sql
-- Generate comparison report
@$ORACLE_HOME/rdbms/admin/awrddrpt.sql
```

Value of comparison reports:
- Compare normal period vs failure period — quickly identify change points
- Compare before optimization vs after optimization — quantify optimization effectiveness
- Compare weekday vs weekend — discover load pattern differences

### 3.2 ASH Data Analysis

Here are the most commonly used ASH query scripts in practice:

#### Top SQL by DB Time

```sql
-- Top SQL by DB Time (past 1 hour)
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
-- Top wait events (past 30 minutes)
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

#### Blocking Chain Analysis

```sql
-- Blocking chain analysis: find the blocking source
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

#### Precisely Locate Activity for a Specific Minute

```sql
-- Precisely locate session activity at a specific time point
-- Assume failure occurred at 2026-06-07 14:30~14:35
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

#### Analysis by Module

```sql
-- Analyze ASH activity by application module
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

### 3.3 ADDM Usage

#### Creating an ADDM Task

```sql
-- Method 1: Use DBMS_ADDM package (12c+)
DECLARE
  task_name VARCHAR2(100);
BEGIN
  task_name := DBMS_ADDM.ANALYZE_INST(
    begin_snap   => 1000,
    end_snap     => 1001,
    instance_number => 1,
    db_id        => NULL  -- Current DB
  );
  DBMS_OUTPUT.PUT_LINE('Task: ' || task_name);
END;
/

-- Method 2: Use DBMS_ADVISOR package (universal approach)
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

#### Viewing ADDM Reports

```sql
-- Method 1: Use DBMS_ADDM for text report
SELECT DBMS_ADDM.GET_REPORT('task_name') FROM dual;

-- Method 2: Query Findings through views
SELECT task_name, finding_name, impact, message
FROM   dba_advisor_findings
WHERE  task_name LIKE 'ADDM%'
ORDER BY task_id DESC, impact DESC;
```

#### ADDM Report Interpretation Example

A typical ADDM Finding output looks like:

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

### 3.4 Comprehensive Diagnostic Workflow

#### Standard Diagnostic SOP

The following is the standard process from problem discovery to root cause identification:

```
Failure Report
  │
  ▼
Step 1: ADDM Quick Diagnosis
  │  Execute ADDM analysis for the most recent snapshot period
  │  Get Top Findings and recommendations
  │
  ▼
Step 2: AWR Trend Confirmation
  │  Generate AWR report, confirm Load Profile
  │  Check Top Timed Events
  │  Identify Top SQL (by Elapsed Time, Buffer Gets)
  │
  ▼
Step 3: ASH Precise Location
  │  Narrow ASH query range by time point
  │  Analyze wait event parameters (P1, P2, P3)
  │  Trace blocking chain (blocking_session)
  │  Locate specific SQL and execution plan
  │
  ▼
Step 4: Root Cause Confirmation and Fix
  │  Confirm root cause (missing index, bind variable peeking, lock contention, etc.)
  │  Execute fix operation
  │
  ▼
Step 5: Effect Verification
     Compare AWR metrics before and after fix
     Confirm wait events have disappeared in ASH
     Re-run ADDM to confirm problem resolved
```

#### Real-Time ASH for Instant Performance Issues

When a problem is occurring (e.g., ongoing lock wait), ASH is the most direct tool:

```sql
-- Real-time view of current active session waits
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

#### AWR Trend Analysis for Periodic Performance Issues

For performance issues occurring at the same time each day:

```sql
-- Compare DB Time trends for the same period over the last 7 days
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

## IV. Result Verification

### AWR Report Key Metrics Checklist

| Check Item | Focus | Warning Threshold |
|------------|-------|-------------------|
| DB Time vs Elapsed Time | Whether DB Time exceeds Elapsed Time | > 1x (multi-session concurrency) |
| DB CPU % | CPU proportion in DB Time | < 50% (severe waiting) |
| Buffer Cache Hit Ratio | Cache hit ratio | < 90% |
| Library Cache Hit Ratio | Library cache hit ratio | < 95% |
| Hard Parse % | Hard parse proportion | > 5% |
| Redo Log Switch/hour | Log switch frequency | > 6 times/hour |
| Top Wait Event proportion | First wait event proportion | > 30% (needs attention) |
| Top SQL proportion | First SQL's DB Time proportion | > 50% (high concentration) |

### ASH Top Events Verification

After fix operations, verify through ASH whether wait events have been eliminated:

```sql
-- Compare ASH sample counts for a wait event before and after fix
-- Assume pre-fix period: 10:00-11:00, post-fix: 11:00-12:00
SELECT 'Before' AS period,
       event,
       COUNT(*) AS samples
FROM   dba_hist_active_sess_history
WHERE  sample_time BETWEEN TO_DATE('2026-06-07 10:00', 'YYYY-MM-DD HH24:MI')
                       AND TO_DATE('2026-06-07 11:00', 'YYYY-MM-DD HH24:MI')
AND    event = 'enq: TX - row lock contention'
GROUP BY event
UNION ALL
SELECT 'After' AS period,
       event,
       COUNT(*) AS samples
FROM   dba_hist_active_sess_history
WHERE  sample_time BETWEEN TO_DATE('2026-06-07 11:00', 'YYYY-MM-DD HH24:MI')
                       AND TO_DATE('2026-06-07 12:00', 'YYYY-MM-DD HH24:MI')
AND    event = 'enq: TX - row lock contention'
GROUP BY event;
```

### ADDM Recommendation Effect Verification

```sql
-- Create post-fix ADDM task, compare Finding count and Impact
-- If the original Finding's Impact drops significantly or disappears, the fix is effective
SELECT task_name,
       finding_name,
       ROUND(impact, 2) AS impact_pct,
       message
FROM   dba_advisor_findings
WHERE  task_name IN ('ADDM_BEFORE', 'ADDM_AFTER')
ORDER BY task_name, impact DESC;
```

## V. Lessons Learned

### 5-Minute Quick Reading Method for AWR Reports

In emergencies, quickly read AWR reports in this order:

1. **Check time range** (30 seconds) — Confirm snapshot time and duration
2. **Check Load Profile** (60 seconds) — DB Time vs Elapsed, determine overall load
3. **Check Top 5 Timed Events** (120 seconds) — Identify main bottleneck type
4. **Check Top SQL by Elapsed** (90 seconds) — Find the most time-consuming SQL
5. **Check IO Statistics** (60 seconds) — Confirm whether I/O bottleneck exists

The entire process takes no more than 5 minutes to form an initial diagnostic direction.

### Common Wait Events Quick Reference

| Wait Event | Wait Class | Common Cause | Resolution Direction |
|------------|-----------|--------------|---------------------|
| db file sequential read | User I/O | Index range scan, single-block read | Check index efficiency, I/O subsystem |
| db file scattered read | User I/O | Full table scan, multi-block read | Add index, optimize SQL |
| enq: TX - row lock contention | Application | Row lock contention | Check transaction commit frequency, application logic |
| enq: TM - contention | Application | Table-level lock (DML vs DDL conflict) | Check foreign key index, DDL timing |
| log file sync | Commit | Transaction commit waiting for log write | Increase redo log, optimize I/O |
| latch: shared pool | Concurrency | Too many hard parses, Shared Pool fragmentation | Use bind variables, adjust Shared Pool |
| library cache pin/lock | Concurrency | SQL parsing contention | Reduce hard parses, avoid high-concurrency DDL |
| cursor: pin S wait on X | Concurrency | Cursor invalidation from bind variable peeking | Disable peeking or use SPM |
| gc buffer busy acquire | Cluster | RAC inter-node cache contention | Optimize data distribution, reduce cross-node access |
| direct path read | User I/O | Parallel query, large table direct path read | Adjust parallelism, optimize PGA |

### ASH Application in Emergency Failures

In production failures, ASH's real-time capability makes it the most powerful weapon:

**Scenario 1: System suddenly slows down**

```sql
-- 1. Quickly see what wait events are most common
SELECT event, COUNT(*) cnt
FROM   v$active_session_history
WHERE  sample_time > SYSDATE - 5/1440  -- Last 5 minutes
AND    session_type = 'FOREGROUND'
GROUP BY event
ORDER BY cnt DESC
FETCH FIRST 5 ROWS ONLY;

-- 2. See which SQL is associated with this wait event
SELECT sql_id, COUNT(*) cnt
FROM   v$active_session_history
WHERE  sample_time > SYSDATE - 5/1440
AND    event = '&event_name'  -- Replace with the event found above
GROUP BY sql_id
ORDER BY cnt DESC
FETCH FIRST 5 ROWS ONLY;
```

**Scenario 2: Find who is blocking whom**

```sql
-- View the complete blocking chain
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

### Performance Baseline Management Best Practices

1. **Create weekday baselines**: Mark workday work-period snapshots
2. **Create weekend baselines**: Compare weekday vs weekend load differences
3. **Create month-end baselines**: Special load patterns during month-end closing
4. **Set adaptive thresholds**: Set alert thresholds based on baseline data rather than fixed values
5. **Retain key baselines regularly**: Don't let baselines be automatically purged with AWR retention policy
6. **Create baselines before version upgrades**: Save baselines before upgrade, compare and verify after upgrade

```sql
-- View current AWR retention policy
SELECT * FROM dba_hist_wr_control;

-- Adjust retention to 30 days, snapshot interval to 30 minutes
BEGIN
  DBMS_WORKLOAD_REPOSITORY.MODIFY_SNAPSHOT_SETTINGS(
    retention => 30 * 24 * 60,   -- 30 days (unit: minutes)
    interval  => 30               -- 30 minutes
  );
END;
/
```

---

**Summary**: AWR/ASH/ADDM are the Oracle DBA's diagnostic toolkit. AWR handles "seeing the big picture," ASH handles "seeing the details," and ADDM handles "providing recommendations." Mastering this methodology means you won't be scrambling when facing performance issues — use ADDM for direction first, then AWR for trends, and finally ASH for precise location, forming a complete data-driven diagnostic closed loop.
