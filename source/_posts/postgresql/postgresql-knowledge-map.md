---
title: PostgreSQL 知识地图
date: 2025-06-04 12:00:02
categories: PostgreSQL
tags: [知识地图, 导航]
---

> PostgreSQL 运维实战知识体系，覆盖安装部署、高可用、性能优化、故障处理。

<!-- more -->

## 一、安装与部署

| 主题 | 说明 |
|------|------|
| 单机部署 | YUM/APT 安装、源码编译、Docker 部署 |
| 版本管理 | 大版本升级（pg_upgrade）、逻辑复制迁移 |
| 初始化配置 | postgresql.conf 关键参数、pg_hba.conf 认证 |
| 扩展管理 | PostGIS、pg_stat_statements、pgvector |

## 二、高可用架构

| 主题 | 说明 |
|------|------|
| 流复制 | 异步/同步复制、级联复制、复制槽管理 |
| Patroni | 基于 DCS 的自动 Failover 方案 |
| PgBouncer | 连接池配置、事务/会话池模式 |
| 备份恢复 | pg_basebackup、pgBackRest、WAL 归档 |
| 逻辑复制 | 发布/订阅、跨版本迁移、部分表同步 |

## 三、性能优化

| 主题 | 说明 |
|------|------|
| 查询优化 | EXPLAIN ANALYZE 解读、统计信息更新 |
| 索引策略 | B-tree/GIN/GiST/BRIN 选型、部分索引 |
| VACUUM | autovacuum 调优、膨胀处理、freeze 策略 |
| 内存管理 | shared_buffers、work_mem、effective_cache_size |
| 连接管理 | max_connections、PgBouncer 配置优化 |

## 四、故障排查

| 主题 | 说明 |
|------|------|
| 启动故障 | recovery 模式、WAL 损坏、pg_resetwal |
| 复制故障 | 复制延迟、slot 膨胀、WAL 积压 |
| 锁问题 | 行锁、表锁、advisory lock、deadlock 分析 |
| 空间故障 | 表膨胀、WAL 暴涨、pg_wal 目录清理 |
| 长事务 | idle in transaction、事务 ID wraparound 风险 |

## 五、安全与合规

| 主题 | 说明 |
|------|------|
| 权限管理 | ROLE 层级、GRANT/REVOKE、行级安全（RLS） |
| 审计 | pgaudit 配置、日志审计 |
| 加密 | SSL/TLS 连接、pgcrypto 列加密 |
| 认证 | LDAP/Kerberos/SCRAM-SHA-256 |

## 六、工具与自动化

| 主题 | 说明 |
|------|------|
| pg_stat 监控 | pg_stat_statements、pg_stat_activity、pg_stat_user_tables |
| pgAdmin / DBeaver | GUI 管理工具 |
| Zabbix 监控 | PostgreSQL 模板、自定义监控项 |
| 自动化脚本 | 日常巡检、空间清理、统计信息更新 |
