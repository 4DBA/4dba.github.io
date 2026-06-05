---
title: Python/Shell 自动巡检脚本：覆盖表空间、告警日志、备份状态的日常巡检方案
date: 2026-05-15 10:00:00
categories: Oracle
tags: [自动巡检, Python, Shell, 监控, crontab, 邮件告警]
---

## 一、问题背景

作为一名 Oracle DBA，**日常巡检**是最基础也是最重要的工作职责之一。无论是生产环境还是测试环境，每天登录数据库检查实例状态、表空间使用率、备份完成情况、告警日志中的错误信息，这些都是确保数据库稳定运行的基本保障。

然而，手工巡检存在几个明显的痛点：

1. **效率低下**：管理的数据库实例越多，每天花费在巡检上的时间就越长。假设管理 20 个实例，每个实例巡检 10 分钟，一天仅巡检就要 3 个多小时。
2. **容易遗漏**：人工操作难免疲劳，尤其在节假日值班时，某些检查项可能被跳过。
3. **缺乏历史记录**：手工巡检的结果难以标准化存储，无法进行趋势分析。
4. **响应滞后**：问题往往在巡检时才发现，无法做到实时或准实时告警。

**自动巡检的价值**在于：

- **标准化**：所有检查项固定，不会遗漏
- **可追溯**：巡检结果自动存储，支持历史对比
- **告警前置**：发现异常立即发送邮件/短信通知
- **释放人力**：DBA 可以将精力集中在更有价值的工作上

本文将介绍一套完整的 Oracle 自动巡检方案，涵盖 Shell 脚本和 Python 脚本两种实现，覆盖实例状态、表空间、ASM 磁盘组、告警日志、备份状态、归档日志等核心检查项。

<!-- more -->

## 二、理论分析

### 2.1 巡检指标体系

一套完善的 Oracle 日常巡检应覆盖以下五个维度：

| 维度 | 检查项 | 告警阈值 |
|------|--------|----------|
| 实例状态 | 数据库实例、监听状态 | 实例 DOWN / 监听异常 |
| 空间管理 | 表空间使用率、ASM 磁盘组使用率 | 表空间 > 85%，ASM > 80% |
| 备份状态 | RMAN 备份是否成功、备份集大小 | 最近一次备份超过 24 小时 |
| 性能指标 | TOP SQL、等待事件、活跃会话数 | 活跃会话 > 阈值、异常等待事件 |
| 告警日志 | ORA- 错误、ORA-600/7445 等严重错误 | 出现严重错误 |

### 2.2 技术选型

在实现自动巡检脚本时，常见的选择有 Shell、Python 和 Perl 三种：

- **Shell**：轻量、无需额外依赖，适合快速实现简单的 SQL 检查。通过 `sqlplus -s` 执行 SQL 并解析输出即可。缺点是处理复杂逻辑和格式化输出不够灵活。
- **Python**：功能强大，生态丰富。配合 `oracledb`（原 `cx_Oracle` 的继任者）库可以方便地连接数据库、处理结果集。支持生成 HTML 报告、发送邮件、存储历史数据等高级功能。
- **Perl**：在传统 Oracle DBA 中使用广泛，但近年来逐渐被 Python 替代。

**推荐方案**：Shell 脚本用于快速轻量巡检，Python 脚本用于生成完整报告和邮件告警。

邮件发送方面：
- Shell 中使用 `mailx` 命令（需配置 SMTP）
- Python 中使用 `smtplib` 标准库

## 三、实战操作

### 3.1 Shell 巡检脚本

以下是完整的 Shell 巡检脚本，覆盖实例状态、表空间使用率、ASM 磁盘组、告警日志错误、归档日志生成速率等核心检查项：

