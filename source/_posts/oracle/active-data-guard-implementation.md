---
title: Active Data Guard 实战：物理备库搭建、Real-time Apply 与读写分离
date: 2026-06-06 10:00:00
categories: Oracle
tags: [Data Guard, ADG, 高可用, 读写分离, DG Broker, 容灾]
---

在生产环境中，许多企业部署了 Data Guard 物理备库用于容灾，但备库长期处于 mount 状态，只接收 redo 不提供任何业务服务，造成了严重的硬件资源浪费。Oracle Active Data Guard（ADG）打破了这一限制，允许物理备库在 apply redo 的同时提供只读查询服务，实现真正的读写分离。本文基于 Oracle 19c 环境，完整记录从物理备库搭建、DG Broker 配置到 ADG 读写分离落地的全流程。

<!-- more -->

## 一、问题背景

### 1.1 传统 Data Guard 的资源浪费

在没有 ADG 选件的场景下，物理备库只能处于以下两种状态之一：

- **Mount 状态**：接收 redo 并 apply，但无法对外提供任何查询服务
- **Read-Only 状态**：可以查询，但停止 redo apply，数据不再与 Primary 同步

这意味着备库服务器的 CPU、内存、存储资源大部分时间处于空闲状态，而企业还要为这些硬件资源支付高昂的采购和维护成本。DBA 面临的尴尬局面是：花了双倍的硬件预算，只得到了一份容灾保障。

### 1.2 ADG 的价值

Active Data Guard 解决了上述矛盾。启用 ADG 后，物理备库可以同时做到：

- **持续 apply redo**：保持与 Primary 的数据同步
- **提供只读查询**：应用可以连接到 ADG 执行 SELECT 语句
- **支持报表和分析**：将消耗资源的报表查询从 Primary 卸载到 ADG
- **支持备份卸载**：RMAN 可以直接从 ADG 备份，不影响 Primary 性能

### 1.3 生产中的典型应用场景

| 场景 | 说明 |
|------|------|
| 读写分离 | OLTP 写操作走 Primary，报表/查询走 ADG |
| 报表卸载 | 将 BI 报表、大查询从 Primary 迁移到 ADG |
| 备份卸载 | RMAN 增量备份在 ADG 上执行，Primary 零备份压力 |
| 容灾+读服务 | 一套备库同时满足容灾和读扩展需求 |
| 数据验证 | ADG 可用于验证数据一致性、测试恢复 |

## 二、理论分析

### 2.1 Data Guard 架构

Data Guard 的核心是 Primary 与 Standby 之间的 redo 数据流：

```
Primary Database
    │
    ├── LGWR ──→ Redo Transport ──→ Standby Redo Log
    │                                    │
    └── ARCH ──→ Archive Log ──────────→ Remote Archive
                                          │
                                    Standby Apply
                                    (Media Recovery)
```

**物理备库 vs 逻辑备库：**

- **物理备库（Physical Standby）**：基于 block-level 的 redo apply，数据文件与 Primary 完全一致。这是 ADG 的基础，也是最常用的备库类型。
- **逻辑备库（Logical Standby）**：将 redo 转换为 SQL 在备库执行，备库可以独立写入，但数据一致性保障更复杂。

**三种保护模式：**

| 保护模式 | 数据丢失风险 | Primary 事务提交 | 同步方式 |
|----------|-------------|-----------------|---------|
| Maximum Performance | 可能丢失少量数据 | 不等待 redo 到达备库 | ASYNC |
| Maximum Availability | 零数据丢失（正常情况） | 等待 redo 到达备库 | SYNC |
| Maximum Protection | 零数据丢失（强制保证） | 等待 redo apply | SYNC |

大多数生产环境选择 **Maximum Performance** 模式，在性能和数据保护之间取得平衡。对数据零丢失有严格要求的核心系统选择 **Maximum Availability**。

### 2.2 ADG 的核心特性

**Real-time Apply**

这是 ADG 最关键的特性。启用 Real-time Apply 后，备库直接从 Standby Redo Log（SRL）apply redo，而不是等待归档日志生成后再 apply。这大大降低了数据延迟：

