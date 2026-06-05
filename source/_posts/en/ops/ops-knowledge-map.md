---
title: Ops Knowledge Map
date: 2025-06-04 12:00:03
categories: 运维杂记
tags: [知识地图, 导航]
lang: en
---

> Operations knowledge beyond databases: middleware, operating systems, monitoring systems, and automation tools.

<!-- more -->

## 1. Linux System Administration

| Topic | Description |
|------|------|
| RHEL/CentOS | System installation, systemd management, firewalld/SELinux |
| Kernel Tuning | sysctl parameters, ulimit configuration, transparent_hugepage |
| Storage Management | LVM, XFS/ext4 selection, multipath configuration |
| Network Management | NetworkManager, bonding, VLAN, iptables/nftables |
| Troubleshooting | dmesg, journalctl, perf, strace |

## 2. Virtualization and Cloud

| Topic | Description |
|------|------|
| VMware ESXi | VM management, resource allocation, performance tuning |
| PVE (Proxmox) | LXC containers, ZFS storage, cluster management |
| Cloud Services | Alibaba Cloud ECS/RDS, object storage, CDN |

## 3. Middleware

| Topic | Description |
|------|------|
| Tibco BW/EMS/RV | Middleware deployment, message queue management, troubleshooting |
| Nginx/OpenResty | Reverse proxy, load balancing, SSL configuration |
| HAProxy | Layer 4/7 load balancing, health checks |
| Redis | Sentinel/cluster mode, persistence, memory optimization |

## 4. Monitoring and Alerting

| Topic | Description |
|------|------|
| Zabbix | Template development, LLD auto-discovery, alert escalation |
| Splunk | Log collection, SPL search, alert rules |
| Prometheus + Grafana | Metric collection, Dashboard design |
| Alert Governance | Alert noise reduction, classification, on-call mechanisms |

## 5. Backup and Disaster Recovery

| Topic | Description |
|------|------|
| NetBackup | Backup strategy, catalog management, recovery drills |
| rsync/scp | File-level synchronization, incremental backup |
| Snapshot Backup | ZFS snapshots, LVM snapshots |

## 6. Automation Operations

| Topic | Description |
|------|------|
| Shell Scripts | Daily inspections, batch operations, checkpoint/resume |
| Ansible | Playbook writing, Role design, batch deployment |
| CI/CD | GitLab CI, Jenkins, automated release |
| Documentation | Operations knowledge base, SOP documentation |
