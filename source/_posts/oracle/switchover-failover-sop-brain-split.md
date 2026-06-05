---
title: Data Guard Switchover/Failover SOP 与脑裂预防机制
date: 2026-02-15 10:00:00
categories: Oracle
tags: [Data Guard, Switchover, Failover, 脑裂, 容灾演练, SOP]
---

## 一、问题背景

### 为什么需要标准化的角色切换SOP

在生产环境中，Oracle Data Guard 的角色切换（Switchover/Failover）是一项高风险操作。没有标准化的操作手册，DBA 在面对紧急故障时容易犯下不可挽回的错误——跳过检查步骤、遗漏数据一致性验证、在错误的时机执行命令，任何一个小失误都可能导致数小时甚至数天的业务中断。

<!-- more -->


标准化的 SOP（Standard Operating Procedure）能够确保：

- **操作可重复**：任何具备资质的 DBA 都能按照手册完成切换
- **风险可控**：每一步操作都有明确的前置条件和验证标准
- **回退可执行**：出现异常时能快速恢复到安全状态
- **审计可追溯**：每一次操作都有记录，满足合规要求

### 切换失败的生产事故案例

以下是一个真实场景的还原：

某金融客户在机房迁移期间执行 Switchover，由于未提前检查 Standby 的归档日志是否连续应用，切换完成后发现新 Primary 缺少 30 分钟的交易数据。更糟糕的是，运维团队在发现问题后尝试回切，却因新旧 Primary 的角色状态混乱导致两个数据库都进入了不可用状态——这就是典型的**脑裂（Split Brain）**场景。

最终代价：业务中断 4 小时，数据丢失约 15 分钟，事后复盘耗时一周。

### 脑裂(Split Brain)对数据一致性的致命影响

脑裂是 Data Guard 架构中最危险的状态——Primary 和 Standby 同时以 Primary 角色运行，各自接受写入，导致两份数据库出现数据分叉。一旦脑裂发生：

- 两份数据库的数据开始分叉，无法简单合并
- 应用可能连接到错误的数据库，写入不一致的数据
- 修复过程需要停机比对，业务影响巨大
- 严重时可能需要从备份恢复，RPO 暴增

因此，理解脑裂的产生机制并建立完善的预防体系，是每一位 DBA 的必修课。

---

## 二、理论分析

### 2.1 Switchover vs Failover

**Switchover（计划性切换）**

Switchover 是一种有序的角色转换过程。Primary 变为 Standby，Standby 变为 Primary，整个过程**零数据丢失**。

```
切换前:  Primary (PROD) ---> Standby (DR)
切换后:  Standby (PROD) <--- Primary (DR)
```

**适用场景**：
- 计划性维护（硬件升级、操作系统补丁、存储迁移）
- 定期容灾演练
- 数据中心迁移
- 负载均衡需求（读写分离架构调整）

**Failover（紧急切换）**

Failover 是在 Primary 不可用时的应急操作。Standby 被激活为新的 Primary，原有 Primary 被废弃或降级。

```
切换前:  Primary (PROD) [故障]   Standby (DR)
切换后:  废弃/恢复     <---   Primary (DR)
```

**适用场景**：
- Primary 数据库所在机房火灾、地震等灾难
- 存储阵列故障，短时间内无法恢复
- 数据库严重损坏，无法修复
- 网络完全中断，Primary 不可达

**关键区别**：

| 特性 | Switchover | Failover |
|------|-----------|----------|
| 触发条件 | 计划性 | 紧急/非计划性 |
| 数据丢失 | 无 | 可能（取决于保护模式） |
| 可逆性 | 完全可逆 | 需重建旧Primary |
| 归档日志间隙 | 无 | 可能存在 |
| 操作复杂度 | 低 | 高 |

### 2.2 脑裂(Split Brain)产生的根因

脑裂的本质是分布式系统中的一致性问题——两个节点同时认为自己是 Primary 并接受写入。

**场景一：网络分区（Network Partition）**

```
正常状态:
Client --> Primary <==== 心跳/Redo传输 ====> Standby

网络分区:
Client --> Primary <----X----> Standby
                         ↑
                    网络中断

问题: Standby 如何判断 Primary 是真的挂了，还是仅仅网络不通？
```

当 Primary 与 Standby 之间的网络中断时，Standby 可能无法确定 Primary 的状态。如果此时贸然将 Standby 提升为 Primary，而原 Primary 其实仍在运行并接受写入，脑裂就产生了。

**场景二：角色转换过程中的时序问题**

在 Switchover 过程中，如果操作执行到一半（旧 Primary 已经 shutdown，新 Primary 已经 open），但网络故障导致旧 Primary 重新启动后以 Primary 角色恢复运行，也会出现脑裂。

**场景三：Fast-Start Failover 的仲裁失败**

