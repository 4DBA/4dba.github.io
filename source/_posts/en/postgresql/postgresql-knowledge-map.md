---
title: "PostgreSQL Knowledge Map"
date: 2025-06-04 12:00:02
categories: PostgreSQL
tags: [知识地图, 导航]
lang: en
---

> PostgreSQL operations knowledge system covering installation & deployment, high availability, performance optimization, and troubleshooting.

<!-- more -->

## 1. Installation & Deployment

| Topic | Description |
|------|------|
| Standalone Deployment | YUM/APT installation, source compilation, Docker deployment |
| Version Management | Major version upgrades (pg_upgrade), logical replication migration |
| Initial Configuration | postgresql.conf key parameters, pg_hba.conf authentication |
| Extension Management | PostGIS, pg_stat_statements, pgvector |

## 2. High Availability Architecture

| Topic | Description |
|------|------|
| Streaming Replication | Async/sync replication, cascading replication, replication slot management |
| Patroni | DCS-based automatic failover solution |
| PgBouncer | Connection pooling configuration, transaction/session pool modes |
| Backup & Recovery | pg_basebackup, pgBackRest, WAL archiving |
| Logical Replication | Publication/subscription, cross-version migration, partial table sync |

## 3. Performance Optimization

| Topic | Description |
|------|------|
| Query Optimization | EXPLAIN ANALYZE interpretation, statistics updates |
| Index Strategy | B-tree/GIN/GiST/BRIN selection, partial indexes |
| VACUUM | autovacuum tuning, bloat handling, freeze strategy |
| Memory Management | shared_buffers, work_mem, effective_cache_size |
| Connection Management | max_connections, PgBouncer configuration optimization |

## 4. Troubleshooting

| Topic | Description |
|------|------|
| Startup Failures | Recovery mode, WAL corruption, pg_resetwal |
| Replication Failures | Replication lag, slot bloat, WAL backlog |
| Lock Issues | Row locks, table locks, advisory locks, deadlock analysis |
| Space Issues | Table bloat, WAL explosion, pg_wal directory cleanup |
| Long Transactions | Idle in transaction, transaction ID wraparound risk |

## 5. Security & Compliance

| Topic | Description |
|------|------|
| Privilege Management | ROLE hierarchy, GRANT/REVOKE, Row-Level Security (RLS) |
| Auditing | pgaudit configuration, log auditing |
| Encryption | SSL/TLS connections, pgcrypto column encryption |
| Authentication | LDAP/Kerberos/SCRAM-SHA-256 |

## 6. Tools & Automation

| Topic | Description |
|------|------|
| pg_stat Monitoring | pg_stat_statements, pg_stat_activity, pg_stat_user_tables |
| pgAdmin / DBeaver | GUI management tools |
| Zabbix Monitoring | PostgreSQL templates, custom monitoring items |
| Automation Scripts | Daily inspections, space cleanup, statistics updates |
