---
title: "TX/TM Lock Mechanism Explained: Quick Identification of Blocking Sessions"
date: 2026-04-02 10:00:00
categories: Oracle
tags: [锁, TX锁, TM锁, 阻塞, Deadlock, 故障排查]
lang: en
---

In the daily operations of Oracle databases, lock and blocking issues are among the most common performance problems DBAs face. A blocking session that is not handled promptly can trigger a chain reaction within minutes, leading to a cascading failure of the entire business system. This article starts from the underlying principles of Oracle's lock mechanism, systematically explains how TX locks and TM locks work, and provides a complete set of blocking diagnosis and resolution procedures.

<!-- more -->

## 1. Problem Background

In production environments, lock and blocking issues are among the most common and most challenging performance problems. When one session holds a lock on a resource and another session needs to acquire a compatible lock on the same resource, the latter must wait — this is called Blocking. Unlike simple slow SQL, blocking problems often exhibit sudden onset and cascading behavior.

**The cascading effect of blocking** is the scenario DBAs fear most: when a row in a core transaction table is locked for an extended period, all business operations that depend on that table will queue up waiting. As the wait queue grows longer, the database connection pool is rapidly exhausted, application servers start reporting connection timeouts, and ultimately the entire business chain is paralyzed. In real-world cases, a simple `UPDATE` statement that fails to `COMMIT` in time can cause hundreds of sessions to enter a wait state within 5 minutes.

**Deadlock** is another extreme form of lock problem. When two or more sessions wait for each other to release resources, Oracle automatically detects the deadlock and breaks the circular wait by rolling back one of the sessions. While Oracle can handle deadlocks automatically, frequent deadlocks often indicate fundamental flaws in the application's transaction design.

Therefore, mastering Oracle's lock mechanism principles and having the ability to quickly identify and handle blocking sessions is a core skill for every DBA.

## 2. Theoretical Analysis

### 2.1 Oracle Lock Mechanism Overview

Oracle's lock mechanism can be divided into the following major categories:

**By function:**

| Lock Type | Description | Typical Scenario |
|-----------|-------------|-----------------|
| DML Lock | Protects data rows and table structure from concurrent modification | SELECT FOR UPDATE, UPDATE, DELETE |
| DDL Lock | Protects data dictionary object definitions | ALTER TABLE, DROP INDEX |
| Latch | Lightweight protection mechanism for memory structures | Buffer Cache, Shared Pool |
| Mutex | Finer-grained memory protection than Latch | Cursor Pin, Library Cache |

**DML Lock Modes:**

Oracle uses numeric codes to represent lock levels, from lowest to highest:

- **Row Share (RS, Mode=2)**: Acquired by `SELECT ... FOR UPDATE`, allows other sessions to concurrently read and write
- **Row Exclusive (RX, Mode=3)**: Acquired by `INSERT/UPDATE/DELETE`, allows other sessions to perform concurrent DML
- **Share (S, Mode=4)**: Acquired by `CREATE INDEX`, allows concurrent reads but prohibits writes
- **Share Row Exclusive (SRX, Mode=5)**: Rarely used, between Share and Exclusive
- **Exclusive (X, Mode=6)**: Highest level, completely exclusive access to the resource

The lock compatibility matrix determines concurrent behavior: two Row Exclusive locks can coexist (so multiple sessions can perform DML on the same table simultaneously), but an Exclusive lock is incompatible with any other lock.

### 2.2 TX Lock (Transaction Lock)

TX lock is one of the most important lock types in Oracle, closely associated with transactions.

**When TX locks are acquired:**

When a session executes a DML operation and modifies data, Oracle allocates a transaction slot in the Undo Segment's transaction table and marks transaction information on the modified data rows. At this point, the session holds a TX lock. Note that TX locks are held until the transaction is committed or rolled back, not released when the statement finishes executing.

**TX Lock Enqueue Type:**

In the `V$LOCK` view, the TX lock's `TYPE` column value is `'TX'`, and the combination of `REQUEST` and `LMODE` columns reveals the specific reason for the wait:

- **TX-4 (Mode=4, ITL Wait)**: The requester needs to allocate a transaction slot in the data block's ITL (Interested Transaction List), but all available ITL slots are occupied. This typically occurs in high-concurrency scenarios or when the table's `INITRANS` parameter is set too low.

- **TX-6 (Mode=6, Row Lock Wait)**: The requester wants to modify a row, but that row is already locked by another active transaction. This is the most common TX wait type, usually caused by long-running transactions.

**ITL Contention Explained:**

ITL (Interested Transaction List) is located in the block header area of each data block, recording which transactions are modifying data in that block. Each ITL entry occupies 24 bytes. By default, a data block has at least `INITRANS` ITL slots (default value is 2), and can dynamically expand up to `MAXTRANS` (fixed at 255 from 11g onwards).

When many concurrent transactions modify the same data block simultaneously and ITL slots are insufficient, new transactions must wait — this is ITL contention. In `V$LOCK`, it appears as `TYPE='TX'` with `REQUEST=4`.

### 2.3 TM Lock (DML Enqueue)

TM lock (also known as DML Enqueue) is used to protect a table's structure from DDL modifications during DML operations. When a session performs a DML operation on a table, Oracle acquires a TM lock at the table level.

**Relationship between TM lock modes and DML operations:**

- `INSERT/UPDATE/DELETE` acquires **Row Exclusive (RX, Mode=3)** TM lock
- `SELECT ... FOR UPDATE` acquires **Row Share (RS, Mode=2)** TM lock
- `LOCK TABLE ... IN SHARE MODE` acquires **Share (S, Mode=4)** TM lock

Since multiple RX locks can coexist compatibly, normal concurrent DML operations will not be blocked by TM locks.

**TM Lock Escalation Caused by Missing Foreign Key Indexes:**

This is a classic Oracle performance pitfall. When a child table's foreign key column lacks an index, executing `DELETE` or `UPDATE` on the parent table's primary key forces Oracle to acquire a **Share (S, Mode=4)** level TM lock on the child table to check for child records. The Share lock is incompatible with the Row Exclusive lock, meaning that during the lock hold period, any DML operation on the child table will be blocked.

```sql
-- Check for missing foreign key indexes
SELECT
    c.table_name      AS child_table,
    c.constraint_name AS fk_constraint,
    cc.column_name    AS fk_column
FROM
    user_constraints  p
    JOIN user_constraints  c  ON c.r_constraint_name = p.constraint_name
    JOIN user_cons_columns cc ON cc.constraint_name  = c.constraint_name
WHERE
    p.constraint_type = 'P'
    AND c.constraint_type   = 'R'
    AND NOT EXISTS (
        SELECT 1
        FROM user_ind_columns i
        WHERE i.table_name  = cc.table_name
          AND i.column_name = cc.column_name
          AND i.column_position = cc.position
    );
```

### 2.4 Blocking Chain Analysis

In complex production environments, blocking is often not simply "one session blocking another" but forms one or more blocking chains.

**Formation of lock wait chains:**

```
Session A (holds lock) → blocks → Session B (waiting for lock) → blocks → Session C (waiting for lock)
```

Session B waits for A to release its lock, while Session C waits for B because B holds another resource. This chain reaction is very common in high-concurrency systems.

**Relationship between V$LOCK, V$SESSION, V$TRANSACTION:**

- `V$LOCK`: Records all held locks and requested locks
- `V$SESSION`: Correlates to `V$LOCK`'s `KADDR` via the `LOCKWAIT` column
- `V$TRANSACTION`: Correlates via `V$SESSION.TADDR` to get transaction details (Undo usage, etc.)

Understanding the relationship between these three views is key to diagnosing lock issues. In `V$LOCK`, records with `BLOCK=1` indicate that session is blocking other sessions, while records with `REQUEST>0` indicate that session is waiting to acquire a lock.

## 3. Practical Operations

