---
title: Data Guard Switchover/Failover SOP and Split Brain Prevention Mechanisms
date: 2026-02-15 10:00:00
categories: Oracle
tags: [Data Guard, Switchover, Failover, 脑裂, 容灾演练, SOP]
lang: en
---

## 1. Background

### Why Standardized Role Transition SOPs Are Needed

In production environments, Oracle Data Guard role transitions (Switchover/Failover) are high-risk operations. Without a standardized operations manual, DBAs are prone to making irreversible errors when facing emergency failures — skipping check steps, missing data consistency verifications, executing commands at wrong timing — and any small mistake can lead to hours or even days of business interruption.

Standardized SOPs (Standard Operating Procedures) can ensure:

- **Repeatable Operations**: Any qualified DBA can complete the transition following the manual
- **Controllable Risks**: Every operation step has clear preconditions and verification standards
- **Executable Rollback**: When anomalies occur, a quick recovery to a safe state is possible
- **Auditable Trail**: Every operation is recorded, meeting compliance requirements

### Production Incident Case of Failed Transition

Here is a reconstruction of a real scenario:

A financial customer executed Switchover during data center migration. Due to not checking in advance whether the Standby's archive logs were continuously applied, after the transition they discovered the new Primary was missing 30 minutes of transaction data. Worse still, the operations team attempted to switch back after discovering the problem, but due to the confused role states of the old and new Primary databases, both became unavailable — this is a classic **Split Brain** scenario.

Final cost: 4 hours of business interruption, approximately 15 minutes of data loss, and a week-long post-incident review.

### The Fatal Impact of Split Brain on Data Consistency

Split brain is the most dangerous state in the Data Guard architecture — Primary and Standby both run in Primary role simultaneously, each accepting writes, causing data divergence between the two databases. Once split brain occurs:

- Data between the two databases begins to diverge and cannot be simply merged
- Applications may connect to the wrong database and write inconsistent data
- The repair process requires downtime comparison, causing enormous business impact
- In severe cases, recovery from backups may be required, causing RPO to skyrocket

Therefore, understanding the mechanisms that cause split brain and establishing a comprehensive prevention system is a mandatory course for every DBA.

---

## 2. Theoretical Analysis

### 2.1 Switchover vs Failover

**Switchover (Planned Transition)**

Switchover is an orderly role transition process. Primary becomes Standby, Standby becomes Primary, with **zero data loss** throughout the process.

```
Before:  Primary (PROD) ---> Standby (DR)
After:   Standby (PROD) <--- Primary (DR)
```

**Applicable Scenarios**:
- Planned maintenance (hardware upgrades, OS patches, storage migration)
- Regular disaster recovery drills
- Data center migration
- Load balancing requirements (read-write separation architecture adjustment)

**Failover (Emergency Transition)**

Failover is an emergency operation when Primary is unavailable. Standby is activated as the new Primary, and the original Primary is abandoned or demoted.

```
Before:  Primary (PROD) [failure]   Standby (DR)
After:   Abandoned/Recovery  <---   Primary (DR)
```

**Applicable Scenarios**:
- Fire, earthquake, or other disasters at the data center hosting Primary
- Storage array failure that cannot be recovered in a short time
- Severe database corruption that cannot be repaired
- Complete network outage, Primary unreachable

**Key Differences**:

| Characteristic | Switchover | Failover |
|------|-----------|----------|
| Trigger Condition | Planned | Emergency/Unplanned |
| Data Loss | None | Possible (depends on protection mode) |
| Reversibility | Fully reversible | Requires rebuilding old Primary |
| Archive Log Gap | None | May exist |
| Operation Complexity | Low | High |

### 2.2 Root Causes of Split Brain

The essence of split brain is a consistency problem in distributed systems — two nodes simultaneously believe they are Primary and accept writes.

**Scenario 1: Network Partition**

```
Normal State:
Client --> Primary <==== Heartbeat/Redo Transport ====> Standby

Network Partition:
Client --> Primary <----X----> Standby
                         ↑
                    Network Outage

Problem: How does the Standby determine if the Primary is truly down, or just unreachable?
```

When the network between Primary and Standby is interrupted, the Standby may not be able to determine the Primary's state. If the Standby is hastily promoted to Primary while the original Primary is actually still running and accepting writes, split brain occurs.

**Scenario 2: Timing Issues During Role Transition**

During Switchover, if the operation is only half completed (old Primary has already shutdown, new Primary has already opened), but a network failure causes the old Primary to restart and resume running in Primary role, split brain will also occur.

