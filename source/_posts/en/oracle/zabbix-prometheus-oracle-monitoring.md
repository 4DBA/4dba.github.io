---
title: "Zabbix/Prometheus Oracle Monitoring Customization: Custom Metrics and Visualization"
date: 2026-05-22 10:00:00
categories: Oracle
tags: [Zabbix, Prometheus, Grafana, 监控, UserParameter, 可视化]
lang: en
---

## 1. Background

In enterprise Oracle database operations, monitoring is the first line of defense for business continuity. However, most DBAs encounter this dilemma in their actual work:

**Limitations of Default Monitoring Templates**: Whether it's the Oracle Template provided by the Zabbix community or the default collection items of the official Prometheus Exporter, they cannot cover all monitoring needs in production environments. For example, default templates typically only focus on basic tablespace usage, connection counts, and other generic metrics, while critical indicators like DG synchronization delay, RAC inter-node heartbeat, and specific business SQL execution efficiency often require DBAs to customize.

**Business-Customized Monitoring Needs**: Different business scenarios require different monitoring granularity and dimensions. E-commerce systems focus on concurrent sessions and lock waits, financial systems focus on archive log generation rate and Data Guard delay, while batch processing systems focus more on TOP SQL execution plan changes. One-size-fits-all default templates cannot meet these differentiated needs.

**Value of Visualization for Operations Decisions**: Monitoring is not just about "alerting when problems occur." More importantly, it supports capacity planning, performance optimization, and other proactive operations decisions through historical trend analysis. A well-designed Grafana Dashboard can let a DBA grasp the health status of the entire database cluster within seconds.

This article starts from the two mainstream monitoring platforms, Zabbix and Prometheus, and details Oracle monitoring customization methods, including custom monitoring items, automatic discovery rules, alert triggers, and Grafana visualization Dashboard setup.

## 2. Theoretical Analysis

### 2.1 Zabbix Monitoring Architecture

Zabbix uses a classic three-tier architecture: **Agent → Server → Web**.

- **Agent**: Deployed on monitored hosts, responsible for collecting local data. For Oracle monitoring, Agent calls custom scripts through UserParameter to connect to the database and collect metrics.
- **Server**: Receives data reported by Agents, executes trigger evaluation, alert notification, and other logic.
- **Web**: Provides visualization interface, supporting Dashboard display, configuration management, and other functions.

Zabbix's strength lies in the **UserParameter** mechanism. Through UserParameter, DBAs can register any Shell/Python script as a monitoring item, which is periodically called by the Agent and results reported. This provides great flexibility for Oracle custom monitoring.

Additionally, Zabbix's **Low-Level Discovery (LLD)** feature can automatically discover dynamic objects in the database such as tablespaces and PDBs, avoiding manual one-by-one configuration of monitoring items.

### 2.2 Prometheus + Grafana

Prometheus uses a Pull model, exposing HTTP endpoints through Exporters for the Prometheus Server to pull metric data. For Oracle monitoring, the most commonly used Exporter is **oracledb_exporter** (maintained by the iamseth/oracledb_exporter project).

Prometheus's query language **PromQL** is very powerful, supporting rich aggregation, calculation, and time series operations. For example, a single PromQL can calculate the average archive log generation rate over the past hour:

```promql
rate(oracle_archive_log_generated_bytes_total[1h])
```

**Grafana**, as Prometheus's visualization frontend, provides rich chart types and template variable support. The community has many mature Oracle Dashboard templates (such as Dashboard with ID 3333) that can be quickly imported and customized according to actual needs.

### 2.3 Oracle Monitoring Metrics Classification

In production environments, Oracle monitoring metrics can be classified by level as follows:

| Metric Category | Typical Metrics | Recommended Collection Frequency |
|---------|---------|------------|
| Instance Level | SGA/PGA usage, DB Time, Logical/Physical Reads | 30s ~ 1min |
| Tablespace Level | Usage rate, growth rate, remaining space | 5min |
| SQL Level | TOP SQL Elapsed Time, Buffer Gets, Executions | 5min |
| DG Level | Apply Lag, Transport Lag, Gap Status | 1min |
| RAC Level | Interconnect Traffic, GC Wait, Instance Status | 1min |

Properly classifying metrics helps set differentiated collection frequencies and alert thresholds, avoiding unnecessary performance overhead on the database.

## 3. Practical Operations

### 3.1 Zabbix Custom Monitoring Items

#### 3.1.1 UserParameter Configuration

Define UserParameter in the Zabbix Agent configuration file. Using tablespace usage as an example:

```bash
# /etc/zabbix/zabbix_agentd.d/oracle_tablespace.conf
UserParameter=oracle.tablespace.usage[*],/etc/zabbix/scripts/oracle_tablespace.sh $1 $2

# General Oracle metric collection entry point
UserParameter=oracle.custom.query[*],/etc/zabbix/scripts/oracle_monitor.sh $1 $2
```

#### 3.1.2 Shell Script Implementation

Tablespace usage collection script:

```bash
#!/bin/bash
# /etc/zabbix/scripts/oracle_tablespace.sh
# Usage: oracle_tablespace.sh <ORACLE_SID> <TABLESPACE_NAME>

export ORACLE_HOME=/u01/app/oracle/product/19c/dbhome_1
export ORACLE_SID=$1
export PATH=$ORACLE_HOME/bin:$PATH

TABLESPACE_NAME=$2

sqlplus -S / as sysdba <<EOF | tail -1
SET PAGESIZE 0 FEEDBACK OFF VERIFY OFF HEADING OFF
SELECT ROUND((used.bytes / total.bytes) * 100, 2)
FROM
  (SELECT tablespace_name, SUM(bytes) bytes
   FROM dba_data_files
   WHERE tablespace_name = UPPER('${TABLESPACE_NAME}')
   GROUP BY tablespace_name) total,
  (SELECT tablespace_name, SUM(bytes) bytes
   FROM dba_segments
   WHERE tablespace_name = UPPER('${TABLESPACE_NAME}')
   GROUP BY tablespace_name) used
WHERE total.tablespace_name = used.tablespace_name(+);
EOF
```

General monitoring script supporting multiple metric queries:

```bash
#!/bin/bash
# /etc/zabbix/scripts/oracle_monitor.sh
export ORACLE_HOME=/u01/app/oracle/product/19c/dbhome_1
export ORACLE_SID=$1
export PATH=$ORACLE_HOME/bin:$PATH

METRIC=$2

case "$METRIC" in
  "sessions")
    sqlplus -S / as sysdba <<'EOF' | tail -1
SET PAGESIZE 0 FEEDBACK OFF VERIFY OFF HEADING OFF
SELECT COUNT(*) FROM v\$session WHERE status = 'ACTIVE';
EOF
    ;;
  "archive_rate")
    sqlplus -S / as sysdba <<'EOF' | tail -1
SET PAGESIZE 0 FEEDBACK OFF VERIFY OFF HEADING OFF
SELECT ROUND(SUM(blocks * block_size) / 1024 / 1024, 2)
FROM v\$archived_log
WHERE first_time > SYSDATE - 1/24
AND dest_id = 1;
EOF
    ;;
  "dg_lag")
    sqlplus -S / as sysdba <<'EOF' | tail -1
SET PAGESIZE 0 FEEDBACK OFF VERIFY OFF HEADING OFF
SELECT VALUE FROM v\$dataguard_stats WHERE NAME = 'apply lag';
EOF
    ;;
esac
```

#### 3.1.3 Low-Level Discovery Rules (LLD)

To automatically discover all tablespaces and create monitoring items, discovery rules need to be defined:

```json
// discovery_rule returns JSON format
{
  "data": [
    "{#TABLESPACE_NAME}": "USERS"},
    "{#TABLESPACE_NAME}": "SYSTEM"},
    "{#TABLESPACE_NAME}": "SYSAUX"}
  ]
}
```

