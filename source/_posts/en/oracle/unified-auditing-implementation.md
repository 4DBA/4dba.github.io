---
title: "Unified Auditing Implementation: Policy Customization and Audit Log Management"
date: 2026-05-02 10:00:00
categories: Oracle
tags: [审计, Unified Auditing, 安全, 合规, FGA]
lang: en
---

## 1. Background

In enterprise database management, auditing is a core component of security compliance. Whether it's MLPS evaluation, GDPR, or internal security audits, database auditing plays an irreplaceable role. However, before Oracle 12c, the implementation of Traditional Auditing had always been a headache for DBAs.

**The limitations of traditional auditing are mainly reflected in the following aspects:**

- **Significant Performance Impact**: Traditional auditing relies on a large number of independent audit tables (such as `AUD$`, `FGA_LOG$`). Each audit event trigger requires disk I/O writes, which has a significant impact on OLTP performance in high-concurrency scenarios. Based on practical experience, enabling full auditing without optimization can cause 5%-15% performance degradation. Especially on production systems with high-frequency DML operations, the additional I/O overhead from auditing often becomes a performance bottleneck.
- **High Management Complexity**: Privilege auditing, action auditing, and object auditing each use different syntax and configuration methods (`AUDIT` statement, `AUDIT_TRAIL` parameter, `DBMS_FGA` package), lacking a unified management entry point with scattered policies that are difficult to maintain. When adding auditing for certain operations, DBAs may need to modify multiple configuration points simultaneously.
- **Fragmented Audit Data**: Standard auditing writes to `SYS.AUD$`, FGA auditing writes to `SYS.FGA_LOG$`, OS auditing writes to operating system files. Audit data is scattered across multiple locations, making querying and archiving extremely inconvenient. To obtain a complete audit report, data must be consolidated from multiple sources, which is particularly passive during security incident investigations.
- **Insufficient Flexibility**: Traditional auditing has difficulty fine-filtering by conditions such as time, IP address, application module, etc. It can often only enable or disable specific audit items without conditional auditing.

**Oracle Unified Auditing (introduced in 12c)** completely restructured the auditing architecture, providing a unified policy management framework that solved many of traditional auditing's pain points. Its core advantages include:

1. **Unified Policy Model**: All audit types (privilege, action, object, FGA) are managed through unified audit policies. A single policy can cover multiple audit needs, greatly simplifying management complexity.
2. **Built-in Performance Optimization**: Audit records are first written to an in-memory buffer (Unified Audit Queue in SGA), then batch-persisted to tables under the `AUDSYS` schema, significantly reducing disk I/O overhead. Compared to traditional auditing, performance impact is substantially reduced.
3. **Flexible Condition Filtering**: Supports fine-grained filtering of audit scope by user, role, time, OS user, IP address, application module, and other conditions, truly achieving "audit what should be audited, skip what shouldn't."
4. **Integrated Log Management**: Query all audit data through the unified `DBA_UNIFIED_AUDIT_TRAIL` view, with standardized cleanup and archiving mechanisms (`DBMS_AUDIT_MGMT` package).

For production environments with compliance audit requirements, migrating to Unified Auditing is an inevitable choice. This article starts from architecture principles and combines practical project experience to detail Unified Auditing's policy customization, FGA configuration, and audit log management best practices.

---

## 2. Theoretical Analysis

### 2.1 Unified Auditing Architecture

Unified Auditing's architecture design revolves around three core components. Understanding how these components work is the prerequisite for correctly implementing audit policies.

**Unified Audit Policy**

All audit rules are defined through `CREATE AUDIT POLICY` statements. A single policy can simultaneously contain privilege audit, action audit, and object audit conditions. After creation, the policy is in DISABLED state and needs to be explicitly enabled through the `AUDIT POLICY` statement. This "define first, enable later" design allows policies to be prepared in advance and deployed uniformly during change windows.

**AUDIT_TRAIL Parameter and Audit Modes**

Oracle provides two audit modes: Mixed Mode and Pure Unified Auditing Mode.

- **Mixed Mode (default)**: Traditional auditing and Unified Auditing coexist. In Mixed Mode, Oracle automatically enables some default unified audit policies (such as `ORA_LOGON_FAILURES`, `ORA_SECURECONFIG`, etc.), while traditional auditing's `AUDIT_TRAIL` parameter remains active. This is the default state for most environments.
- **Pure Unified Auditing Mode**: Completely disables traditional auditing; all audit behavior is uniformly managed by Unified Auditing. Requires relinking Oracle binary files to switch.

