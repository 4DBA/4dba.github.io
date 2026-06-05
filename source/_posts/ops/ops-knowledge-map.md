---
title: 运维杂记 知识地图
lang: zh-CN
date: 2025-06-04 12:00:03
categories: 运维杂记
tags: [知识地图, 导航]
---

> 数据库之外的运维知识：中间件、操作系统、监控体系、自动化工具。

<!-- more -->

## 一、Linux 系统管理

| 主题 | 说明 |
|------|------|
| RHEL/CentOS | 系统安装、systemd 管理、firewalld/SELinux |
| 内核调优 | sysctl 参数、ulimit 配置、transparent_hugepage |
| 存储管理 | LVM、XFS/ext4 选型、多路径配置 |
| 网络管理 | NetworkManager、bonding、VLAN、iptables/nftables |
| 故障排查 | dmesg、journalctl、perf、strace |

## 二、虚拟化与云

| 主题 | 说明 |
|------|------|
| VMware ESXi | 虚拟机管理、资源分配、性能调优 |
| PVE (Proxmox) | LXC 容器、ZFS 存储、集群管理 |
| 云服务 | 阿里云 ECS/RDS、对象存储、CDN |

## 三、中间件

| 主题 | 说明 |
|------|------|
| Tibco BW/EMS/RV | 中间件部署、消息队列管理、故障排查 |
| Nginx/OpenResty | 反向代理、负载均衡、SSL 配置 |
| HAProxy | 四/七层负载均衡、健康检查 |
| Redis | 哨兵/集群模式、持久化、内存优化 |

## 四、监控与告警

| 主题 | 说明 |
|------|------|
| Zabbix | 模板开发、LLD 自动发现、告警升级 |
| Splunk | 日志收集、SPL 搜索、告警规则 |
| Prometheus + Grafana | 指标采集、Dashboard 设计 |
| 告警治理 | 告警降噪、分级、On-Call 机制 |

## 五、备份与容灾

| 主题 | 说明 |
|------|------|
| NetBackup | 备份策略、Catalog 管理、恢复演练 |
| rsync/scp | 文件级同步、增量备份 |
| 快照备份 | ZFS 快照、LVM 快照 |

## 六、自动化运维

| 主题 | 说明 |
|------|------|
| Shell 脚本 | 日常巡检、批量操作、checkpoint/resume |
| Ansible | Playbook 编写、Role 设计、批量部署 |
| CI/CD | GitLab CI、Jenkins、自动化发布 |
| 文档管理 | 运维知识库、SOP 文档化 |