**Scenario 3: Fast-Start Failover Arbitration Failure**

FSFO relies on the Observer for failure arbitration. If the Observer's network partition prevents it from simultaneously accessing both databases, the Observer may make incorrect transition decisions.

### 2.3 Split Brain Prevention Mechanisms

#### FSFO's Observer Process

Observer is the core arbitration component of Fast-Start Failover. It is an independent process running on a third-party node (neither Primary nor Standby), continuously monitoring the state of both databases.

```
Primary <--- Observer ---> Standby
              |
              v
         Third-party Host
```

Observer's arbitration logic:
- Periodically sends heartbeats to Primary (default once per second)
- If Primary is unreachable beyond `FastStartFailoverLagLimit`, Observer triggers Failover
- Observer simultaneously connects to both databases, avoiding single-point misjudgment

#### Impact of Three Protection Modes on Split Brain

| Protection Mode | Data Protection | Performance Impact | Split Brain Risk |
|---------|---------|---------|---------|
| Maximum Protection | Zero loss | Highest | Lowest |
| Maximum Availability | Best-effort zero loss | Medium | Medium |
| Maximum Performance | Possible data loss | Lowest | Highest |

Under **Maximum Protection** mode, if the Standby becomes unavailable, the Primary automatically shuts down (SHUTDOWN ABORT), fundamentally eliminating the possibility of both databases running simultaneously. The cost is potential business interruption.

Under **Maximum Performance** mode, Primary does not wait for Standby acknowledgment. Even if the Standby is offline, Primary can operate normally. This is optimal for performance but has the highest split brain risk.

Recommended approach: Use **Maximum Availability** mode in production environments, achieving a balance between availability and safety.

#### Network Redundancy and Heartbeat Detection

```
Recommended Network Architecture:

Standby Host
    |-- NIC1 --> Network A (Business Network) --> Primary Host
    |-- NIC2 --> Network B (Dedicated Heartbeat) --> Primary Host
    |-- NIC3 --> Network C (Management Network) --> Primary Host
```

Key measures:
- Use a dedicated network for Redo log transmission
- Configure multiple network paths to avoid single points of failure
- Use Oracle Net's multiple address configuration (`FAILOVER=ON`)
- Configure OS-level heartbeat detection (e.g., Oracle Clusterware, Pacemaker)

---

## 3. Practical Operations

### 3.1 Switchover SOP (Standard Operating Manual)

#### Pre-Switch Checklist

**Must be confirmed item by item before the switch. If any item is not met, stop the operation:**

```
=== Switchover Pre-Switch Checklist ===

□ 1. Confirm current roles
   SELECT database_role, open_mode, switchover_status FROM v$database;
   -- Primary: switchover_status must be TO STANDBY or SESSIONS ACTIVE
   -- Standby: must be NOT ALLOWED or SESSIONS ACTIVE

□ 2. Check if archive logs are continuously applied
   -- Execute on Standby:
   SELECT thread#, max(sequence#) FROM v$archived_log WHERE applied='YES' GROUP BY thread#;
   -- Execute on Primary:
   SELECT thread#, max(sequence#) FROM v$archived_log GROUP BY thread#;
   -- sequence# must match on both sides

□ 3. Check for GAPS
   SELECT * FROM v$archive_gap;
   -- Result must be empty

□ 4. Check if Standby Redo Apply is running
   SELECT process, status FROM v$managed_standby WHERE process LIKE 'MRP%';
   -- MRP0 must exist with status APPLYING_LOG

□ 5. Check temp file consistency
   -- Ensure Standby temp tablespace files exist and are accessible

□ 6. Check all instances (RAC environment)
   -- All instances must be online, or only one instance online
   -- Confirm no active long-running transactions
   SELECT * FROM v$transaction WHERE status != 'INACTIVE';

□ 7. Stop application connections
   -- Notify application team to stop writes
   -- Or execute on Primary:
   ALTER SYSTEM QUIESCE RESTRICTED;  -- Optional, use with caution

□ 8. Create restore guarantee point (optional but recommended)
   -- On Primary:
   CREATE RESTORE POINT switchover_guarantee GUARANTEE FLASHBACK DATABASE;

□ 9. Confirm network connectivity
   -- Primary to Standby TNS connection is normal
   -- Standby to Primary TNS connection is normal
```

#### Broker Switchover Command

Using Data Guard Broker is the most recommended approach, as it automatically handles most steps:

```sql
-- Connect to DGMGRL
$ dgmgrl sys/password@primary_db

-- View current configuration status
DGMGRL> SHOW CONFIGURATION;
DGMGRL> SHOW DATABASE VERBOSE 'primary_db';
DGMGRL> SHOW DATABASE VERBOSE 'standby_db';

-- Execute Switchover (Broker automatically handles all steps)
DGMGRL> SWITCHOVER TO 'standby_db';

-- Verify switch result
DGMGRL> SHOW CONFIGURATION;
```

Internal steps of Broker Switchover:
1. Convert Primary database to Standby role
2. Convert Standby database to Primary role
3. Automatically restart both databases
4. Re-enable Redo transport and apply

#### Detailed Manual Switchover Steps

When Broker is unavailable, manual execution is needed:

**Step 1: Prepare for switch on Primary**

```sql
-- Check switch status
SQL> SELECT switchover_status FROM v$database;

-- If status is TO STANDBY, execute directly:
SQL> ALTER DATABASE COMMIT TO SWITCHOVER TO STANDBY WITH SESSION SHUTDOWN;

-- If status is SESSIONS ACTIVE, need to kill sessions first or use:
SQL> ALTER DATABASE COMMIT TO SWITCHOVER TO STANDBY WITH SESSION SHUTDOWN;
```

**Step 2: Prepare for switch on Standby**

```sql
-- Cancel Redo Apply on Standby
SQL> ALTER DATABASE RECOVER MANAGED STANDBY DATABASE CANCEL;

-- Check status
SQL> SELECT switchover_status FROM v$database;

-- Convert Standby to Primary
SQL> ALTER DATABASE COMMIT TO SWITCHOVER TO PRIMARY;

-- If Physical Standby was previously opened read-only:
SQL> ALTER DATABASE COMMIT TO SWITCHOVER TO PRIMARY WITH SESSION SHUTDOWN;
```

**Step 3: Open new Primary**

```sql
-- On the new Primary (original Standby):
SQL> ALTER DATABASE OPEN;
```

**Step 4: Start Redo Apply on new Standby**

```sql
-- On the new Standby (original Primary):
SQL> STARTUP MOUNT;
SQL> ALTER DATABASE RECOVER MANAGED STANDBY DATABASE DISCONNECT FROM SESSION;
```

#### Post-Switch Verification Steps

```sql
=== Post-Switch Verification Checklist ===

□ 1. Confirm roles
   SELECT database_role, open_mode FROM v$database;
   -- New Primary: PRIMARY / READ WRITE
   -- New Standby: PHYSICAL STANDBY / MOUNTED or READ ONLY WITH APPLY

□ 2. Confirm Redo transport is normal
   -- On new Primary:
   SELECT dest_id, status, error FROM v$archive_dest WHERE dest_id=2;
   -- status must be VALID

□ 3. Confirm archive log sequence numbers are continuous
   -- Latest archive sequence number on new Primary
   -- Latest applied sequence number on new Standby

□ 4. Verify data consistency
   -- Spot check data counts of critical tables
   SELECT COUNT(*) FROM critical_table;

□ 5. Verify application connections
   -- Application team confirms connections are normal
   -- Execute simple read-write tests
```

#### Switchback Steps

If switching back to the original Primary is needed, simply execute Switchover again:

```sql
-- On the new Primary (original Standby):
DGMGRL> SWITCHOVER TO 'original_primary_db';
```

### 3.2 Failover SOP

#### Determining Whether Failover Is Needed

Failover is a last resort. Before execution, the following conditions must be confirmed:

```
=== Failover Decision Tree ===

1. Is the Primary database truly unavailable?
   ├── Only network unreachable? → Don't Failover, check network
   ├── Only database instance crashed? → Try STARTUP
   ├── Storage failure? → Assess recovery time
   └── Data center-level disaster? → Confirm Failover

2. Is the estimated recovery time (RTO) beyond tolerance?
   ├── < RTO → Wait for recovery
   └── > RTO → Execute Failover

3. Is there data loss?
   └── Maximum Protection mode → Zero loss, safe to Failover
   └── Maximum Performance mode → Assess loss amount
```

#### Manual Failover Steps