UserParameter configuration for discovery rules:

```bash
# zabbix_agentd.d/oracle_discovery.conf
UserParameter=oracle.discovery.tablespace[*],/etc/zabbix/scripts/oracle_discovery.sh $1 tablespace
UserParameter=oracle.discovery.pdb[*],/etc/zabbix/scripts/oracle_discovery.sh $1 pdb
```

Discovery script example:

```bash
#!/bin/bash
# /etc/zabbix/scripts/oracle_discovery.sh
export ORACLE_HOME=/u01/app/oracle/product/19c/dbhome_1
export ORACLE_SID=$1
export PATH=$ORACLE_HOME/bin:$PATH

OBJECT_TYPE=$2

case "$OBJECT_TYPE" in
  "tablespace")
    sqlplus -S / as sysdba <<'EOF'
SET PAGESIZE 0 FEEDBACK OFF VERIFY OFF HEADING OFF
SELECT '{"data":[' FROM dual;
SELECT LISTAGG('{"{#TABLESPACE_NAME}":"' || tablespace_name || '"}', ',')
  WITHIN GROUP (ORDER BY tablespace_name)
FROM dba_tablespaces WHERE contents = 'PERMANENT';
SELECT ']}' FROM dual;
EOF
    ;;
esac
```

#### 3.1.4 Alert Triggers

Configure triggers in Zabbix Web interface:

```
# Tablespace usage above 85% is Warning
{Template Oracle:oracle.tablespace.usage[{#TABLESPACE_NAME}].last()}>85

# Tablespace usage above 95% is Disaster
{Template Oracle:oracle.tablespace.usage[{#TABLESPACE_NAME}].last()}>95

# DG Apply Lag exceeds 300 seconds alert
{Template Oracle:oracle.custom.query[ORCL,dg_lag].last()}>300

# Active Session spike alert (exceeds 2x baseline)
{Template Oracle:oracle.custom.query[ORCL,sessions].avg(10m)} >
{Template Oracle:oracle.custom.query[ORCL,sessions].avg(1h)} * 2
```

### 3.2 Prometheus Configuration

#### 3.2.1 oracledb_exporter Deployment

```bash
# Download exporter
wget https://github.com/iamseth/oracledb_exporter/releases/download/0.6.0/oracledb_exporter-0.6.0.linux-amd64.tar.gz
tar xzf oracledb_exporter-0.6.0.linux-amd64.tar.gz
mv oracledb_exporter /usr/local/bin/

# Configure environment variables
cat > /etc/oracledb_exporter.env <<'EOF'
DATA_SOURCE_NAME=oracle://exporter:password@localhost:1521/ORCL
LD_LIBRARY_PATH=/u01/app/oracle/instantclient_19_21
CUSTOM_METRICS=/etc/oracledb_exporter/custom-metrics.toml
EOF
```

Custom metrics configuration (custom-metrics.toml):

