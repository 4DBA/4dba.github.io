---
title: 信创/国产化 知识地图
lang: zh-CN
date: 2025-06-04 12:00:04
categories: 信创
tags: [知识地图, 导航]
---

> 国产数据库运维知识体系，覆盖达梦、OceanBase、GaussDB/MOGdb 等主流信创数据库。

<!-- more -->

## 一、达梦数据库

| 主题 | 说明 |
|------|------|
| 安装部署 | 单机/主备集群安装、DM8 新特性 |
| 体系架构 | 线程架构、内存结构、物理文件结构 |
| 备份恢复 | 物理备份与恢复、逻辑备份 dexp/dimp |
| 高可用 | DataWatch 守护集群 |
| 故障处理 | Redo 丢失恢复、Page 损坏处理 |
| 性能优化 | IO 写入性能、Partial Write、列存表 |

## 二、OceanBase

| 主题 | 说明 |
|------|------|
| 集群搭建 | 单副本/多副本集群部署 |
| 分区表 | 二级分区、分区裁剪增强 |
| 索引 | 分区索引、索引测试 |
| 压测 | TPC-C 基准测试 |
| 查询优化 | 查询转换、执行计划分析 |

## 三、GaussDB / MOGdb

| 主题 | 说明 |
|------|------|
| 安装部署 | 单机安装、集群部署 |
| 备份恢复 | Roach 备份、BRM 表级恢复 |
| 内核特性 | BGWriter/PageWrite 线程、Checkpoint |
| 闪回 | 闪回查询、闪回事务查询 |
| DBLink | Oracle DBLink 兼容功能 |
| SQL Patch | SQL Patch 调优 |

## 四、迁移实战

| 主题 | 说明 |
|------|------|
| Oracle → 达梦 | 数据迁移方案、字符集转换 |
| Oracle → GaussDB | 工具链对比、兼容性评估 |
| MySQL → OceanBase | 迁移路径、数据校验 |
| GoldenGate 跨库 | DB2 → PostgreSQL/MOGdb 同步 |

## 五、信创选型建议

| 维度 | 考量 |
|------|------|
| 兼容性 | Oracle SQL 兼容度、存储过程迁移成本 |
| 生态 | 社区活跃度、厂商支持力度 |
| 性能 | OLTP/OLAP 场景对比 |
| 运维成本 | 工具链成熟度、人才储备 |
