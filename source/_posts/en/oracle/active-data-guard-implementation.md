---
title: "Active Data Guard in Practice: Physical Standby Setup, Real-time Apply, and Read-Write Splitting"
lang: en
date: 2026-02-10 10:00:00
categories: Oracle
tags: [Data Guard, ADG, 高可用, 读写分离, DG Broker, 容灾]
---

In production environments, many enterprises deploy Data Guard physical standbys for disaster recovery, but these standbys remain in mount state for extended periods, only receiving redo without providing any business services — resulting in significant waste of hardware resources. Oracle Active Data Guard (ADG) breaks this limitation by allowing physical standbys to provide read-only query services while applying redo, achieving true read-write splitting. This article, based on an Oracle 19c environment, documents the complete process from physical standby setup and DG Broker configuration to implementing ADG read-write splitting.

<!-- more -->

## I. Background

### 1.1 Resource Waste in Traditional Data Guard

Without the ADG option, a physical standby can only be in one of two states:

- **Mount State**: Receives and applies redo, but cannot provide any query services
- **Read-Only State**: Allows queries, but stops redo apply — data is no longer synchronized with the Primary

This means the standby server's CPU, memory, and storage resources sit idle most of the time, while enterprises still pay high procurement and maintenance costs for this hardware. The awkward situation DBAs face is: double the hardware budget, but only one layer of disaster recovery protection.

### 1.2 The Value of ADG

Active Data Guard resolves this contradiction. With ADG enabled, a physical standby can simultaneously:

- **Continuously apply redo**: Maintain data synchronization with the Primary
- **Provide read-only queries**: Applications can connect to ADG to execute SELECT statements
- **Support reporting and analytics**: Offload resource-intensive report queries from the Primary to ADG
- **Support backup offloading**: RMAN can back up directly from ADG without impacting Primary performance

### 1.3 Typical Production Use Cases

| Scenario | Description |
|----------|-------------|
| Read-Write Splitting | OLTP writes go to Primary, reports/queries go to ADG |
| Report Offloading | Migrate BI reports and large queries from Primary to ADG |
| Backup Offloading | RMAN incremental backups run on ADG, zero backup pressure on Primary |
| DR + Read Service | A single standby satisfies both disaster recovery and read scaling requirements |
| Data Validation | ADG can be used to verify data consistency and test recovery |

## II. Theoretical Analysis

### 2.1 Data Guard Architecture

The core of Data Guard is the redo data flow between Primary and Standby:

```
Primary Database
    │
    ├── LGWR ──→ Redo Transport ──→ Standby Redo Log
    │                                    │
    └── ARCH ──→ Archive Log ──────────→ Remote Archive
                                          │
                                    Standby Apply
                                    (Media Recovery)
```

**Physical Standby vs Logical Standby:**

- **Physical Standby**: Block-level redo apply, data files are identical to the Primary. This is the foundation of ADG and the most commonly used standby type.
- **Logical Standby**: Converts redo into SQL statements executed on the standby. The standby can be independently written to, but data consistency guarantees are more complex.

**Three Protection Modes:**

| Protection Mode | Data Loss Risk | Primary Transaction Commit | Synchronization Method |
|-----------------|---------------|---------------------------|----------------------|
| Maximum Performance | Possible minor data loss | Does not wait for redo to reach standby | ASYNC |
| Maximum Availability | Zero data loss (normal conditions) | Waits for redo to reach standby | SYNC |
| Maximum Protection | Zero data loss (enforced guarantee) | Waits for redo apply | SYNC |

Most production environments choose **Maximum Performance** mode, balancing performance and data protection. Core systems with strict zero data loss requirements choose **Maximum Availability**.

### 2.2 Core ADG Features

**Real-time Apply**

This is ADG's most critical feature. With Real-time Apply enabled, the standby applies redo directly from the Standby Redo Log (SRL) rather than waiting for archived logs to be generated first. This significantly reduces data latency:

```
-- Enable Real-time Apply
ALTER DATABASE RECOVER MANAGED STANDBY DATABASE 
  USING CURRENT LOGFILE DISCONNECT FROM SESSION;
```

**Parallel Mechanism of Redo Apply and Query**

ADG leverages a multi-process architecture to achieve parallelism between apply and query:

- **MRPn (Managed Recovery Process)**: Responsible for redo apply
- **RFS (Remote File Server)**: Receives redo data
- **Query Processes**: Independent server processes handling read-only queries

When a query needs to read a block currently being modified by apply, ADG obtains a consistent copy of that block from the Primary (via ADG block shipping), ensuring read consistency of query results.

**Block Change Tracking (BCT)**

ADG standbys support Block Change Tracking, which can dramatically accelerate incremental backups:

```sql
-- Enable BCT on ADG standby
ALTER DATABASE ENABLE BLOCK CHANGE TRACKING 
  USING FILE '/u01/app/oracle/bct/adg_bct.f';
```

With BCT enabled, RMAN incremental backups only need to scan blocks marked as "changed" rather than performing full database scans, reducing backup time by several times.

**DML Redirection (12c+)**

Starting with Oracle 12c, ADG supports automatic redirection of DML operations to the Primary for execution:

```sql
-- Enable DML Redirection
ALTER SYSTEM SET ADG_REDIRECT_DML=TRUE;
```

This allows applications to execute INSERT/UPDATE/DELETE on ADG, with Oracle automatically forwarding these operations to the Primary. This is suitable for low-volume write scenarios and is not recommended for heavy use.

### 2.3 DG Broker

**DMON Process and Broker Architecture**

Data Guard Broker (DG Broker) is Oracle's Data Guard management framework. Its core component is the DMON (Data Guard Monitor) process:

- The DMON process runs on each database instance
- Responsible for configuration management, status monitoring, and role transition coordination
- Provides a unified command-line interface (dgmgrl) and EM/Cloud Control integration

**Broker Configuration Management and Status Monitoring**

Broker stores all Data Guard configuration information in local configuration files (specified by `DG_BROKER_CONFIG_FILE1` and `DG_BROKER_CONFIG_FILE2` parameters), providing a unified view:

```
DGMGRL> SHOW CONFIGURATION;
DGMGRL> SHOW DATABASE 'PRODDB';
DGMGRL> SHOW DATABASE 'PRODDB_STBY';
```

**Fast-Start Failover (FSFO)**

FSFO is the automatic failover feature provided by Broker. Core principles:

1. The Observer process continuously monitors Primary availability
2. When the Primary becomes unreachable beyond the threshold (default 30 seconds), the Observer triggers Failover
3. The standby automatically switches to the Primary role
4. Applications reconnect to the new Primary via TAF or FAN

Key FSFO configuration includes Observer site, Failover threshold, target standby selection, etc.

### 2.4 Redo Transport Services

**LGWR SYNC vs ASYNC**

| Mode | Mechanism | Applicable Scenario |
|------|-----------|---------------------|
| LGWR SYNC | LGWR process synchronously writes to standby SRL | Maximum Availability / Protection |
| LGWR ASYNC | LGWR process asynchronously writes to standby SRL | Maximum Performance (recommended) |
| ARCH | Transmits during archival | Legacy compatibility, highest latency |

**ARCH Transport vs LGWR Transport**

- **ARCH Transport**: Transmits archive logs only during log switches, with at least one log switch cycle of delay
- **LGWR Transport**: Transmits redo data in real time, latency can be reduced to seconds

Modern environments generally use **LGWR ASYNC** mode, balancing performance and low latency.

**Gap Resolution Mechanism**

When a redo gap occurs on the standby (usually caused by network interruption), Oracle automatically detects and resolves it:

1. The standby requests missing archives through the FAL (Fetch Archive Log) Server
2. The Primary's FAL Server sends the missing archive logs
3. After the standby applies them, normal synchronization resumes

You can also manually resolve gaps:

```sql
-- Query gap on standby
SELECT * FROM V$ARCHIVE_GAP;

-- Manually register missing archive log
ALTER DATABASE REGISTER PHYSICAL LOGFILE '/path/to/missing_archive.arc';
```

## III. Hands-On Operations

The following operations are based on an Oracle 19c environment, with Primary database SID `PRODDB` and standby SID `PRODDB_STBY`.

### 3.1 Physical Standby Setup (19c)

**Step 1: Primary-Side Prerequisites**

```sql
-- Enable force logging to ensure all operations generate redo
ALTER DATABASE FORCE LOGGING;

-- Enable archive mode (if in NOARCHIVELOG)
SHUTDOWN IMMEDIATE;
STARTUP MOUNT;
ALTER DATABASE ARCHIVELOG;
ALTER DATABASE OPEN;

-- Add Standby Redo Logs (one more group than Online Redo Logs)
-- Assuming Online Redo Logs have 4 groups of 200MB each
ALTER DATABASE ADD STANDBY LOGFILE THREAD 1 GROUP 11 
  ('/u01/app/oracle/oradata/PRODDB/sredo11.log') SIZE 200M;
ALTER DATABASE ADD STANDBY LOGFILE THREAD 1 GROUP 12 
  ('/u01/app/oracle/oradata/PRODDB/sredo12.log') SIZE 200M;
ALTER DATABASE ADD STANDBY LOGFILE THREAD 1 GROUP 13 
  ('/u01/app/oracle/oradata/PRODDB/sredo13.log') SIZE 200M;
ALTER DATABASE ADD STANDBY LOGFILE THREAD 1 GROUP 14 
  ('/u01/app/oracle/oradata/PRODDB/sredo14.log') SIZE 200M;
ALTER DATABASE ADD STANDBY LOGFILE THREAD 1 GROUP 15 
  ('/u01/app/oracle/oradata/PRODDB/sredo15.log') SIZE 200M;

-- Confirm Standby Redo Log creation
SELECT GROUP#, THREAD#, SEQUENCE#, STATUS, BYTES/1024/1024 AS SIZE_MB
FROM V$STANDBY_LOG;
```

**Step 2: Primary-Side Initialization Parameter Configuration**

```sql
-- Set DB_UNIQUE_NAME
ALTER SYSTEM SET DB_UNIQUE_NAME='PRODDB' SCOPE=SPFILE;

-- Set archive destination (pointing to standby)
ALTER SYSTEM SET LOG_ARCHIVE_CONFIG='DG_CONFIG=(PRODDB,PRODDB_STBY)' SCOPE=BOTH;
ALTER SYSTEM SET LOG_ARCHIVE_DEST_2='SERVICE=PRODDB_STBY ASYNC 
  VALID_FOR=(ONLINE_LOGFILES,PRIMARY_ROLE) DB_UNIQUE_NAME=PRODDB_STBY' SCOPE=BOTH;

-- FAL configuration
ALTER SYSTEM SET FAL_SERVER='PRODDB_STBY' SCOPE=BOTH;

-- Standby File Management
ALTER SYSTEM SET STANDBY_FILE_MANAGEMENT=AUTO SCOPE=BOTH;

-- Log file name conversion (Primary -> Standby path mapping)
ALTER SYSTEM SET DB_FILE_NAME_CONVERT='/PRODDB_STBY/','/PRODDB/' SCOPE=SPFILE;
ALTER SYSTEM SET LOG_FILE_NAME_CONVERT='/PRODDB_STBY/','/PRODDB/' SCOPE=SPFILE;
```

**Step 3: TNS Configuration**

Configure in `$TNS_ADMIN/tnsnames.ora` on both Primary and Standby:

```
PRODDB =
  (DESCRIPTION =
    (ADDRESS = (PROTOCOL = TCP)(HOST = primary-svr)(PORT = 1521))
    (CONNECT_DATA =
      (SERVER = DEDICATED)
      (SERVICE_NAME = PRODDB)
    )
  )

PRODDB_STBY =
  (DESCRIPTION =
    (ADDRESS = (PROTOCOL = TCP)(HOST = standby-svr)(PORT = 1521))
    (CONNECT_DATA =
      (SERVER = DEDICATED)
      (SERVICE_NAME = PRODDB_STBY)
    )
  )
```

