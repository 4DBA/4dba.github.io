---
title: "Python/Shell Automated Inspection Scripts: Daily Inspection Solution Covering Tablespaces, Alert Logs, and Backup Status"
date: 2026-05-15 10:00:00
categories: Oracle
tags: [自动巡检, Python, Shell, 监控, crontab, 邮件告警]
lang: en
---

## 1. Background

As an Oracle DBA, **daily inspection** is one of the most fundamental and important job responsibilities. Whether in production or test environments, logging into the database every day to check instance status, tablespace usage, backup completion, and error messages in the alert log — these are all basic safeguards for ensuring stable database operation.

However, manual inspection has several obvious pain points:

1. **Low efficiency**: The more database instances you manage, the more time you spend on inspections each day. Assuming 20 instances with 10 minutes per inspection, daily inspections alone would take over 3 hours.
2. **Easy to miss**: Human operations inevitably lead to fatigue, especially during holiday duty, where certain check items may be skipped.
3. **Lack of historical records**: Manual inspection results are difficult to store in a standardized way, making trend analysis impossible.
4. **Delayed response**: Problems are often only discovered during inspection, making real-time or near-real-time alerting impossible.

**The value of automated inspection** lies in:

- **Standardization**: All check items are fixed, nothing is missed
- **Traceability**: Inspection results are automatically stored, supporting historical comparison
- **Proactive alerting**: Anomalies trigger immediate email/SMS notifications
- **Freed manpower**: DBAs can focus their energy on more valuable work

This article introduces a complete Oracle automated inspection solution covering both Shell and Python script implementations, including core check items such as instance status, tablespaces, ASM disk groups, alert logs, backup status, and archived logs.

<!-- more -->

## 2. Theoretical Analysis

### 2.1 Inspection Metrics System

A comprehensive Oracle daily inspection should cover the following five dimensions:

| Dimension | Check Item | Alert Threshold |
|------|--------|----------|
| Instance Status | Database instance, listener status | Instance DOWN / Listener anomaly |
| Space Management | Tablespace usage, ASM disk group usage | Tablespace > 85%, ASM > 80% |
| Backup Status | RMAN backup success, backup set size | Last backup over 24 hours ago |
| Performance Metrics | TOP SQL, wait events, active session count | Active sessions > threshold, abnormal wait events |
| Alert Log | ORA- errors, ORA-600/7445 and other severe errors | Severe errors present |

### 2.2 Technology Selection

When implementing automated inspection scripts, common choices are Shell, Python, and Perl:

- **Shell**: Lightweight, no additional dependencies, suitable for quickly implementing simple SQL checks. Execute SQL via `sqlplus -s` and parse the output. The drawback is that handling complex logic and formatted output is not flexible enough.
- **Python**: Powerful functionality, rich ecosystem. Combined with the `oracledb` library (successor to `cx_Oracle`), it can conveniently connect to databases and process result sets. Supports advanced features like HTML report generation, email sending, and historical data storage.
- **Perl**: Widely used among traditional Oracle DBAs, but has been gradually replaced by Python in recent years.

**Recommended approach**: Shell scripts for quick lightweight inspections, Python scripts for generating complete reports and email alerts.

For email sending:
- Shell uses the `mailx` command (requires SMTP configuration)
- Python uses the `smtplib` standard library

## 3. Hands-On Operations

### 3.1 Shell Inspection Script

Below is the complete Shell inspection script covering core check items including instance status, tablespace usage, ASM disk groups, alert log errors, and archived log generation rate:

```bash
#!/bin/bash
#============================================================
# Script Name: oracle_daily_check.sh
# Function: Oracle database daily inspection script
# Platform: Linux / AIX / Solaris
# Author: OCM DBA @ 4dba.top
# Created: 2026-06-10
#============================================================

#-------------------- Environment Variables --------------------
export ORACLE_HOME=/u01/app/oracle/product/19c/dbhome_1
export PATH=$ORACLE_HOME/bin:$PATH
export LD_LIBRARY_PATH=$ORACLE_HOME/lib:$LD_LIBRARY_PATH

#-------------------- Configuration --------------------
DB_USER="sys"
DB_PASS="your_password"
DB_ROLE="as sysdba"
DB_HOST="localhost"
DB_PORT="1521"
DB_SERVICE="ORCL"

# Alert thresholds
TABLESPACE_WARN=85    # Tablespace usage warning threshold (%)
TABLESPACE_CRIT=95    # Tablespace usage critical threshold (%)
ASM_WARN=80           # ASM disk group usage warning threshold (%)

# Email configuration
MAIL_TO="dba-team@4dba.top"
MAIL_SUBJECT="[Oracle Inspection] $(hostname) - $(date +%Y%m%d)"

# Inspection report
REPORT_DIR="/home/oracle/dba/scripts/reports"
REPORT_FILE="${REPORT_DIR}/daily_check_$(date +%Y%m%d_%H%M%S).log"
ALERT_FILE="${REPORT_DIR}/alert_$(date +%Y%m%d_%H%M%S).log"

# Alert log path
ALERT_LOG_DIR="$ORACLE_BASE/diag/rdbms/orcl/ORCL/trace"
ALERT_LOG="${ALERT_LOG_DIR}/alert_ORCL.log"

#-------------------- Initialization --------------------
mkdir -p ${REPORT_DIR}
> ${ALERT_FILE}

# Counters
ERROR_COUNT=0
WARN_COUNT=0

#-------------------- Helper Functions --------------------
log_info() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [INFO] $*" | tee -a ${REPORT_FILE}
}

log_warn() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [WARN] $*" | tee -a ${REPORT_FILE}
    echo "[WARN] $*" >> ${ALERT_FILE}
    ((WARN_COUNT++))
}

log_error() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [ERROR] $*" | tee -a ${REPORT_FILE}
    echo "[ERROR] $*" >> ${ALERT_FILE}
    ((ERROR_COUNT++))
}

# SQL execution wrapper function
run_sql() {
    local sql_stmt="$1"
    echo "${sql_stmt}" | sqlplus -s / as sysdba 2>/dev/null
}

# SQL execution with connection string
run_sql_remote() {
    local sql_stmt="$1"
    echo "${sql_stmt}" | sqlplus -s ${DB_USER}/${DB_PASS}@${DB_HOST}:${DB_PORT}/${DB_SERVICE} as ${DB_ROLE} 2>/dev/null
}

#-------------------- 1. Instance Status Check --------------------
log_info "========== 1. Instance Status Check =========="

# Check if instance is running
INSTANCE_STATUS=$(run_sql "
    SELECT STATUS FROM V\$INSTANCE;
" | grep -E 'OPEN|MOUNTED' | tr -d '[:space:]')

if [ "${INSTANCE_STATUS}" = "OPEN" ]; then
    log_info "Instance status: OPEN - Normal"
else
    log_error "Instance status abnormal: ${INSTANCE_STATUS}"
fi

# Get instance basic information
run_sql "
    SET LINESIZE 200
    SET PAGESIZE 100
    COL INSTANCE_NAME FORMAT A20
    COL HOST_NAME FORMAT A30
    COL VERSION FORMAT A15
    COL STARTUP_TIME FORMAT A20
    SELECT INSTANCE_NAME, HOST_NAME, VERSION, 
           TO_CHAR(STARTUP_TIME, 'YYYY-MM-DD HH24:MI:SS') AS STARTUP_TIME,
           STATUS, DATABASE_STATUS
    FROM V\$INSTANCE;
" | grep -v '^$' | grep -v '^SQL>' >> ${REPORT_FILE}

#-------------------- 2. Listener Status Check --------------------
log_info "========== 2. Listener Status Check =========="

LSNR_STATUS=$(lsnrctl status 2>&1)
if echo "${LSNR_STATUS}" | grep -q "no listener"; then
    log_error "Listener is not running!"
else
    LISTENER_NAME=$(echo "${LSNR_STATUS}" | grep "Alias" | awk '{print $NF}')
    log_info "Listener ${LISTENER_NAME} is running normally"
fi

#-------------------- 3. Tablespace Usage Check --------------------
log_info "========== 3. Tablespace Usage Check =========="

run_sql "
    SET LINESIZE 200
    SET PAGESIZE 200
    COL TABLESPACE_NAME FORMAT A25
    COL \"Used%\" FORMAT 999.99
    COL \"MaxUsed%\" FORMAT 999.99
    SELECT 
        a.tablespace_name,
        ROUND(a.total_mb, 2) AS \"Total(MB)\",
        ROUND(a.total_mb - NVL(b.free_mb, 0), 2) AS \"Used(MB)\",
        ROUND(NVL(b.free_mb, 0), 2) AS \"Free(MB)\",
        ROUND((a.total_mb - NVL(b.free_mb, 0)) / a.total_mb * 100, 2) AS \"Used%\"
    FROM (
        SELECT tablespace_name, SUM(bytes) / 1024 / 1024 AS total_mb
        FROM dba_data_files
        GROUP BY tablespace_name
    ) a
    LEFT JOIN (
        SELECT tablespace_name, SUM(bytes) / 1024 / 1024 AS free_mb
        FROM dba_free_space
        GROUP BY tablespace_name
    ) b ON a.tablespace_name = b.tablespace_name
    ORDER BY (a.total_mb - NVL(b.free_mb, 0)) / a.total_mb DESC;
" | grep -v '^$' | grep -v '^SQL>' >> ${REPORT_FILE}

# Check if any tablespace exceeds threshold
OVER_TS=$(run_sql "
    SET HEADING OFF
    SET FEEDBACK OFF
    SELECT tablespace_name || ':' || ROUND(used_pct, 2)
    FROM (
        SELECT a.tablespace_name,
               (a.total_mb - NVL(b.free_mb, 0)) / a.total_mb * 100 AS used_pct
        FROM (
            SELECT tablespace_name, SUM(bytes) / 1024 / 1024 AS total_mb
            FROM dba_data_files GROUP BY tablespace_name
        ) a
        LEFT JOIN (
            SELECT tablespace_name, SUM(bytes) / 1024 / 1024 AS free_mb
            FROM dba_free_space GROUP BY tablespace_name
        ) b ON a.tablespace_name = b.tablespace_name
    )
    WHERE used_pct > ${TABLESPACE_WARN};
")

if [ -n "${OVER_TS}" ]; then
    echo "${OVER_TS}" | while IFS=: read -r ts_name ts_pct; do
        if (( $(echo "${ts_pct} > ${TABLESPACE_CRIT}" | bc -l) )); then
            log_error "Tablespace ${ts_name} usage ${ts_pct}% exceeds critical threshold ${TABLESPACE_CRIT}%!"
        elif (( $(echo "${ts_pct} > ${TABLESPACE_WARN}" | bc -l) )); then
            log_warn "Tablespace ${ts_name} usage ${ts_pct}% exceeds warning threshold ${TABLESPACE_WARN}%"
        fi
    done
else
    log_info "All tablespace usage is normal (threshold: ${TABLESPACE_WARN}%)"
fi

# Check TEMP tablespace
run_sql "
    SET HEADING OFF
    SET FEEDBACK OFF
    SELECT 'TEMP:' || ROUND((a.total_mb - NVL(b.free_mb, 0)) / a.total_mb * 100, 2)
    FROM (
        SELECT tablespace_name, SUM(bytes) / 1024 / 1024 AS total_mb
        FROM dba_temp_files GROUP BY tablespace_name
    ) a
    LEFT JOIN (
        SELECT tablespace_name, SUM(bytes) / 1024 / 1024 AS free_mb
        FROM v\$temp_space_header GROUP BY tablespace_name
    ) b ON a.tablespace_name = b.tablespace_name;
" | grep -v '^$' | grep -v '^SQL>' >> ${REPORT_FILE}

#-------------------- 4. ASM Disk Group Check --------------------
log_info "========== 4. ASM Disk Group Check =========="

ASM_EXISTS=$(run_sql "
    SET HEADING OFF
    SELECT COUNT(*) FROM V\$ASM_DISKGROUP;
" | grep -E '^\s*[0-9]+' | tr -d '[:space:]')

if [ "${ASM_EXISTS}" -gt 0 ]; then
    run_sql "
        SET LINESIZE 200
        COL NAME FORMAT A20
        COL STATE FORMAT A15
        SELECT NAME, STATE, 
               ROUND(TOTAL_MB/1024, 2) AS \"Total(GB)\",
               ROUND(FREE_MB/1024, 2) AS \"Free(GB)\",
               ROUND((TOTAL_MB - FREE_MB) / TOTAL_MB * 100, 2) AS \"Used%\"
        FROM V\$ASM_DISKGROUP;
    " | grep -v '^$' | grep -v '^SQL>' >> ${REPORT_FILE}

    # Check ASM usage alerts
    OVER_ASM=$(run_sql "
        SET HEADING OFF
        SET FEEDBACK OFF
        SELECT NAME || ':' || ROUND((TOTAL_MB - FREE_MB) / TOTAL_MB * 100, 2)
        FROM V\$ASM_DISKGROUP
        WHERE (TOTAL_MB - FREE_MB) / TOTAL_MB * 100 > ${ASM_WARN};
    ")

    if [ -n "${OVER_ASM}" ]; then
        echo "${OVER_ASM}" | while IFS=: read -r dg_name dg_pct; do
            log_warn "ASM disk group ${dg_name} usage ${dg_pct}% exceeds threshold ${ASM_WARN}%"
        done
    else
        log_info "All ASM disk group usage is normal"
    fi
else
    log_info "No ASM disk groups detected, skipping this check"
fi

#-------------------- 5. Alert Log Error Check --------------------
log_info "========== 5. Alert Log Error Check =========="

if [ -f "${ALERT_LOG}" ]; then
    # Check ORA- errors in the last 24 hours
    RECENT_ERRORS=$(find ${ALERT_LOG_DIR} -name "alert_*.log" -mtime -1 -exec grep -c "ORA-" {} \; 2>/dev/null | paste -sd+ | bc 2>/dev/null || echo "0")

    if [ "${RECENT_ERRORS}" -gt 0 ]; then
        log_warn "Found ${RECENT_ERRORS} ORA- errors in alert log within the last 24 hours"

        # List severe errors
        CRITICAL_ERRORS=$(grep -E "ORA-600|ORA-7445|ORA-00600|ORA-07445" ${ALERT_LOG} | tail -10)
        if [ -n "${CRITICAL_ERRORS}" ]; then
            log_error "Found severe internal errors:"
            echo "${CRITICAL_ERRORS}" >> ${REPORT_FILE}
        fi

        # List recent common ORA- errors
        log_info "Last 10 ORA- errors:"
        grep "ORA-" ${ALERT_LOG} | tail -10 >> ${REPORT_FILE}
    else
        log_info "No ORA- errors in alert log within the last 24 hours"
    fi
else
    log_warn "Alert log file does not exist: ${ALERT_LOG}"
fi

#-------------------- 6. Archived Log Generation Rate --------------------
log_info "========== 6. Archived Log Generation Rate =========="

ARCH_LOG=$(run_sql "
    SET HEADING OFF
    SET FEEDBACK OFF
    SELECT 'Count:' || COUNT(*) || '|Size:' || ROUND(NVL(SUM(BLOCKS * BLOCK_SIZE) / 1024 / 1024, 0), 2) || 'MB'
    FROM V\$ARCHIVED_LOG
    WHERE FIRST_TIME > SYSDATE - 1
    AND DEST_ID = 1;
" | grep '^Count:' | tr -d '[:space:]')

if [ -n "${ARCH_LOG}" ]; then
    ARCH_COUNT=$(echo "${ARCH_LOG}" | sed 's/Count:\([0-9]*\).*/\1/')
    ARCH_SIZE=$(echo "${ARCH_LOG}" | sed 's/.*Size:\(.*\)MB/\1/')
    log_info "Archived logs in the past 24 hours: ${ARCH_COUNT} files, total size ${ARCH_SIZE} MB"

    # Alert on excessive archived log generation
    if [ "${ARCH_COUNT}" -gt 200 ]; then
        log_warn "Archived log count ${ARCH_COUNT} — possible heavy DML operations"
    fi
fi

#-------------------- 7. RMAN Backup Status Check --------------------
log_info "========== 7. RMAN Backup Status Check =========="

run_sql "
    SET LINESIZE 200
    COL STATUS FORMAT A15
    COL INPUT_TYPE FORMAT A20
    COL INPUT_BYTES_DISPLAY FORMAT A15
    COL OUTPUT_BYTES_DISPLAY FORMAT A15
    COL TIME_TAKEN_DISPLAY FORMAT A15
    SELECT TO_CHAR(START_TIME, 'YYYY-MM-DD HH24:MI:SS') AS START_TIME,
           TO_CHAR(END_TIME, 'YYYY-MM-DD HH24:MI:SS') AS END_TIME,
           STATUS, INPUT_TYPE,
           INPUT_BYTES_DISPLAY, OUTPUT_BYTES_DISPLAY,
           TIME_TAKEN_DISPLAY
    FROM V\$RMAN_BACKUP_JOB_DETAILS
    WHERE START_TIME > SYSDATE - 2
    ORDER BY START_TIME DESC;
" | grep -v '^$' | grep -v '^SQL>' >> ${REPORT_FILE}

# Check if the most recent backup was successful
LAST_BACKUP_STATUS=$(run_sql "
    SET HEADING OFF
    SET FEEDBACK OFF
    SELECT STATUS FROM V\$RMAN_BACKUP_JOB_DETAILS
    WHERE START_TIME = (
        SELECT MAX(START_TIME) FROM V\$RMAN_BACKUP_JOB_DETAILS
    );
" | grep -v '^$' | grep -v '^SQL>' | tr -d '[:space:]')

if [ "${LAST_BACKUP_STATUS}" = "COMPLETED" ]; then
    log_info "Last RMAN backup status: Success"
else
    log_error "Last RMAN backup status: ${LAST_BACKUP_STATUS}"
fi

#-------------------- 8. Invalid Objects Check --------------------
log_info "========== 8. Invalid Objects Check =========="

INVALID_COUNT=$(run_sql "
    SET HEADING OFF
    SET FEEDBACK OFF
    SELECT COUNT(*) FROM DBA_OBJECTS WHERE STATUS = 'INVALID';
" | grep -E '^\s*[0-9]+' | tr -d '[:space:]')

if [ "${INVALID_COUNT}" -gt 0 ]; then
    log_warn "Found ${INVALID_COUNT} invalid objects"
    run_sql "
        SET LINESIZE 200
        COL OWNER FORMAT A20
        COL OBJECT_TYPE FORMAT A20
        COL OBJECT_NAME FORMAT A40
        SELECT OWNER, OBJECT_TYPE, OBJECT_NAME
        FROM DBA_OBJECTS
        WHERE STATUS = 'INVALID'
        ORDER BY OWNER, OBJECT_TYPE;
    " | grep -v '^$' | grep -v '^SQL>' >> ${REPORT_FILE}
else
    log_info "No invalid objects"
fi

#-------------------- 9. Long Transactions Check --------------------
log_info "========== 9. Long Transactions Check =========="

LONG_TXN=$(run_sql "
    SET HEADING OFF
    SET FEEDBACK OFF
    SELECT COUNT(*) FROM V\$TRANSACTION
    WHERE SYSDATE - START_DATE > 1/24;
" | grep -E '^\s*[0-9]+' | tr -d '[:space:]')

if [ "${LONG_TXN}" -gt 0 ]; then
    log_warn "Found ${LONG_TXN} transactions running for more than 1 hour"
else
    log_info "No long-running transactions"
fi

#-------------------- 10. Session Count Check --------------------
log_info "========== 10. Session Count Check =========="

run_sql "
    SET HEADING OFF
    SET FEEDBACK OFF
    SELECT 'Active:' || 
           (SELECT COUNT(*) FROM V\$SESSION WHERE STATUS = 'ACTIVE' AND TYPE = 'USER') ||
           '|Inactive:' ||
           (SELECT COUNT(*) FROM V\$SESSION WHERE STATUS = 'INACTIVE' AND TYPE = 'USER') ||
           '|Total:' ||
           (SELECT COUNT(*) FROM V\$SESSION WHERE TYPE = 'USER') ||
           '|MaxSessions:' ||
           (SELECT VALUE FROM V\$PARAMETER WHERE NAME = 'sessions');
" | grep '^Active:' >> ${REPORT_FILE}

#-------------------- Inspection Report Summary --------------------
log_info "=========================================="
log_info "Inspection Summary:"
log_info "  Error count: ${ERROR_COUNT}"
log_info "  Warning count: ${WARN_COUNT}"
log_info "  Report file: ${REPORT_FILE}"
log_info "=========================================="

# Send email (if there are warnings or errors)
if [ ${ERROR_COUNT} -gt 0 ] || [ ${WARN_COUNT} -gt 0 ]; then
    MAIL_SUBJECT="[Oracle Inspection-Alert] $(hostname) - ERR:${ERROR_COUNT} WARN:${WARN_COUNT}"
    cat ${REPORT_FILE} | mailx -s "${MAIL_SUBJECT}" ${MAIL_TO}
    log_info "Inspection report sent to ${MAIL_TO}"
else
    MAIL_SUBJECT="[Oracle Inspection-Normal] $(hostname) - $(date +%Y%m%d)"
    cat ${REPORT_FILE} | mailx -s "${MAIL_SUBJECT}" ${MAIL_TO}
    log_info "Inspection normal, report sent"
fi

# Clean up reports older than 30 days
find ${REPORT_DIR} -name "daily_check_*.log" -mtime +30 -delete
find ${REPORT_DIR} -name "alert_*.log" -mtime +30 -delete

exit 0
```