### 3.1 Blocking Session Identification

Below are the core blocking diagnostic scripts I use in daily operations, validated in numerous production environments:

**Script 1: Quick Identification of Blocking Source**

```sql
-- Quickly view all current blocking relationships
SELECT
    s1.sid              AS blocking_sid,
    s1.serial#          AS blocking_serial,
    s1.username         AS blocking_user,
    s1.machine          AS blocking_machine,
    s1.program          AS blocking_program,
    s1.status           AS blocking_status,
    s2.sid              AS waiting_sid,
    s2.serial#          AS waiting_serial,
    s2.username         AS waiting_user,
    s2.sql_id           AS waiting_sql_id,
    w.type              AS lock_type,
    w.id1               AS lock_id1,
    w.id2               AS lock_id2,
    w.ctime             AS wait_seconds
FROM
    v$lock  w
    JOIN v$session s2 ON s2.sid       = w.sid
    JOIN v$lock  h    ON h.type       = w.type
                     AND h.id1        = w.id1
                     AND h.id2        = w.id2
                     AND h.lmode      > 0
    JOIN v$session s1 ON s1.sid       = h.sid
WHERE
    w.request > 0
    AND h.lmode > 0
    AND s1.sid != s2.sid
ORDER BY
    w.ctime DESC;
```

**Script 2: Complete Blocking Chain Analysis**

```sql
-- Recursive query for complete blocking chain
WITH blocking_tree AS (
    -- Anchor: find all blocking sources (sessions not blocked by others)
    SELECT
        s.sid,
        s.serial#,
        s.username,
        s.machine,
        s.program,
        s.sql_id,
        s.status,
        s.last_call_et,
        t.used_ublk     AS undo_blocks,
        t.start_time,
        CAST(s.sid AS VARCHAR2(1000)) AS path,
        0                AS level
    FROM
        v$session       s
        JOIN v$lock l   ON l.sid = s.sid AND l.type = 'TX' AND l.lmode > 0
        LEFT JOIN v$transaction t ON s.taddr = t.addr
    WHERE
        s.sid IN (
            SELECT h.sid
            FROM v$lock h
            WHERE h.request = 0 AND h.lmode > 0
              AND h.type = 'TX'
        )
        AND s.sid NOT IN (
            SELECT w.sid
            FROM v$lock w
            WHERE w.request > 0
        )
    UNION ALL
    -- Recursion: find sessions blocked by the current level
    SELECT
        s2.sid,
        s2.serial#,
        s2.username,
        s2.machine,
        s2.program,
        s2.sql_id,
        s2.status,
        s2.last_call_et,
        NULL,
        NULL,
        bt.path || ' -> ' || s2.sid,
        bt.level + 1
    FROM
        blocking_tree bt
        JOIN v$lock w  ON w.request > 0 AND w.type = 'TX'
        JOIN v$lock h  ON h.type = w.type AND h.id1 = w.id1
                      AND h.id2 = w.id2 AND h.lmode > 0
                      AND h.sid   = bt.sid
        JOIN v$session s2 ON s2.sid = w.sid
)
SELECT
    LPAD(' ', level * 2, ' ') || sid    AS blocking_tree,
    username,
    machine,
    status,
    sql_id,
    last_call_et   AS idle_seconds,
    undo_blocks,
    path
FROM
    blocking_tree
START WITH
    level = 0
CONNECT BY
    PRIOR sid = (
        SELECT h.sid
        FROM v$lock h
        WHERE h.type = 'TX' AND h.lmode > 0
          AND h.id1 = (
              SELECT w2.id1 FROM v$lock w2
              WHERE w2.sid = PRIOR sid AND w2.request > 0
          )
          AND ROWNUM = 1
    )
ORDER SIBLINGS BY
    last_call_et DESC;
```

**Script 3: Wait Event Correlation Analysis**

```sql
-- View detailed information of blocking sessions combined with wait events
SELECT
    s.sid,
    s.serial#,
    s.username,
    s.sql_id,
    s.event,
    s.wait_class,
    s.seconds_in_wait,
    s.state,
    sw.p1              AS p1_raw,
    sw.p2              AS p2_raw,
    sw.p3              AS p3_raw,
    DECODE(sw.event,
        'enq: TX - row lock contention',
            'Row lock wait P1='  || TO_CHAR(sw.p1,'FM0XXXXXXX')
            || ' P2='      || sw.p2
            || ' P3='      || sw.p3,
        'enq: TX - allocate ITL entry',
            'ITL wait',
        'enq: TM - contention',
            'TM lock wait Obj#=' || sw.p2,
        sw.event
    ) AS lock_detail
FROM
    v$session s
    JOIN v$session_wait sw ON sw.sid = s.sid
WHERE
    s.blocking_session IS NOT NULL
    OR s.sid IN (
        SELECT sid FROM v$lock WHERE request > 0
    )
ORDER BY
    s.seconds_in_wait DESC;
```

**V$LOCK View Key Column Reference:**

| Column | Description |
|--------|-------------|
| `SID` | Session ID holding or requesting the lock |
| `TYPE` | Lock type (TX, TM, UL, etc.) |
| `ID1, ID2` | Lock resource identifiers; for TX locks, ID1=rollback segment number, ID2=transaction slot number |
| `LMODE` | Lock mode held (0=none, 2=RS, 3=RX, 4=S, 5=SRX, 6=X) |
| `REQUEST` | Lock mode requested (>0 means waiting) |
| `CTIME` | Time the lock has been held or waited on (seconds) |
| `BLOCK` | Whether this session is blocking others (1=yes) |

### 3.2 Safely Handling Blocking

After identifying the blocking source, you need to decide on a handling strategy based on the specific situation.

**Kill Session Best Practices:**

After confirming the blocking source, first contact the application side to confirm whether the transaction can be rolled back. If DBA intervention is needed, use the following commands:

```sql
-- Standard Kill Session (waits for transaction rollback to complete before releasing)
ALTER SYSTEM KILL SESSION 'sid,serial#' ;

-- Forced Kill Session (immediately disconnects, async rollback)
ALTER SYSTEM KILL SESSION 'sid,serial#' IMMEDIATE;
```

**Notes on the `IMMEDIATE` option:**

- `IMMEDIATE` does not mean skipping rollback — it only immediately disconnects the client connection; transaction rollback proceeds asynchronously in the background
- In RAC environments, you need to specify `INST_ID`: `ALTER SYSTEM KILL SESSION 'sid,serial#,@inst_id' IMMEDIATE;`
- If the killed session involves large amounts of DML, the rollback process may take a long time; during this period, related resources remain locked

**Handling ORA-00031:**

If a killed session still exists (status `KILLED`), you need to clean up at the OS level:

```sql
-- Find the SPID of killed but still existing sessions
SELECT sid, serial#, status, spid, program
FROM v$session s JOIN v$process p ON s.paddr = p.addr
WHERE status = 'KILLED';

-- Terminate the process at the OS level (Linux/Unix)
-- kill -9 <spid>
```

### 3.3 Deadlock Handling

**ORA-00060 Error Analysis:**

When Oracle detects a deadlock, it throws `ORA-00060: deadlock detected while waiting for resource` on the session chosen as the victim, and automatically rolls back that session's current statement.

**Deadlock Trace File Interpretation:**

Oracle generates a Trace file in the `USER_DUMP_DEST` (or `DIAGNOSTIC_DEST`) directory when a deadlock is detected. Below is a key excerpt from a typical deadlock Trace file:

```
Deadlock graph:
                       ---------Blocker(s)--------  ---------Waiter(s)---------
Resource Name          process session holds waits  process session holds waits
TX-000a001f-000002e8        32     143     X             35     208           X
TX-00090015-000002f0        35     208     X             32     143           X

session 143: DID 0001-0020-00000002  session 208: DID 0001-0023-00000001
session 208: DID 0001-0023-00000001  session 143: DID 0001-0020-00000002

Rows waited on:
  Session 143: obj - rowid = 00012345 - AAAPoCAAEAAABbXAAA
  Session 208: obj - rowid = 00012346 - AAAPoDAAEAAACcYBBB

----- Current SQL Statement for this session -----
UPDATE orders SET status = 'SHIPPED' WHERE order_id = 1001;
```

