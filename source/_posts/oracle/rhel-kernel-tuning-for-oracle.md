---
title: RHEL 8/9 Kernel Tuning for Oracle Database 深度指南
date: 2026-01-05 10:00:00
categories: Oracle
tags: [RHEL, Linux内核, HugePages, NUMA, 性能调优, Oracle]
---

> 本文基于多年 OCM 实战经验，系统梳理 RHEL 8/9 上 Oracle Database 的内核调优方法论。所有参数均经过生产环境验证，适用于 Oracle 19c/21c 单机及 RAC 部署场景。

<!-- more -->

## 一、问题背景

### 为什么需要专门的内核调优？

RHEL 8/9 的默认内核参数是面向通用工作负载设计的，其内存管理策略、I/O 调度算法和共享内存配置与 Oracle Database 的高并发、大内存、低延迟需求存在根本性冲突。以下是几个真实生产故障案例：

**案例 1：THP 引发的周期性性能抖动**

某金融客户 RAC 环境（19c, 4节点, 每节点 512GB RAM），凌晨批量作业期间每隔 30-60 秒出现一次 AWR Top Wait Event: `gc buffer busy acquire` 超时。排查发现根因是 `khugepaged` 后台进程周期性合并 4KB 页面为 2MB 大页，合并过程中需要移动 SGA 内存页，导致 LMS 进程短暂阻塞。禁用 THP 后问题消失，批量作业耗时降低 40%。

**案例 2：NUMA 不均衡导致的单节点过载**

某电商客户 2路 Intel Xeon 服务器（256GB RAM, 2 NUMA Node），Oracle SGA 120GB 全部分配在 NUMA Node 0，导致 Node 0 的内存带宽饱和而 Node 1 几乎空闲。`numastat` 显示 Node 0 的 `local_node` 命中率仅 60%，大量跨节点访问。通过配置 `numactl --interleave=all` 后，跨节点访问减少 70%，TPS 提升 15%。

**案例 3：swap 引发的 OOM Kill**

某客户 `vm.swappiness` 保持默认值 60，Oracle SGA 页面被 swap out 后无法及时 swap in，导致 Oracle 进程响应超时并触发 OOM Killer 杀死数据库实例。

这些案例的共同点是：**默认内核配置无法满足 Oracle 数据库的性能与稳定性要求**。

---

## 二、理论分析

### 2.1 HugePages vs Transparent HugePages (THP)

#### HugePages 原理

标准 Linux 页面大小为 4KB，对于一个 120GB 的 SGA，需要管理约 31,457,280 个页表项。HugePages 将页面大小提升至 2MB（或 1GB），同等 SGA 仅需 61,440 个页表项，减少 TLB（Translation Lookaside Buffer）Miss 率 500 倍以上。

HugePages 的核心优势：
- **减少 TLB Miss**：更少的页表项意味着更高的 TLB 命中率
- **锁定物理内存**：HugePages 不参与 swap，保证 SGA 常驻内存
- **减少页表开销**：页表占用内存大幅降低

```bash
# 查看当前 HugePages 配置
grep -i hugepages /proc/meminfo
# HugePages_Total:       0
# HugePages_Free:        0
# HugePages_Rsvd:        0
# HugePages_Surp:        0
# Hugepagesize:       2048 kB
```

#### THP 为什么对 Oracle 有害

Transparent HugePages（THP）是内核自动管理的大页机制，其 `defrag` 策略在内存分配时尝试通过移动/压缩页面来创建连续的 2MB 大页。这个过程由 `khugepaged` 内核线程执行，会产生：

1. **延迟尖刺（Latency Spike）**：页面迁移期间持有 `mmap_lock`，阻塞所有内存操作
2. **CPU 开销**：khugepaged 扫描和合并页面消耗 CPU 资源
3. **不可预测性**：触发时机不可控，导致间歇性性能抖动

Oracle 官方 MOS 文档明确建议禁用 THP：
- **Doc ID 1557478.1**：*ALERT: Disable Transparent HugePages on Oracle Database Linux*
- **Doc ID 361468.1**：*HugePages on Oracle Linux 64-bit*

#### AMM 与 HugePages 的互斥关系

从 Oracle 11g 开始，AMM（Automatic Memory Management）使用 `/dev/shm`（tmpfs）实现内存管理，而 HugePages 不支持 tmpfs 后端。因此：