```toml
# /etc/oracledb_exporter/custom-metrics.toml

# Tablespace usage
[[metric]]
context = "oracle_tablespace"
metricsdesc = { pct_used = "Tablespace percent used", free_mb = "Free space in MB", total_mb = "Total space in MB" }
request = """
SELECT
  t.tablespace_name,
  ROUND((1 - (f.free_bytes / t.total_bytes)) * 100, 2) as pct_used,
  ROUND(f.free_bytes / 1024 / 1024, 2) as free_mb,
  ROUND(t.total_bytes / 1024 / 1024, 2) as total_mb
FROM
  (SELECT tablespace_name, SUM(bytes) total_bytes
   FROM dba_data_files GROUP BY tablespace_name) t,
  (SELECT tablespace_name, SUM(bytes) free_bytes
   FROM dba_free_space GROUP BY tablespace_name) f
WHERE t.tablespace_name = f.tablespace_name(+)
"""

# Active Session Count
[[metric]]
context = "oracle_session"
metricsdesc = { active_count = "Number of active sessions", total_count = "Total sessions" }
request = """
SELECT
  SUM(CASE WHEN status='ACTIVE' THEN 1 ELSE 0 END) as active_count,
  COUNT(*) as total_count
FROM v$session WHERE type = 'USER'
"""

# DG Stats
[[metric]]
context = "oracle_dg"
metricsdesc = { apply_lag_seconds = "Data Guard apply lag in seconds", transport_lag_seconds = "Transport lag in seconds" }
request = """
SELECT
  EXTRACT(DAY FROM TO_DSINTERVAL(VALUE)) * 86400 +
  EXTRACT(HOUR FROM TO_DSINTERVAL(VALUE)) * 3600 +
  EXTRACT(MINUTE FROM TO_DSINTERVAL(VALUE)) * 60 +
  EXTRACT(SECOND FROM TO_DSINTERVAL(VALUE)) as apply_lag_seconds
FROM v$dataguard_stats WHERE name = 'apply lag'
"""

# Top SQL by Elapsed Time
[[metric]]
context = "oracle_top_sql"
metricsdesc = { elapsed_seconds = "SQL elapsed time", executions = "SQL executions", buffer_gets = "Buffer gets" }
request = """
SELECT
  ROWNUM as sql_rank,
  ROUND(elapsed_time / 1000000, 2) as elapsed_seconds,
  executions,
  buffer_gets
FROM (
  SELECT elapsed_time, executions, buffer_gets
  FROM v$sql ORDER BY elapsed_time DESC
) WHERE ROWNUM <= 10
"""
```

Configure systemd service:

```ini
# /etc/systemd/system/oracledb_exporter.service
[Unit]
Description=Oracle DB Exporter
After=network.target

[Service]
EnvironmentFile=/etc/oracledb_exporter.env
ExecStart=/usr/local/bin/oracledb_exporter \
  --web.listen-address=:9161 \
  --log.level=info
Restart=always
User=oracle

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable --now oracledb_exporter
```

#### 3.2.2 Prometheus Configuration

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'oracle'
    scrape_interval: 30s
    scrape_timeout: 10s
    static_configs:
      - targets:
          - 'db-host-1:9161'
          - 'db-host-2:9161'
        labels:
          env: 'production'
    metric_relabel_configs:
      - source_labels: [__name__]
        regex: 'oracle_tablespace_(.+)'
        target_label: 'tablespace'
```

#### 3.2.3 Grafana Dashboard Configuration

After adding the Prometheus data source in Grafana, you can use the community Dashboard template (ID: 3333) or build a custom Dashboard. Common PromQL queries:

```promql
# Top 10 Tablespace Usage
topk(10, oracle_tablespace_pct_used)

# Archive log generation rate over 1 hour (MB/h)
rate(oracle_redo_size_bytes_total[1h]) / 1024 / 1024 * 3600

# Session utilization
oracle_session_active_count / oracle_parameter_processes * 100

# DG Apply Lag trend
oracle_dg_apply_lag_seconds
```

Add template variables in the Dashboard to support multi-instance switching:

```
# Variable name: instance
# Type: Query
# Query: label_values(up{job="oracle"}, instance)
```

### 3.3 Common Monitoring Scripts Summary

Below is a summary of the most commonly used monitoring collection SQL in production environments, which can be directly used in Zabbix UserParameter or Prometheus custom-metrics.toml:

**Tablespace Usage**:
```sql
SELECT tablespace_name,
       ROUND((1 - NVL(f.free, 0) / t.total) * 100, 2) pct_used,
       ROUND(t.total / 1024 / 1024, 2) total_mb
FROM (SELECT tablespace_name, SUM(bytes) total
      FROM dba_data_files GROUP BY tablespace_name) t,
     (SELECT tablespace_name, SUM(bytes) free
      FROM dba_free_space GROUP BY tablespace_name) f
