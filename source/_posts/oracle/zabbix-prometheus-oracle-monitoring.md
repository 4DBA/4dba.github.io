---
title: Zabbix/Prometheus Oracle 监控定制：自定义监控项与可视化
date: 2026-05-22 10:00:00
categories: Oracle
tags: [Zabbix, Prometheus, Grafana, 监控, UserParameter, 可视化]
---

## 一、问题背景

在企业级 Oracle 数据库运维中，监控是保障业务连续性的第一道防线。然而，大多数 DBA 在实际工作中都会遇到这样的困境：

<!-- more -->


**默认监控模板的局限性**：无论是 Zabbix 社区提供的 Oracle Template，还是 Prometheus 官方 Exporter 的默认采集项，都无法覆盖生产环境中的全部监控需求。例如，默认模板通常只关注基础的表空间使用率、连接数等通用指标，而对于 DG 同步延迟、RAC 节点间心跳、特定业务 SQL 的执行效率等关键指标，往往需要 DBA 自行定制。

**业务定制化的监控需求**：不同的业务场景对监控的粒度和维度要求各不相同。电商系统关注并发会话与锁等待，金融系统关注归档日志生成速率与 Data Guard 延迟，而批处理系统则更关注 TOP SQL 的执行计划变化。一刀切的默认模板无法满足这些差异化需求。

**可视化对运维决策的价值**：监控不仅仅是"出问题时告警"，更重要的是通过历史趋势分析支撑容量规划、性能优化等主动运维决策。一个设计良好的 Grafana Dashboard 可以让 DBA 在数秒内掌握整个数据库集群的健康状态。

本文将从 Zabbix 和 Prometheus 两大主流监控平台出发，详细介绍 Oracle 监控的定制化方法，包括自定义监控项、自动发现规则、告警触发器以及 Grafana 可视化 Dashboard 的搭建。

## 二、理论分析

### 2.1 Zabbix 监控架构

Zabbix 采用经典的三层架构：**Agent → Server → Web**。

- **Agent**：部署在被监控主机上，负责采集本地数据。对于 Oracle 监控，Agent 通过 UserParameter 调用自定义脚本连接数据库采集指标。
- **Server**：接收 Agent 上报的数据，执行触发器评估、告警通知等逻辑。
- **Web**：提供可视化界面，支持 Dashboard 展示、配置管理等功能。

Zabbix 的强大之处在于 **UserParameter** 机制。通过 UserParameter，DBA 可以将任意 Shell/Python 脚本注册为监控项，由 Agent 定时调用并上报结果。这为 Oracle 自定义监控提供了极大的灵活性。

此外，Zabbix 的 **Low-Level Discovery（LLD）** 功能可以自动发现数据库中的表空间、PDB 等动态对象，避免手动逐一配置监控项。

### 2.2 Prometheus + Grafana

Prometheus 采用 Pull 模型，通过 Exporter 暴露 HTTP 端点供 Prometheus Server 拉取指标数据。对于 Oracle 监控，最常用的 Exporter 是 **oracledb_exporter**（由 iamseth/oracledb_exporter 项目维护）。

Prometheus 的查询语言 **PromQL** 非常强大，支持丰富的聚合、计算和时间序列操作。例如，可以用一条 PromQL 计算过去 1 小时内归档日志的平均生成速率：

```promql
rate(oracle_archive_log_generated_bytes_total[1h])
```

**Grafana** 作为 Prometheus 的可视化前端，提供了丰富的图表类型和模板变量支持。社区已有大量成熟的 Oracle Dashboard 模板（如 ID 为 3333 的 Dashboard），可以快速导入并根据实际需求定制。

### 2.3 Oracle 监控指标分类

生产环境中，Oracle 监控指标可以按层级分为以下几类：

| 指标类别 | 典型指标 | 采集频率建议 |
|---------|---------|------------|
| 实例级 | SGA/PGA 使用率、DB Time、Logical/Physical Reads | 30s ~ 1min |
| 表空间级 | 使用率、增长速率、剩余空间 | 5min |
| SQL 级 | TOP SQL Elapsed Time、Buffer Gets、Executions | 5min |
| DG 级 | Apply Lag、Transport Lag、Gap Status | 1min |
| RAC 级 | Interconnect Traffic、GC Wait、Instance Status | 1min |