FSFO 依赖 Observer 进行故障仲裁。如果 Observer 所在网络分区导致无法同时访问两个数据库，Observer 可能做出错误的切换决策。

### 2.3 脑裂预防机制

#### FSFO 的 Observer 进程

Observer 是 Fast-Start Failover 的核心仲裁组件。它是一个独立进程，运行在第三方节点上（既不是 Primary 也不是 Standby），持续监控两个数据库的状态。

```
Primary <--- Observer ---> Standby
              |
              v
         第三方主机
```

Observer 的仲裁逻辑：
- 定期向 Primary 发送心跳（默认每秒一次）
- 如果 Primary 失联超过 `FastStartFailoverLagLimit`，Observer 触发 Failover
- Observer 同时连接两个数据库，避免单点误判

#### 三种保护模式对脑裂的影响

| 保护模式 | 数据保护 | 性能影响 | 脑裂风险 |
|---------|---------|---------|---------|
| Maximum Protection | 零丢失 | 最大 | 最低 |
| Maximum Availability | 尽量零丢失 | 中等 | 中等 |
| Maximum Performance | 可能丢数据 | 最小 | 最高 |

**Maximum Protection** 模式下，如果 Standby 不可用，Primary 会自动关闭（SHUTDOWN ABORT），从根本上杜绝了两个数据库同时运行的可能性。但代价是可能造成业务中断。

**Maximum Performance** 模式下，Primary 不等待 Standby 确认，即使 Standby 离线 Primary 也能正常运行，这在性能上最优，但脑裂风险最高。

推荐方案：在生产环境中使用 **Maximum Availability** 模式，在可用性和安全性之间取得平衡。

#### 网络冗余与心跳检测

```
推荐的网络架构:

Standby Host
    |-- NIC1 --> 网络A (业务网络) --> Primary Host
    |-- NIC2 --> 网络B (专用心跳) --> Primary Host
    |-- NIC3 --> 网络C (管理网络) --> Primary Host
```

关键措施：
- 使用独立的专用网络传输 Redo 日志
- 配置多条网络路径，避免单点故障
- 使用 Oracle Net 的多重地址配置（`FAILOVER=ON`）
- 配置 OS 级别的心跳检测（如 Oracle Clusterware、Pacemaker）

---

## 三、实战操作

### 3.1 Switchover SOP（标准化操作手册）

#### 切换前检查清单

**必须在切换前逐项确认，任何一项不满足则停止操作：**

```
=== Switchover 切换前检查清单 ===

□ 1. 确认当前角色
   SELECT database_role, open_mode, switchover_status FROM v$database;
   -- Primary: switchover_status 必须为 TO STANDBY 或 SESSIONS ACTIVE
   -- Standby: 必须为 NOT ALLOWED 或 SESSIONS ACTIVE

□ 2. 检查归档日志是否连续应用
   -- 在 Standby 上执行:
   SELECT thread#, max(sequence#) FROM v$archived_log WHERE applied='YES' GROUP BY thread#;
   -- 在 Primary 上执行:
   SELECT thread#, max(sequence#) FROM v$archived_log GROUP BY thread#;
   -- 两边的 sequence# 必须一致

□ 3. 检查是否有 GAPS
   SELECT * FROM v$archive_gap;
   -- 结果必须为空

□ 4. 检查 Standby 的 Redo Apply 是否在运行
   SELECT process, status FROM v$managed_standby WHERE process LIKE 'MRP%';
   -- MRP0 必须存在且状态为 APPLYING_LOG

□ 5. 检查临时文件是否一致
   -- 确保 Standby 的临时表空间文件存在且可访问

□ 6. 检查所有实例（RAC 环境）
   -- 所有实例都必须在线，或者只有一个实例在线
   -- 确认没有活跃的长事务
   SELECT * FROM v$transaction WHERE status != 'INACTIVE';

□ 7. 停止应用连接
   -- 通知应用团队停止写入
   -- 或者在 Primary 上执行:
   ALTER SYSTEM QUIESCE RESTRICTED;  -- 可选，需谨慎

□ 8. 创建恢复保证点（可选但推荐）
   -- 在 Primary 上:
   CREATE RESTORE POINT switchover_guarantee GUARANTEE FLASHBACK DATABASE;

□ 9. 确认网络连通性
   -- Primary 到 Standby 的 TNS 连接正常
   -- Standby 到 Primary 的 TNS 连接正常
```

#### Broker 执行 Switchover 命令

使用 Data Guard Broker 是最推荐的方式，它会自动处理大部分步骤：