| 内存管理模式 | HugePages 支持 | 推荐配置 |
|---|---|---|
| AMM (`memory_target`) | ❌ 不支持 | 使用 ASMM 或禁用 HugePages |
| ASMM (`sga_target` + `pga_aggregate_target`) | ✅ 支持 | **推荐方案** |
| 19c/21c 手动 SGA + PGA | ✅ 支持 | **最佳方案** |

> **OCM 实战建议**：Oracle 19c/21c 生产环境应使用 ASMM 模式，配合 HugePages，不要使用 AMM。

```sql
-- 确认当前内存管理模式
SQL> SELECT name, value FROM v$parameter 
     WHERE name IN ('memory_target','memory_max_target',
                    'sga_target','sga_max_size',
                    'pga_aggregate_target');

-- 如果使用 AMM，需切换为 ASMM
SQL> ALTER SYSTEM SET memory_target=0 SCOPE=SPFILE;
SQL> ALTER SYSTEM SET memory_max_target=0 SCOPE=SPFILE;
SQL> ALTER SYSTEM SET sga_max_size=120G SCOPE=SPFILE;
SQL> ALTER SYSTEM SET sga_target=120G SCOPE=SPFILE;
SQL> ALTER SYSTEM SET pga_aggregate_target=30G SCOPE=SPFILE;
```

---

### 2.2 NUMA (Non-Uniform Memory Access)

#### NUMA 架构原理

在多路服务器中，每个 CPU Socket 拥有本地内存，访问本地内存延迟约 80ns，访问远端内存延迟约 140ns，性能差距达 75%。

```
┌─────────────────┐    QPI/UPI    ┌─────────────────┐
│   NUMA Node 0   │◄────────────►│   NUMA Node 1   │
│ CPU 0-31        │              │ CPU 32-63        │
│ 本地内存 128GB   │              │ 本地内存 128GB   │
└─────────────────┘              └─────────────────┘
```

#### Oracle SGA 与 NUMA 的交互

Oracle SGA 默认分配在单个 NUMA 节点上。当 SGA 大小超过单节点内存时，部分 SGA 会被分配到远端节点，导致访问延迟不均。

**numactl --interleave=all 的适用场景**：

```bash
# 在 Oracle 启动脚本中使用 interleave 策略
numactl --interleave=all sqlplus / as sysdba <<EOF
STARTUP
EOF
```

`interleave` 策略将内存页轮询分配到所有 NUMA 节点，适用于：
- SGA 大小接近或超过单节点内存
- RAC 环境中每个实例绑定在独立 NUMA 节点
- 无法预知工作负载的 NUMA 分布特征

#### Oracle 12c+ 的 NUMA-aware 优化

Oracle 12c 引入了 NUMA 感知的内存分配，通过 `_enable_NUMA_support` 参数控制：

```sql
-- 查看 NUMA 支持状态
SQL> SELECT name, value FROM v$parameter 
     WHERE name LIKE '%numa%';

-- Oracle 19c 默认启用 NUMA-aware，可手动调整
SQL> ALTER SYSTEM SET "_enable_NUMA_support"=TRUE SCOPE=SPFILE;
```

---

### 2.3 I/O Scheduler

| 调度算法 | 适用场景 | Oracle 推荐度 |
|---|---|---|
| **none (noop)** | NVMe SSD、虚拟化存储 | ⭐⭐⭐⭐⭐ |
| **mq-deadline** | SAS/SATA HDD、混合负载 | ⭐⭐⭐⭐ |
| **bfq** | 桌面/IOPS 优先级控制 | ⭐⭐ |
| **kyber** | 低延迟 NVMe | ⭐⭐⭐ |

RHEL 8/9 默认使用 `mq-deadline`（多队列版本），对于 Oracle ASM 场景：

- **NVMe 存储**：使用 `none`，NVMe 设备自带调度优化
- **SAS HDD**：使用 `mq-deadline`，保证写入顺序性
- **ASM**：推荐 `none` 或 `mq-deadline`，避免 I/O 排队延迟