合理分类指标有助于设置差异化的采集频率和告警阈值，避免对数据库造成不必要的性能开销。

## 三、实战操作

### 3.1 Zabbix 自定义监控项

#### 3.1.1 UserParameter 配置

在 Zabbix Agent 配置文件中定义 UserParameter。以表空间使用率为例：

```bash
# /etc/zabbix/zabbix_agentd.d/oracle_tablespace.conf
UserParameter=oracle.tablespace.usage[*],/etc/zabbix/scripts/oracle_tablespace.sh $1 $2

# 通用 Oracle 指标采集入口
UserParameter=oracle.custom.query[*],/etc/zabbix/scripts/oracle_monitor.sh $1 $2
```

#### 3.1.2 Shell 脚本实现

以下是表空间使用率采集脚本：

```bash
#!/bin/bash
# /etc/zabbix/scripts/oracle_tablespace.sh
# 用法: oracle_tablespace.sh <ORACLE_SID> <TABLESPACE_NAME>

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

通用监控脚本，支持多种指标查询：

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

#### 3.1.3 自动发现规则（LLD）

为自动发现所有表空间并创建监控项，需要定义发现规则：

```json
// discovery_rule 返回的 JSON 格式
{
  "data": [
    "{#TABLESPACE_NAME}": "USERS"},
    "{#TABLESPACE_NAME}": "SYSTEM"},
    "{#TABLESPACE_NAME}": "SYSAUX"}
  ]
}
```

发现规则的 UserParameter 配置：

```bash
# zabbix_agentd.d/oracle_discovery.conf
UserParameter=oracle.discovery.tablespace[*],/etc/zabbix/scripts/oracle_discovery.sh $1 tablespace
UserParameter=oracle.discovery.pdb[*],/etc/zabbix/scripts/oracle_discovery.sh $1 pdb
```

发现脚本示例：

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

#### 3.1.4 告警触发器

在 Zabbix Web 界面中配置触发器：

```
# 表空间使用率超过 85% 为 Warning
{Template Oracle:oracle.tablespace.usage[{#TABLESPACE_NAME}].last()}>85

# 表空间使用率超过 95% 为 Disaster
{Template Oracle:oracle.tablespace.usage[{#TABLESPACE_NAME}].last()}>95

# DG Apply Lag 超过 300 秒告警
{Template Oracle:oracle.custom.query[ORCL,dg_lag].last()}>300

# Active Session 突增告警（超过基线 2 倍）
{Template Oracle:oracle.custom.query[ORCL,sessions].avg(10m)} >
{Template Oracle:oracle.custom.query[ORCL,sessions].avg(1h)} * 2
```

### 3.2 Prometheus 配置

#### 3.2.1 oracledb_exporter 部署

```bash
# 下载 exporter
wget https://github.com/iamseth/oracledb_exporter/releases/download/0.6.0/oracledb_exporter-0.6.0.linux-amd64.tar.gz
tar xzf oracledb_exporter-0.6.0.linux-amd64.tar.gz
mv oracledb_exporter /usr/local/bin/

# 配置环境变量
cat > /etc/oracledb_exporter.env <<'EOF'
DATA_SOURCE_NAME=oracle://exporter:password@localhost:1521/ORCL
LD_LIBRARY_PATH=/u01/app/oracle/instantclient_19_21
CUSTOM_METRICS=/etc/oracledb_exporter/custom-metrics.toml
EOF
```

自定义指标配置（custom-metrics.toml）：

```toml
# /etc/oracledb_exporter/custom-metrics.toml

# 表空间使用率
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

配置 systemd 服务：

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

#### 3.2.2 Prometheus 配置

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

#### 3.2.3 Grafana Dashboard 配置

在 Grafana 中添加 Prometheus 数据源后，可以使用社区 Dashboard 模板（ID: 3333）或自建 Dashboard。常用 PromQL 查询：

```promql
# 表空间使用率 Top 10
topk(10, oracle_tablespace_pct_used)

# 1 小时内归档日志生成速率 (MB/h)
rate(oracle_redo_size_bytes_total[1h]) / 1024 / 1024 * 3600

# Session 利用率
oracle_session_active_count / oracle_parameter_processes * 100

# DG Apply Lag 趋势
oracle_dg_apply_lag_seconds
```

Dashboard 中添加模板变量以支持多实例切换：

```
# 变量名: instance
# 类型: Query
# 查询: label_values(up{job="oracle"}, instance)
```

### 3.3 常用监控脚本汇总

以下汇总生产环境中最常用的监控采集 SQL，可在 Zabbix UserParameter 或 Prometheus custom-metrics.toml 中直接使用：

**表空间使用率**：
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

**归档日志生成速率**（过去 1 小时，MB/h）：
```sql
SELECT ROUND(SUM(blocks * block_size) / 1024 / 1024, 2) archive_mb
FROM v$archived_log
WHERE first_time > SYSDATE - 1/24 AND dest_id = 1;
```

**DG 延迟**：
```sql
SELECT name, value FROM v$dataguard_stats
WHERE name IN ('apply lag', 'transport lag');
```

**TOP SQL**（按 Elapsed Time 排序）：
```sql
SELECT sql_id, sql_text, elapsed_time, executions,
       ROUND(elapsed_time / NULLIF(executions, 0) / 1000000, 2) avg_sec
FROM v$sql ORDER BY elapsed_time DESC FETCH FIRST 10 ROWS ONLY;
```

## 四、结果验证

### 4.1 监控数据采集验证

部署完成后，需要验证数据采集的正确性：

```bash
# Zabbix Agent 测试
zabbix_agentd -t oracle.tablespace.usage[ORCL,USERS]
# 预期输出: [t|85.23]

# Prometheus Exporter 测试
curl -s http://localhost:9161/metrics | grep oracle_tablespace
# 预期输出: oracle_tablespace_pct_used{tablespace="USERS"} 85.23
```

### 4.2 告警触发测试

模拟告警场景进行测试：

```bash
# 临时调低阈值验证告警触发
# 在 Zabbix 中将表空间告警阈值临时设为 10%，观察是否触发
# 在 Prometheus Alertmanager 中配置 test alert rule
```

验证告警通知是否正常发送到指定渠道（邮件、企业微信、钉钉等）。

### 4.3 Dashboard 可视化验证

检查 Grafana Dashboard 各面板数据是否正常展示：

1. 打开 Dashboard，确认所有面板有数据渲染
2. 切换模板变量（实例、表空间），确认数据联动正确
3. 检查时间范围选择是否影响图表展示
4. 验证告警阈值标注线是否正确显示

## 五、经验总结

### 5.1 监控指标选择建议

- **必选指标**：表空间使用率、连接数、DG 延迟、归档日志生成速率
- **推荐指标**：SGA/PGA 命中率、TOP SQL、锁等待、RAC 间通信
- **可选指标**：索引使用率、审计日志量、备份状态

指标并非越多越好，过多的采集项会增加数据库负担。建议根据业务实际需求做减法。

### 5.2 告警阈值设置

| 指标 | Warning 阈值 | Disaster 阈值 | 说明 |
|------|-------------|--------------|------|
| 表空间使用率 | 85% | 95% | 需关注增长趋势 |
| DG Apply Lag | 5 min | 30 min | 金融场景可适当收紧 |
| 归档生成速率 | 5 GB/h | 20 GB/h | 需结合历史基线 |
| Active Sessions | 基线×2 | 基线×5 | 基线需运行 2 周以上 |

建议采用**动态阈值**策略：以过去 2~4 周的历史数据为基线，告警阈值设置为基线的 N 倍，而非固定绝对值。

### 5.3 Dashboard 设计原则

1. **分层展示**：总览 → 集群级 → 实例级 → SQL 级，支持逐层下钻
2. **颜色编码**：绿色（正常）→ 黄色（Warning）→ 红色（Disaster），一目了然
3. **时间对比**：支持同比/环比对比，便于发现异常趋势
4. **变量联动**：利用 Grafana Template Variables 实现多实例、多维度切换
5. **移动适配**：考虑在手机端查看的场景，关键面板放在首屏

好的监控体系不是一蹴而就的，需要在生产实践中持续迭代优化。建议每季度回顾一次监控策略，结合业务变化和历史告警记录，不断调整采集指标和告警阈值，让监控真正成为数据库稳定运行的坚实保障。
