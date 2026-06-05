---
title: "Localization/信创 Knowledge Map"
date: 2025-06-04 12:00:04
categories: 信创
tags: [知识地图, 导航]
lang: en
---

> Domestic database operations knowledge system, covering DM, OceanBase, GaussDB/MOGdb and other mainstream localization databases.

<!-- more -->

## I. DM (Dameng) Database

| Topic | Description |
|-------|-------------|
| Installation | Standby/primary-standby cluster installation, DM8 new features |
| Architecture | Thread architecture, memory structure, physical file structure |
| Backup & Recovery | Physical backup and recovery, logical backup dexp/dimp |
| High Availability | DataWatch guardian cluster |
| Troubleshooting | Redo loss recovery, Page corruption handling |
| Performance | IO write performance, Partial Write, columnar tables |

## II. OceanBase

| Topic | Description |
|-------|-------------|
| Cluster Setup | Single-replica/multi-replica cluster deployment |
| Partitioned Tables | Two-level partitioning, partition pruning enhancement |
| Indexes | Partitioned indexes, index testing |
| Benchmarking | TPC-C baseline testing |
| Query Optimization | Query transformation, execution plan analysis |

## III. GaussDB / MOGdb

| Topic | Description |
|-------|-------------|
| Installation | Standalone installation, cluster deployment |
| Backup & Recovery | Roach backup, BRM table-level recovery |
| Kernel Features | BGWriter/PageWrite threads, Checkpoint |
| Flashback | Flashback query, flashback transaction query |
| DBLink | Oracle DBLink compatibility |
| SQL Patch | SQL Patch tuning |

## IV. Migration Practices

| Topic | Description |
|-------|-------------|
| Oracle → DM | Data migration solutions, character set conversion |
| Oracle → GaussDB | Tool chain comparison, compatibility assessment |
| MySQL → OceanBase | Migration path, data validation |
| GoldenGate Cross-DB | DB2 → PostgreSQL/MOGdb synchronization |

## V. Localization Selection Guide

| Dimension | Considerations |
|-----------|---------------|
| Compatibility | Oracle SQL compatibility, stored procedure migration cost |
| Ecosystem | Community activity, vendor support |
| Performance | OLTP/OLAP scenario comparison |
| Ops Cost | Tool chain maturity, talent availability |