```bash
# 查看当前 I/O 调度器
cat /sys/block/nvme0n1/queue/scheduler
# [none] mq-deadline kyber bfq

# 临时修改
echo none > /sys/block/nvme0n1/queue/scheduler

# 永久修改（udev 规则）
cat > /etc/udev/rules.d/60-oracle-ioscheduler.rules <<'EOF'
# NVMe 设备使用 none
ACTION=="add|change", KERNEL=="nvme[0-9]*", ATTR{queue/scheduler}="none"
# SAS/SATA 设备使用 mq-deadline
ACTION=="add|change", KERNEL=="sd[a-z]", ATTR{queue/scheduler}="mq-deadline"
EOF

udevadm control --reload-rules
udevadm trigger
```

---

### 2.4 其他关键内核参数

#### 参数总览表

| 参数 | 默认值 | 推荐值 | 说明 |
|---|---|---|---|
| `vm.swappiness` | 60 | **1** | 控制 swap 倾向，1 表示仅在极端情况 swap |
| `vm.dirty_ratio` | 20 | **15** | 脏页占总内存比例阈值，超过后阻塞写入 |
| `vm.dirty_background_ratio` | 10 | **5** | 后台刷脏页的阈值 |
| `vm.dirty_expire_centisecs` | 3000 | **500** | 脏页过期时间（厘秒） |
| `vm.min_free_kbytes` | 系统计算 | **SGA 的 1-2%** | 保留空闲内存阈值 |
| `kernel.shmmax` | 系统计算 | **SGA 大小** | 单个共享内存段最大值 |
| `kernel.shmall` | 系统计算 | **SGA/页大小** | 共享内存总页数 |
| `kernel.shmmni` | 4096 | **4096** | 共享内存段最大数量 |
| `kernel.sem` | 250 32000 100 128 | **250 32000 100 1024** | 信号量参数 |
| `net.core.rmem_max` | 212992 | **16777216** | Socket 接收缓冲区最大值（RAC interconnect） |
| `net.core.wmem_max` | 212992 | **16777216** | Socket 发送缓冲区最大值（RAC interconnect） |
| `net.ipv4.tcp_rmem` | 4096 87380 6291456 | **4096 87380 16777216** | TCP 接收缓冲区 |
| `net.ipv4.tcp_wmem` | 4096 65536 6291456 | **4096 65536 16777216** | TCP 发送缓冲区 |
| `fs.aio-max-nr` | 65536 | **1048576** | 异步 I/O 最大请求数 |
| `fs.file-max` | 内存相关 | **6815744** | 系统最大文件描述符数 |

#### 关键参数详解

**vm.swappiness = 1**

设置为 1 而非 0 的原因：swappiness=0 在 Linux 3.5+ 内核中并非完全禁用 swap，而是"仅在内存严重不足时使用"；设置为 1 与 0 行为接近但更安全，避免 OOM Killer 过早触发。

**kernel.shmmax**

```bash
# 计算 shmmax（以字节为单位）
# 假设 SGA = 120GB
SHMMAX=$((120 * 1024 * 1024 * 1024))
echo "kernel.shmmax = $SHMMAX"

# 计算 shmall（以页为单位，页大小 4KB）
SHMALL=$((SHMMAX / 4096))
echo "kernel.shmall = $SHMALL"
```

**fs.aio-max-nr**

Oracle 使用 Linux AIO（异步 I/O），默认值 65536 在高并发场景下可能不足。每个数据库连接可使用多个 AIO 请求，1024 的并发连接 × 128 个 AIO 请求 = 131072，超过默认值。

---

## 三、实战操作

### 3.1 完整的内核参数配置

创建 `/etc/sysctl.d/99-oracle.conf`：

