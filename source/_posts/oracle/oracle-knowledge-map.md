---
title: Oracle 运维实战知识地图
lang: zh-CN
date: 2025-06-04 12:00:00
categories: Oracle
tags: [知识地图, 导航, OCM, 运维实战]
---

> OCM 级别的 Oracle 实战知识体系，覆盖安装部署、高可用、性能调优、故障恢复、安全合规、自动化全链路。共 28 篇深度实战文章。

<!-- more -->

---

## 一、基础建设与部署 (Foundation & Deployment)

| 日期 | 文章 | 核心内容 |
|------|------|----------|
| 01-05 | [RHEL 8/9 Kernel Tuning for Oracle 深度指南](/2026/01/05/oracle/rhel-kernel-tuning-for-oracle/) | HugePages, THP, NUMA, I/O Scheduler 对 Oracle 性能的影响及配置标准 |
| 01-12 | [Oracle 19c/23ai 静默安装最佳实践](/2026/01/12/oracle/silent-installation-best-practices-19c-23ai/) | db_install.rsp 关键参数解析，标准化、可重复的单机环境交付 |
| 01-19 | [Grid Infrastructure 深度解析](/2026/01/19/oracle/grid-infrastructure-deep-dive/) | OCR/Voting Disk 管理、SCAN IP 原理、GPNP Profile、集群启动逻辑 |
| 01-26 | [RAC + ASM on Multipath 存储](/2026/01/26/oracle/rac-asm-multipath-storage/) | Linux Multipath 配置、ASM 磁盘组发现、权限管理及冗余策略 |
| 01-31 | [Ansible 自动化部署 Oracle](/2026/01/31/oracle/ansible-automated-deployment/) | 使用 Ansible Playbook 自动化完成从 OS 准备到软件安装的全流程 |

## 二、高可用与容灾 (High Availability & DR)

| 日期 | 文章 | 核心内容 |
|------|------|----------|
| 02-05 | [RAC Cache Fusion 深度解析与负载均衡实战](/2026/02/05/oracle/rac-cache-fusion-load-balancing/) | Cache Fusion 机制图解、GCS 等待事件分析、Service 级别负载均衡 |
| 02-10 | [Active Data Guard 实战](/2026/02/10/oracle/active-data-guard-implementation/) | 物理备库搭建、Real-time Apply、DG Broker 自动化、读写分离 |
| 02-15 | [Switchover/Failover SOP 与脑裂预防](/2026/02/15/oracle/switchover-failover-sop-brain-split/) | 标准化角色切换演练手册、脑裂根因分析及预防机制 |
| 02-20 | [RMAN 高级备份策略](/2026/02/20/oracle/rman-advanced-backup-strategies/) | 增量备份、块变更追踪 (BCT)、Catalog 管理、跨节点恢复 |
| 02-28 | [GoldenGate vs Data Guard 技术选型](/2026/02/28/oracle/goldengate-vs-dataguard/) | 两种容灾技术的适用场景对比、架构选型建议 |

## 三、性能调优 (Performance Tuning)

| 日期 | 文章 | 核心内容 |
|------|------|----------|
| 03-03 | [AWR/ASH/ADDM 诊断框架](/2026/03/03/oracle/awr-ash-addm-diagnostic-framework/) | 从 ADDM 建议到 AWR 趋势分析，再到 ASH 采样定位瞬时瓶颈 |
| 03-08 | [SQL 执行计划分析精通](/2026/03/08/oracle/sql-execution-plan-analysis-mastery/) | Cost, Cardinality, Access Path 深度解读，10053 Trace 分析 |
| 03-13 | [Oracle 内存管理：AMM vs ASMM](/2026/03/13/oracle/memory-management-amm-vs-asmm/) | SGA/PGA 自动管理优劣分析、大内存服务器参数模板、OOM 预防 |
| 03-18 | [I/O 子系统优化](/2026/03/18/oracle/io-subsystem-optimization/) | ASM Rebalance、存储多路径、Linux I/O 栈全链路调优 |
| 03-23 | [Latch, Mutex 与并发争用调优](/2026/03/23/oracle/latch-mutex-concurrency-tuning/) | Library Cache Lock/Pin、Row Cache Lock 根因与优化 |

