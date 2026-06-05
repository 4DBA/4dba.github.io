---
title: MySQL Knowledge Map
date: 2025-06-04 12:00:01
categories: MySQL
tags: [知识地图, 导航]
lang: en
---

> MySQL operations knowledge system covering replication, high availability, performance optimization, and troubleshooting.

<!-- more -->

## 1. Installation and Deployment

| Topic | Description |
|------|------|
| Standalone Deployment | YUM/APT installation, binary installation, Docker deployment |
| Replication | GTID replication, semi-synchronous replication, multi-source replication |
| MGR | MySQL Group Replication single-primary/multi-primary mode |
| InnoDB Cluster | Shell + Router + MGR integrated solution |
| Version Upgrade | 5.7→8.0 upgrade path, 8.0→8.4 considerations |

## 2. High Availability Architecture

| Topic | Description |
|------|------|
| Replication Management | Replication delay handling, GTID skip, multi-threaded replication |
| MGR Operations | Member management, network partition handling, single-primary switch |
| ProxySQL | Read-write separation, automatic failover, query routing |
| Orchestrator | Automatic failover, topology management |
| Backup and Recovery | Xtrabackup full/incremental, binlog recovery, logical backup |

## 3. Performance Optimization

| Topic | Description |
|------|------|
| Slow Query Analysis | slow_log configuration, pt-query-digest analysis |
| Index Optimization | Covering index, prefix index, index failure scenarios |
| Execution Plan | EXPLAIN field interpretation, optimizer_trace |
| InnoDB Tuning | buffer_pool, redo_log, flush strategy |
| Connection Management | Connection pool configuration, max_connections, thread_cache |

## 4. Troubleshooting

| Topic | Description |
|------|------|
| Startup Failures | InnoDB crash recovery, redo/undo corruption |
| Replication Failures | Primary-replica inconsistency, GTID gap, relay log corruption |
| Lock Issues | metadata lock, gap lock, deadlock analysis |
| Space Failures | binlog explosion, ibdata1 bloat, tmpdir full |
| Connection Failures | Too many connections, Can't connect, DNS resolution |

## 5. Security and Compliance

| Topic | Description |
|------|------|
| Privilege Management | Roles, dynamic privileges, password policies |
| Auditing | audit_log plugin, general_log |
| Encryption | TDE tablespace encryption, SSL connections |
| SQL Injection Prevention | Prepared statements, WAF configuration |

## 6. Tools and Automation

| Topic | Description |
|------|------|
| pt-toolkit | pt-online-schema-change, pt-stalk, pt-kill |
| MySQL Shell | Interactive management, dump/load, AdminAPI |
| Zabbix Monitoring | MySQL template, custom monitoring items |
| gh-ost | Online DDL, triggerless schema changes |