```bash
#!/bin/bash
#============================================================
# 脚本名称: oracle_daily_check.sh
# 功能描述: Oracle 数据库日常巡检脚本
# 适用平台: Linux / AIX / Solaris
# 作者: OCM DBA @ 4dba.top
# 创建日期: 2026-06-10
#============================================================

#-------------------- 环境变量 --------------------
export ORACLE_HOME=/u01/app/oracle/product/19c/dbhome_1
export PATH=$ORACLE_HOME/bin:$PATH
export LD_LIBRARY_PATH=$ORACLE_HOME/lib:$LD_LIBRARY_PATH

#-------------------- 配置区域 --------------------
DB_USER="sys"
DB_PASS="your_password"
DB_ROLE="as sysdba"
DB_HOST="localhost"
DB_PORT="1521"
DB_SERVICE="ORCL"

# 告警阈值
TABLESPACE_WARN=85    # 表空间使用率告警阈值(%)
TABLESPACE_CRIT=95    # 表空间使用率严重告警阈值(%)
ASM_WARN=80           # ASM 磁盘组使用率告警阈值(%)

# 邮件配置
MAIL_TO="dba-team@4dba.top"
MAIL_SUBJECT="[Oracle巡检] $(hostname) - $(date +%Y%m%d)"

# 巡检报告
REPORT_DIR="/home/oracle/dba/scripts/reports"
REPORT_FILE="${REPORT_DIR}/daily_check_$(date +%Y%m%d_%H%M%S).log"
ALERT_FILE="${REPORT_DIR}/alert_$(date +%Y%m%d_%H%M%S).log"

# 告警日志路径
ALERT_LOG_DIR="$ORACLE_BASE/diag/rdbms/orcl/ORCL/trace"
ALERT_LOG="${ALERT_LOG_DIR}/alert_ORCL.log"

#-------------------- 初始化 --------------------
mkdir -p ${REPORT_DIR}
> ${ALERT_FILE}

# 计数器
ERROR_COUNT=0
WARN_COUNT=0

#-------------------- 辅助函数 --------------------
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

# 执行 SQL 的封装函数
run_sql() {
    local sql_stmt="$1"
    echo "${sql_stmt}" | sqlplus -s / as sysdba 2>/dev/null
}

# 带连接字符串的 SQL 执行
run_sql_remote() {
    local sql_stmt="$1"
    echo "${sql_stmt}" | sqlplus -s ${DB_USER}/${DB_PASS}@${DB_HOST}:${DB_PORT}/${DB_SERVICE} as ${DB_ROLE} 2>/dev/null
}

#-------------------- 1. 实例状态检查 --------------------
log_info "========== 1. 实例状态检查 =========="

# 检查实例是否运行
INSTANCE_STATUS=$(run_sql "
    SELECT STATUS FROM V\$INSTANCE;
" | grep -E 'OPEN|MOUNTED' | tr -d '[:space:]')

if [ "${INSTANCE_STATUS}" = "OPEN" ]; then
    log_info "实例状态: OPEN - 正常"
else
    log_error "实例状态异常: ${INSTANCE_STATUS}"
fi

# 获取实例基本信息
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

#-------------------- 2. 监听状态检查 --------------------
log_info "========== 2. 监听状态检查 =========="

LSNR_STATUS=$(lsnrctl status 2>&1)
if echo "${LSNR_STATUS}" | grep -q "no listener"; then
    log_error "监听未运行!"
else
    LISTENER_NAME=$(echo "${LSNR_STATUS}" | grep "Alias" | awk '{print $NF}')
    log_info "监听 ${LISTENER_NAME} 运行正常"
fi

#-------------------- 3. 表空间使用率检查 --------------------
log_info "========== 3. 表空间使用率检查 =========="

run_sql "
    SET LINESIZE 200
    SET PAGESIZE 200
    COL TABLESPACE_NAME FORMAT A25
    COL "Used%" FORMAT 999.99
    COL "MaxUsed%" FORMAT 999.99
    SELECT 
        a.tablespace_name,
        ROUND(a.total_mb, 2) AS "Total(MB)",
        ROUND(a.total_mb - NVL(b.free_mb, 0), 2) AS "Used(MB)",
        ROUND(NVL(b.free_mb, 0), 2) AS "Free(MB)",
        ROUND((a.total_mb - NVL(b.free_mb, 0)) / a.total_mb * 100, 2) AS "Used%"
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

# 检查是否有表空间超过阈值
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
            log_error "表空间 ${ts_name} 使用率 ${ts_pct}% 超过严重阈值 ${TABLESPACE_CRIT}%!"
        elif (( $(echo "${ts_pct} > ${TABLESPACE_WARN}" | bc -l) )); then
            log_warn "表空间 ${ts_name} 使用率 ${ts_pct}% 超过告警阈值 ${TABLESPACE_WARN}%"
        fi
    done
else
    log_info "所有表空间使用率正常 (阈值: ${TABLESPACE_WARN}%)"
fi

# 检查 TEMP 表空间
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

#-------------------- 4. ASM 磁盘组检查 --------------------
log_info "========== 4. ASM 磁盘组检查 =========="

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

    # 检查 ASM 使用率告警
    OVER_ASM=$(run_sql "
        SET HEADING OFF
        SET FEEDBACK OFF
        SELECT NAME || ':' || ROUND((TOTAL_MB - FREE_MB) / TOTAL_MB * 100, 2)
        FROM V\$ASM_DISKGROUP
        WHERE (TOTAL_MB - FREE_MB) / TOTAL_MB * 100 > ${ASM_WARN};
    ")

    if [ -n "${OVER_ASM}" ]; then
        echo "${OVER_ASM}" | while IFS=: read -r dg_name dg_pct; do
            log_warn "ASM 磁盘组 ${dg_name} 使用率 ${dg_pct}% 超过阈值 ${ASM_WARN}%"
        done
    else
        log_info "所有 ASM 磁盘组使用率正常"
    fi
else
    log_info "未检测到 ASM 磁盘组，跳过此检查项"
fi

#-------------------- 5. 告警日志错误检查 --------------------
log_info "========== 5. 告警日志错误检查 =========="

if [ -f "${ALERT_LOG}" ]; then
    # 检查最近 24 小时内的 ORA- 错误
    RECENT_ERRORS=$(find ${ALERT_LOG_DIR} -name "alert_*.log" -mtime -1 -exec grep -c "ORA-" {} \; 2>/dev/null | paste -sd+ | bc 2>/dev/null || echo "0")

    if [ "${RECENT_ERRORS}" -gt 0 ]; then
        log_warn "最近 24 小时告警日志中发现 ${RECENT_ERRORS} 条 ORA- 错误"

        # 列出严重错误
        CRITICAL_ERRORS=$(grep -E "ORA-600|ORA-7445|ORA-00600|ORA-07445" ${ALERT_LOG} | tail -10)
        if [ -n "${CRITICAL_ERRORS}" ]; then
            log_error "发现严重内部错误:"
            echo "${CRITICAL_ERRORS}" >> ${REPORT_FILE}
        fi

        # 列出最近的普通 ORA- 错误
        log_info "最近 10 条 ORA- 错误:"
        grep "ORA-" ${ALERT_LOG} | tail -10 >> ${REPORT_FILE}
    else
        log_info "最近 24 小时告警日志无 ORA- 错误"
    fi
else
    log_warn "告警日志文件不存在: ${ALERT_LOG}"
fi

#-------------------- 6. 归档日志生成速率 --------------------
log_info "========== 6. 归档日志生成速率 =========="

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
    log_info "过去 24 小时归档日志: ${ARCH_COUNT} 个, 总大小 ${ARCH_SIZE} MB"

    # 归档日志生成过多告警
    if [ "${ARCH_COUNT}" -gt 200 ]; then
        log_warn "归档日志生成数量 ${ARCH_COUNT} 个，可能有大量 DML 操作"
    fi
fi

#-------------------- 7. RMAN 备份状态检查 --------------------
log_info "========== 7. RMAN 备份状态检查 =========="

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

# 检查最近一次备份是否成功
LAST_BACKUP_STATUS=$(run_sql "
    SET HEADING OFF
    SET FEEDBACK OFF
    SELECT STATUS FROM V\$RMAN_BACKUP_JOB_DETAILS
    WHERE START_TIME = (
        SELECT MAX(START_TIME) FROM V\$RMAN_BACKUP_JOB_DETAILS
    );
" | grep -v '^$' | grep -v '^SQL>' | tr -d '[:space:]')

if [ "${LAST_BACKUP_STATUS}" = "COMPLETED" ]; then
    log_info "最近一次 RMAN 备份状态: 成功"
else
    log_error "最近一次 RMAN 备份状态: ${LAST_BACKUP_STATUS}"
fi

#-------------------- 8. 无效对象检查 --------------------
log_info "========== 8. 无效对象检查 =========="

INVALID_COUNT=$(run_sql "
    SET HEADING OFF
    SET FEEDBACK OFF
    SELECT COUNT(*) FROM DBA_OBJECTS WHERE STATUS = 'INVALID';
" | grep -E '^\s*[0-9]+' | tr -d '[:space:]')

if [ "${INVALID_COUNT}" -gt 0 ]; then
    log_warn "存在 ${INVALID_COUNT} 个无效对象"
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
    log_info "无无效对象"
fi

#-------------------- 9. 长事务检查 --------------------
log_info "========== 9. 长事务检查 =========="

LONG_TXN=$(run_sql "
    SET HEADING OFF
    SET FEEDBACK OFF
    SELECT COUNT(*) FROM V\$TRANSACTION
    WHERE SYSDATE - START_DATE > 1/24;
" | grep -E '^\s*[0-9]+' | tr -d '[:space:]')

if [ "${LONG_TXN}" -gt 0 ]; then
    log_warn "存在 ${LONG_TXN} 个运行超过 1 小时的事务"
else
    log_info "无长时间运行的事务"
fi

#-------------------- 10. 会话数检查 --------------------
log_info "========== 10. 会话数检查 =========="

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

#-------------------- 巡检报告汇总 --------------------
log_info "=========================================="
log_info "巡检完成汇总:"
log_info "  错误数量: ${ERROR_COUNT}"
log_info "  告警数量: ${WARN_COUNT}"
log_info "  报告文件: ${REPORT_FILE}"
log_info "=========================================="

# 发送邮件（如果有告警或错误）
if [ ${ERROR_COUNT} -gt 0 ] || [ ${WARN_COUNT} -gt 0 ]; then
    MAIL_SUBJECT="[Oracle巡检-告警] $(hostname) - ERR:${ERROR_COUNT} WARN:${WARN_COUNT}"
    cat ${REPORT_FILE} | mailx -s "${MAIL_SUBJECT}" ${MAIL_TO}
    log_info "巡检报告已发送至 ${MAIL_TO}"
else
    MAIL_SUBJECT="[Oracle巡检-正常] $(hostname) - $(date +%Y%m%d)"
    cat ${REPORT_FILE} | mailx -s "${MAIL_SUBJECT}" ${MAIL_TO}
    log_info "巡检正常，报告已发送"
fi

# 清理 30 天前的报告
find ${REPORT_DIR} -name "daily_check_*.log" -mtime +30 -delete
find ${REPORT_DIR} -name "alert_*.log" -mtime +30 -delete

exit 0
```