**Key interpretation points:**

1. **Blocker/Waiter Matrix**: Clearly shows the mutual wait relationship between two sessions. Session 143 holds an X lock on TX-...2e8 and waits for an X lock on TX-...2f0, while Session 208 is the exact opposite.
2. **Rowid**: The `Rows waited on` section identifies the specific data rows being waited on, which can be mapped to specific tables and data blocks using the `DBMS_ROWID` package.
3. **SQL Statement**: The Trace file records the SQL being executed when the deadlock occurred, which is key to analyzing the root cause.

**Real-World Deadlock Analysis Case:**

An e-commerce system frequently reported ORA-00060. Analysis of the Trace file revealed the following pattern:

- Session A executes: `UPDATE parent_table SET ... WHERE id = 1` (locks parent table row)
- Session A executes: `UPDATE child_table SET ... WHERE parent_id = 2` (attempts to lock child table row)
- Session B executes: `UPDATE parent_table SET ... WHERE id = 2` (locks parent table row)
- Session B executes: `UPDATE child_table SET ... WHERE parent_id = 1` (attempts to lock child table row)

The two sessions were cross-locking different resources, forming a classic deadlock. **Solution**: Sort `parent_id` at the application layer before executing updates, ensuring all transactions acquire locks in the same order.

**Common Deadlock Patterns and Prevention:**

1. **Cross-update deadlock**: Different transactions update the same resource set in different orders → Standardize lock acquisition order
2. **Foreign key deadlock**: Missing index on child table's foreign key column, parent table deletion conflicts with child table insertion → Create indexes on foreign key columns
3. **Bitmap index deadlock**: Bitmap index row lock granularity is at the data block level → Avoid bitmap indexes on high-concurrency tables
4. **ITL contention deadlock**: INITRANS set too low, preventing transactions from obtaining ITL slots → Adjust INITRANS

### 3.4 ITL Contention Optimization

**INITRANS Parameter Adjustment:**

When `V$LOCK` frequently shows waits with `TYPE='TX'` and `REQUEST=4`, it indicates ITL contention. Here's how to adjust:

```sql
-- View current table's INITRANS setting
SELECT table_name, ini_trans, max_trans
FROM user_tables
WHERE table_name = 'YOUR_TABLE';

-- Modify INITRANS (requires table rebuild or online redefinition)
ALTER TABLE your_table INITRANS 10;

-- For existing high-concurrency tables, apply via Online Rebuild
ALTER INDEX your_idx REBUILD ONLINE INITRANS 20;
```

**ITL Configuration Recommendations for High-Concurrency Tables:**

| Scenario | Recommended INITRANS | Notes |
|----------|---------------------|-------|
| Normal business tables | 2-5 (default 2) | Generally no adjustment needed |
| Hot tables (heavy concurrent updates) | 10-20 | Such as order tables, inventory tables |
| Frequent batch processing tables | 10-15 | Batch updates to the same data block |
| High-concurrency indexes | 10-25 | B-Tree index root and branch block hotspots |

Note that `INITRANS` only affects newly allocated data blocks. For existing data blocks, you need to reorganize them using `ALTER TABLE ... MOVE` or `ALTER INDEX ... REBUILD`.

## 4. Result Verification

After resolving blocking issues, a series of verifications are needed to ensure business operations have returned to normal.

**Blocking Resolution Confirmation:**