**Script Usage Instructions**:

1. Modify the environment variables at the top of the script (`ORACLE_HOME`, database connection info, email address, etc.)
2. Adjust alert thresholds based on actual conditions
3. Grant execute permission: `chmod +x oracle_daily_check.sh`
4. Manual test: `./oracle_daily_check.sh`

### 3.2 Python Inspection Script

While Shell scripts are lightweight, they fall short in generating polished reports and handling complex logic. The Python script below implements more comprehensive inspection functionality, including HTML report generation, multi-instance support, and historical data storage:

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Oracle Database Daily Inspection Script (Python Version)
Features: Multi-instance inspection, HTML reports, email sending, historical data storage
Author: OCM DBA @ 4dba.top
Date: 2026-06-10
"""

import os
import sys
import json
import logging
import smtplib
from datetime import datetime, timedelta
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.base import MIMEBase
from email import encoders
from dataclasses import dataclass, field
from typing import List, Dict, Optional

try:
    import oracledb
except ImportError:
    print("Please install oracledb first: pip install oracledb")
    sys.exit(1)

# -------------------- Configuration --------------------

# Database instance list
DB_INSTANCES = [
    {
        "name": "PROD1",
        "host": "192.168.1.100",
        "port": 1521,
        "service": "PRODDB",
        "user": "sys",
        "password": "your_password",
        "role": "SYSDBA",
    },
    {
        "name": "PROD2",
        "host": "192.168.1.101",
        "port": 1521,
        "service": "PRODDB2",
        "user": "sys",
        "password": "your_password",
        "role": "SYSDBA",
    },
    {
        "name": "TEST1",
        "host": "192.168.1.200",
        "port": 1521,
        "service": "TESTDB",
        "user": "sys",
        "password": "your_password",
        "role": "SYSDBA",
    },
]

# Alert threshold configuration
THRESHOLDS = {
    "tablespace_warn": 85,       # Tablespace usage warning (%)
    "tablespace_crit": 95,       # Tablespace usage critical (%)
    "asm_warn": 80,              # ASM disk group usage warning (%)
    "session_warn": 80,          # Session count percentage warning (%)
    "arch_count_warn": 200,      # Archived log count warning
    "long_txn_hours": 1,         # Long transaction threshold (hours)
}

# Email configuration
MAIL_CONFIG = {
    "smtp_server": "smtp.4dba.top",
    "smtp_port": 465,
    "smtp_ssl": True,
    "username": "alert@4dba.top",
    "password": "smtp_password",
    "from_addr": "alert@4dba.top",
    "to_addrs": ["dba-team@4dba.top"],
}

# Report output directory
REPORT_DIR = "/home/oracle/dba/scripts/reports"
HISTORY_DB = "/home/oracle/dba/scripts/data/history.db"

# Logging configuration
logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)


# -------------------- Data Structures --------------------

@dataclass
class CheckResult:
    """Single check result"""
    category: str
    item: str
    status: str  # OK / WARN / ERROR / CRITICAL
    message: str
    details: Optional[str] = None
    timestamp: str = field(default_factory=lambda: datetime.now().strftime("%Y-%m-%d %H:%M:%S"))


@dataclass
class InstanceReport:
    """Single instance inspection report"""
    instance_name: str
    host: str
    check_time: str
    results: List[CheckResult] = field(default_factory=list)
    connected: bool = False

    @property
    def error_count(self) -> int:
        return sum(1 for r in self.results if r.status in ("ERROR", "CRITICAL"))

    @property
    def warn_count(self) -> int:
        return sum(1 for r in self.results if r.status == "WARN")

    @property
    def ok_count(self) -> int:
        return sum(1 for r in self.results if r.status == "OK")


# -------------------- Database Connection --------------------

class OracleChecker:
    """Oracle inspection class"""

    def __init__(self, instance_config: dict):
        self.config = instance_config
        self.name = instance_config["name"]
        self.conn = None
        self.report = InstanceReport(
            instance_name=self.name,
            host=instance_config["host"],
            check_time=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        )

    def connect(self) -> bool:
        """Connect to database"""
        try:
            dsn = oracledb.makedsn(
                self.config["host"],
                self.config["port"],
                service_name=self.config["service"],
            )
            self.conn = oracledb.connect(
                user=self.config["user"],
                password=self.config["password"],
                dsn=dsn,
                mode=oracledb.SYSDBA if self.config.get("role") == "SYSDBA" else 0,
            )
            self.report.connected = True
            logger.info(f"[{self.name}] Database connection successful")
            return True
        except Exception as e:
            logger.error(f"[{self.name}] Database connection failed: {e}")
            self.report.results.append(CheckResult(
                category="Connection Status",
                item="Database Connection",
                status="CRITICAL",
                message=f"Unable to connect to database: {str(e)}",
            ))
            return False

    def disconnect(self):
        """Disconnect from database"""
        if self.conn:
            try:
                self.conn.close()
            except Exception:
                pass

    def _query(self, sql: str, fetchall: bool = True):
        """Execute query and return results"""
        try:
            cursor = self.conn.cursor()
            cursor.execute(sql)
            if fetchall:
                columns = [desc[0] for desc in cursor.description]
                rows = cursor.fetchall()
                return columns, rows
            else:
                return cursor.fetchone()
        except Exception as e:
            logger.error(f"[{self.name}] SQL execution failed: {e}")
            return None, None

    def check_instance_status(self):
        """Check instance status"""
        logger.info(f"[{self.name}] Checking instance status...")
        cols, rows = self._query("""
            SELECT INSTANCE_NAME, HOST_NAME, VERSION, STATUS, 
                   DATABASE_STATUS, TO_CHAR(STARTUP_TIME, 'YYYY-MM-DD HH24:MI:SS') AS STARTUP_TIME
            FROM V$INSTANCE
        """)
        if rows:
            row = rows[0]
            status = row[3]
            if status == "OPEN":
                self.report.results.append(CheckResult(
                    category="Instance Status",
                    item="Database Instance",
                    status="OK",
                    message=f"Instance {row[0]} status normal (OPEN)",
                    details=f"Version: {row[2]}, Host: {row[1]}, Startup Time: {row[5]}",
                ))
            else:
                self.report.results.append(CheckResult(
                    category="Instance Status",
                    item="Database Instance",
                    status="ERROR",
                    message=f"Instance status abnormal: {status}",
                ))

    def check_tablespace(self):
        """Check tablespace usage"""
        logger.info(f"[{self.name}] Checking tablespace usage...")
        cols, rows = self._query("""
            SELECT 
                a.tablespace_name,
                ROUND(a.total_mb, 2) AS total_mb,
                ROUND(a.total_mb - NVL(b.free_mb, 0), 2) AS used_mb,
                ROUND(NVL(b.free_mb, 0), 2) AS free_mb,
                ROUND((a.total_mb - NVL(b.free_mb, 0)) / a.total_mb * 100, 2) AS used_pct
            FROM (
                SELECT tablespace_name, SUM(bytes) / 1024 / 1024 AS total_mb
                FROM dba_data_files
                GROUP BY tablespace_name
            ) a
            LEFT JOIN (
                SELECT tablespace_name, SUM(bytes) / 1024 / 1024 AS free_mb
                FROM dba_free_space
                GROUP BY tablespace_name
            ) b ON a.tablespace_name = b.tablespace_name
            ORDER BY used_pct DESC
        """)
        if rows:
            for row in rows:
                ts_name, total, used, free, pct = row
                if pct >= THRESHOLDS["tablespace_crit"]:
                    status = "CRITICAL"
                elif pct >= THRESHOLDS["tablespace_warn"]:
                    status = "WARN"
                else:
                    status = "OK"
                self.report.results.append(CheckResult(
                    category="Space Management",
                    item=f"Tablespace {ts_name}",
                    status=status,
                    message=f"Usage {pct}% (Total {total}MB, Used {used}MB)",
                ))

    def check_asm_diskgroup(self):
        """Check ASM disk groups"""
        logger.info(f"[{self.name}] Checking ASM disk groups...")
        cols, rows = self._query("""
            SELECT NAME, STATE, 
                   ROUND(TOTAL_MB/1024, 2) AS total_gb,
                   ROUND(FREE_MB/1024, 2) AS free_gb,
                   ROUND((TOTAL_MB - FREE_MB) / TOTAL_MB * 100, 2) AS used_pct
            FROM V$ASM_DISKGROUP
        """)
        if rows:
            for row in rows:
                dg_name, state, total, free, pct = row
                if pct >= THRESHOLDS["asm_warn"]:
                    status = "WARN"
                else:
                    status = "OK"
                self.report.results.append(CheckResult(
                    category="Space Management",
                    item=f"ASM Disk Group {dg_name}",
                    status=status,
                    message=f"State: {state}, Usage {pct}% (Total {total}GB, Free {free}GB)",
                ))
        else:
            logger.info(f"[{self.name}] No ASM disk groups detected")

    def check_backup_status(self):
        """Check RMAN backup status"""
        logger.info(f"[{self.name}] Checking RMAN backup status...")
        cols, rows = self._query("""
            SELECT TO_CHAR(START_TIME, 'YYYY-MM-DD HH24:MI:SS') AS start_time,
                   STATUS, INPUT_TYPE,
                   INPUT_BYTES_DISPLAY, TIME_TAKEN_DISPLAY
            FROM V$RMAN_BACKUP_JOB_DETAILS
            WHERE START_TIME > SYSDATE - 2
            ORDER BY START_TIME DESC
        """)
        if rows:
            # Check most recent backup
            latest = rows[0]
            if latest[1] == "COMPLETED":
                self.report.results.append(CheckResult(
                    category="Backup Status",
                    item="RMAN Backup",
                    status="OK",
                    message=f"Latest backup successful ({latest[2]})",
                    details=f"Time: {latest[0]}, Size: {latest[3]}, Duration: {latest[4]}",
                ))
            else:
                self.report.results.append(CheckResult(
                    category="Backup Status",
                    item="RMAN Backup",
                    status="ERROR",
                    message=f"Latest backup status abnormal: {latest[1]}",
                    details=f"Time: {latest[0]}, Type: {latest[2]}",
                ))
            # Output detailed backup history
            details = "\n".join([
                f"  {r[0]} | {r[1]} | {r[2]} | {r[3]} | {r[4]}" for r in rows
            ])
            logger.info(f"[{self.name}] Backup history:\n{details}")
        else:
            self.report.results.append(CheckResult(
                category="Backup Status",
                item="RMAN Backup",
                status="WARN",
                message="No backup records in the last 2 days",
            ))

    def check_archive_log(self):
        """Check archived log generation rate"""
        logger.info(f"[{self.name}] Checking archived logs...")
        cols, rows = self._query("""
            SELECT COUNT(*) AS cnt,
                   ROUND(NVL(SUM(BLOCKS * BLOCK_SIZE) / 1024 / 1024, 0), 2) AS size_mb
            FROM V$ARCHIVED_LOG
            WHERE FIRST_TIME > SYSDATE - 1
            AND DEST_ID = 1
        """)
        if rows:
            cnt, size_mb = rows[0]
            if cnt > THRESHOLDS["arch_count_warn"]:
                status = "WARN"
            else:
                status = "OK"
            self.report.results.append(CheckResult(
                category="Archived Logs",
                item="Archive Generation Rate",
                status=status,
                message=f"Past 24 hours: {cnt} files, {size_mb} MB",
            ))

    def check_alert_log(self):
        """Check ORA- errors in alert log"""
        logger.info(f"[{self.name}] Checking alert log...")
        # Query V$DIAG_ALERT_EXT for recent ORA- errors
        # Note: Requires Oracle 11g+ ADR
        cols, rows = self._query("""
            SELECT MESSAGE_TEXT 
            FROM V$DIAG_ALERT_EXT
            WHERE ORIGINATING_TIMESTAMP > SYSTIMESTAMP - INTERVAL '1' DAY
            AND MESSAGE_TEXT LIKE '%ORA-%'
            AND MESSAGE_TEXT NOT LIKE '%ORA-00000%'
            ORDER BY ORIGINATING_TIMESTAMP DESC
        """)
        if rows:
            ora_errors = [r[0][:200] for r in rows[:20]]
            # Check for severe errors
            critical = [e for e in ora_errors if "ORA-600" in e or "ORA-7445" in e]
            if critical:
                self.report.results.append(CheckResult(
                    category="Alert Log",
                    item="Severe Errors",
                    status="CRITICAL",
                    message=f"Found {len(critical)} severe internal errors",
                    details="\n".join(critical[:5]),
                ))
            self.report.results.append(CheckResult(
                category="Alert Log",
                item="ORA- Errors",
                status="WARN" if len(rows) > 10 else "OK",
                message=f"Past 24 hours: {len(rows)} ORA- errors",
                details="\n".join(ora_errors[:5]),
            ))
        else:
            self.report.results.append(CheckResult(
                category="Alert Log",
                item="ORA- Errors",
                status="OK",
                message="No ORA- errors in the past 24 hours",
            ))

    def check_sessions(self):
        """Check session count"""
        logger.info(f"[{self.name}] Checking session count...")
        cols, rows = self._query("""
            SELECT 
                (SELECT COUNT(*) FROM V$SESSION WHERE STATUS = 'ACTIVE' AND TYPE = 'USER') AS active,
                (SELECT COUNT(*) FROM V$SESSION WHERE STATUS = 'INACTIVE' AND TYPE = 'USER') AS inactive,
                (SELECT COUNT(*) FROM V$SESSION WHERE TYPE = 'USER') AS total,
                (SELECT TO_NUMBER(VALUE) FROM V$PARAMETER WHERE NAME = 'sessions') AS max_sessions
            FROM DUAL
        """)
        if rows:
            active, inactive, total, max_sessions = rows[0]
            pct = round(total / max_sessions * 100, 1) if max_sessions else 0
            status = "WARN" if pct >= THRESHOLDS["session_warn"] else "OK"
            self.report.results.append(CheckResult(
                category="Session Info",
                item="Session Statistics",
                status=status,
                message=f"Active: {active}, Idle: {inactive}, Total: {total}/{max_sessions} ({pct}%)",
            ))

    def check_invalid_objects(self):
        """Check invalid objects"""
        logger.info(f"[{self.name}] Checking invalid objects...")
        cols, rows = self._query("""
            SELECT COUNT(*) FROM DBA_OBJECTS WHERE STATUS = 'INVALID'
        """)
        if rows:
            cnt = rows[0][0]
            if cnt > 0:
                self.report.results.append(CheckResult(
                    category="Object Status",
                    item="Invalid Objects",
                    status="WARN",
                    message=f"Found {cnt} invalid objects",
                ))
            else:
                self.report.results.append(CheckResult(
                    category="Object Status",
                    item="Invalid Objects",
                    status="OK",
                    message="No invalid objects",
                ))

    def run_all_checks(self):
        """Run all inspection checks"""
        if not self.connect():
            return self.report

        checks = [
            self.check_instance_status,
            self.check_tablespace,
            self.check_asm_diskgroup,
            self.check_backup_status,
            self.check_archive_log,
            self.check_alert_log,
            self.check_sessions,
            self.check_invalid_objects,
        ]

        for check_func in checks:
            try:
                check_func()
            except Exception as e:
                logger.error(f"[{self.name}] {check_func.__name__} execution failed: {e}")
                self.report.results.append(CheckResult(
                    category="Script Error",
                    item=check_func.__name__,
                    status="ERROR",
                    message=f"Check execution exception: {str(e)}",
                ))

        self.disconnect()
        return self.report


# -------------------- HTML Report Generation --------------------

class ReportGenerator:
    """Report generator"""

    @staticmethod
    def generate_html(reports: List[InstanceReport]) -> str:
        """Generate HTML format report"""
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        total_errors = sum(r.error_count for r in reports)
        total_warns = sum(r.warn_count for r in reports)

        html = f"""<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Oracle Daily Inspection Report</title>