WHERE t.tablespace_name = f.tablespace_name(+);
```

**Archive Log Generation Rate** (past 1 hour, MB/h):
```sql
SELECT ROUND(SUM(blocks * block_size) / 1024 / 1024, 2) archive_mb
FROM v$archived_log
WHERE first_time > SYSDATE - 1/24 AND dest_id = 1;
```

**DG Delay**:
```sql
SELECT name, value FROM v$dataguard_stats
WHERE name IN ('apply lag', 'transport lag');
```

**TOP SQL** (sorted by Elapsed Time):
```sql
SELECT sql_id, sql_text, elapsed_time, executions,
       ROUND(elapsed_time / NULLIF(executions, 0) / 1000000, 2) avg_sec
FROM v$sql ORDER BY elapsed_time DESC FETCH FIRST 10 ROWS ONLY;
```

## 4. Result Verification

### 4.1 Monitoring Data Collection Verification

After deployment, verify the correctness of data collection:

```bash
# Zabbix Agent test
zabbix_agentd -t oracle.tablespace.usage[ORCL,USERS]
# Expected output: [t|85.23]

# Prometheus Exporter test
curl -s http://localhost:9161/metrics | grep oracle_tablespace
# Expected output: oracle_tablespace_pct_used{tablespace="USERS"} 85.23
```

### 4.2 Alert Trigger Testing

Simulate alert scenarios for testing:

```bash
# Temporarily lower threshold to verify alert trigger
# In Zabbix, temporarily set tablespace alert threshold to 10%, observe if triggered
# In Prometheus Alertmanager, configure test alert rule
```

Verify that alert notifications are sent correctly to specified channels (email, WeChat Work, DingTalk, etc.).

### 4.3 Dashboard Visualization Verification

Check that all Grafana Dashboard panels display data correctly:

1. Open Dashboard, confirm all panels have data rendering
2. Switch template variables (instance, tablespace), confirm data linkage is correct
3. Check if time range selection affects chart display
4. Verify alert threshold annotation lines display correctly

## 5. Experience Summary

### 5.1 Monitoring Metric Selection Recommendations

- **Required Metrics**: Tablespace usage, connection count, DG delay, archive log generation rate
- **Recommended Metrics**: SGA/PGA hit ratio, TOP SQL, lock wait, RAC inter-communication
- **Optional Metrics**: Index usage, audit log volume, backup status

More metrics are not always better; excessive collection items increase database burden. Recommend reducing based on actual business needs.

### 5.2 Alert Threshold Settings

| Metric | Warning Threshold | Disaster Threshold | Notes |
|------|-------------|--------------|------|
| Tablespace Usage | 85% | 95% | Need to monitor growth trends |
| DG Apply Lag | 5 min | 30 min | Financial scenarios may tighten |
| Archive Generation Rate | 5 GB/h | 20 GB/h | Combine with historical baseline |
| Active Sessions | Baseline×2 | Baseline×5 | Baseline needs 2+ weeks of data |

Recommend using **dynamic threshold** strategy: use historical data from the past 2-4 weeks as baseline, set alert thresholds to N times the baseline rather than fixed absolute values.

### 5.3 Dashboard Design Principles

1. **Layered Display**: Overview → Cluster Level → Instance Level → SQL Level, supporting drill-down
2. **Color Coding**: Green (Normal) → Yellow (Warning) → Red (Disaster), at a glance
3. **Time Comparison**: Support year-over-year/period-over-period comparison for anomaly trend detection
4. **Variable Linkage**: Use Grafana Template Variables for multi-instance, multi-dimension switching
5. **Mobile Adaptation**: Consider mobile viewing scenarios, place key panels on the first screen

A good monitoring system is not built overnight; it requires continuous iteration and optimization in production practice. Recommend reviewing monitoring strategies quarterly, adjusting collection metrics and alert thresholds based on business changes and historical alert records, making monitoring truly a solid guarantee for stable database operations.