```
-- 启用 Real-time Apply
ALTER DATABASE RECOVER MANAGED STANDBY DATABASE 
  USING CURRENT LOGFILE DISCONNECT FROM SESSION;
```

**Redo Apply 与 Query 的并行机制**

ADG 利用多进程架构实现 apply 与 query 的并行：

- **MRPn（Managed Recovery Process）**：负责 redo apply
- **RFS（Remote File Server）**：接收 redo 数据
- **查询进程**：独立的 server process 处理只读查询

当查询需要读取的 block 正在被 apply 修改时，ADG 会从 Primary 获取该 block 的一致性副本（通过 ADG block shipping），确保查询结果的读一致性。

**Block Change Tracking（BCT）**

ADG 备库支持 Block Change Tracking，可以大幅加速增量备份：

```sql
-- 在 ADG 备库上启用 BCT
ALTER DATABASE ENABLE BLOCK CHANGE TRACKING 
  USING FILE '/u01/app/oracle/bct/adg_bct.f';
```

启用 BCT 后，RMAN 增量备份只需扫描标记为"已变更"的 block，而不是全库扫描，备份时间可缩短数倍。

**DML 重定向（12c+）**

从 Oracle 12c 开始，ADG 支持将 DML 操作自动重定向到 Primary 执行：

```sql
-- 启用 DML 重定向
ALTER SYSTEM SET ADG_REDIRECT_DML=TRUE;
```

这允许应用在 ADG 上执行 INSERT/UPDATE/DELETE，Oracle 自动将这些操作转发到 Primary。适用于少量写入场景，不建议大量使用。

### 2.3 DG Broker

**DMON 进程与 Broker 架构**

Data Guard Broker（DG Broker）是 Oracle 提供的 Data Guard 管理框架，核心组件是 DMON（Data Guard Monitor）进程：

- DMON 进程在每个数据库实例上运行
- 负责配置管理、状态监控、角色切换协调
- 提供统一的命令行接口（dgmgrl）和 EM/Cloud Control 集成

**Broker 的配置管理与状态监控**

Broker 将所有 Data Guard 配置信息存储在本地配置文件中（由 `DG_BROKER_CONFIG_FILE1` 和 `DG_BROKER_CONFIG_FILE2` 参数指定），提供统一的视图：

```
DGMGRL> SHOW CONFIGURATION;
DGMGRL> SHOW DATABASE 'PRODDB';
DGMGRL> SHOW DATABASE 'PRODDB_STBY';
```

**Fast-Start Failover（FSFO）**

FSFO 是 Broker 提供的自动故障转移功能，核心原理：

1. Observer 进程持续监控 Primary 的可用性
2. 当 Primary 不可达超过阈值（默认 30 秒），Observer 触发 Failover
3. 备库自动切换为 Primary 角色
4. 应用通过 TAF 或 FAN 重连到新 Primary

FSFO 的关键配置包括 Observer 站点、Failover 阈值、目标备库选择等。

### 2.4 Redo Transport Services

**LGWR SYNC vs ASYNC**

| 模式 | 机制 | 适用场景 |
|------|------|---------|
| LGWR SYNC | LGWR 进程同步写入备库 SRL | Maximum Availability / Protection |
| LGWR ASYNC | LGWR 进程异步写入备库 SRL | Maximum Performance（推荐） |
| ARCH | 归档时传输 | 旧版兼容，延迟最大 |

**ARCH 传输 vs LGWR 传输**

- **ARCH 传输**：日志切换时才传输归档日志，延迟至少一个日志切换周期
- **LGWR 传输**：实时传输 redo 数据，延迟可降至秒级

现代环境普遍使用 **LGWR ASYNC** 模式，兼顾性能和低延迟。

**Gap Resolution 机制**

当备库出现 redo gap（通常是网络中断导致）时，Oracle 会自动检测并解决：

1. 备库通过 FAL（Fetch Archive Log）Server 请求缺失的归档
2. Primary 的 FAL Server 发送缺失的归档日志
3. 备库 apply 后恢复正常同步

也可以手动解决 gap：