**脚本使用说明**：

1. 修改脚本顶部的环境变量（`ORACLE_HOME`、数据库连接信息、邮件地址等）
2. 根据实际情况调整告警阈值
3. 赋予执行权限：`chmod +x oracle_daily_check.sh`
4. 手动测试：`./oracle_daily_check.sh`

### 3.2 Python 巡检脚本

Shell 脚本虽然轻量，但在生成美观报告、处理复杂逻辑方面有所不足。下面的 Python 脚本实现了更完整的巡检功能，包括 HTML 报告生成、多实例支持、历史数据存储等：

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Oracle 数据库日常巡检脚本 (Python 版本)
功能：多实例巡检、HTML报告、邮件发送、历史数据存储
作者：OCM DBA @ 4dba.top
日期：2026-06-10
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
    print("请先安装 oracledb: pip install oracledb")
    sys.exit(1)

# -------------------- 配置区域 --------------------

# 数据库实例列表
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

# 告警阈值配置
THRESHOLDS = {
    "tablespace_warn": 85,       # 表空间使用率告警(%)
    "tablespace_crit": 95,       # 表空间使用率严重告警(%)
    "asm_warn": 80,              # ASM 磁盘组使用率告警(%)
    "session_warn": 80,          # 会话数占最大值百分比告警(%)
    "arch_count_warn": 200,      # 归档日志数量告警
    "long_txn_hours": 1,         # 长事务阈值(小时)
}