In Mixed Mode, you can check the traditional auditing configuration status via the `AUDIT_TRAIL` parameter:

```sql
SHOW PARAMETER audit_trail;
-- DB       : Audit records written to SYS.AUD$ table
-- DB,EXTENDED: Written to table including SQL bind variables
-- OS       : Audit records written to OS files
-- NONE     : Traditional auditing disabled
```

**Audit Record Storage**

Unified Auditing audit records are stored in the `AUDSYS` schema under the `SYSAUX` tablespace, using internal table structures and automatic partitioning design. The data write process is as follows:

1. Audit events are first written to the Unified Audit Queue in SGA (memory queue)
2. Background process (Unified Auditing Background Writer) periodically flushes queue data to disk in batches
3. Default flush triggered every 3 seconds or when queue reaches 1MB
4. Data is persisted to partitioned tables under the `AUDSYS` schema

This asynchronous write mechanism is the key to Unified Auditing's performance advantage over traditional auditing.

```sql
-- View audit queue configuration
SELECT * FROM V$UNIFIED_AUDIT_QUEUE_WRITERS;

-- View audit space usage in SYSAUX
SELECT occupant_name, space_usage_kbytes,
       ROUND(space_usage_kbytes/1024, 2) AS usage_mb
FROM V$SYSAUX_OCCUPANTS
WHERE occupant_name LIKE '%AUDIT%';
```

### 2.2 Audit Policy Types

Unified Auditing supports the following four audit policy types, which can be mixed in a single policy — this is the core of its flexibility:

| Type | Description | Applicable Scenario |
|------|------|----------|
| Privilege Audit | Audits usage of system privileges, regardless of whether the user actually has them | Monitor privileged operations like `DROP ANY TABLE` |
| Action Audit | Audits DDL/DML operations, audit by operation type | Monitor specific table CRUD operations |
| Object Audit | Audits operations on specific objects | Precise control at table/view level auditing |
| FGA (Fine-Grained Auditing) | Condition-based fine auditing, supports WHERE condition filtering | Audit by business logic conditions, such as salary exceeding a threshold |

In actual projects, the most commonly used is the combination of action audit and FGA: action audit records all changes to core tables, while FGA triggers more detailed audit records under specific business conditions.

### 2.3 Audit Log Management

**Querying Audit Logs**

Uniformly queried through the `DBA_UNIFIED_AUDIT_TRAIL` view, which integrates all types of audit records:

```sql
SELECT event_timestamp, dbusername, action_name,
       object_schema, object_name, sql_text
FROM DBA_UNIFIED_AUDIT_TRAIL
ORDER BY event_timestamp DESC
FETCH FIRST 100 ROWS ONLY;
```

**Audit Log Cleanup Strategy**

Audit logs cannot grow indefinitely, otherwise they will quickly fill up the `SYSAUX` tablespace and affect normal database operations. It is recommended to manage according to the following strategy:

- **Retention Period**: Set according to compliance requirements (typically 90 days to 1 year); MLPS Level 3 typically requires at least 6 months
- **Cleanup Method**: Use the `DBMS_AUDIT_MGMT` package for standardized cleanup — this is Oracle's officially recommended approach
- **Archiving Method**: Export to independent tablespace or external storage before cleanup to ensure historical data traceability

**Audit Log Export**

Audit data can be exported via Data Pump or CTAS. It is recommended to use CTAS to export to an independent tablespace for easier subsequent querying and archive management:

```sql
-- Export to independent table (recommend using independent tablespace)
CREATE TABLE aud_archive.unified_audit_202606
TABLESPACE aud_archive_ts
AS SELECT * FROM UNIFIED_AUDIT_TRAIL
WHERE event_timestamp < SYSTIMESTAMP - INTERVAL '90' DAY;
```

---

## 3. Practical Operations

### 3.1 Enabling Unified Auditing

#### Checking Current Audit Mode

```sql
-- Check if Unified Auditing has been compiled and enabled
SELECT VALUE FROM V$OPTION WHERE PARAMETER = 'Unified Auditing';
-- TRUE means compiled and enabled (default TRUE for 12c and above)

-- Check current audit mode
SELECT PARAMETER, VALUE FROM V$OPTION
WHERE PARAMETER = 'Unified Auditing';
```

#### Migrating to Pure Unified Auditing Mode

Oracle 12c defaults to Mixed Mode. If you need to fully migrate to Pure Unified Auditing Mode (disabling traditional auditing), you need to shut down the database and execute the following steps:

```bash
# 1. Shut down database
sqlplus / as sysdba
SHUTDOWN IMMEDIATE;
EXIT;

# 2. Relink Oracle binary files, enable Pure Unified Auditing
cd $ORACLE_HOME/rdbms/lib
make -f ins_rdbms.mk uniaud_on ioracle

# 3. Start database
sqlplus / as sysdba
STARTUP;
```

> **Note**: Switching to Pure Unified Auditing Mode is irreversible (requires reinstalling the database to revert). If the current Mixed Mode meets your needs, it is recommended to keep Mixed Mode. Mixed Mode is sufficient for most environments.

#### Verifying Enablement Status

```sql
-- Verify Unified Auditing mode
SELECT PARAMETER, VALUE
FROM V$OPTION
WHERE PARAMETER = 'Unified Auditing';

-- View existing audit policies (including default policies)
SELECT POLICY_NAME, ENABLED_OPT, USER_AUDIT_OPTION
FROM AUDIT_UNIFIED_POLICIES
ORDER BY POLICY_NAME;

-- View enabled policies
SELECT POLICY_NAME, ENABLED_OPTION, ENTITY_NAME, ENTITY_TYPE
FROM AUDIT_UNIFIED_ENABLED_POLICIES;

-- View specific audit items of default policies
SELECT POLICY_NAME, AUDIT_OPTION, AUDIT_OPTION_TYPE, OBJECT_SCHEMA, OBJECT_NAME
FROM AUDIT_UNIFIED_POLICIES
WHERE POLICY_NAME = 'ORA_SECURECONFIG'
ORDER BY AUDIT_OPTION;
```

### 3.2 Creating Audit Policies

#### Privilege Audit Policy

Audit all operations using the `DROP ANY TABLE` privilege, which is one of the most basic requirements in security compliance:

```sql
-- Create privilege audit policy
CREATE AUDIT POLICY priv_drop_any_table_policy
  PRIVILEGES DROP ANY TABLE;

-- Enable policy (applies to all users)
AUDIT POLICY priv_drop_any_table_policy;

-- Enable only for specific users
AUDIT POLICY priv_drop_any_table_policy BY scott, hr;

-- Enable only for non-DBA users (excluding SYS and SYSDBA connections)
AUDIT POLICY priv_drop_any_table_policy EXCEPT SYS;
```

#### DML Operation Audit Policy

Audit all DML operations on core HR schema personnel tables, which is frequently required in MLPS evaluations:

```sql
-- Create DML audit policy
CREATE AUDIT POLICY hr_dml_audit_policy
  ACTIONS INSERT ON HR.EMPLOYEES,
          UPDATE ON HR.EMPLOYEES,
          DELETE ON HR.EMPLOYEES,
          INSERT ON HR.DEPARTMENTS,
          UPDATE ON HR.DEPARTMENTS,
          DELETE ON HR.DEPARTMENTS;

-- Enable policy (excluding SYS user)
AUDIT POLICY hr_dml_audit_policy BY ALL EXCEPT SYS;
```

#### Login Failure Audit

Oracle has the `ORA_LOGON_FAILURES` policy enabled by default, but you can customize more granular login audit policies for detecting brute force attacks and abnormal logins:

```sql
-- Create login audit policy
CREATE AUDIT POLICY login_audit_policy
  ACTIONS LOGON, LOGOFF,
  ROLES DBA, DATAPUMP_EXP_FULL_DATABASE;

-- Enable
AUDIT POLICY login_audit_policy;

-- Query login failure records of the last 7 days
SELECT event_timestamp, dbusername, client_identifier,
       action_name, return_code, userhost,
       terminal, authentication_type
FROM DBA_UNIFIED_AUDIT_TRAIL
WHERE action_name IN ('LOGON', 'LOGOFF')
  AND return_code != 0
  AND event_timestamp > SYSTIMESTAMP - INTERVAL '7' DAY
ORDER BY event_timestamp DESC;

-- Statistics of failed login user distribution
SELECT dbusername, COUNT(*) AS fail_count
FROM DBA_UNIFIED_AUDIT_TRAIL
WHERE action_name = 'LOGON'
  AND return_code != 0
  AND event_timestamp > SYSTIMESTAMP - INTERVAL '7' DAY
GROUP BY dbusername
ORDER BY fail_count DESC;
```

#### Privileged Operation Audit

Audit sensitive operations of all DBA role users to prevent privilege abuse:

```sql
-- Create privileged operation audit policy
CREATE AUDIT POLICY dba_operations_policy
  PRIVILEGES ALTER SYSTEM,
             ALTER DATABASE,
             ALTER USER,
             DROP USER,
             CREATE ANY TABLE,
             ALTER ANY TABLE,
             DROP ANY TABLE
  WHEN 'SYS_CONTEXT(''USERENV'',''SESSION_USER'') NOT IN (''SYS'',''SYSTEM'')'
  EVALUATE PER SESSION;

-- Enable
AUDIT POLICY dba_operations_policy BY USERS WITH GRANTED ROLES DBA;
```

After policy creation, you can view the detailed policy definition:

```sql
-- View policy details
SELECT POLICY_NAME, AUDIT_OPTION, AUDIT_OPTION_TYPE,
       OBJECT_SCHEMA, OBJECT_NAME, COMMON
FROM AUDIT_UNIFIED_POLICIES
WHERE POLICY_NAME = 'DBA_OPERATIONS_POLICY';
```

### 3.3 FGA Configuration

Fine-Grained Auditing (FGA) is implemented through the `DBMS_FGA` package and is the most flexible audit method in Unified Auditing. Unlike regular action auditing, FGA supports precise control of audit scope based on WHERE conditions, suitable for conditional auditing of sensitive data.

#### FGA Policy Creation

**Scenario 1: Audit SELECT access to sensitive salary fields**

Trigger audit when someone queries salary information of high-earning employees — a typical requirement in financial and HR scenarios:

```sql
BEGIN
  DBMS_FGA.ADD_POLICY(
    object_schema   => 'HR',
    object_name     => 'EMPLOYEES',
    policy_name     => 'AUDIT_SALARY_ACCESS',
    audit_column    => 'SALARY,COMMISSION_PCT',
    audit_condition => 'SALARY > 10000',
    audit_column_opts => DBMS_FGA.ANY_COLUMNS,
    statement_types => 'SELECT',
    handler_schema  => NULL,
    handler_module  => NULL,
    enable          => TRUE
  );
END;
/
```

Parameter descriptions:
- `audit_column`: Specifies columns to audit; multiple columns separated by commas
- `audit_condition`: Condition that triggers audit, similar to WHERE clause
- `audit_column_opts`: `ANY_COLUMNS` means trigger on access to any specified column; `ALL_COLUMNS` means trigger only when all specified columns are accessed
- `statement_types`: SQL operation types to audit, supports `SELECT`, `INSERT`, `UPDATE`, `DELETE`

**Scenario 2: Audit DELETE operations on financial transaction tables**

Deleting financial transaction records is a high-risk operation and should be unconditionally audited:

```sql
BEGIN
  DBMS_FGA.ADD_POLICY(
    object_schema   => 'FINANCE',
    object_name     => 'TRANSACTIONS',
    policy_name     => 'AUDIT_FINANCE_DELETE',
    audit_condition => '1=1',
    statement_types => 'DELETE',
    enable          => TRUE
  );
END;
/
```

**Scenario 3: Audit bulk access to customer information**

Trigger audit when queries involve all columns of the customer table (possibly indicating bulk data export):

```sql
BEGIN
  DBMS_FGA.ADD_POLICY(
    object_schema   => 'CRM',
    object_name     => 'CUSTOMERS',
    policy_name     => 'AUDIT_BULK_CUSTOMER_ACCESS',
    audit_condition => '1=1',
    statement_types => 'SELECT',
    audit_column_opts => DBMS_FGA.ALL_COLUMNS,
    enable          => TRUE
  );
END;
/
```

#### FGA Policy Management

FGA policies support dynamic enable, disable, and delete without rebuilding the policy:

```sql
-- Enable FGA policy
BEGIN
  DBMS_FGA.ENABLE_POLICY('HR', 'EMPLOYEES', 'AUDIT_SALARY_ACCESS');
END;
/

-- Disable FGA policy
BEGIN
  DBMS_FGA.DISABLE_POLICY('HR', 'EMPLOYEES', 'AUDIT_SALARY_ACCESS');
END;
/

-- Delete FGA policy
BEGIN
  DBMS_FGA.DROP_POLICY('HR', 'EMPLOYEES', 'AUDIT_SALARY_ACCESS');
END;
/

-- View existing FGA policies
SELECT object_schema, object_name, policy_name,
       enabled, sel, ins, upd, del,
       audit_column, audit_condition
FROM DBA_AUDIT_POLICES;
```

#### FGA Log Query