```sql
-- 连接到 DGMGRL
$ dgmgrl sys/password@primary_db

-- 查看当前配置状态
DGMGRL> SHOW CONFIGURATION;
DGMGRL> SHOW DATABASE VERBOSE 'primary_db';
DGMGRL> SHOW DATABASE VERBOSE 'standby_db';

-- 执行 Switchover（Broker 自动处理所有步骤）
DGMGRL> SWITCHOVER TO 'standby_db';

-- 验证切换结果
DGMGRL> SHOW CONFIGURATION;
```

Broker Switchover 的内部步骤：
1. 将 Primary 数据库转换为 Standby 角色
2. 将 Standby 数据库转换为 Primary 角色
3. 自动重启两个数据库
4. 重新启用 Redo 传输和应用

#### 手动 Switchover 详细步骤

当 Broker 不可用时，需要手动执行：

**Step 1: 在 Primary 上准备切换**

```sql
-- 检查切换状态
SQL> SELECT switchover_status FROM v$database;

-- 如果状态为 TO STANDBY，直接执行:
SQL> ALTER DATABASE COMMIT TO SWITCHOVER TO STANDBY WITH SESSION SHUTDOWN;

-- 如果状态为 SESSIONS ACTIVE，需要先杀掉会话或使用:
SQL> ALTER DATABASE COMMIT TO SWITCHOVER TO STANDBY WITH SESSION SHUTDOWN;
```

**Step 2: 在 Standby 上准备切换**

```sql
-- 在 Standby 上取消 Redo Apply
SQL> ALTER DATABASE RECOVER MANAGED STANDBY DATABASE CANCEL;

-- 检查状态
SQL> SELECT switchover_status FROM v$database;

-- 将 Standby 转换为 Primary
SQL> ALTER DATABASE COMMIT TO SWITCHOVER TO PRIMARY;

-- 如果是 Physical Standby 且曾以只读方式打开过:
SQL> ALTER DATABASE COMMIT TO SWITCHOVER TO PRIMARY WITH SESSION SHUTDOWN;
```

**Step 3: 打开新 Primary**

```sql
-- 在新的 Primary（原 Standby）上:
SQL> ALTER DATABASE OPEN;
```

**Step 4: 在新 Standby 上启动 Redo Apply**

```sql
-- 在新的 Standby（原 Primary）上:
SQL> STARTUP MOUNT;
SQL> ALTER DATABASE RECOVER MANAGED STANDBY DATABASE DISCONNECT FROM SESSION;
```

#### 切换后验证步骤

```sql
=== 切换后验证清单 ===

□ 1. 确认角色
   SELECT database_role, open_mode FROM v$database;
   -- 新 Primary: PRIMARY / READ WRITE
   -- 新 Standby: PHYSICAL STANDBY / MOUNTED 或 READ ONLY WITH APPLY

□ 2. 确认 Redo 传输正常
   -- 在新 Primary 上:
   SELECT dest_id, status, error FROM v$archive_dest WHERE dest_id=2;
   -- status 必须为 VALID

□ 3. 确认归档日志序列号连续
   -- 新 Primary 最新归档序列号
   -- 新 Standby 已应用到的序列号

□ 4. 验证数据一致性
   -- 抽样检查关键表的数据条数
   SELECT COUNT(*) FROM critical_table;

□ 5. 验证应用连接
   -- 应用团队确认连接正常
   -- 执行简单的读写测试
```

#### 回切步骤

如需回切到原 Primary，只需再次执行 Switchover：

```sql
-- 在新 Primary（原 Standby）上:
DGMGRL> SWITCHOVER TO 'original_primary_db';
```

### 3.2 Failover SOP

#### 判断是否需要 Failover

Failover 是最后手段，在执行前必须确认以下条件：

```
=== Failover 决策树 ===

1. Primary 数据库是否真的不可用？
   ├── 仅网络不通？ → 不要 Failover，检查网络
   ├── 仅数据库实例挂了？ → 尝试 STARTUP
   ├── 存储故障？ → 评估恢复时间
   └── 机房级灾难？ → 确认 Failover

2. 预计恢复时间 (RTO) 是否超出容忍范围？
   ├── < RTO → 等待恢复
   └── > RTO → 执行 Failover

3. 是否有数据丢失？
   └── Maximum Protection 模式 → 零丢失，放心 Failover
   └── Maximum Performance 模式 → 评估丢失量
```

#### 手动 Failover 步骤

```sql
-- Step 1: 在 Standby 上检查归档日志应用情况
SQL> SELECT thread#, max(sequence#) FROM v$archived_log WHERE applied='YES' GROUP BY thread#;

-- Step 2: 尝试应用所有可用的归档日志
SQL> ALTER DATABASE RECOVER MANAGED STANDBY DATABASE CANCEL;
SQL> ALTER DATABASE RECOVER MANAGED STANDBY DATABASE FINISH;

-- Step 3: 如果有数据丢失风险（返回 ORA-19909），确认继续
SQL> ALTER DATABASE RECOVER MANAGED STANDBY DATABASE FINISH FORCE;

-- Step 4: 将 Standby 转换为 Primary
SQL> ALTER DATABASE COMMIT TO SWITCHOVER TO PRIMARY;
-- 或者（如果 switchover_status 不允许）:
SQL> ALTER DATABASE ACTIVATE STANDBY DATABASE;

-- Step 5: 打开数据库
SQL> ALTER DATABASE OPEN;

-- 注意: ACTIVATE STANDBY DATABASE 是不可逆操作！
```