```sql
-- 在备库上查询 gap
SELECT * FROM V$ARCHIVE_GAP;

-- 手动注册缺失的归档日志
ALTER DATABASE REGISTER PHYSICAL LOGFILE '/path/to/missing_archive.arc';
```

## 三、实战操作

以下操作基于 Oracle 19c 环境，Primary 数据库 SID 为 `PRODDB`，备库 SID 为 `PRODDB_STBY`。

### 3.1 物理备库搭建（19c）

**Step 1：Primary 端前置配置**

```sql
-- 开启 force logging，确保所有操作都生成 redo
ALTER DATABASE FORCE LOGGING;

-- 开启归档模式（如果是 NOARCHIVELOG）
SHUTDOWN IMMEDIATE;
STARTUP MOUNT;
ALTER DATABASE ARCHIVELOG;
ALTER DATABASE OPEN;

-- 添加 Standby Redo Log（比 Online Redo Log 多一组）
-- 假设 Online Redo Log 为 4 组，每组 200MB
ALTER DATABASE ADD STANDBY LOGFILE THREAD 1 GROUP 11 
  ('/u01/app/oracle/oradata/PRODDB/sredo11.log') SIZE 200M;
ALTER DATABASE ADD STANDBY LOGFILE THREAD 1 GROUP 12 
  ('/u01/app/oracle/oradata/PRODDB/sredo12.log') SIZE 200M;
ALTER DATABASE ADD STANDBY LOGFILE THREAD 1 GROUP 13 
  ('/u01/app/oracle/oradata/PRODDB/sredo13.log') SIZE 200M;
ALTER DATABASE ADD STANDBY LOGFILE THREAD 1 GROUP 14 
  ('/u01/app/oracle/oradata/PRODDB/sredo14.log') SIZE 200M;
ALTER DATABASE ADD STANDBY LOGFILE THREAD 1 GROUP 15 
  ('/u01/app/oracle/oradata/PRODDB/sredo15.log') SIZE 200M;

-- 确认 Standby Redo Log 创建成功
SELECT GROUP#, THREAD#, SEQUENCE#, STATUS, BYTES/1024/1024 AS SIZE_MB
FROM V$STANDBY_LOG;
```

**Step 2：Primary 端初始化参数配置**

```sql
-- 设置 DB_UNIQUE_NAME
ALTER SYSTEM SET DB_UNIQUE_NAME='PRODDB' SCOPE=SPFILE;

-- 设置归档目标（指向备库）
ALTER SYSTEM SET LOG_ARCHIVE_CONFIG='DG_CONFIG=(PRODDB,PRODDB_STBY)' SCOPE=BOTH;
ALTER SYSTEM SET LOG_ARCHIVE_DEST_2='SERVICE=PRODDB_STBY ASYNC 
  VALID_FOR=(ONLINE_LOGFILES,PRIMARY_ROLE) DB_UNIQUE_NAME=PRODDB_STBY' SCOPE=BOTH;

-- FAL 配置
ALTER SYSTEM SET FAL_SERVER='PRODDB_STBY' SCOPE=BOTH;

-- Standby File Management
ALTER SYSTEM SET STANDBY_FILE_MANAGEMENT=AUTO SCOPE=BOTH;

-- 日志文件名转换（Primary -> Standby 路径映射）
ALTER SYSTEM SET DB_FILE_NAME_CONVERT='/PRODDB_STBY/','/PRODDB/' SCOPE=SPFILE;
ALTER SYSTEM SET LOG_FILE_NAME_CONVERT='/PRODDB_STBY/','/PRODDB/' SCOPE=SPFILE;
```

**Step 3：TNS 配置**

在 Primary 和 Standby 的 `$TNS_ADMIN/tnsnames.ora` 中配置：

```
PRODDB =
  (DESCRIPTION =
    (ADDRESS = (PROTOCOL = TCP)(HOST = primary-svr)(PORT = 1521))
    (CONNECT_DATA =
      (SERVER = DEDICATED)
      (SERVICE_NAME = PRODDB)
    )
  )

PRODDB_STBY =
  (DESCRIPTION =
    (ADDRESS = (PROTOCOL = TCP)(HOST = standby-svr)(PORT = 1521))
    (CONNECT_DATA =
      (SERVER = DEDICATED)
      (SERVICE_NAME = PRODDB_STBY)
    )
  )
```