<style>
    body {{ font-family: "Microsoft YaHei", Arial, sans-serif; margin: 20px; background: #f5f5f5; }}
    .container {{ max-width: 1200px; margin: 0 auto; }}
    .header {{ background: #2c3e50; color: white; padding: 20px; border-radius: 8px 8px 0 0; }}
    .header h1 {{ margin: 0; font-size: 24px; }}
    .header .time {{ color: #bdc3c7; margin-top: 8px; }}
    .summary {{ background: white; padding: 20px; border-bottom: 1px solid #ddd; display: flex; gap: 20px; }}
    .summary-item {{ flex: 1; text-align: center; padding: 15px; border-radius: 8px; }}
    .summary-item.ok {{ background: #d5f4e6; color: #27ae60; }}
    .summary-item.warn {{ background: #fef9e7; color: #f39c12; }}
    .summary-item.error {{ background: #fadbd8; color: #e74c3c; }}
    .summary-item h3 {{ margin: 0; font-size: 32px; }}
    .summary-item p {{ margin: 5px 0 0 0; font-size: 14px; }}
    .instance {{ background: white; margin: 20px 0; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }}
    .instance-header {{ background: #34495e; color: white; padding: 15px 20px; font-size: 18px; }}
    .instance-header .host {{ color: #bdc3c7; font-size: 14px; }}
    table {{ width: 100%; border-collapse: collapse; }}
    th {{ background: #ecf0f1; padding: 12px 15px; text-align: left; font-size: 14px; }}
    td {{ padding: 10px 15px; border-bottom: 1px solid #ecf0f1; font-size: 13px; }}
    tr:hover {{ background: #f8f9fa; }}
    .status-ok {{ color: #27ae60; font-weight: bold; }}
    .status-warn {{ color: #f39c12; font-weight: bold; }}
    .status-error {{ color: #e74c3c; font-weight: bold; }}
    .status-critical {{ color: #c0392b; font-weight: bold; background: #fadbd8; }}
    .details {{ color: #7f8c8d; font-size: 12px; margin-top: 4px; }}
    .footer {{ text-align: center; padding: 20px; color: #95a5a6; font-size: 12px; }}
</style>
</head>
<body>
<div class="container">
<div class="header">
    <h1>Oracle Database Daily Inspection Report</h1>
    <div class="time">Inspection Time: {now} | Instance Count: {len(reports)}</div>
</div>
<div class="summary">
    <div class="summary-item {'error' if total_errors > 0 else 'ok'}">
        <h3>{total_errors}</h3>
        <p>Errors</p>
    </div>
    <div class="summary-item {'warn' if total_warns > 0 else 'ok'}">
        <h3>{total_warns}</h3>
        <p>Warnings</p>
    </div>
    <div class="summary-item ok">
        <h3>{len(reports)}</h3>
        <p>Instances</p>
    </div>
</div>
"""
        for report in reports:
            status_color = "error" if report.error_count > 0 else ("warn" if report.warn_count > 0 else "ok")
            html += f"""
<div class="instance">
    <div class="instance-header">
        {report.instance_name} <span class="host">({report.host})</span>
        <span style="float:right" class="status-{status_color}">
            {'Has Alerts' if status_color != 'ok' else 'Normal'}
            - Errors:{report.error_count} Warnings:{report.warn_count}
        </span>
    </div>
    <table>
        <tr><th>Category</th><th>Check Item</th><th>Status</th><th>Result</th></tr>
"""
            for r in report.results:
                status_class = f"status-{r.status.lower()}"
                status_text = {"OK": "✅ Normal", "WARN": "⚠️ Warning", "ERROR": "❌ Error", "CRITICAL": "🔥 Critical"}.get(r.status, r.status)
                details_html = f'<div class="details">{r.details}</div>' if r.details else ''
                html += f"""
        <tr>
            <td>{r.category}</td>
            <td>{r.item}</td>
            <td class="{status_class}">{status_text}</td>
            <td>{r.message}{details_html}</td>
        </tr>
"""
            html += "    </table>\n</div>\n"

        html += f"""
<div class="footer">
    Oracle Inspection Report - Generated at {now} - Powered by Python + oracledb
</div>
</div>
</body>
</html>"""
        return html


# -------------------- Email Sending --------------------

class MailSender:
    """Email sending class"""

    @staticmethod
    def send(subject: str, html_body: str, attachment_path: Optional[str] = None):
        """Send HTML email"""
        cfg = MAIL_CONFIG
        msg = MIMEMultipart()
        msg["From"] = cfg["from_addr"]
        msg["To"] = ", ".join(cfg["to_addrs"])
        msg["Subject"] = subject

        # HTML body
        msg.attach(MIMEText(html_body, "html", "utf-8"))

        # Attachment
        if attachment_path and os.path.exists(attachment_path):
            with open(attachment_path, "rb") as f:
                part = MIMEBase("application", "octet-stream")
                part.set_payload(f.read())
                encoders.encode_base64(part)
                part.add_header(
                    "Content-Disposition",
                    f"attachment; filename=os.path.basename(attachment_path)",
                )
                msg.attach(part)

        try:
            if cfg["smtp_ssl"]:
                server = smtplib.SMTP_SSL(cfg["smtp_server"], cfg["smtp_port"])
            else:
                server = smtplib.SMTP(cfg["smtp_server"], cfg["smtp_port"])
                server.starttls()
            server.login(cfg["username"], cfg["password"])
            server.sendmail(cfg["from_addr"], cfg["to_addrs"], msg.as_string())
            server.quit()
            logger.info(f"Email sent successfully: {subject}")
        except Exception as e:
            logger.error(f"Email sending failed: {e}")


# -------------------- Main Flow --------------------

def main():
    """Main function"""
    logger.info("=" * 60)
    logger.info("Oracle Daily Inspection Started")
    logger.info("=" * 60)

    os.makedirs(REPORT_DIR, exist_ok=True)
    reports = []

    # Inspect each instance
    for instance_cfg in DB_INSTANCES:
        logger.info(f"--- Starting inspection: {instance_cfg['name']} ---")
        checker = OracleChecker(instance_cfg)
        report = checker.run_all_checks()
        reports.append(report)

    # Generate HTML report
    html = ReportGenerator.generate_html(reports)
    report_file = os.path.join(
        REPORT_DIR, f"daily_check_{datetime.now().strftime('%Y%m%d_%H%M%S')}.html"
    )
    with open(report_file, "w", encoding="utf-8") as f:
        f.write(html)
    logger.info(f"HTML report generated: {report_file}")

    # Save historical data (JSON)
    history_file = os.path.join(
        REPORT_DIR, f"history_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    )
    history_data = []
    for report in reports:
        instance_data = {
            "instance": report.instance_name,
            "host": report.host,
            "time": report.check_time,
            "errors": report.error_count,
            "warnings": report.warn_count,
            "checks": [
                {
                    "category": r.category,
                    "item": r.item,
                    "status": r.status,
                    "message": r.message,
                }
                for r in report.results
            ],
        }
        history_data.append(instance_data)
    with open(history_file, "w", encoding="utf-8") as f:
        json.dump(history_data, f, ensure_ascii=False, indent=2)
    logger.info(f"Historical data saved: {history_file}")

    # Send email
    total_errors = sum(r.error_count for r in reports)
    total_warns = sum(r.warn_count for r in reports)

    if total_errors > 0 or total_warns > 0:
        subject = f"[Oracle Inspection-Alert] ERR:{total_errors} WARN:{total_warns} - {datetime.now().strftime('%Y%m%d')}"
    else:
        subject = f"[Oracle Inspection-Normal] {datetime.now().strftime('%Y%m%d')}"

    MailSender.send(subject, html, report_file)

    # Clean up reports older than 30 days
    cutoff = datetime.now() - timedelta(days=30)
    for f_name in os.listdir(REPORT_DIR):
        f_path = os.path.join(REPORT_DIR, f_name)
        if os.path.isfile(f_path):
            f_mtime = datetime.fromtimestamp(os.path.getmtime(f_path))
            if f_mtime < cutoff:
                os.remove(f_path)
                logger.info(f"Cleaned up expired file: {f_name}")

    logger.info("=" * 60)
    logger.info("Oracle Daily Inspection Complete")
    logger.info(f"Total Errors: {total_errors}, Total Warnings: {total_warns}")
    logger.info("=" * 60)


if __name__ == "__main__":
    main()
```

**Script Usage Instructions**:

1. Install dependencies: `pip install oracledb`
2. Modify `DB_INSTANCES` with actual database connection information
3. Modify `MAIL_CONFIG` with email server configuration
4. Run: `python3 oracle_daily_check.py`

### 3.3 crontab Configuration

Configure the inspection script as a scheduled task for automated execution:

```bash
# Edit crontab
crontab -e

# Execute Shell inspection daily at 8:00 AM
0 8 * * * /home/oracle/dba/scripts/oracle_daily_check.sh >> /home/oracle/dba/scripts/logs/cron.log 2>&1

# Execute Python inspection daily at 8:30 AM (generates complete report)
30 8 * * * /home/oracle/dba/scripts/oracle_daily_check.py >> /home/oracle/dba/scripts/logs/cron_py.log 2>&1

# Quick check every 4 hours (only checks tablespaces and instance status)
0 */4 * * * /home/oracle/dba/scripts/oracle_quick_check.sh >> /home/oracle/dba/scripts/logs/quick_check.log 2>&1

# Log rotation configuration (via logrotate)
# /etc/logrotate.d/oracle_check
# /home/oracle/dba/scripts/logs/*.log {
#     daily
#     rotate 30
#     compress
#     missingok
#     notifempty
# }
```

**Alert Frequency Control**: To avoid "alert fatigue" from frequent notifications, recommendations include:

1. **Tiered alerting**: Severe errors (CRITICAL) trigger immediate notification; general warnings (WARN) are aggregated into daily reports
2. **Alert convergence**: The same error only triggers an alert once within a given time period, implementable via flag files:

```bash
# Add alert convergence logic to Shell script
ALERT_FLAG_DIR="/home/oracle/dba/scripts/alert_flags"
mkdir -p ${ALERT_FLAG_DIR}

# Check if already alerted
check_alert_suppressed() {
    local alert_key="$1"
    local flag_file="${ALERT_FLAG_DIR}/${alert_key}.flag"
    if [ -f "${flag_file}" ]; then
        local flag_time=$(stat -c %Y "${flag_file}")
        local now=$(date +%s)
        local diff=$((now - flag_time))
        # No repeat alert within 4 hours
        if [ ${diff} -lt 14400 ]; then
            return 0  # Already alerted, suppress
        fi
    fi
    # Create alert flag
    touch "${flag_file}"
    return 1  # Alert needed
}
```

## 4. Result Verification

### 4.1 Script Test Run

Before formal deployment, thoroughly verify in the test environment:

```bash
# Shell script test
$ chmod +x oracle_daily_check.sh
$ ./oracle_daily_check.sh

# Expected output example
[2026-06-10 08:00:01] [INFO] ========== 1. Instance Status Check ==========
[2026-06-10 08:00:02] [INFO] Instance status: OPEN - Normal
[2026-06-10 08:00:03] [INFO] ========== 3. Tablespace Usage Check ==========
[2026-06-10 08:00:05] [WARN] Tablespace USERS usage 87.32% exceeds warning threshold 85%
[2026-06-10 08:00:06] [INFO] ========== 7. RMAN Backup Status Check ==========
[2026-06-10 08:00:07] [INFO] Last RMAN backup status: Success
[2026-06-10 08:00:08] [INFO] ==========================================
[2026-06-10 08:00:08] [INFO] Inspection Summary:
[2026-06-10 08:00:08] [INFO]   Error count: 0
[2026-06-10 08:00:08] [INFO]   Warning count: 1
```

### 4.2 Email Receipt Verification

Confirm emails can be received normally; check the following:

1. Whether the email subject contains the inspection result summary
2. Whether the HTML report format is correct
3. Whether alert items are correctly highlighted
4. Whether attachments work properly

### 4.3 Alert Trigger Verification

Simulate anomaly scenarios to verify alerts trigger correctly:

```bash
# Simulate tablespace usage exceeding threshold
# Create a large tablespace and fill it with data to verify alert triggering
# Clean up after testing

# Verify alert convergence mechanism
# Run the script twice consecutively, confirm the second run doesn't repeat the alert
```

## 5. Lessons Learned

### 5.1 Customization of Inspection Metrics

Different business scenarios have different requirements for inspection metrics:

- **OLTP systems**: Focus on active session count, lock waits, archived log generation rate
- **OLAP systems**: Focus on tablespace usage (large tables grow fast), temporary tablespace
- **RAC environments**: Need to check instance status and load balancing across all nodes
- **Data Guard environments**: Need to check primary-standby sync delay and archived log transport status

It is recommended to add configuration file support in scripts to flexibly adjust inspection items and thresholds per instance.

### 5.2 False Positive Handling Strategy

The most common issue with automated inspection is **false positives**; handling strategies include:

1. **Baseline comparison**: Instead of fixed thresholds, compare against historical baselines. For example, if tablespace usage is normally 80%, only alert when it suddenly rises to 85%
2. **Alert escalation**: First alert is INFO level; persistent issues escalate to WARN/ERROR
3. **Whitelist mechanism**: Certain known invalid objects or specific ORA- errors can be added to a whitelist
4. **Alert acknowledgment**: After an alert is sent, wait for DBA acknowledgment; unacknowledged alerts automatically escalate

### 5.3 Integration with Existing Monitoring Systems

Automated inspection scripts should not run in isolation; integration with existing monitoring systems is recommended:

- **Zabbix/Prometheus**: Push inspection results as metrics, leveraging existing alert channels
- **CMDB**: Automatically sync database instance information discovered during inspection to CMDB
- **Ticketing system**: Alerts automatically generate tickets to track resolution progress
- **WeChat Work/DingTalk**: Push alerts to enterprise instant messaging tools for faster response

The typical integration approach is to write inspection script output to a standardized interface (such as JSON files or REST API) for downstream systems to consume.

---

**Summary**: A comprehensive Oracle automated inspection solution is not only an efficiency tool for DBAs but also a cornerstone of database operations standardization. Starting from lightweight Shell scripts, gradually evolving to complete Python solutions, and then integrating with monitoring systems — each stage has its value. The key is to choose the right implementation approach based on actual environment needs and continuously optimize inspection metrics and alert strategies.

I hope the scripts and solutions in this article are helpful to you. If you have questions or suggestions, feel free to discuss in the comments.