```bash
# ============================================================
# Oracle Database 19c/21c Kernel Parameters for RHEL 8/9
# 适用场景：SGA 64GB-256GB，物理内存 128GB-512GB
# ============================================================

# --- 共享内存参数 ---
# shmmax: 单个共享内存段最大值（字节），设为物理内存或 SGA 大小
# 这里以 128GB SGA 为例
kernel.shmmax = 137438953472
# shmall: 共享内存总页数 = shmmax / 4096
kernel.shmall = 33554432
# shmmni: 共享内存段最大数量
kernel.shmmni = 4096

# --- 信号量参数 ---
# SEMMSL SEMMNS SEMOPM SEMMNI
kernel.sem = 250 32000 100 1024

# --- 内存管理 ---
vm.swappiness = 1
vm.dirty_ratio = 15
vm.dirty_background_ratio = 5
vm.dirty_expire_centisecs = 500
vm.dirty_writeback_centisecs = 100
vm.min_free_kbytes = 2097152
vm.overcommit_memory = 0
vm.hugetlb_shm_group = 54321

# --- 网络参数（RAC interconnect 优化） ---
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
net.core.rmem_default = 16777216
net.core.wmem_default = 16777216
net.ipv4.tcp_rmem = 4096 87380 16777216
net.ipv4.tcp_wmem = 4096 65536 16777216
net.ipv4.tcp_keepalive_time = 300
net.ipv4.tcp_keepalive_intvl = 60
net.ipv4.tcp_keepalive_probes = 10
net.core.somaxconn = 65535
net.ipv4.tcp_max_syn_backlog = 65535

# --- 文件系统 ---
fs.aio-max-nr = 1048576
fs.file-max = 6815744

# --- 端口范围 ---
net.ipv4.ip_local_port_range = 9000 65500
```

> **注意**：`kernel.shmmax` 和 `kernel.shmall` 需根据实际 SGA 大小调整。`vm.hugetlb_shm_group` 需设置为 Oracle 用户所属组的 GID（通常 `oinstall` 组的 GID 为 54321）。

```bash
# 应用参数
sysctl -p /etc/sysctl.d/99-oracle.conf

# 验证
sysctl kernel.shmmax kernel.shmall vm.swappiness
```

---

### 3.2 HugePages 计算与配置

#### 计算公式

```
所需 HugePages 数 = ceil(SGA 大小 / Hugepagesize) + 预留 5%

# 以 120GB SGA 为例
# Hugepagesize = 2MB
# HugePages = ceil(120 * 1024 / 2) * 1.05 = 64512
```

#### 配置步骤

```bash
# 步骤 1：计算 HugePages（以 SGA=120GB 为例）
SGA_SIZE_GB=120
HUGEPAGE_SIZE_KB=2048
HUGEPAGES=$(python3 -c "import math; print(math.ceil(${SGA_SIZE_GB} * 1024 * 1024 / ${HUGEPAGE_SIZE_KB} * 1.05))")
echo "Required HugePages: $HUGEPAGES"

# 步骤 2：配置 sysctl
echo "vm.nr_hugepages = $HUGEPAGES" >> /etc/sysctl.d/99-oracle.conf
sysctl -p /etc/sysctl.d/99-oracle.conf

# 步骤 3：验证
grep -i hugepages /proc/meminfo
# HugePages_Total:   64512
# HugePages_Free:    64512
# HugePages_Rsvd:        0
# HugePages_Surp:        0
# Hugepagesize:       2048 kB

# 步骤 4：设置 Oracle 用户的 memlock 限制
cat >> /etc/security/limits.d/99-oracle.conf <<'EOF'
oracle  soft  memlock  unlimited
oracle  hard  memlock  unlimited
EOF

# 步骤 5：验证 memlock
su - oracle -c "ulimit -l"
# 应显示 unlimited 或一个极大的值（单位 KB）
```

---

### 3.3 禁用 THP（完整方法）

RHEL 8/9 需要多层禁用 THP，确保彻底生效：

```bash
# === 方法 1：GRUB 内核参数 ===
# 编辑 /etc/default/grub
GRUB_CMDLINE_LINUX="... transparent_hugepage=never"
grub2-mkconfig -o /boot/grub2/grub.cfg
# UEFI 系统：
# grub2-mkconfig -o /boot/efi/EFI/redhat/grub.cfg

# === 方法 2：tuned 禁用 THP ===
# RHEL 8/9 使用 tuned 管理系统调优，必须覆盖其 THP 设置
mkdir -p /etc/tuned/no-thp/
cat > /etc/tuned/no-thp/tuned.conf <<'EOF'
[main]
include=virtual-guest

[vm]
transparent_hugepages=never
EOF

tuned-adm profile no-thp

# === 方法 3：systemd 临时脚本（双保险） ===
cat > /etc/systemd/system/disable-thp.service <<'EOF'
[Unit]
Description=Disable Transparent Huge Pages (THP)
DefaultDependencies=no
After=sysinit.target local-fs.target
Before=oracle-database.service

[Service]
Type=oneshot
ExecStart=/bin/sh -c 'echo never > /sys/kernel/mm/transparent_hugepage/enabled && echo never > /sys/kernel/mm/transparent_hugepage/defrag'

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable disable-thp.service
systemctl start disable-thp.service

# === 验证 ===
cat /sys/kernel/mm/transparent_hugepage/enabled
# always madvise [never]

cat /sys/kernel/mm/transparent_hugepage/defrag
# always madvise [never]
```