**Step 4：密码文件与参数文件传递**

```bash
# 从 Primary 复制密码文件到 Standby
scp $ORACLE_HOME/dbs/orapwPRODDB standby-svr:$ORACLE_HOME/dbs/orapwPRODDB_STBY

# 创建备库参数文件 initPRODDB_STBY.ora
cat > /tmp/initPRODDB_STBY.ora << 'EOF'
db_name=PRODDB
db_unique_name=PRODDB_STBY
enable_pluggable_database=true
EOF

# 传递到备库
scp /tmp/initPRODDB_STBY.ora standby-svr:$ORACLE_HOME/dbs/
```

**Step 5：创建必要目录**

```bash
# 在 Standby 服务器上执行
mkdir -p /u01/app/oracle/oradata/PRODDB_STBY
mkdir -p /u01/app/oracle/fast_recovery_area/PRODDB_STBY
mkdir -p /u01/app/oracle/admin/PRODDB_STBY/adump
```

**Step 6：RMAN Duplicate 创建备库**

在 Primary 服务器上执行（连接到 Primary 和 Standby 实例）：

```bash
rman target sys/password@PRODDB auxiliary sys/password@PRODDB_STBY

# 在 RMAN 中执行
RUN {
  ALLOCATE CHANNEL ch1 DEVICE TYPE DISK;
  ALLOCATE AUXILIARY CHANNEL ach1 DEVICE TYPE DISK;
  
  DUPLICATE TARGET DATABASE
    FOR STANDBY
    FROM ACTIVE DATABASE
    DORECOVER
    SPFILE
      SET DB_UNIQUE_NAME='PRODDB_STBY'
      SET LOG_ARCHIVE_DEST_2='SERVICE=PRODDB ASYNC 
        VALID_FOR=(ONLINE_LOGFILES,PRIMARY_ROLE) DB_UNIQUE_NAME=PRODDB'
      SET FAL_SERVER='PRODDB'
    NOFILENAMECHECK;
}
```

> **关键参数说明：**
> - `FROM ACTIVE DATABASE`：直接从运行中的 Primary 在线复制，无需备份集
> - `DORECOVER`：复制完成后自动应用归档日志进行恢复
> - `SPFILE`：自动从 Primary 传递 SPFILE 并覆盖指定参数
> - `NOFILENAMECHECK`：当 Primary 和 Standby 使用相同路径时需要此参数

**Step 7：启动备库并启用 Real-time Apply**

```sql
-- 在 Standby 上执行
-- 备库已由 RMAN duplicate 启动到 mount 状态

-- 启用 Real-time Apply
ALTER DATABASE RECOVER MANAGED STANDBY DATABASE 
  USING CURRENT LOGFILE DISCONNECT FROM SESSION;

-- 验证 apply 状态
SELECT PROCESS, STATUS, THREAD#, SEQUENCE#, BLOCK#
FROM V$MANAGED_STANDBY
WHERE PROCESS IN ('MRP0','RFS');

-- 打开到 ADG 模式
ALTER DATABASE OPEN;
```

至此，物理备库搭建完成并已启用 Real-time Apply。备库现在处于 ADG 状态，可以接受只读查询。

### 3.2 DG Broker 配置

**Step 1：启用 Broker**

在 Primary 和 Standby 上分别执行：

```sql
-- 启用 Broker
ALTER SYSTEM SET DG_BROKER_START=TRUE SCOPE=BOTH;

-- 确认 DMON 进程启动
SELECT PROCESS, STATUS FROM V$MANAGED_STANDBY WHERE PROCESS='DMON';
```

**Step 2：创建 Broker 配置**

```bash
# 连接到 dgmgrl（在 Primary 上执行）
dgmgrl sys/password@PRODDB
```