**Step 4: Password File and Parameter File Transfer**

```bash
# Copy password file from Primary to Standby
scp $ORACLE_HOME/dbs/orapwPRODDB standby-svr:$ORACLE_HOME/dbs/orapwPRODDB_STBY

# Create standby parameter file initPRODDB_STBY.ora
cat > /tmp/initPRODDB_STBY.ora << 'EOF'
db_name=PRODDB
db_unique_name=PRODDB_STBY
enable_pluggable_database=true
EOF

# Transfer to standby
scp /tmp/initPRODDB_STBY.ora standby-svr:$ORACLE_HOME/dbs/
```

**Step 5: Create Required Directories**

```bash
# Execute on Standby server
mkdir -p /u01/app/oracle/oradata/PRODDB_STBY
mkdir -p /u01/app/oracle/fast_recovery_area/PRODDB_STBY
mkdir -p /u01/app/oracle/admin/PRODDB_STBY/adump
```

**Step 6: Create Standby with RMAN Duplicate**

Execute on the Primary server (connected to both Primary and Standby instances):

```bash
rman target sys/password@PRODDB auxiliary sys/password@PRODDB_STBY

# Execute in RMAN
RUN {
  ALLOCATE CHANNEL ch1 DEVICE TYPE DISK;
  ALLOCATE AUXILIARY CHANNEL ach1 DEVICE TYPE DISK;
  
  DUPLICATE TARGET DATABASE
    FOR STANDBY
    FROM ACTIVE DATABASE
    DORECOVER
    SPFILE
      SET DB_UNIQUE_NAME='PRODDB_STBY'
      SET LOG_ARCHIVE_DEST_2='SERVICE=PRODDB ASYNC 
        VALID_FOR=(ONLINE_LOGFILES,PRIMARY_ROLE) DB_UNIQUE_NAME=PRODDB'
      SET FAL_SERVER='PRODDB'
    NOFILENAMECHECK;
}
```

> **Key Parameter Notes:**
> - `FROM ACTIVE DATABASE`: Directly copies from the running Primary online, no backup set needed
> - `DORECOVER`: Automatically applies archive logs for recovery after copying
> - `SPFILE`: Automatically transfers SPFILE from Primary and overrides specified parameters
> - `NOFILENAMECHECK`: Required when Primary and Standby use the same paths

**Step 7: Start Standby and Enable Real-time Apply**

```sql
-- Execute on Standby
-- Standby was already started to mount state by RMAN duplicate

-- Enable Real-time Apply
ALTER DATABASE RECOVER MANAGED STANDBY DATABASE 
  USING CURRENT LOGFILE DISCONNECT FROM SESSION;

-- Verify apply status
SELECT PROCESS, STATUS, THREAD#, SEQUENCE#, BLOCK#
FROM V$MANAGED_STANDBY
WHERE PROCESS IN ('MRP0','RFS');

-- Open to ADG mode
ALTER DATABASE OPEN;
```

At this point, the physical standby setup is complete and Real-time Apply is enabled. The standby is now in ADG state and can accept read-only queries.

### 3.2 DG Broker Configuration

**Step 1: Enable Broker**

Execute on both Primary and Standby:

```sql
-- Enable Broker
ALTER SYSTEM SET DG_BROKER_START=TRUE SCOPE=BOTH;

-- Confirm DMON process started
SELECT PROCESS, STATUS FROM V$MANAGED_STANDBY WHERE PROCESS='DMON';
```

**Step 2: Create Broker Configuration**

```bash
# Connect to dgmgrl (execute on Primary)
dgmgrl sys/password@PRODDB
```