```sql
-- Confirm no residual blocking relationships
SELECT COUNT(*) AS blocking_count
FROM v$lock w
WHERE w.request > 0
  AND EXISTS (
      SELECT 1 FROM v$lock h
      WHERE h.type = w.type
        AND h.id1  = w.id1
        AND h.id2  = w.id2
        AND h.lmode > 0
        AND h.sid  != w.sid
  );
-- Expected to return 0

-- Confirm affected sessions have recovered
SELECT sid, serial#, status, event, seconds_in_wait
FROM v$session
WHERE event LIKE '%enq: TX%'
   OR event LIKE '%enq: TM%';
-- Expected to return no results or sessions executing normally
```

**Lock Wait Metric Monitoring:**

Establish a monitoring baseline and continuously track the following metrics:

```sql
-- Current lock wait statistics (periodic collection)
SELECT
    event,
    COUNT(*)           AS session_count,
    MAX(seconds_in_wait) AS max_wait_seconds,
    AVG(seconds_in_wait) AS avg_wait_seconds
FROM v$session
WHERE wait_class = 'Application'
  AND event LIKE '%enq:%'
GROUP BY event
ORDER BY session_count DESC;
```

**Application Layer Transaction Optimization Verification:**

- Confirm long-running transactions have been optimized and transaction hold times shortened
- Verify foreign key indexes have been added
- Check that ITL contention is eliminated after `INITRANS` adjustments
- Compare `enq: TX` wait events before and after adjustments using AWR reports

## 5. Lessons Learned

### Lock Issue Prevention Strategies

1. **Monitoring First**: Deploy real-time lock wait monitoring and alerting, intervening before blocking escalates into a cascading failure. Recommended thresholds: trigger an alert when a single blocking chain exceeds 5 waiting sessions or blocking time exceeds 60 seconds.

2. **Full Foreign Key Index Coverage**: This is an iron rule — all foreign key columns must have indexes. This can be enforced in table creation standards or by periodically running the foreign key missing index check script provided earlier.

3. **Proper INITRANS Settings**: For known hot tables and high-concurrency indexes, set higher `INITRANS` values proactively to avoid ITL contention issues after going live.

4. **Avoid Long Transactions**: The longer a transaction holds locks, the higher the probability of lock conflicts. Application design should follow the "short transaction" principle — commit or rollback as soon as possible.

### Application Layer Transaction Design Recommendations

- **Standardize Lock Acquisition Order**: When multiple transactions need to modify the same resource set, ensure locks are acquired in the same order to fundamentally prevent deadlocks.
- **Proper Isolation Level Usage**: Don't blindly use `SERIALIZABLE` — it significantly increases the probability of lock conflicts.
- **Batch Operations with Periodic Commits**: Large batch `UPDATE/DELETE` operations should be executed in batches with periodic `COMMIT` to avoid holding locks for extended periods.
- **Avoid External Calls in Transactions**: HTTP requests, file I/O, and other external operations should not be placed inside database transactions, as they can multiply transaction duration.

### Quick Diagnostic Checklist for Common Lock Issues

| Symptom | Possible Cause | Quick Diagnostic Method |
|---------|---------------|------------------------|
| Many sessions waiting on `enq: TX - row lock contention` | Long transaction blocking | Check `V$LOCK` for sessions with `BLOCK=1` |
| Many sessions waiting on `enq: TX - allocate ITL entry` | ITL contention | Check `INITRANS` on hot tables |
| Many sessions waiting on `enq: TM - contention` | TM lock escalation | Check for missing foreign key indexes |
| Frequent ORA-00060 | Application deadlocks | Analyze Deadlock Trace file |
| Session doesn't disappear after Kill Session | Rollback not complete | Kill SPID at OS level |
| Large Undo usage in `V$TRANSACTION` | Very long transactions | Check `USED_UBLK` and `START_TIME` |

Handling lock issues may seem complex, but once you master the relationships between the three core views — `V$LOCK` / `V$SESSION` / `V$TRANSACTION` — and use the diagnostic scripts provided in this article, the vast majority of lock issues can have their root cause identified and resolved within minutes. Remember, prevention is always better than cure — proper transaction design and a robust monitoring system are the fundamental safeguards against lock issues impacting business operations.