# 邮件配置
MAIL_CONFIG = {
    "smtp_server": "smtp.4dba.top",
    "smtp_port": 465,
    "smtp_ssl": True,
    "username": "alert@4dba.top",
    "password": "smtp_password",
    "from_addr": "alert@4dba.top",
    "to_addrs": ["dba-team@4dba.top"],
}

# 报告输出目录
REPORT_DIR = "/home/oracle/dba/scripts/reports"
HISTORY_DB = "/home/oracle/dba/scripts/data/history.db"

# 日志配置
logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)


# -------------------- 数据结构 --------------------

@dataclass
class CheckResult:
    """单项检查结果"""
    category: str
    item: str
    status: str  # OK / WARN / ERROR / CRITICAL
    message: str
    details: Optional[str] = None
    timestamp: str = field(default_factory=lambda: datetime.now().strftime("%Y-%m-%d %H:%M:%S"))


@dataclass
class InstanceReport:
    """单实例巡检报告"""
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


# -------------------- 数据库连接 --------------------

class OracleChecker:
    """Oracle 巡检类"""

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
        """连接数据库"""
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
            logger.info(f"[{self.name}] 数据库连接成功")
            return True
        except Exception as e:
            logger.error(f"[{self.name}] 数据库连接失败: {e}")
            self.report.results.append(CheckResult(
                category="连接状态",
                item="数据库连接",
                status="CRITICAL",
                message=f"无法连接数据库: {str(e)}",
            ))
            return False

    def disconnect(self):
        """断开数据库连接"""
        if self.conn:
            try:
                self.conn.close()
            except Exception:
                pass

    def _query(self, sql: str, fetchall: bool = True):
        """执行查询并返回结果"""
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
            logger.error(f"[{self.name}] SQL 执行失败: {e}")
            return None, None

    def check_instance_status(self):
        """检查实例状态"""
        logger.info(f"[{self.name}] 检查实例状态...")
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
                    category="实例状态",
                    item="数据库实例",
                    status="OK",
                    message=f"实例 {row[0]} 状态正常 (OPEN)",
                    details=f"版本: {row[2]}, 主机: {row[1]}, 启动时间: {row[5]}",
                ))
            else:
                self.report.results.append(CheckResult(
                    category="实例状态",
                    item="数据库实例",
                    status="ERROR",
                    message=f"实例状态异常: {status}",
                ))

    def check_tablespace(self):
        """检查表空间使用率"""
        logger.info(f"[{self.name}] 检查表空间使用率...")
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
                    category="空间管理",
                    item=f"表空间 {ts_name}",
                    status=status,
                    message=f"使用率 {pct}% (总 {total}MB, 已用 {used}MB)",
                ))

    def check_asm_diskgroup(self):
        """检查 ASM 磁盘组"""
        logger.info(f"[{self.name}] 检查 ASM 磁盘组...")
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
                    category="空间管理",
                    item=f"ASM 磁盘组 {dg_name}",
                    status=status,
                    message=f"状态: {state}, 使用率 {pct}% (总 {total}GB, 空闲 {free}GB)",
                ))
        else:
            logger.info(f"[{self.name}] 未检测到 ASM 磁盘组")

    def check_backup_status(self):
        """检查 RMAN 备份状态"""
        logger.info(f"[{self.name}] 检查 RMAN 备份状态...")
        cols, rows = self._query("""
            SELECT TO_CHAR(START_TIME, 'YYYY-MM-DD HH24:MI:SS') AS start_time,
                   STATUS, INPUT_TYPE,
                   INPUT_BYTES_DISPLAY, TIME_TAKEN_DISPLAY
            FROM V$RMAN_BACKUP_JOB_DETAILS
            WHERE START_TIME > SYSDATE - 2
            ORDER BY START_TIME DESC
        """)
        if rows:
            # 检查最近一次备份
            latest = rows[0]
            if latest[1] == "COMPLETED":
                self.report.results.append(CheckResult(
                    category="备份状态",
                    item="RMAN 备份",
                    status="OK",
                    message=f"最近备份成功 ({latest[2]})",
                    details=f"时间: {latest[0]}, 大小: {latest[3]}, 耗时: {latest[4]}",
                ))
            else:
                self.report.results.append(CheckResult(
                    category="备份状态",
                    item="RMAN 备份",
                    status="ERROR",
                    message=f"最近备份状态异常: {latest[1]}",
                    details=f"时间: {latest[0]}, 类型: {latest[2]}",
                ))
            # 输出详细备份历史
            details = "\n".join([
                f"  {r[0]} | {r[1]} | {r[2]} | {r[3]} | {r[4]}" for r in rows
            ])
            logger.info(f"[{self.name}] 备份历史:\n{details}")
        else:
            self.report.results.append(CheckResult(
                category="备份状态",
                item="RMAN 备份",
                status="WARN",
                message="最近 2 天无备份记录",
            ))

    def check_archive_log(self):
        """检查归档日志生成速率"""
        logger.info(f"[{self.name}] 检查归档日志...")
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
                category="归档日志",
                item="归档生成速率",
                status=status,
                message=f"过去 24 小时: {cnt} 个, {size_mb} MB",
            ))

    def check_alert_log(self):
        """检查告警日志中的 ORA- 错误"""
        logger.info(f"[{self.name}] 检查告警日志...")
        # 通过查询 V$DIAG_ALERT_EXT 获取最近的 ORA- 错误
        # 注意：需要 Oracle 11g+ 的 ADR
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
            # 检查是否有严重错误
            critical = [e for e in ora_errors if "ORA-600" in e or "ORA-7445" in e]
            if critical:
                self.report.results.append(CheckResult(
                    category="告警日志",
                    item="严重错误",
                    status="CRITICAL",
                    message=f"发现 {len(critical)} 个严重内部错误",
                    details="\n".join(critical[:5]),
                ))
            self.report.results.append(CheckResult(
                category="告警日志",
                item="ORA- 错误",
                status="WARN" if len(rows) > 10 else "OK",
                message=f"过去 24 小时: {len(rows)} 条 ORA- 错误",
                details="\n".join(ora_errors[:5]),
            ))
        else:
            self.report.results.append(CheckResult(
                category="告警日志",
                item="ORA- 错误",
                status="OK",
                message="过去 24 小时无 ORA- 错误",
            ))

    def check_sessions(self):
        """检查会话数"""
        logger.info(f"[{self.name}] 检查会话数...")
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
                category="会话信息",
                item="会话统计",
                status=status,
                message=f"活跃: {active}, 空闲: {inactive}, 总计: {total}/{max_sessions} ({pct}%)",
            ))

    def check_invalid_objects(self):
        """检查无效对象"""
        logger.info(f"[{self.name}] 检查无效对象...")
        cols, rows = self._query("""
            SELECT COUNT(*) FROM DBA_OBJECTS WHERE STATUS = 'INVALID'
        """)
        if rows:
            cnt = rows[0][0]
            if cnt > 0:
                self.report.results.append(CheckResult(
                    category="对象状态",
                    item="无效对象",
                    status="WARN",
                    message=f"存在 {cnt} 个无效对象",
                ))
            else:
                self.report.results.append(CheckResult(
                    category="对象状态",
                    item="无效对象",
                    status="OK",
                    message="无无效对象",
                ))

    def run_all_checks(self):
        """执行所有巡检项"""
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
                logger.error(f"[{self.name}] {check_func.__name__} 执行失败: {e}")
                self.report.results.append(CheckResult(
                    category="脚本错误",
                    item=check_func.__name__,
                    status="ERROR",
                    message=f"检查执行异常: {str(e)}",
                ))

        self.disconnect()
        return self.report