```sql
-- Execute in dgmgrl

-- Create configuration
CREATE CONFIGURATION 'DG_CONFIG' AS
  PRIMARY DATABASE IS 'PRODDB'
  CONNECT IDENTIFIER IS 'PRODDB';

-- Add standby
ADD DATABASE 'PRODDB_STBY' AS
  CONNECT IDENTIFIER IS 'PRODDB_STBY';

-- Enable configuration
ENABLE CONFIGURATION;

-- Verify configuration status
SHOW CONFIGURATION;

-- View detailed database status
SHOW DATABASE 'PRODDB';
SHOW DATABASE 'PRODDB_STBY';
```

**Step 3: Configure Protection Mode (Optional)**

```sql
-- Set to Maximum Performance (default)
-- For Maximum Availability:
EDIT CONFIGURATION SET PROTECTION MODE AS MaxAvailability;

-- To enable Fast-Start Failover
ENABLE FAST_START FAILOVER;

-- Start Observer (execute on a separate Observer server)
dgmgrl sys/password@PRODDB "START OBSERVER;"
```

**Step 4: Verify Broker Status**

```sql
-- In dgmgrl
SHOW CONFIGURATION;
-- Expected output:
-- Configuration - DG_CONFIG
--   Protection Mode: MaxPerformance
--   Members:
--   PRODDB      - Primary database
--   PRODDB_STBY - Physical standby database
-- Fast-Start Failover: Disabled
-- Configuration Status: SUCCESS

SHOW DATABASE 'PRODDB_STBY';
-- Check ApplyLag, TransportLag, State, etc.
```

### 3.3 ADG Read-Write Splitting Configuration

**Method 1: Service-Level Read-Write Splitting**

Create a dedicated read-only Service on the ADG standby:

```sql
-- Create Service on Primary (via DBMS_SERVICE)
BEGIN
  DBMS_SERVICE.CREATE_SERVICE(
    service_name => 'PRODDB_RO',
    network_name => 'PRODDB_RO',
    failover_method => 'BASIC',
    failover_type => 'SELECT',
    failover_retries => 3,
    failover_delay => 5
  );
END;
/

-- Start Service on ADG standby
-- Edit $ORACLE_HOME/network/admin/tnsnames.ora to add read-only Service
```

TNS configuration (application side):

```
# Write service - connect to Primary
PRODDB_RW =
  (DESCRIPTION =
    (ADDRESS_LIST =
      (ADDRESS = (PROTOCOL = TCP)(HOST = primary-svr)(PORT = 1521))
    )
    (CONNECT_DATA =
      (SERVICE_NAME = PRODDB)
    )
  )

# Read service - connect to ADG standby
PRODDB_RO =
  (DESCRIPTION =
    (ADDRESS_LIST =
      (ADDRESS = (PROTOCOL = TCP)(HOST = standby-svr)(PORT = 1521))
    )
    (CONNECT_DATA =
      (SERVICE_NAME = PRODDB)
    )
  )

# Read-write splitting - automatic routing
PRODDB_RW_SPLIT =
  (DESCRIPTION =
    (ADDRESS_LIST =
      (LOAD_BALANCE = ON)
      (ADDRESS = (PROTOCOL = TCP)(HOST = primary-svr)(PORT = 1521))
      (ADDRESS = (PROTOCOL = TCP)(HOST = standby-svr)(PORT = 1521))
    )
    (CONNECT_DATA =
      (SERVICE_NAME = PRODDB)
    )
  )
```

**Method 2: JDBC Connection String Configuration**

```properties
# Write operations - connect to Primary
jdbc:oracle:thin:@//primary-svr:1521/PRODDB

# Read operations - connect to ADG
jdbc:oracle:thin:@//standby-svr:1521/PRODDB

# JDBC connection with Application Continuity
jdbc:oracle:thin:@(DESCRIPTION=
  (ADDRESS_LIST=
    (ADDRESS=(PROTOCOL=TCP)(HOST=primary-svr)(PORT=1521))
    (ADDRESS=(PROTOCOL=TCP)(HOST=standby-svr)(PORT=1521)))
  (CONNECT_DATA=(SERVICE_NAME=PRODDB)))
```

**Method 3: Oracle Connection Manager for Transparent Routing**

For scenarios requiring transparent read-write splitting, you can use Oracle Connection Manager (CMAN) with the `CLIENT_PREFERRED_SERVER` parameter to automatically route to Primary or ADG based on SQL statement type.

### 3.4 Switchover Operations

**Switchover Using Broker (Recommended)**

```bash
# Connect to dgmgrl
dgmgrl sys/password@PRODDB

# Execute switchover
SWITCHOVER TO 'PRODDB_STBY';
```

Broker automatically completes the following:
1. Validates Primary and Standby status
2. Switches Primary to Standby
3. Switches Standby to Primary
4. Updates Broker configuration
5. Restarts affected database instances

**Manual Switchover Steps**

```sql
-- Execute on Primary
-- Step 1: Verify switchover readiness
SELECT SWITCHOVER_STATUS FROM V$DATABASE;
-- Expected output: TO STANDBY or SESSIONS ACTIVE

-- Step 2: Switch Primary to Standby
ALTER DATABASE COMMIT TO SWITCHOVER TO STANDBY WITH SESSION SHUTDOWN;

-- Step 3: Execute on Standby
-- Confirm role switch
SELECT DATABASE_ROLE FROM V$DATABASE;
-- Expected output: PHYSICAL STANDBY

-- Step 4: Switch Standby to Primary
ALTER DATABASE COMMIT TO SWITCHOVER TO PRIMARY WITH SESSION SHUTDOWN;

-- Step 5: Open new Primary
ALTER DATABASE OPEN;

-- Step 6: Enable Real-time Apply on new Standby
ALTER DATABASE RECOVER MANAGED STANDBY DATABASE 
  USING CURRENT LOGFILE DISCONNECT FROM SESSION;
ALTER DATABASE OPEN;
```

**Application-Side Connection Switching**

The following strategies are recommended to ensure smooth application-side switching:

- **TAF (Transparent Application Failover)**: Configure `FAILOVER_MODE` in TNS
- **FAN (Fast Application Notification)**: Combined with ONS for rapid failure notification
- **Application Continuity (AC)**: 12c+ feature that automatically replays failed transactions
- **Connection Pool Retry**: Implement connection failure retry logic at the application layer

## IV. Result Verification

### 4.1 Database Role and Status

```sql
-- Check database role and open mode
SELECT NAME, DATABASE_ROLE, OPEN_MODE, PROTECTION_MODE
FROM V$DATABASE;

-- Expected output (ADG standby):
-- NAME       DATABASE_ROLE    OPEN_MODE           PROTECTION_MODE
-- PRODDB     PRIMARY          READ WRITE          MAXIMUM PERFORMANCE
-- PRODDB_STBY PHYSICAL STANDBY READ ONLY WITH APPLY MAXIMUM PERFORMANCE
```

### 4.2 Apply Lag and Transport Lag

```sql
-- View apply lag and transport lag
SELECT NAME, VALUE, DATUM_TIME
FROM V$DATAGUARD_STATS
WHERE NAME IN ('apply lag', 'transport lag');

-- More detailed dest status
SELECT DEST_ID, STATUS, TYPE, DATABASE_MODE, 
       RECOVERY_MODE, APPLIED_SCN, APPLY_LAG, TRANSPORT_LAG
FROM V$ARCHIVE_DEST_STATUS
WHERE DATABASE_MODE != 'NONE';
```

### 4.3 DG Broker Verification

```sql
-- In dgmgrl
SHOW CONFIGURATION;
SHOW DATABASE 'PRODDB_STBY';

-- Check InconsistentProperties of each member
SHOW DATABASE 'PRODDB_STBY' 'InconsistentProperties';
```

### 4.4 Real-time Apply Verification

The most intuitive verification — create a table on Primary, immediately queryable on ADG:

```sql
-- Execute on Primary
CREATE TABLE adg_test (id NUMBER, create_time TIMESTAMP DEFAULT SYSTIMESTAMP);
INSERT INTO adg_test VALUES (1, SYSTIMESTAMP);
COMMIT;

-- Query immediately on ADG standby (latency typically within 1-3 seconds)
SELECT * FROM adg_test;
-- Expected output:
-- ID  CREATE_TIME
-- 1   06-JUN-26 10.00.01.123456 AM

-- Clean up test table
-- On Primary
DROP TABLE adg_test PURGE;
```

## V. Lessons Learned

### 5.1 ADG Performance Impact and Tuning

ADG's performance impact on the Primary mainly manifests in the redo transport phase. Tuning recommendations:

- **Use LGWR ASYNC mode**: Avoid SYNC mode blocking Primary transaction commits
- **Set `NET_TIMEOUT` appropriately in `LOG_ARCHIVE_DEST_2`**: Recommended 10-30 seconds
- **Match standby SRL size to Primary OLRL**: Avoid extra overhead from log switches
- **Standby apply parallelism**: Control MRPn process count via `PARALLEL` parameter

```sql
-- Set apply parallelism (adjust based on CPU core count)
ALTER DATABASE RECOVER MANAGED STANDBY DATABASE 
  PARALLEL 8 USING CURRENT LOGFILE DISCONNECT FROM SESSION;
```

### 5.2 Network Bandwidth Requirements for Standby

Network is a critical infrastructure for Data Guard. Calculation formula:

```
Required bandwidth ≈ (Primary redo generation per second × 8) / bandwidth utilization
```

For example, if Primary generates 10MB redo per second with 70% target bandwidth utilization:

```
(10 × 8) / 0.7 ≈ 114 Mbps
```

It is recommended to use a dedicated network link with QoS configured to guarantee bandwidth priority for redo transport. For cross-datacenter deployments, network latency should be within 10ms (especially important in SYNC mode).

### 5.3 Common Failures and Handling

**Archive Gap**

```sql
-- Query gap
SELECT * FROM V$ARCHIVE_GAP;

-- Manually transfer and register missing archives
ALTER DATABASE REGISTER PHYSICAL LOGFILE '/path/to/archive.arc';

-- Or use RMAN to resolve gap
RMAN> RECOVER STANDBY DATABASE;
```

**Excessive Apply Lag**

- Check standby I/O performance (whether I/O bottleneck exists)
- Check network transport delay (STATUS and ERROR in V$ARCHIVE_DEST)
- Increase apply parallelism
- Check whether large DDL operations are causing slow apply

**ADG Queries Blocking Apply**

In extreme cases, heavy concurrent queries may impact apply performance. This can be mitigated as follows:

```sql
-- Set apply lag timeout (automatically interrupt queries exceeding threshold)
ALTER SYSTEM SET ADG_MAX_IO_RESPONSE_TIME=1000; -- milliseconds
```

### 5.4 ADG Licensing Requirements

**Important Note**: Active Data Guard is a paid option for Oracle and requires a separate license. When executing `ALTER DATABASE OPEN` (READ ONLY WITH APPLY) on the standby, Oracle records ADG usage. Using this feature without purchasing an ADG license carries compliance risks.

Alternatives (without ADG option):

- Switch the standby to `READ ONLY` state for queries (will stop redo apply)
- Use Snapshot Standby to create a temporary read-write snapshot (will also pause apply)
- Use Oracle GoldenGate for more flexible read-write splitting

---

This is the complete setup and configuration process for Active Data Guard in an Oracle 19c environment. From RMAN duplicate creation of the physical standby, to unified management via DG Broker, to Service-level read-write splitting configuration, ADG provides a mature solution to help enterprises transform standbys from "cost centers" to "value centers." In actual deployment, it is recommended to select appropriate protection modes and transport methods based on business characteristics, and establish comprehensive monitoring and alerting mechanisms (including apply lag, transport lag, gap detection, etc.) to ensure ADG remains in a healthy operational state.
