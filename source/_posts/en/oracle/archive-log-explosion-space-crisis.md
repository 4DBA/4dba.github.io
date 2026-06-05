---
title: "Archive Log Surge and Space Crisis: Root Cause Analysis and Emergency Response"
lang: en
date: 2026-04-12 10:00:00
categories: Oracle
tags: [归档日志, 空间管理, RMAN, 应急, 故障排查]
---

## I. Background

Archive Log surges are one of the most common emergency failures Oracle DBAs encounter. In production environments, when the archive destination directory runs out of space, it directly causes the database instance to hang, blocking all write operations and bringing business operations to a complete halt. These failures often occur during peak business hours with significant impact, requiring DBAs to complete emergency response in the shortest possible time.

Common trigger scenarios include:

- **Large-scale DML operations**: Batch data imports, ETL jobs, table rebuilds (CTAS / ALTER TABLE MOVE) generate massive redo, causing archive logs to expand rapidly
- **Data Guard transport interruption**: Primary archives cannot be transported to the standby in time, causing archive logs to accumulate locally without cleanup
- **RMAN backup failure without cleanup**: RMAN backup jobs terminate abnormally, archive logs are not marked as backed up, and retention policies cannot take effect
- **Unreasonable RMAN retention policy**: Retention days or redundancy copies set too high, causing archive logs to reside long-term

This article systematically introduces root cause identification, emergency response, and long-term prevention strategies for archive log surge problems, from theoretical analysis to practical operations.

<!-- more -->

## II. Theoretical Analysis

### 2.1 Archive Log Generation Mechanism

Oracle's archive logs are triggered by Redo Log switches. When an Online Redo Log Group is filled, the LGWR process switches to the next log group, and Oracle automatically triggers the archival process (ARCn) to copy the filled Redo Log into an archive log file.

**Archive Process Working Principles:**

1. LGWR writes Redo records into the current Online Redo Log Group
2. When the log group is filled or receives a manual switch command (`ALTER SYSTEM SWITCH LOGFILE`), a log switch is triggered
3. ARCn process copies the now Inactive log group contents to the archive destination directory
4. After archiving completes, the log group can be reused by LGWR

**Archive Log Naming Convention:**

The default format is controlled by the `log_archive_format` parameter, with the common format being `%t_%s_%r.arc`:

- `%t` — Thread Number (instance number)
- `%s` — Sequence Number (log sequence number, monotonically increasing)
- `%r` — Resetlogs ID (identifies the database open incarnation)

Example: `1_12345_1145234567.arc` indicates Thread 1, Sequence 12345, Resetlogs ID 1145234567.

### 2.2 Root Cause Classification of Archive Surges

The root causes of archive log surges can be categorized into four major types:

**Business-Side Causes:**

- Large batch data imports (SQL*Loader, INSERT /*+ APPEND */)
- Batch ETL jobs executing large-scale UPDATE / DELETE
- Table rebuild operations (ALTER TABLE MOVE, DBMS_REDEFINITION)
- Index rebuilds (ALTER INDEX REBUILD)

**DG (Data Guard) Side Causes:**

- Network failures causing archive transport interruption, archive logs accumulating on Primary
- Standby apply lag too large, Primary archives cannot be deleted
- FAL server misconfiguration, Gap cannot be automatically resolved

**Backup Side Causes:**

- RMAN backup jobs failing or timing out, archive logs not marked as backed up
- Backup strategy only includes full database backup, no archive log backup configured
- Backup target storage unavailable (tape library offline, object storage anomaly)

**Configuration Side Causes:**

- RMAN retention policy set too high (e.g., REDUNDANCY 10 or RECOVERY WINDOW 30 days)
- No automatic archive log deletion policy configured
- Archive destination directory sharing the same disk group with data files

### 2.3 Space Monitoring Indicators

**FRA (Flash Recovery Area) Space Management:**

FRA is Oracle's recommended unified backup and recovery area, storing archive logs, RMAN backups, flashback logs, etc. Configured through `db_recovery_file_dest` and `db_recovery_file_dest_size` parameters.

When FRA space is insufficient, Oracle behaves as follows:

- Database pauses all write operations, waiting for space release
- Alert Log shows `ORA-19809: limit exceeded for recovery files`
- ARCn process stops archiving, Redo Logs cannot switch

**Key Monitoring Views:**

```sql
-- Check FRA space usage
SELECT * FROM V$FLASH_RECOVERY_AREA_USAGE;

-- Check archive log generation rate (by hour)
SELECT TRUNC(first_time, 'HH') AS hour,
       COUNT(*) AS switch_count,
       ROUND(SUM(blocks * block_size) / 1024 / 1024, 2) AS size_mb
FROM v$archived_log
WHERE first_time > SYSDATE - 1
GROUP BY TRUNC(first_time, 'HH')
ORDER BY hour;

-- Check archive destination directory usage (OS level)
-- df -h /u01/app/oracle/archivelog/
```

## III. Hands-On Operations

### 3.1 Emergency Response Scripts

When archive space alerts trigger, space must be freed in the shortest possible time. Here is the standardized emergency response procedure:

**Step 1: Check Archive Generation Rate and Current Space**

```sql
-- Connect as SYSDBA
-- Check total archive log count and recent generation rate
SELECT COUNT(*) AS total_logs,
       ROUND(SUM(blocks * block_size) / 1024 / 1024 / 1024, 2) AS total_gb,
       MIN(first_time) AS earliest,
       MAX(first_time) AS latest
FROM v$archived_log
WHERE deleted = 'NO';

-- Check hourly archive volume for the last 24 hours
SELECT TRUNC(first_time, 'HH') AS hour,
       COUNT(*) AS log_count,
       ROUND(SUM(blocks * block_size) / 1024 / 1024, 2) AS size_mb
FROM v$archived_log
WHERE first_time > SYSDATE - 1
  AND deleted = 'NO'
GROUP BY TRUNC(first_time, 'HH')
ORDER BY hour DESC;

-- Check FRA usage
SELECT name,
       ROUND(space_limit / 1024 / 1024 / 1024, 2) AS limit_gb,
       ROUND(space_used / 1024 / 1024 / 1024, 2) AS used_gb,
       ROUND((space_used / space_limit) * 100, 2) AS pct_used
FROM v$recovery_file_dest;
```

**Step 2: RMAN Cleanup of Expired and Backed-Up Archives**

```bash
# Connect to RMAN
rman target /

# Execute the following cleanup commands
```

```rman
-- Delete all backed-up archive logs
DELETE ARCHIVELOG ALL BACKED UP 1 TIMES TO DEVICE TYPE DISK;

-- Delete archive logs older than 24 hours (adjust time as needed)
DELETE NOPROMPT ARCHIVELOG ALL COMPLETED BEFORE 'SYSDATE-1';

-- Delete archive logs older than 2 days that have been backed up
DELETE NOPROMPT ARCHIVELOG ALL COMPLETED BEFORE 'SYSDATE-2'
  BACKED UP 1 TIMES TO DEVICE TYPE DISK;

-- Crosscheck and delete expired archives
CROSSCHECK ARCHIVELOG ALL;
DELETE NOPROMPT EXPIRED ARCHIVELOG ALL;

-- Verify cleanup results
LIST ARCHIVELOG ALL;
```

**Step 3: OS-Level Manual Cleanup (for emergency use)**

```bash
#!/bin/bash
# Emergency cleanup script - delete archive logs older than 48 hours
# Note: Confirm these archives have been backed up or are no longer needed before use

ARCHIVE_DIR="/u01/app/oracle/archivelog"
HOURS=48

echo "=== Emergency archive cleanup - deleting files older than ${HOURS} hours ==="
echo "Space before cleanup:"
df -h ${ARCHIVE_DIR}

find ${ARCHIVE_DIR} -name "*.arc" -o -name "*.dbf" | \
  while read f; do
    if [ "$(find "$f" -mmin +$((HOURS*60)))" ]; then
      echo "Deleting: $f"
      rm -f "$f"
    fi
  done

echo "Space after cleanup:"
df -h ${ARCHIVE_DIR}
```

**Step 4: Manual Archive Destination Switch (Temporary Emergency)**