# -------------------- HTML 报告生成 --------------------

class ReportGenerator:
    """报告生成器"""

    @staticmethod
    def generate_html(reports: List[InstanceReport]) -> str:
        """生成 HTML 格式报告"""
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        total_errors = sum(r.error_count for r in reports)
        total_warns = sum(r.warn_count for r in reports)

        html = f"""<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Oracle 日常巡检报告</title>
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
    <h1>Oracle 数据库日常巡检报告</h1>
    <div class="time">巡检时间: {now} | 实例数量: {len(reports)}</div>
</div>
<div class="summary">
    <div class="summary-item {'error' if total_errors > 0 else 'ok'}">
        <h3>{total_errors}</h3>
        <p>错误</p>
    </div>
    <div class="summary-item {'warn' if total_warns > 0 else 'ok'}">
        <h3>{total_warns}</h3>
        <p>告警</p>
    </div>
    <div class="summary-item ok">
        <h3>{len(reports)}</h3>
        <p>实例</p>
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
            {'有告警' if status_color != 'ok' else '正常'}
            - 错误:{report.error_count} 告警:{report.warn_count}
        </span>
    </div>
    <table>
        <tr><th>分类</th><th>检查项</th><th>状态</th><th>结果</th></tr>
"""
            for r in report.results:
                status_class = f"status-{r.status.lower()}"
                status_text = {"OK": "✅ 正常", "WARN": "⚠️ 告警", "ERROR": "❌ 错误", "CRITICAL": "🔥 严重"}.get(r.status, r.status)
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
    Oracle 巡检报告 - 生成于 {now} - Powered by Python + oracledb