```sql
-- 在 dgmgrl 中执行

-- 创建配置
CREATE CONFIGURATION 'DG_CONFIG' AS
  PRIMARY DATABASE IS 'PRODDB'
  CONNECT IDENTIFIER IS 'PRODDB';

-- 添加备库
ADD DATABASE 'PRODDB_STBY' AS
  CONNECT IDENTIFIER IS 'PRODDB_STBY';

-- 启用配置
ENABLE CONFIGURATION;

-- 验证配置状态
SHOW CONFIGURATION;

-- 查看详细数据库状态
SHOW DATABASE 'PRODDB';
SHOW DATABASE 'PRODDB_STBY';
```

**Step 3：配置保护模式（可选）**

```sql
-- 设置为 Maximum Performance（默认）
-- 如需 Maximum Availability：
EDIT CONFIGURATION SET PROTECTION MODE AS MaxAvailability;

-- 如需启用 Fast-Start Failover
ENABLE FAST_START FAILOVER;

-- 启动 Observer（在独立的 Observer 服务器上执行）
dgmgrl sys/password@PRODDB "START OBSERVER;"
```

**Step 4：验证 Broker 状态**

```sql
-- 在 dgmgrl 中
SHOW CONFIGURATION;
-- 预期输出：
-- Configuration - DG_CONFIG
--   Protection Mode: MaxPerformance
--   Members:
--   PRODDB      - Primary database
--   PRODDB_STBY - Physical standby database
-- Fast-Start Failover: Disabled
-- Configuration Status: SUCCESS

SHOW DATABASE 'PRODDB_STBY';
-- 查看 ApplyLag、TransportLag、State 等信息
```

### 3.3 ADG 读写分离配置

**方式一：Service 级别的读写分离**

在 ADG 备库上创建专用的只读 Service：

```sql
-- 在 Primary 上创建 Service（通过 DBMS_SERVICE）
BEGIN
  DBMS_SERVICE.CREATE_SERVICE(
    service_name => 'PRODDB_RO',
    network_name => 'PRODDB_RO',
    failover_method => 'BASIC',
    failover_type => 'SELECT',
    failover_retries => 3,
    failover_delay => 5
  );
END;
/

-- 在 ADG 备库上启动 Service
-- 编辑 $ORACLE_HOME/network/admin/tnsnames.ora 添加只读 Service
```

TNS 配置（应用端）：

```
# 写服务 - 连接 Primary
PRODDB_RW =
  (DESCRIPTION =
    (ADDRESS_LIST =
      (ADDRESS = (PROTOCOL = TCP)(HOST = primary-svr)(PORT = 1521))
    )
    (CONNECT_DATA =
      (SERVICE_NAME = PRODDB)
    )
  )

# 读服务 - 连接 ADG 备库
PRODDB_RO =
  (DESCRIPTION =
    (ADDRESS_LIST =
      (ADDRESS = (PROTOCOL = TCP)(HOST = standby-svr)(PORT = 1521))
    )
    (CONNECT_DATA =
      (SERVICE_NAME = PRODDB)
    )
  )

# 读写分离 - 自动路由
PRODDB_RW_SPLIT =
  (DESCRIPTION =
    (ADDRESS_LIST =
      (LOAD_BALANCE = ON)
      (ADDRESS = (PROTOCOL = TCP)(HOST = primary-svr)(PORT = 1521))
      (ADDRESS = (PROTOCOL = TCP)(HOST = standby-svr)(PORT = 1521))
    )
    (CONNECT_DATA =
      (SERVICE_NAME = PRODDB)
    )
  )
```

**方式二：JDBC 连接字符串配置**

```properties
# 写操作 - 连接 Primary
jdbc:oracle:thin:@//primary-svr:1521/PRODDB

# 读操作 - 连接 ADG
jdbc:oracle:thin:@//standby-svr:1521/PRODDB

# 使用 Application Continuity 的 JDBC 连接
jdbc:oracle:thin:@(DESCRIPTION=
  (ADDRESS_LIST=
    (ADDRESS=(PROTOCOL=TCP)(HOST=primary-svr)(PORT=1521))
    (ADDRESS=(PROTOCOL=TCP)(HOST=standby-svr)(PORT=1521)))
  (CONNECT_DATA=(SERVICE_NAME=PRODDB)))
```