```sql
-- FGA audit logs are uniformly queried in Unified Auditing mode
SELECT event_timestamp, dbusername, object_schema,
       object_name, sql_text, sql_binds
FROM DBA_UNIFIED_AUDIT_TRAIL
WHERE audit_type = 'FGA AUDIT'
  AND event_timestamp > SYSTIMESTAMP - INTERVAL '1' DAY
ORDER BY event_timestamp DESC;

-- Count FGA trigger frequency by object
SELECT object_schema, object_name, COUNT(*) AS trigger_count
FROM DBA_UNIFIED_AUDIT_TRAIL
WHERE audit_type = 'FGA AUDIT'
  AND event_timestamp > SYSTIMESTAMP - INTERVAL '7' DAY
GROUP BY object_schema, object_name
ORDER BY trigger_count DESC;
```

### 3.4 Audit Log Maintenance

Audit log maintenance is the most easily overlooked yet most problematic aspect in production environments. Audit logs that are not cleaned up promptly will quickly fill up the SYSAUX tablespace, causing database anomalies.

#### Initialize Audit Cleanup Framework

```sql
-- Initialize audit cleanup configuration (only needs to be executed once)
BEGIN
  DBMS_AUDIT_MGMT.INIT_CLEANUP(
    audit_trail_type         => DBMS_AUDIT_MGMT.AUDIT_TRAIL_UNIFIED,
    default_cleanup_interval => 720  -- 720 minutes = check every 12 hours
  );
END;
/

-- Set audit record retention days (90 days)
BEGIN
  DBMS_AUDIT_MGMT.SET_LAST_ARCHIVE_TIMESTAMP(
    audit_trail_type  => DBMS_AUDIT_MGMT.AUDIT_TRAIL_UNIFIED,
    last_archive_time => SYSTIMESTAMP - INTERVAL '90' DAY
  );
END;
/
```

#### Log Cleanup Script

```sql
-- Manually execute cleanup (clear audit records exceeding retention period)
BEGIN
  DBMS_AUDIT_MGMT.CLEAN_AUDIT_TRAIL(
    audit_trail_type        => DBMS_AUDIT_MGMT.AUDIT_TRAIL_UNIFIED,
    use_last_arch_timestamp => TRUE
  );
END;
/

-- Set up automatic cleanup job (recommended, daily automatic cleanup)
BEGIN
  DBMS_AUDIT_MGMT.CREATE_PURGE_JOB(
    audit_trail_type           => DBMS_AUDIT_MGMT.AUDIT_TRAIL_UNIFIED,
    audit_trail_purge_interval => 24,     -- Execute every 24 hours
    audit_trail_purge_name     => 'UNIFIED_AUDIT_PURGE_JOB',
    use_last_arch_timestamp    => TRUE
  );
END;
/

-- View cleanup job status
SELECT JOB_NAME, JOB_STATUS, JOB_FREQUENCY
FROM DBA_AUDIT_MGMT_CLEANUP_JOBS;
```

#### Archiving Strategy

It is recommended to archive to an independent tablespace before cleanup, preserving historical data to meet compliance retention requirements:

```sql
-- Create archive tablespace (recommend placing on independent disk group)
CREATE TABLESPACE aud_archive_ts
  DATAFILE '+DATA' SIZE 10G AUTOEXTEND ON NEXT 1G MAXSIZE 50G
  EXTENT MANAGEMENT LOCAL AUTOALLOCATE;

-- Create archive user
CREATE USER aud_archive IDENTIFIED BY "StrongPass123!"
  DEFAULT TABLESPACE aud_archive_ts
  QUOTA UNLIMITED ON aud_archive_ts;

GRANT CREATE TABLE TO aud_archive;

-- Monthly archive (example for May 2026)
CREATE TABLE aud_archive.audit_202605
TABLESPACE aud_archive_ts
AS SELECT * FROM SYS.UNIFIED_AUDIT_TRAIL
WHERE event_timestamp >= DATE '2026-05-01'
  AND event_timestamp <  DATE '2026-06-01';

-- After archiving, set archive timestamp to allow cleanup of data from that period and before
BEGIN
  DBMS_AUDIT_MGMT.SET_LAST_ARCHIVE_TIMESTAMP(
    audit_trail_type  => DBMS_AUDIT_MGMT.AUDIT_TRAIL_UNIFIED,
    last_archive_time => TO_TIMESTAMP('2026-06-01 00:00:00', 'YYYY-MM-DD HH24:MI:SS')
  );
END;
/
```
