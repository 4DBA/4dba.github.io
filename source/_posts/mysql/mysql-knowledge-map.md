---
title: MySQL 知识地图
date: 2025-06-04 12:00:01
categories: MySQL
tags: [知识地图, 导航]
---

> MySQL 运维实战知识体系，覆盖主从复制、高可用、性能优化、故障处理。

<!-- more -->

## 一、安装与部署

| 主题 | 说明 |
|------|------|
| 单机部署 | YUM/APT 安装、二进制安装、Docker 部署 |
| 主从复制 | GTID 复制、半同步复制、多源复制 |
| MGR | MySQL Group Replication 单主/多主模式 |
| InnoDB Cluster | Shell + Router + MGR 一体化方案 |
| 版本升级 | 5.7→8.0 升级路径、8.0→8.4 注意事项 |

## 二、高可用架构

| 主题 | 说明 |
|------|------|
| 主从复制管理 | 复制延迟处理、GTID 跳过、多线程复制 |
| MGR 运维 | 成员管理、网络分区处理、单主切换 |
| ProxySQL | 读写分离、故障自动切换、查询路由 |
| Orchestrator | 自动 Failover、拓扑管理 |
| 备份恢复 | Xtrabackup 全量/增量、binlog 恢复、逻辑备份 |

## 三、性能优化

| 主题 | 说明 |
|------|------|
| 慢查询分析 | slow_log 配置、pt-query-digest 分析 |
| 索引优化 | 覆盖索引、前缀索引、索引失效场景 |
| 执行计划 | EXPLAIN 各字段解读、optimizer_trace |
| InnoDB 调优 | buffer_pool、redo_log、flush 策略 |
| 连接管理 | 连接池配置、max_connections、thread_cache |

## 四、故障排查

| 主题 | 说明 |
|------|------|
| 启动故障 | InnoDB crash recovery、redo/undo 损坏 |
| 复制故障 | 主从不一致、GTID gap、relay log 损坏 |
| 锁问题 | metadata lock、gap lock、死锁分析 |
| 空间故障 | binlog 暴涨、ibdata1 膨胀、tmpdir 满 |
| 连接故障 | Too many connections、Can't connect、DNS 解析 |

## 五、安全与合规

| 主题 | 说明 |
|------|------|
| 权限管理 | 角色、动态权限、密码策略 |
| 审计 | audit_log 插件、general_log |
| 加密 | TDE 表空间加密、SSL 连接 |
| SQL 注入防护 | prepared statement、WAF 配置 |

## 六、工具与自动化

| 主题 | 说明 |
|------|------|
| pt-toolkit | pt-online-schema-change、pt-stalk、pt-kill |
| MySQL Shell | 交互式管理、dump/load、AdminAPI |
| Zabbix 监控 | MySQL 模板、自定义监控项 |
| gh-ost | Online DDL、无触发器表结构变更 |