</div>
</div>
</body>
</html>"""
        return html


# -------------------- 邮件发送 --------------------

class MailSender:
    """邮件发送类"""

    @staticmethod
    def send(subject: str, html_body: str, attachment_path: Optional[str] = None):
        """发送 HTML 邮件"""
        cfg = MAIL_CONFIG
        msg = MIMEMultipart()
        msg["From"] = cfg["from_addr"]
        msg["To"] = ", ".join(cfg["to_addrs"])
        msg["Subject"] = subject

        # HTML 正文
        msg.attach(MIMEText(html_body, "html", "utf-8"))

        # 附件
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
            logger.info(f"邮件发送成功: {subject}")
        except Exception as e:
            logger.error(f"邮件发送失败: {e}")


# -------------------- 主流程 --------------------

def main():
    """主函数"""
    logger.info("=" * 60)
    logger.info("Oracle 日常巡检开始")
    logger.info("=" * 60)

    os.makedirs(REPORT_DIR, exist_ok=True)
    reports = []

    # 逐实例巡检
    for instance_cfg in DB_INSTANCES:
        logger.info(f"--- 开始巡检: {instance_cfg['name']} ---")
        checker = OracleChecker(instance_cfg)
        report = checker.run_all_checks()
        reports.append(report)

    # 生成 HTML 报告
    html = ReportGenerator.generate_html(reports)
    report_file = os.path.join(
        REPORT_DIR, f"daily_check_{datetime.now().strftime('%Y%m%d_%H%M%S')}.html"
    )
    with open(report_file, "w", encoding="utf-8") as f:
        f.write(html)
    logger.info(f"HTML 报告已生成: {report_file}")

    # 保存历史数据 (JSON)
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
    logger.info(f"历史数据已保存: {history_file}")

    # 发送邮件
    total_errors = sum(r.error_count for r in reports)
    total_warns = sum(r.warn_count for r in reports)

    if total_errors > 0 or total_warns > 0:
        subject = f"[Oracle巡检-告警] ERR:{total_errors} WARN:{total_warns} - {datetime.now().strftime('%Y%m%d')}"
    else:
        subject = f"[Oracle巡检-正常] {datetime.now().strftime('%Y%m%d')}"

    MailSender.send(subject, html, report_file)

    # 清理 30 天前的报告
    cutoff = datetime.now() - timedelta(days=30)
    for f_name in os.listdir(REPORT_DIR):
        f_path = os.path.join(REPORT_DIR, f_name)
        if os.path.isfile(f_path):
            f_mtime = datetime.fromtimestamp(os.path.getmtime(f_path))
            if f_mtime < cutoff:
                os.remove(f_path)
                logger.info(f"已清理过期文件: {f_name}")

    logger.info("=" * 60)
    logger.info("Oracle 日常巡检完成")
    logger.info(f"总错误: {total_errors}, 总告警: {total_warns}")
    logger.info("=" * 60)


if __name__ == "__main__":
    main()
```

**脚本使用说明**：

1. 安装依赖：`pip install oracledb`
2. 修改 `DB_INSTANCES` 配置实际的数据库连接信息
3. 修改 `MAIL_CONFIG` 配置邮件服务器
4. 运行：`python3 oracle_daily_check.py`

### 3.3 crontab 配置

将巡检脚本配置为定时任务，实现自动化执行：

```bash
# 编辑 crontab
crontab -e

# 每天早上 8:00 执行 Shell 巡检
0 8 * * * /home/oracle/dba/scripts/oracle_daily_check.sh >> /home/oracle/dba/scripts/logs/cron.log 2>&1

# 每天早上 8:30 执行 Python 巡检 (生成完整报告)
30 8 * * * /home/oracle/dba/scripts/oracle_daily_check.py >> /home/oracle/dba/scripts/logs/cron_py.log 2>&1

# 每 4 小时执行一次快速检查 (仅检查表空间和实例状态)
0 */4 * * * /home/oracle/dba/scripts/oracle_quick_check.sh >> /home/oracle/dba/scripts/logs/quick_check.log 2>&1

# 日志轮转配置 (通过 logrotate)
# /etc/logrotate.d/oracle_check
# /home/oracle/dba/scripts/logs/*.log {
#     daily
#     rotate 30
#     compress
#     missingok
#     notifempty
# }
```

**告警频率控制**：为了避免频繁告警造成"告警疲劳"，建议：

1. **分级告警**：严重错误（CRITICAL）立即通知，一般告警（WARN）汇总到日报
2. **告警收敛**：同一错误在一定时间内只告警一次，可以通过标记文件实现：

```bash
# 在 Shell 脚本中增加告警收敛逻辑
ALERT_FLAG_DIR="/home/oracle/dba/scripts/alert_flags"
mkdir -p ${ALERT_FLAG_DIR}

# 检查是否已经告警过
check_alert_suppressed() {
    local alert_key="$1"
    local flag_file="${ALERT_FLAG_DIR}/${alert_key}.flag"
    if [ -f "${flag_file}" ]; then
        local flag_time=$(stat -c %Y "${flag_file}")
        local now=$(date +%s)
        local diff=$((now - flag_time))
        # 4 小时内不重复告警
        if [ ${diff} -lt 14400 ]; then
            return 0  # 已告警，抑制
        fi
    fi
    # 创建告警标记
    touch "${flag_file}"
    return 1  # 需要告警
}
```

## 四、结果验证

### 4.1 脚本测试运行

在正式部署前，务必在测试环境充分验证：

```bash
# Shell 脚本测试
$ chmod +x oracle_daily_check.sh
$ ./oracle_daily_check.sh

# 预期输出示例
[2026-06-10 08:00:01] [INFO] ========== 1. 实例状态检查 ==========
[2026-06-10 08:00:02] [INFO] 实例状态: OPEN - 正常
[2026-06-10 08:00:03] [INFO] ========== 3. 表空间使用率检查 ==========
[2026-06-10 08:00:05] [WARN] 表空间 USERS 使用率 87.32% 超过告警阈值 85%
[2026-06-10 08:00:06] [INFO] ========== 7. RMAN 备份状态检查 ==========
[2026-06-10 08:00:07] [INFO] 最近一次 RMAN 备份状态: 成功
[2026-06-10 08:00:08] [INFO] ==========================================
[2026-06-10 08:00:08] [INFO] 巡检完成汇总:
[2026-06-10 08:00:08] [INFO]   错误数量: 0
[2026-06-10 08:00:08] [INFO]   告警数量: 1
```

### 4.2 邮件接收验证

确认邮件能正常接收，检查以下几点：

1. 邮件标题是否包含巡检结果摘要
2. HTML 报告格式是否正确
3. 告警项是否正确高亮显示
4. 附件是否正常

### 4.3 告警触发验证

模拟异常场景验证告警是否正确触发：

```bash
# 模拟表空间使用率超阈值
# 创建一个大表空间并填充数据，验证告警触发
# 测试完成后清理

# 验证告警收敛机制
# 连续运行两次脚本，确认第二次不重复告警
```

## 五、经验总结

### 5.1 巡检指标的定制化

不同业务场景对巡检指标的要求不同：

- **OLTP 系统**：重点关注活跃会话数、锁等待、归档日志生成速率
- **OLAP 系统**：重点关注表空间使用率（大表增长快）、临时表空间
- **RAC 环境**：需要检查所有节点的实例状态、负载均衡情况
- **Data Guard 环境**：需要检查主备同步延迟、归档日志传输状态

建议在脚本中增加配置文件支持，根据不同实例灵活调整巡检项和阈值。

### 5.2 误报处理策略

自动巡检最常见的问题是**误报**，处理策略包括：

1. **基线对比**：不是用固定阈值，而是与历史基线对比。比如表空间使用率平时就是 80%，突然涨到 85% 才告警
2. **告警升级**：第一次告警为 INFO 级别，持续存在才升级为 WARN/ERROR
3. **白名单机制**：某些已知的无效对象或特定的 ORA- 错误可以加入白名单
4. **告警确认**：告警发出后等待 DBA 确认，未确认的告警自动升级

### 5.3 与现有监控系统集成

自动巡检脚本不应孤立运行，建议与现有监控体系集成：

- **Zabbix/Prometheus**：将巡检结果以 metric 形式推送，利用现有告警通道
- **CMDB**：巡检发现的数据库实例信息自动同步到 CMDB
- **工单系统**：告警自动生成工单，跟踪处理进度
- **企业微信/钉钉**：将告警推送到企业即时通讯工具，提高响应速度

集成方式通常是将巡检脚本的输出结果写入标准化接口（如 JSON 文件或 REST API），由下游系统消费。

---

**总结**：一套完善的 Oracle 自动巡检方案，不仅是 DBA 的效率工具，更是数据库运维标准化的基石。从 Shell 轻量脚本起步，逐步演进到 Python 完整方案，再到与监控体系集成，每个阶段都有其价值。关键是要根据实际环境需求，选择合适的实现方式，并持续优化巡检指标和告警策略。

希望本文的脚本和方案对你有所帮助。如有问题或建议，欢迎在评论区交流。