**方式三：Oracle Connection Manager 实现透明路由**

对于需要透明读写分离的场景，可以使用 Oracle Connection Manager（CMAN）配合 `CLIENT_PREFERRED_SERVER` 参数，根据 SQL 语句类型自动路由到 Primary 或 ADG。

### 3.4 Switchover 操作

**使用 Broker 执行 Switchover（推荐）**

```bash
# 连接到 dgmgrl
dgmgrl sys/password@PRODDB

# 执行 switchover
SWITCHOVER TO 'PRODDB_STBY';
```

Broker 自动完成以下操作：
1. 验证 Primary 和 Standby 的状态
2. 将 Primary 切换为 Standby
3. 将 Standby 切换为 Primary
4. 更新 Broker 配置
5. 重启受影响的数据库实例

**手动 Switchover 步骤**

```sql
-- 在 Primary 上执行
-- Step 1: 验证 switchover 就绪状态
SELECT SWITCHOVER_STATUS FROM V$DATABASE;
-- 预期输出: TO STANDBY 或 SESSIONS ACTIVE

-- Step 2: Primary 切换为 Standby
ALTER DATABASE COMMIT TO SWITCHOVER TO STANDBY WITH SESSION SHUTDOWN;

-- Step 3: 在 Standby 上执行
-- 确认角色切换
SELECT DATABASE_ROLE FROM V$DATABASE;
-- 预期输出: PHYSICAL STANDBY

-- Step 4: Standby 切换为 Primary
ALTER DATABASE COMMIT TO SWITCHOVER TO PRIMARY WITH SESSION SHUTDOWN;

-- Step 5: 打开新 Primary
ALTER DATABASE OPEN;

-- Step 6: 在新 Standby 上启用 Real-time Apply
ALTER DATABASE RECOVER MANAGED STANDBY DATABASE 
  USING CURRENT LOGFILE DISCONNECT FROM SESSION;
ALTER DATABASE OPEN;
```

**应用端连接切换处理**

建议使用以下策略确保应用端平滑切换：

- **TAF（Transparent Application Failover）**：在 TNS 中配置 `FAILOVER_MODE`
- **FAN（Fast Application Notification）**：结合 ONS 实现快速故障通知
- **Application Continuity（AC）**：12c+ 特性，自动重放失败的事务
- **连接池重试**：在应用层实现连接失败重试逻辑

## 四、结果验证

### 4.1 数据库角色与状态

```sql
-- 检查数据库角色和打开模式
SELECT NAME, DATABASE_ROLE, OPEN_MODE, PROTECTION_MODE
FROM V$DATABASE;

-- 预期输出（ADG 备库）：
-- NAME       DATABASE_ROLE    OPEN_MODE           PROTECTION_MODE
-- PRODDB     PRIMARY          READ WRITE          MAXIMUM PERFORMANCE
-- PRODDB_STBY PHYSICAL STANDBY READ ONLY WITH APPLY MAXIMUM PERFORMANCE
```

### 4.2 Apply Lag 与 Transport Lag

```sql
-- 查看 apply 延迟和传输延迟
SELECT NAME, VALUE, DATUM_TIME
FROM V$DATAGUARD_STATS
WHERE NAME IN ('apply lag', 'transport lag');

-- 更详细的 dest 状态
SELECT DEST_ID, STATUS, TYPE, DATABASE_MODE, 
       RECOVERY_MODE, APPLIED_SCN, APPLY_LAG, TRANSPORT_LAG
FROM V$ARCHIVE_DEST_STATUS
WHERE DATABASE_MODE != 'NONE';
```

### 4.3 DG Broker 验证

```sql
-- 在 dgmgrl 中
SHOW CONFIGURATION;
SHOW DATABASE 'PRODDB_STBY';

-- 检查各成员的 InconsistentProperties
SHOW DATABASE 'PRODDB_STBY' 'InconsistentProperties';
```

### 4.4 Real-time Apply 验证

这是最直观的验证方式——在 Primary 上建表，ADG 上立即可查：