```sql
-- Step 1: Check archive log apply status on Standby
SQL> SELECT thread#, max(sequence#) FROM v$archived_log WHERE applied='YES' GROUP BY thread#;

-- Step 2: Try to apply all available archive logs
SQL> ALTER DATABASE RECOVER MANAGED STANDBY DATABASE CANCEL;
SQL> ALTER DATABASE RECOVER MANAGED STANDBY DATABASE FINISH;

-- Step 3: If there is data loss risk (returns ORA-19909), confirm to continue
SQL> ALTER DATABASE RECOVER MANAGED STANDBY DATABASE FINISH FORCE;

-- Step 4: Convert Standby to Primary
SQL> ALTER DATABASE COMMIT TO SWITCHOVER TO PRIMARY;
-- Or (if switchover_status does not allow):
SQL> ALTER DATABASE ACTIVATE STANDBY DATABASE;

-- Step 5: Open database
SQL> ALTER DATABASE OPEN;

-- Note: ACTIVATE STANDBY DATABASE is an irreversible operation!
```

#### Broker Failover Operation

```sql
$ dgmgrl sys/password@standby_db

-- Execute Failover
DGMGRL> FAILOVER TO 'standby_db';

-- Verify
DGMGRL> SHOW CONFIGURATION;
```

#### Rebuilding Old Primary After Failover

After Failover, the old Primary cannot be directly used as a Standby and needs to be rebuilt:

**Method 1: Using Flashback Database**

```sql
-- On the old Primary (if it can start):
SQL> STARTUP MOUNT;

-- Record the SCN at Failover time
-- On the new Primary:
SQL> SELECT standby_became_primary_scn FROM v$database;

-- On the old Primary:
SQL> FLASHBACK DATABASE TO SCN <standby_became_primary_scn>;

-- Convert to Standby
SQL> ALTER DATABASE CONVERT TO PHYSICAL STANDBY;
SQL> SHUTDOWN IMMEDIATE;
SQL> STARTUP MOUNT;
SQL> ALTER DATABASE RECOVER MANAGED STANDBY DATABASE DISCONNECT FROM SESSION;
```

**Method 2: RMAN Rebuild**

```bash
# On the old Primary host
$ rman target /

RMAN> STARTUP MOUNT;
RMAN> RESTORE DATABASE;
RMAN> RECOVER DATABASE;

# Or use DUPLICATE
RMAN> DUPLICATE TARGET DATABASE FOR STANDBY FROM ACTIVE DATABASE;
```

### 3.3 FSFO Configuration and Drills

#### Observer Process Configuration

```sql
-- Step 1: Install Oracle Client on Observer host

-- Step 2: Configure tnsnames.ora, ensure Observer can connect to both databases

-- Step 3: Set FSFO parameters in Broker
DGMGRL> EDIT DATABASE 'primary_db' SET PROPERTY FastStartFailoverTarget = 'standby_db';
DGMGRL> EDIT DATABASE 'standby_db' SET PROPERTY FastStartFailoverTarget = 'primary_db';
DGMGRL> EDIT CONFIGURATION SET PROPERTY FastStartFailoverLagLimit = 30;
DGMGRL> EDIT CONFIGURATION SET PROPERTY FastStartFailoverThreshold = 30;
DGMGRL> EDIT CONFIGURATION SET PROPERTY ObserverConnectIdentifier = 'observer_host';

-- Step 4: Start Observer
$ dgmgrl sys/password@primary_db
DGMGRL> START OBSERVER;
-- Observer will run continuously in the foreground

-- In production, recommend using nohup or systemd to manage the Observer process
```

#### FSFO Enablement and Testing

```sql
-- Confirm protection mode (FSFO requires at least Maximum Availability)
DGMGRL> EDIT CONFIGURATION SET PROTECTION MODE AS MaxAvailability;

-- Enable FSFO
DGMGRL> ENABLE FAST_START FAILOVER;

-- Verify FSFO status
DGMGRL> SHOW FAST_START FAILOVER;
```

#### Simulating Automatic Failover on Failure

```sql
-- Simulate failure on Primary
SQL> SHUTDOWN ABORT;

-- Observe Observer log, wait for automatic Failover
-- Observer will automatically execute Failover after FastStartFailoverThreshold seconds

-- Verify automatic switch result
DGMGRL> SHOW CONFIGURATION;
DGMGRL> SHOW DATABASE 'new_primary_db';
```

### 3.4 Split Brain Handling

#### Methods to Detect Split Brain