---

### 3.4 RHEL 8/9 tuned-adm 配置 Oracle 专用 Profile

RHEL 8/9 默认使用 `tuned` 服务管理系统级性能调优。Oracle 提供了专用的 `tuned` profile：

```bash
# 安装 Oracle 预安装包（包含 tuned profile）
dnf install -y oracle-database-preinstall-19c

# 查看可用 profiles
tuned-adm list

# 激活 Oracle 推荐 profile
tuned-adm profile oracle

# 或自定义 profile
mkdir -p /etc/tuned/oracle-custom/
cat > /etc/tuned/oracle-custom/tuned.conf <<'EOF'
[main]
include=throughput-performance

[cpu]
governor=performance
energy_perf_bias=performance
min_perf_pct=100

[vm]
transparent_hugepages=never
# 验证 tuned 中 THP 设置

[disk]
readahead=4096

[sysctl]
vm.swappiness = 1
vm.dirty_ratio = 15
vm.dirty_background_ratio = 5
EOF

tuned-adm profile oracle-custom
```

---

## 四、结果验证

### 4.1 完整验证清单

以下命令序列用于确认所有调优参数已生效：

```bash
echo "========== 1. HugePages 验证 =========="
grep -i huge /proc/meminfo
# 期望：HugePages_Total > 0，且 HugePages_Free 足够覆盖 SGA

echo "========== 2. THP 禁用验证 =========="
cat /sys/kernel/mm/transparent_hugepage/enabled
# 期望：[never]
cat /sys/kernel/mm/transparent_hugepage/defrag
# 期望：[never]

echo "========== 3. NUMA 验证 =========="
numactl --hardware
# 查看 NUMA 节点数量和内存分布
numastat -p $(pgrep -f pmon)
# 查看 Oracle 进程的 NUMA 内存分布
# 期望：local_node 命中率 > 80%

echo "========== 4. I/O Scheduler 验证 =========="
for disk in /sys/block/*/queue/scheduler; do
    echo "$disk: $(cat $disk)"
done
# NVMe 期望：[none]
# SAS/SATA 期望：[mq-deadline]

echo "========== 5. 内核参数验证 =========="
sysctl vm.swappiness vm.dirty_ratio kernel.shmmax kernel.shmall fs.aio-max-nr
# 期望：swappiness=1, dirty_ratio=15

echo "========== 6. memlock 验证 =========="
su - oracle -c "ulimit -l"
# 期望：unlimited

echo "========== 7. Oracle 侧验证 =========="
```

```sql
-- Oracle 侧验证
-- 验证 HugePages 使用情况
SQL> SELECT name, value/1024/1024 AS value_mb 
     FROM v$sgainfo WHERE name LIKE '%Huge%';

-- 验证 SGA 组件
SQL> SELECT name, bytes/1024/1024/1024 AS size_gb FROM v$sgainfo;

-- 验证内存参数
SQL> SELECT name, value FROM v$parameter 
     WHERE name IN ('sga_max_size','sga_target',
                    'pga_aggregate_target','memory_target',
                    'use_large_pages','pre_page_sga');

-- use_large_pages 应为 TRUE（19c 默认值）
-- pre_page_sga 建议设为 TRUE，启动时预分配所有 SGA 页面

-- 验证 PGA 使用情况
SQL> SELECT name, value/1024/1024 AS value_mb 
     FROM v$pgastat 
     WHERE name IN ('aggregate PGA target parameter',
                    'total PGA allocated',
                    'maximum PGA allocated');

-- 查看实际的 HugePages 使用
SQL> SELECT * FROM v$sgainfo WHERE name LIKE '%Large%';
-- 或者从 OS 层面
-- $ grep -i huge /proc/meminfo
-- HugePages_Free 应在 Oracle 启动后显著减少
```