```sql
-- Temporarily add new archive destination directory (relieve pressure on original directory)
ALTER SYSTEM SET log_archive_dest_3='LOCATION=/u01/app/oracle/archivelog2' SCOPE=BOTH;

-- If using FRA, temporarily increase FRA size
ALTER SYSTEM SET db_recovery_file_dest_size=200G SCOPE=BOTH;
```

### 3.2 Root Cause Identification

After emergency response is complete, you need to identify the root cause to prevent recurrence.

**Find SQL generating the most redo:**

```sql
-- Find SQL generating the most redo (requires AWR or ASH data)
SELECT sql_id,
       sql_text,
       executions,
       buffer_gets,
       disk_reads,
       ROUND(elapsed_time / 1000000, 2) AS elapsed_sec
FROM v$sql
WHERE parsing_schema_name NOT IN ('SYS', 'SYSTEM')
ORDER BY buffer_gets DESC
FETCH FIRST 20 ROWS ONLY;

-- View current active sessions generating the most redo
SELECT s.sid, s.serial#, s.username, s.program,
       t.used_ublk AS undo_blocks,
       t.used_urec AS undo_records
FROM v$session s
JOIN v$transaction t ON s.taddr = t.addr
ORDER BY t.used_ublk DESC;
```

**Check DG Transport Status:**

```sql
-- View archive destination status
SELECT dest_id, dest_name, status, error,
       archived_seq#, applied_seq#
FROM v$archive_dest_status
WHERE status != 'INACTIVE';

-- View archive Gap
SELECT * FROM v$archive_gap;

-- View standby apply lag
SELECT name, value
FROM v$dataguard_stats
WHERE name IN ('transport lag', 'apply lag');
```

**Check RMAN Backup Status:**

```sql
-- View archive log backup status
SELECT sequence#,
       first_time,
       next_time,
       backup_count,
       deleted
FROM v$archived_log
WHERE backup_count = 0
  AND deleted = 'NO'
  AND first_time < SYSDATE - 1
ORDER BY sequence#
FETCH FIRST 20 ROWS ONLY;
```

### 3.3 Long-Term Solutions

**RMAN Retention Policy Configuration:**

```rman
-- Set recovery window-based retention policy (7-day recoverability)
CONFIGURE RETENTION POLICY TO RECOVERY WINDOW OF 7 DAYS;

-- Or redundancy-based retention policy
CONFIGURE RETENTION POLICY TO REDUNDANCY 2;

-- Configure archive log deletion policy
-- Auto-delete after RMAN backup
CONFIGURE ARCHIVELOG DELETION POLICY TO BACKED UP 1 TIMES TO DISK;

-- DG environment: deletable after transport to all standbys
CONFIGURE ARCHIVELOG DELETION POLICY TO APPLIED ON ALL STANDBY;
```

**FRA Size Planning Principles:**

FRA size should be comprehensively evaluated based on the following factors:

- Full database backup size
- Average daily archive log generation
- Retention period requirements
- Flashback log requirements (if Flashback Database is enabled)

Recommended formula:

```
FRA Size = Full DB backup size + (Daily archive volume × Retention days) + Flashback space + 20% redundancy
```

**Automatic Cleanup Script:**