#### Broker Failover 操作

```sql
$ dgmgrl sys/password@standby_db

-- 执行 Failover
DGMGRL> FAILOVER TO 'standby_db';

-- 验证
DGMGRL> SHOW CONFIGURATION;
```

#### Failover 后重建旧 Primary

Failover 后，旧 Primary 不能直接作为 Standby 使用，需要重建：

**方法一：使用 Flashback Database**

```sql
-- 在旧 Primary 上（如果能启动）:
SQL> STARTUP MOUNT;

-- 记录 Failover 时的 SCN
-- 在新 Primary 上:
SQL> SELECT standby_became_primary_scn FROM v$database;

-- 在旧 Primary 上:
SQL> FLASHBACK DATABASE TO SCN <standby_became_primary_scn>;

-- 转换为 Standby
SQL> ALTER DATABASE CONVERT TO PHYSICAL STANDBY;
SQL> SHUTDOWN IMMEDIATE;
SQL> STARTUP MOUNT;
SQL> ALTER DATABASE RECOVER MANAGED STANDBY DATABASE DISCONNECT FROM SESSION;
```

**方法二：RMAN 重建**

```bash
# 在旧 Primary 主机上
$ rman target /

RMAN> STARTUP MOUNT;
RMAN> RESTORE DATABASE;
RMAN> RECOVER DATABASE;

# 或者使用 DUPLICATE
RMAN> DUPLICATE TARGET DATABASE FOR STANDBY FROM ACTIVE DATABASE;
```

### 3.3 FSFO 配置与演练

#### Observer 进程配置

```sql
-- Step 1: 在 Observer 主机上安装 Oracle Client

-- Step 2: 配置 tnsnames.ora，确保 Observer 能连接两个数据库

-- Step 3: 在 Broker 中设置 FSFO 参数
DGMGRL> EDIT DATABASE 'primary_db' SET PROPERTY FastStartFailoverTarget = 'standby_db';
DGMGRL> EDIT DATABASE 'standby_db' SET PROPERTY FastStartFailoverTarget = 'primary_db';
DGMGRL> EDIT CONFIGURATION SET PROPERTY FastStartFailoverLagLimit = 30;
DGMGRL> EDIT CONFIGURATION SET PROPERTY FastStartFailoverThreshold = 30;
DGMGRL> EDIT CONFIGURATION SET PROPERTY ObserverConnectIdentifier = 'observer_host';

-- Step 4: 启动 Observer
$ dgmgrl sys/password@primary_db
DGMGRL> START OBSERVER;
-- Observer 将在前台持续运行

-- 生产环境建议使用 nohup 或 systemd 管理 Observer 进程
```

#### FSFO 启用与测试

```sql
-- 确认保护模式（FSFO 要求至少 Maximum Availability）
DGMGRL> EDIT CONFIGURATION SET PROTECTION MODE AS MaxAvailability;

-- 启用 FSFO
DGMGRL> ENABLE FAST_START FAILOVER;

-- 验证 FSFO 状态
DGMGRL> SHOW FAST_START FAILOVER;
```

#### 模拟故障自动切换

```sql
-- 在 Primary 上模拟故障
SQL> SHUTDOWN ABORT;

-- 观察 Observer 日志，等待自动 Failover
-- Observer 会在 FastStartFailoverThreshold 秒后自动执行 Failover

-- 验证自动切换结果
DGMGRL> SHOW CONFIGURATION;
DGMGRL> SHOW DATABASE 'new_primary_db';
```

### 3.4 脑裂处理

#### 检测脑裂的方法

```sql
-- 方法一: 检查两个数据库的角色
-- 如果两个数据库都返回 PRIMARY，说明已发生脑裂
SELECT database_role FROM v$database;

-- 方法二: 检查 Broker 状态
DGMGRL> SHOW CONFIGURATION;
-- 如果报错 ORA-16600 或 ORA-16724，可能是脑裂

-- 方法三: 检查 Redo 传输错误
SELECT dest_id, status, error FROM v$archive_dest WHERE target='STANDBY';
-- 如果报 ORA-16009 (invalid redo transport destination)，可能是脑裂
```

#### 脑裂发生后的数据一致性检查

```sql
-- 在两个数据库上分别执行以下查询，对比结果:

