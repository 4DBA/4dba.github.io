---
title: Oracle 知识地图
date: 2025-06-04 12:00:00
categories: Oracle
tags: [知识地图, 导航]
---

> OCM 级别的 Oracle 实战知识体系，覆盖安装部署、高可用、性能调优、故障恢复全链路。

<!-- more -->

## 一、安装部署

| 主题 | 说明 |
|------|------|
| 单机安装 | Oracle 19c/21c 静默安装、RPM 安装 |
| RAC 集群 | Grid Infrastructure + RAC 部署全流程 |
| Data Guard | 物理/逻辑备库搭建、Switchover/Failover |
| 升级迁移 | 11g→19c 升级路径、跨平台迁移（XTTS/DMU） |

## 二、高可用架构

| 主题 | 说明 |
|------|------|
| RAC 管理 | 节点增删、VIP/SCAN、负载均衡 |
| Data Guard 运维 | 日志传输延迟处理、DG Broker 配置 |
| RMAN 备份恢复 | 全量/增量备份、跨节点恢复、Catalog 管理 |
| 容灾演练 | Switchover 演练 SOP、RTO/RPO 评估 |

## 三、性能调优

| 主题 | 说明 |
|------|------|
| AWR/ASH 分析 | Top SQL 定位、等待事件解读 |
| SQL 优化 | 执行计划分析、Hint 使用、SQL Profile |
| 内存管理 | SGA/PGA 调优、AMM/ASMM 选型 |
| I/O 优化 | ASM 条带化、多路径、存储选型 |
| 参数调优 | 关键隐含参数、最佳实践参数模板 |

## 四、故障排查

| 主题 | 说明 |
|------|------|
| 启动故障 | ORA-01113/ORA-01110 数据文件恢复 |
| 空间故障 | 表空间满、归档日志暴涨、ASM 磁盘组告警 |
| 锁与阻塞 | TX/TM 锁分析、kill session 最佳实践 |
| ORA-00600/07445 | 内部错误诊断、trace 分析 |
| 网络故障 | TNS-12541/ORA-12170 排查 |

## 五、安全与合规

| 主题 | 说明 |
|------|------|
| 权限管理 | 最小权限原则、角色设计、审计策略 |
| TDE 加密 | 表空间加密、钱包管理 |
| 审计 | Unified Auditing 配置、审计日志清理 |
| 补丁 | PSU/RU 补丁应用、OPlan 回滚 |

## 六、工具与自动化

| 主题 | 说明 |
|------|------|
| SQLcl / SQL*Plus | 日常管理脚本库 |
| ORDS | REST API 暴露数据库服务 |
| Zabbix 监控 | Oracle 模板、自定义监控项 |
| 自动巡检 | crontab + 脚本实现日常巡检自动化 |