```sql
-- 在 Primary 上执行
CREATE TABLE adg_test (id NUMBER, create_time TIMESTAMP DEFAULT SYSTIMESTAMP);
INSERT INTO adg_test VALUES (1, SYSTIMESTAMP);
COMMIT;

-- 在 ADG 备库上立即查询（延迟通常在 1-3 秒内）
SELECT * FROM adg_test;
-- 预期输出：
-- ID  CREATE_TIME
-- 1   06-JUN-26 10.00.01.123456 AM

-- 清理测试表
-- 在 Primary 上
DROP TABLE adg_test PURGE;
```

## 五、经验总结

### 5.1 ADG 的性能影响与调优

ADG 对 Primary 的性能影响主要体现在 redo 传输环节。调优建议：

- **使用 LGWR ASYNC 模式**：避免 SYNC 模式对 Primary 事务提交的阻塞
- **合理设置 `LOG_ARCHIVE_DEST_2` 的 `NET_TIMEOUT`**：建议设置为 10-30 秒
- **备库 SRL 大小与 Primary OLRL 一致**：避免日志切换导致的额外开销
- **备库 apply 并行度**：通过 `PARALLEL` 参数控制 MRPn 进程数量

```sql
-- 设置 apply 并行度（根据 CPU 核心数调整）
ALTER DATABASE RECOVER MANAGED STANDBY DATABASE 
  PARALLEL 8 USING CURRENT LOGFILE DISCONNECT FROM SESSION;
```

### 5.2 备库的网络带宽要求

网络是 Data Guard 的关键基础设施。计算公式：

```
所需带宽 ≈ (Primary 每秒 redo 生成量 × 8) / 带宽利用率
```

例如，Primary 每秒产生 10MB redo，目标带宽利用率 70%：

```
(10 × 8) / 0.7 ≈ 114 Mbps
```

建议使用专用网络链路，并配置 QoS 保证 redo 传输的带宽优先级。跨机房部署时，网络延迟应控制在 10ms 以内（SYNC 模式下尤为重要）。

### 5.3 常见故障与处理

**归档 Gap**

```sql
-- 查询 gap
SELECT * FROM V$ARCHIVE_GAP;

-- 手动传输并注册缺失的归档
ALTER DATABASE REGISTER PHYSICAL LOGFILE '/path/to/archive.arc';

-- 或使用 RMAN 解决 gap
RMAN> RECOVER STANDBY DATABASE;
```

**Apply 延迟过大**

- 检查备库 I/O 性能（是否存在 I/O 瓶颈）
- 检查网络传输延迟（V$ARCHIVE_DEST 的 STATUS 和 ERROR）
- 增加 apply 并行度
- 检查是否存在大量 DDL 操作导致 apply 慢

**ADG 查询阻塞 Apply**

在极端情况下，大量并发查询可能影响 apply 性能。可通过以下方式缓解：

```sql
-- 设置 apply 延迟超时（超过阈值自动中断查询）
ALTER SYSTEM SET ADG_MAX_IO_RESPONSE_TIME=1000; -- 毫秒
```

### 5.4 ADG 的授权要求

**重要提示**：Active Data Guard 是 Oracle 的付费选件，需要单独购买许可。在备库上执行 `ALTER DATABASE OPEN`（READ ONLY WITH APPLY）时，Oracle 会记录 ADG 的使用。未购买 ADG 许可而使用该功能会带来合规风险。

替代方案（不使用 ADG 选件）：

- 将备库切换到 `READ ONLY` 状态用于查询（会停止 redo apply）
- 使用 Snapshot Standby 创建临时的可读写快照（也会暂停 apply）
- 使用 Oracle GoldenGate 实现更灵活的读写分离

---

以上就是 Oracle 19c 环境下 Active Data Guard 的完整搭建与配置过程。从物理备库的 RMAN duplicate 创建，到 DG Broker 的统一管理，再到 Service 级别的读写分离配置，ADG 提供了一套成熟的解决方案，帮助企业将备库从"成本中心"转变为"价值中心"。在实际部署中，建议结合业务特点选择合适的保护模式和传输方式，并建立完善的监控告警机制（包括 apply lag、transport lag、gap 检测等），确保 ADG 始终处于健康运行状态。