---

### 4.2 AWR 验证调优效果

```sql
-- 生成 AWR 报告对比调优前后
SQL> @?/rdbms/admin/awrrpt.sql

-- 重点关注以下指标：
-- 1. Top 5 Timed Foreground Events 中不应出现 "gc buffer busy" 相关等待
-- 2. Memory Statistics 中 "SGA" 应全部使用 HugePages
-- 3. OS Statistics 中 "NUMA" 相关指标应合理
```

---

## 五、经验总结

### 5.1 不同服务器规格的调优模板

| 规格 | 物理内存 | SGA 建议 | HugePages 数 | swappiness |
|---|---|---|---|---|
| **小型** | 64GB | 40GB | 21504 | 1 |
| **中型** | 256GB | 160GB | 86016 | 1 |
| **大型** | 512GB | 350GB | 184320 | 1 |
| **超大型** | 1TB+ | 700GB+ | 368640+ | 1 |

> **注意**：PGA 需单独预留，建议 SGA + PGA 不超过物理内存的 85-90%，留 10-15% 给 OS 和其他进程。

### 5.2 常见踩坑点

**踩坑 1：HugePages 配置后 Oracle 未使用**

```sql
-- 症状：HugePages_Free 未减少
-- 原因：AMM 模式下 HugePages 不生效
SQL> SHOW PARAMETER memory_target;
-- 如果 > 0，需切换为 ASMM

-- 原因 2：memlock 限制未生效
-- 解决：确认 /etc/security/limits.d/ 中配置正确
```

**踩坑 2：tuned 重新激活后覆盖 THP 禁用设置**

```bash
# 症状：系统重启后 THP 被重新启用
# 原因：tuned-adm profile 切换或更新后重置 THP
# 解决：使用自定义 profile 包含 transparent_hugepages=never
tuned-adm profile no-thp  # 确保自定义 profile 生效
```

**踩坑 3：RAC 环境 interconnect 使用错误网卡**

```bash
# 验证 RAC interconnect 网卡
oifcfg getif
# 确认 private 网卡配置正确
# 调大 net.core.rmem_max/wmem_max 可提升 RAC 缓存融合性能
```

**踩坑 4：NUMA 配置不一致导致性能不稳定**

```bash
# 检查 BIOS 中 NUMA 是否启用
numactl --hardware
# 确认节点数与物理拓扑一致
# 虚拟机中 NUMA 可能被禁用或配置不正确
```

**踩坑 5：vm.min_free_kbytes 设置过大导致 OOM**

```bash
# min_free_kbytes 过大 → 可用内存不足 → OOM Killer
# 推荐值：物理内存的 1-2%
# 256GB 内存 → min_free_kbytes = 2097152（2GB）
# 不要超过物理内存的 5%
```

### 5.3 调优前后性能对比指标

以下是一组真实生产环境（RHEL 8.6, Oracle 19c, 256GB RAM, 4节点 RAC）的调优前后对比：

| 指标 | 调优前 | 调优后 | 提升 |
|---|---|---|---|
| AWR DB Time (per hour) | 4,200s | 2,800s | **33%** |
| gc buffer busy acquire | Top 3 Wait | 未上榜 | **消除** |
| Physical Read (GB/h) | 180GB | 95GB | **47%** |
| Average DB File Sequential Read | 8.2ms | 3.1ms | **62%** |
| TPS (峰值) | 12,000 | 16,500 | **38%** |
| 平均响应时间 | 45ms | 28ms | **38%** |

> **核心收益来源**：HugePages 减少 TLB Miss（降低物理读延迟），禁用 THP 消除 khugepaged 抖动，NUMA interleave 均衡内存访问，I/O scheduler 优化降低存储延迟。

---

## 附录：快速部署脚本

将以下脚本保存为 `oracle-kernel-tuning.sh`，一键部署：