```bash
#!/bin/bash
# Oracle archive log automatic cleanup script
# Recommended to run via cron every 2-4 hours
# crontab: 0 */2 * * * /home/oracle/scripts/archive_cleanup.sh

export ORACLE_SID=ORCL
export ORACLE_HOME=/u01/app/oracle/product/19c/dbhome_1
export PATH=$ORACLE_HOME/bin:$PATH

LOG_DIR="/home/oracle/logs"
LOG_FILE="${LOG_DIR}/archive_cleanup_$(date +%Y%m%d).log"
KEEP_DAYS=2

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> ${LOG_FILE}
}

log "===== Archive cleanup task started ====="

# Check archive space usage
USAGE_PCT=$(sqlplus -s / as sysdba <<'EOF'
SET HEADING OFF FEEDBACK OFF PAGES 0
SELECT ROUND((space_used / space_limit) * 100, 2)
FROM v$recovery_file_dest;
EXIT;
EOF
)

USAGE_PCT=$(echo ${USAGE_PCT} | tr -d ' ')
log "Current FRA usage: ${USAGE_PCT}%"

# Execute cleanup when usage exceeds 70%
THRESHOLD=70
if (( $(echo "${USAGE_PCT} > ${THRESHOLD}" | bc -l) )); then
    log "Usage exceeds ${THRESHOLD}%, starting cleanup..."

    rman target / <<RMAN_EOF >> ${LOG_FILE} 2>&1
RUN {
    DELETE NOPROMPT ARCHIVELOG ALL COMPLETED BEFORE 'SYSDATE-${KEEP_DAYS}';
    CROSSCHECK ARCHIVELOG ALL;
    DELETE NOPROMPT EXPIRED ARCHIVELOG ALL;
}
RMAN_EOF

    # Recheck after cleanup
    NEW_PCT=$(sqlplus -s / as sysdba <<'EOF'
SET HEADING OFF FEEDBACK OFF PAGES 0
SELECT ROUND((space_used / space_limit) * 100, 2)
FROM v$recovery_file_dest;
EXIT;
EOF
    )
    NEW_PCT=$(echo ${NEW_PCT} | tr -d ' ')
    log "FRA usage after cleanup: ${NEW_PCT}%"
else
    log "Usage normal, no cleanup needed"
fi

log "===== Archive cleanup task completed ====="
```

**Monitoring Alert Configuration Script:**

```bash
#!/bin/bash
# Archive space monitoring alert script
# crontab: */15 * * * * /home/oracle/scripts/archive_monitor.sh

export ORACLE_SID=ORCL
export ORACLE_HOME=/u01/app/oracle/product/19c/dbhome_1
export PATH=$ORACLE_HOME/bin:$PATH

# Threshold configuration
WARN_THRESHOLD=70
CRIT_THRESHOLD=85
ALERT_EMAIL="dba-team@company.com"

# Get FRA usage
RESULT=$(sqlplus -s / as sysdba <<'EOF'
SET HEADING OFF FEEDBACK OFF PAGES 0 TRIMSPOOL ON
SELECT ROUND((space_used / space_limit) * 100, 2) || '|' ||
       ROUND(space_used / 1024 / 1024 / 1024, 2) || '|' ||
       ROUND(space_limit / 1024 / 1024 / 1024, 2)
FROM v$recovery_file_dest;
EXIT;
EOF
)

PCT_USED=$(echo ${RESULT} | cut -d'|' -f1 | tr -d ' ')
USED_GB=$(echo ${RESULT} | cut -d'|' -f2 | tr -d ' ')
TOTAL_GB=$(echo ${RESULT} | cut -d'|' -f3 | tr -d ' ')

if (( $(echo "${PCT_USED} >= ${CRIT_THRESHOLD}" | bc -l) )); then
    SUBJECT="[CRITICAL] Oracle FRA Space Critically Low - ${PCT_USED}%"
    BODY="Alert Level: Critical\nDatabase: ${ORACLE_SID}\nFRA Usage: ${PCT_USED}%\nUsed: ${USED_GB}GB / ${TOTAL_GB}GB\n\nPlease handle immediately!"
    echo -e "${BODY}" | mail -s "${SUBJECT}" ${ALERT_EMAIL}
elif (( $(echo "${PCT_USED} >= ${WARN_THRESHOLD}" | bc -l) )); then
    SUBJECT="[WARNING] Oracle FRA Space Alert - ${PCT_USED}%"
    BODY="Alert Level: Warning\nDatabase: ${ORACLE_SID}\nFRA Usage: ${PCT_USED}%\nUsed: ${USED_GB}GB / ${TOTAL_GB}GB\n\nPlease monitor and schedule resolution."
    echo -e "${BODY}" | mail -s "${SUBJECT}" ${ALERT_EMAIL}
fi
```

### 3.4 Archive Management in DG Environments

Archive management in DG environments is more complex than in standalone environments, requiring consideration of both Primary and Standby archive lifecycle.

**Archive Gap Handling:**

```sql
-- Check Gap on standby
SELECT * FROM v$archive_gap;

-- Manually register missing archive log
ALTER DATABASE REGISTER PHYSICAL LOGFILE '/path/to/missing_archive.arc';

-- Automatic Gap Resolution configuration check
-- Ensure FAL_SERVER and FAL_CLIENT are configured correctly
SHOW PARAMETER fal;
```