## 四、故障排查与应急 (Troubleshooting & Emergency)

| 日期 | 文章 | 核心内容 |
|------|------|----------|
| 03-28 | [解码 ORA-00600 与 ORA-07445](/2026/03/28/oracle/decoding-ora-00600-ora-07445/) | Trace 文件分析、MOS 知识库定位内部错误 |
| 04-02 | [TX/TM 锁机制详解与阻塞会话定位](/2026/04/02/oracle/locks-blocking-session-resolution/) | V$LOCK/V$SESSION 快速定位阻塞源、死锁处理 |
| 04-07 | [Oracle 启动故障排查与 Control File 恢复](/2026/04/07/oracle/startup-failures-controlfile-recovery/) | ORA-01113/ORA-00205 处理、Control File 重建、不完全恢复 |
| 04-12 | [归档日志暴涨与空间危机](/2026/04/12/oracle/archive-log-explosion-space-crisis/) | 归档暴涨根因分析、紧急空间释放脚本、监控预警方案 |
| 04-17 | [TNS 网络故障排查](/2026/04/17/oracle/network-tns-debugging/) | TNS-12541/ORA-12170 系统化诊断、防火墙/Listener 配置 |

## 五、安全与合规 (Security & Compliance)

| 日期 | 文章 | 核心内容 |
|------|------|----------|
| 04-22 | [最小权限原则与角色设计](/2026/04/22/oracle/least-privilege-role-design/) | 基于业务角色的最小权限体系、Profile 资源限制 |
| 04-27 | [TDE 透明数据加密实战](/2026/04/27/oracle/tde-transparent-data-encryption-guide/) | 表空间级加密、Wallet 钱包管理、多租户密钥管理 |
| 05-02 | [Unified Auditing 统一审计实施](/2026/05/02/oracle/unified-auditing-implementation/) | 统一审计策略定制、FGA 配置、审计日志维护 |
| 05-08 | [补丁生命周期管理 RU/PSU](/2026/05/08/oracle/patch-lifecycle-management-ru-psu/) | OPlan 冲突检测、滚动升级、回滚标准化流程 |

## 六、自动化与前沿 (Automation & Modern Trends)

| 日期 | 文章 | 核心内容 |
|------|------|----------|
| 05-15 | [Python/Shell 自动巡检脚本](/2026/05/15/oracle/python-shell-daily-inspection/) | 覆盖表空间、告警日志、备份状态的完整巡检+邮件预警 |
| 05-22 | [Zabbix/Prometheus Oracle 监控定制](/2026/05/22/oracle/zabbix-prometheus-oracle-monitoring/) | 自定义 UserParameter、oracledb_exporter、Grafana Dashboard |
| 05-29 | [ORDS：数据库转化为 REST API](/2026/05/29/oracle/ords-exposing-database-rest-api/) | SQL 查询转化为 RESTful 接口、OAuth2 认证 |
| 06-03 | [Oracle 23ai 新特性：AI Vector Search & JSON](/2026/06/03/oracle/oracle-23ai-ai-vector-search-json/) | 向量数据库、JSON Relational Duality、AI 应用落地 |

---

## 技术栈覆盖

```
数据库版本:  11gR2 → 12c → 19c → 21c → 23ai
高可用架构:  RAC / Data Guard / GoldenGate / ADG
性能工具:    AWR / ASH / ADDM / 10053 Trace / SQL Profile
备份恢复:    RMAN / BCT / Catalog / PITR
安全管理:    TDE / Unified Auditing / 最小权限 / Patch
自动化:      Ansible / Python / Shell / Zabbix / Prometheus / ORDS
操作系统:    RHEL 8/9 / Linux Kernel Tuning / Multipath
```

---

*作者：Cove · Oracle OCM / MySQL OCP · 半导体 DBA*
*博客：[4dba.top](https://4dba.top)*