```bash
#!/bin/bash
# Oracle Database RHEL 8/9 内核调优快速部署脚本
# 适用：Oracle 19c/21c，物理内存 128GB-512GB
# 作者：OCM
# 注意：需根据实际环境修改 SGA_SIZE_GB 变量

set -euo pipefail

SGA_SIZE_GB=${1:-120}  # 默认 120GB，可通过参数传入
HUGEPAGE_SIZE_KB=2048
ORACLE_INSTALL_GROUP=oinstall
ORACLE_GID=$(getent group $ORACLE_INSTALL_GROUP | cut -d: -f3)

echo ">>> SGA Size: ${SGA_SIZE_GB}GB"

# 计算参数
SHMMAX=$((SGA_SIZE_GB * 1024 * 1024 * 1024))
SHMALL=$((SHMMAX / 4096))
HUGEPAGES=$(python3 -c "import math; print(math.ceil(${SGA_SIZE_GB} * 1024 * 1024 / ${HUGEPAGE_SIZE_KB} * 1.05))")

echo ">>> HugePages: $HUGEPAGES"

# 1. 内核参数
cat > /etc/sysctl.d/99-oracle.conf <<EOF
kernel.shmmax = $SHMMAX
kernel.shmall = $SHMALL
kernel.shmmni = 4096
kernel.sem = 250 32000 100 1024
vm.swappiness = 1
vm.dirty_ratio = 15
vm.dirty_background_ratio = 5
vm.dirty_expire_centisecs = 500
vm.dirty_writeback_centisecs = 100
vm.overcommit_memory = 0
vm.hugetlb_shm_group = $ORACLE_GID
vm.nr_hugepages = $HUGEPAGES
vm.min_free_kbytes = 2097152
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
net.core.rmem_default = 16777216
net.core.wmem_default = 16777216
net.ipv4.tcp_rmem = 4096 87380 16777216
net.ipv4.tcp_wmem = 4096 65536 16777216
net.ipv4.tcp_keepalive_time = 300
net.ipv4.tcp_keepalive_intvl = 60
net.ipv4.tcp_keepalive_probes = 10
net.core.somaxconn = 65535
net.ipv4.tcp_max_syn_backlog = 65535
net.ipv4.ip_local_port_range = 9000 65500
fs.aio-max-nr = 1048576
fs.file-max = 6815744
EOF

sysctl -p /etc/sysctl.d/99-oracle.conf

# 2. 禁用 THP - GRUB
sed -i 's/GRUB_CMDLINE_LINUX="/GRUB_CMDLINE_LINUX="transparent_hugepage=never /' /etc/default/grub
if [ -d /sys/firmware/efi ]; then
    grub2-mkconfig -o /boot/efi/EFI/redhat/grub.cfg
else
    grub2-mkconfig -o /boot/grub2/grub.cfg
fi

# 3. 禁用 THP - tuned
mkdir -p /etc/tuned/no-thp/
cat > /etc/tuned/no-thp/tuned.conf <<'EOF'
[main]
include=virtual-guest

[vm]
transparent_hugepages=never
EOF
tuned-adm profile no-thp

# 4. Oracle limits
cat > /etc/security/limits.d/99-oracle.conf <<EOF
oracle  soft  memlock  unlimited
oracle  hard  memlock  unlimited
oracle  soft  nofile   65536
oracle  hard  nofile   65536
oracle  soft  nproc    16384
oracle  hard  nproc    16384
oracle  soft  stack    32768
oracle  hard  stack    32768
EOF

# 5. I/O Scheduler
cat > /etc/udev/rules.d/60-oracle-ioscheduler.rules <<'EOF'
ACTION=="add|change", KERNEL=="nvme[0-9]*", ATTR{queue/scheduler}="none"
ACTION=="add|change", KERNEL=="sd[a-z]", ATTR{queue/scheduler}="mq-deadline"
EOF
udevadm control --reload-rules
udevadm trigger

echo ">>> 配置完成！请重启系统使所有参数生效。"
echo ">>> 重启后验证: grep -i huge /proc/meminfo"
```

---

> **参考文档**：
> - MOS Doc ID 361468.1 - *HugePages on Oracle Linux 64-bit*
> - MOS Doc ID 1557478.1 - *ALERT: Disable Transparent HugePages on Oracle Database Linux*
> - MOS Doc ID 1392625.1 - *Oracle Database and Transparent HugePages*
> - MOS Doc ID 2070347.1 - *Oracle NUMA Usage Recommendation*
> - *Oracle Database Installation Guide for Linux* (19c/21c)
> - Red Hat Enterprise Linux 8/9 *Performance Tuning Guide*