```sql
-- Method 1: Check roles of both databases
-- If both databases return PRIMARY, split brain has occurred
SELECT database_role FROM v$database;

-- Method 2: Check Broker status
DGMGRL> SHOW CONFIGURATION;
-- If ORA-16600 or ORA-16724 errors appear, it may be split brain

-- Method 3: Check Redo transport errors
SELECT dest_id, status, error FROM v$archive_dest WHERE target='STANDBY';
-- If ORA-16009 (invalid redo transport destination) appears, it may be split brain
```

#### Data Consistency Check After Split Brain

```sql
-- Execute the following queries on both databases and compare results:

-- 1. Latest SCN
SELECT current_scn FROM v$database;

-- 2. Latest archive log sequence number
SELECT max(sequence#) FROM v$archived_log;

-- 3. Record count of critical business tables
SELECT COUNT(*) FROM critical_table;

-- 4. Latest transaction time
SELECT max(create_time) FROM transaction_table;
```

#### Split Brain Repair Steps

```
=== Split Brain Repair SOP ===

Step 1: Determine which database is "correct"
- Based on SCN size, archive log completeness, business data integrity
- Usually choose the one with the larger SCN as the correct database

Step 2: Immediately stop the "incorrect" database
SQL> SHUTDOWN ABORT;

Step 3: Confirm role on the "correct" database
SQL> ALTER DATABASE OPEN RESETLOGS;  -- if needed

Step 4: Rebuild the "incorrect" database as Standby
- Use RMAN DUPLICATE or Flashback Database

Step 5: Verify data consistency
- Compare critical table data
- Confirm no data loss

Step 6: Post-incident analysis
- Find the root cause of split brain
- Strengthen preventive measures
- Update SOP documentation
```

---

## 4. Result Verification

### Post-Switch Role Confirmation

```sql
-- Mandatory verification queries
SELECT database_role, open_mode, protection_mode, switchover_status
FROM v$database;

-- Expected results:
-- Primary:     PRIMARY / READ WRITE / <protection_mode> / TO STANDBY
-- Standby:     PHYSICAL STANDBY / READ ONLY WITH APPLY / <protection_mode> / NOT ALLOWED
```

### Data Consistency Verification

```sql
-- Method 1: SCN comparison
-- Execute on both Primary and Standby
SELECT current_scn FROM v$database;
-- Standby's SCN should be close to Primary's SCN

-- Method 2: Archive log sequence number comparison
-- Primary: Latest generated archive log
SELECT max(sequence#) FROM v$archived_log;
-- Standby: Latest applied archive log
SELECT max(sequence#) FROM v$archived_log WHERE applied='YES';
-- The two numbers should match

-- Method 3: Business data spot check
-- Select core business tables, compare record counts and latest records
SELECT COUNT(*), MAX(update_time) FROM order_table;
```

### Application Connection Verification

```bash
# 1. TNS connection test
$ tnsping new_primary_tnsname

# 2. SQL*Plus connection test
$ sqlplus app_user/password@new_primary_tnsname

# 3. JDBC connection test (application level)
# Confirm application can connect normally to new Primary

# 4. Read-write test
# Execute INSERT + SELECT to verify read-write works
```

---

## 5. Experience Summary

### Disaster Recovery Drill Frequency and Methods

- **Monthly**: Execute complete Switchover drill in test environment
- **Quarterly**: Execute Switchover (including switchback) during production maintenance window
- **Semi-annually**: Simulate Failover scenarios (in isolated environment)
- **Annually**: Full-chain disaster recovery drill (including application layer verification)

### Common Issues During Transitions

| Issue | Cause | Solution |
|------|------|---------|
| ORA-16009: invalid redo transport destination | Standby TNS configuration error | Check tnsnames.ora and listener.ora |
| ORA-16416: switchover target has lagged behind | Standby archive log apply delay | Wait for apply to complete or check MRP process |
| ORA-16410: switchover target is not a standby | Abnormal role state | Check Broker configuration and database role |
| MRP0 process won't start | Archive log lost or corrupted | Use RMAN to recover missing archive logs |
| Cannot switchback after Failover | Failover is irreversible | Need to rebuild old Primary |

### Importance of Documentation

1. **Every switch must be recorded**: Execution time, operator, execution steps, verification results, anomalies
2. **SOP documents must be versioned**: Update SOP after each drill based on actual experience
3. **Build a knowledge base**: Consolidate typical cases and solutions into team knowledge
4. **Regular review**: Review SOP document timeliness and accuracy quarterly

An excellent DBA can not only execute Switchover/Failover but can ensure the process is standardized, automated, and auditable. Put SOPs into practice so that every switch is like a well-trained fire drill — fast, precise, and steady.