**Standby-Side Automatic Deletion:**

```sql
-- Configure archive log deletion policy on standby
-- Auto-delete after apply completes
ALTER SYSTEM SET log_archive_dest_state_1='DEFER';  -- If temporary pause needed

-- RMAN configuration (execute on Primary)
CONFIGURE ARCHIVELOG DELETION POLICY TO APPLIED ON ALL STANDBY;
```

Standby automatic cleanup script:

```bash
#!/bin/bash
# Standby archive automatic cleanup script
export ORACLE_SID=STDBY
export ORACLE_HOME=/u01/app/oracle/product/19c/dbhome_1

rman target / <<EOF
DELETE NOPROMPT ARCHIVELOG ALL COMPLETED BEFORE 'SYSDATE-1';
EOF
```

**Remote Archive Destination Cleanup:**

If the Primary has multiple archive destinations configured (`log_archive_dest_N`), ensure remote destination archives are also properly managed. When remote destinations are unreachable, Primary archives accumulate locally. In this case:

1. Check network connectivity
2. Temporarily disable the problem destination (`ALTER SYSTEM SET log_archive_dest_state_N=DEFER`)
3. Clean up locally accumulated archives
4. Re-enable the destination after resolution

## IV. Result Verification

After emergency response and root cause fixes are complete, systematic verification is needed:

**Archive Generation Rate Verification:**

```sql
-- Verify archive generation rate has returned to normal
SELECT TRUNC(first_time, 'HH') AS hour,
       COUNT(*) AS log_count,
       ROUND(SUM(blocks * block_size) / 1024 / 1024, 2) AS size_mb
FROM v$archived_log
WHERE first_time > SYSDATE - 1/24  -- Last 1 hour
GROUP BY TRUNC(first_time, 'HH')
ORDER BY hour DESC;
```

**Space Usage Verification:**

```sql
-- Confirm FRA usage is in safe range (recommended < 70%)
SELECT name,
       ROUND(space_limit / 1024 / 1024 / 1024, 2) AS limit_gb,
       ROUND(space_used / 1024 / 1024 / 1024, 2) AS used_gb,
       ROUND((space_used / space_limit) * 100, 2) AS pct_used
FROM v$recovery_file_dest;
```

**Monitoring Alert Verification:**

- Confirm monitoring scripts execute as scheduled (check cron logs)
- Verify alert emails are sent properly
- Confirm alert thresholds are set reasonably

## V. Lessons Learned

### Archive Log Management Best Practices

1. **Configure a reasonable RMAN retention policy**: Production environments recommend `RECOVERY WINDOW OF 7 DAYS` rather than unlimited retention
2. **Regular archive log backups**: Ensure RMAN archive log backup jobs run normally, with automatic cleanup after backup completion
3. **DG environments use APPLIED ON ALL STANDBY policy**: Archives are automatically marked as deletable after being applied on all standbys
4. **Avoid sharing disk between archives and data files**: Archive directories should be independent to prevent database unavailability from space contention

### Space Planning Principles

1. **FRA size should be at least 2x database size**: Covers one full database backup + 1-2 days of archive logs
2. **Tiered monitoring thresholds**: Warning 70%, Critical 85%, Emergency 95%
3. **Reserve emergency space**: At least 20% space reserved for emergencies
4. **Regular capacity planning**: Expand storage in advance based on business growth trends

### Automated Monitoring Solution

1. **Multi-dimensional monitoring**: Simultaneously monitor FRA usage, archive directory filesystem usage, and archive generation rate
2. **Tiered alerting**: Warning level sends email, Critical level triggers SMS/phone notification
3. **Automatic cleanup**: Configure automatic cleanup scripts that trigger at Warning level
4. **Trend analysis**: Record historical data, build archive generation trend models, and predict space needs in advance

Archive log space management seems simple, but once it gets out of control in production, the consequences are severe. DBAs need to establish comprehensive monitoring systems and automated emergency response mechanisms to nip problems in the bud. Remember: **Prevention is always more important than firefighting**.
