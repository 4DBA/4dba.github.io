---
title: Unified Auditing 统一审计实施：策略定制与审计日志管理
date: 2026-05-02 10:00:00
categories: Oracle
tags: [审计, Unified Auditing, 安全, 合规, FGA]
---

## 一、问题背景

在企业级数据库管理中，审计是安全合规的核心环节。无论是等保测评、GDPR、还是内部安全审计，数据库审计都扮演着不可替代的角色。然而在 Oracle 12c 之前，传统审计（Traditional Auditing）的实施一直让 DBA 感到头疼。

<!-- more -->


**传统审计的局限性主要体现在以下几个方面：**

- **性能影响大**：传统审计依赖大量独立的审计表（如 `AUD$`、`FGA_LOG$`），每次审计事件触发都需要写入磁盘 I/O，高并发场景下对 OLTP 性能影响显著。根据实践经验，在未优化的情况下，开启全量审计可能导致 5%-15% 的性能下降。尤其是在高频 DML 操作的生产系统上，审计带来的额外 I/O 开销往往成为性能瓶颈。
- **管理复杂度高**：权限审计、操作审计、对象审计分别使用不同的语法和配置方式（`AUDIT` 语句、`AUDIT_TRAIL` 参数、`DBMS_FGA` 包），缺乏统一管理入口，策略分散难以维护。当需要对某类操作添加审计时，DBA 可能需要同时修改多个配置点。
- **审计数据碎片化**：标准审计写入 `SYS.AUD$`，FGA 审计写入 `SYS.FGA_LOG$`，OS 审计写入操作系统文件，审计数据分散在多个位置，查询和归档都极为不便。想要获取一份完整的审计报告，需要从多个数据源中整合数据，这在安全事件调查时尤为被动。
- **灵活性不足**：传统审计难以按时间、IP 地址、应用模块等条件进行精细过滤，往往只能开启或关闭某个审计项，无法做到按需审计。

**Oracle Unified Auditing（12c 引入）** 彻底重构了审计架构，提供统一的策略管理框架，解决了传统审计的诸多痛点。其核心优势包括：

1. **统一的策略模型**：所有审计类型（权限、操作、对象、FGA）通过统一的审计策略（Audit Policy）管理，一条策略即可覆盖多种审计需求，极大简化了管理复杂度。
2. **内置性能优化**：审计记录先写入内存缓冲区（SGA 中的 Unified Audit Queue），再批量持久化到 `AUDSYS` schema 下的表中，大幅减少磁盘 I/O 开销。相比传统审计，性能影响降低显著。
3. **灵活的条件过滤**：支持按用户、角色、时间、操作系统用户、IP 地址、应用模块等条件精细过滤审计范围，真正做到「该审的审，不该审的不审」。
4. **集成化的日志管理**：通过 `DBA_UNIFIED_AUDIT_TRAIL` 统一视图查询所有审计数据，支持标准化的清理和归档机制（`DBMS_AUDIT_MGMT` 包）。

对于有合规审计要求的生产环境，迁移到 Unified Auditing 是必然的选择。本文将从架构原理出发，结合实际项目经验，详细介绍 Unified Auditing 的策略定制、FGA 配置和审计日志管理的最佳实践。

---

## 二、理论分析

### 2.1 Unified Auditing 架构

Unified Auditing 的架构设计围绕三个核心组件展开，理解这些组件的工作原理是正确实施审计策略的前提。

**统一审计策略（Unified Audit Policy）**

所有审计规则通过 `CREATE AUDIT POLICY` 语句定义，一条策略可同时包含权限审计、操作审计和对象审计条件。策略创建后处于 DISABLED 状态，需要通过 `AUDIT POLICY` 语句显式启用。这种「先定义、后启用」的设计使得策略可以预先准备，在变更窗口统一上线。

**AUDIT_TRAIL 参数与审计模式**

Oracle 提供两种审计模式：Mixed Mode 和 Pure Unified Auditing Mode。

- **Mixed Mode（默认）**：传统审计和 Unified Auditing 并存。在 Mixed Mode 下，Oracle 自动启用一些默认的统一审计策略（如 `ORA_LOGON_FAILURES`、`ORA_SECURECONFIG` 等），同时传统审计的 `AUDIT_TRAIL` 参数仍然生效。这是大多数环境的默认状态。
- **Pure Unified Auditing Mode**：完全关闭传统审计，所有审计行为统一由 Unified Auditing 管理。需要通过重新链接 Oracle 二进制文件来切换。

在 Mixed Mode 下，可以通过 `AUDIT_TRAIL` 参数查看传统审计的配置状态：

```sql
SHOW PARAMETER audit_trail;
-- DB       : 审计记录写入SYS.AUD$表
-- DB,EXTENDED: 写入表且包含SQL绑定变量
-- OS       : 审计记录写入操作系统文件
-- NONE     : 关闭传统审计
```

**审计记录存储**

Unified Auditing 的审计记录存储在 `SYSAUX` 表空间的 `AUDSYS` schema 下，采用内部表结构和自动分区设计。数据写入流程如下：

1. 审计事件首先写入 SGA 中的 Unified Audit Queue（内存队列）
2. 后台进程（Unified Auditing Background Writer）定期将队列数据批量刷新到磁盘
3. 默认每 3 秒或队列达到 1MB 时触发一次刷新
4. 数据持久化到 `AUDSYS` schema 下的分区表中

这种异步写入机制是 Unified Auditing 性能优于传统审计的关键所在。

```sql
-- 查看审计队列配置
SELECT * FROM V$UNIFIED_AUDIT_QUEUE_WRITERS;

-- 查看SYSAUX中审计占用空间
SELECT occupant_name, space_usage_kbytes,
       ROUND(space_usage_kbytes/1024, 2) AS usage_mb
FROM V$SYSAUX_OCCUPANTS
WHERE occupant_name LIKE '%AUDIT%';
```

### 2.2 审计策略类型

Unified Auditing 支持以下四种审计策略类型，可以在一条策略中混合使用，这是其灵活性的核心体现：

| 类型 | 说明 | 适用场景 |
|------|------|----------|
| 权限审计（Privilege Audit） | 审计系统权限的使用，无论用户是否真正拥有该权限 | 监控特权操作，如 `DROP ANY TABLE` |
| 操作审计（Action Audit） | 审计 DDL/DML 操作，按操作类型审计 | 监控特定表的增删改查 |
| 对象审计（Object Audit） | 审计特定对象上的操作 | 精确控制到表/视图级别的审计 |
| 细粒度审计（FGA） | 基于条件的精细审计，支持 WHERE 条件过滤 | 按业务逻辑条件审计，如薪资超过某阈值 |

实际项目中，最常用的是操作审计和 FGA 的组合：操作审计负责记录所有对核心表的变更操作，FGA 负责在特定业务条件下触发更详细的审计记录。

### 2.3 审计日志管理

**查询审计日志**

统一通过 `DBA_UNIFIED_AUDIT_TRAIL` 视图查询，该视图整合了所有类型的审计记录：

```sql
SELECT event_timestamp, dbusername, action_name,
       object_schema, object_name, sql_text
FROM DBA_UNIFIED_AUDIT_TRAIL
ORDER BY event_timestamp DESC
FETCH FIRST 100 ROWS ONLY;
```

**审计日志清理策略**

审计日志不能无限制增长，否则将迅速填满 `SYSAUX` 表空间，影响数据库正常运行。建议按以下策略管理：

- **保留周期**：根据合规要求设定（通常 90 天至 1 年），等保三级通常要求至少 6 个月
- **清理方式**：使用 `DBMS_AUDIT_MGMT` 包进行标准化清理，这是 Oracle 官方推荐的方式
- **归档方式**：清理前先导出到独立表空间或外部存储，确保历史数据可追溯

**审计日志导出**

可通过 Data Pump 或 CTAS 方式导出审计数据。建议使用 CTAS 导出到独立表空间，便于后续查询和归档管理：

```sql
-- 导出到独立表（建议使用独立表空间）
CREATE TABLE aud_archive.unified_audit_202606
TABLESPACE aud_archive_ts
AS SELECT * FROM UNIFIED_AUDIT_TRAIL
WHERE event_timestamp < SYSTIMESTAMP - INTERVAL '90' DAY;
```

---

## 三、实战操作

### 3.1 启用 Unified Auditing

#### 检查当前审计模式

```sql
-- 检查Unified Auditing是否已编译启用
SELECT VALUE FROM V$OPTION WHERE PARAMETER = 'Unified Auditing';
-- TRUE 表示已编译启用（12c及以上默认为TRUE）

-- 检查当前审计模式
SELECT PARAMETER, VALUE FROM V$OPTION
WHERE PARAMETER = 'Unified Auditing';
```

#### 迁移到纯 Unified Auditing 模式

Oracle 12c 默认是 Mixed Mode，如需完全迁移到纯 Unified Auditing 模式（关闭传统审计），需要关闭数据库并执行以下步骤：

```bash
# 1. 关闭数据库
sqlplus / as sysdba
SHUTDOWN IMMEDIATE;
EXIT;

# 2. 重新链接Oracle二进制文件，启用纯Unified Auditing
cd $ORACLE_HOME/rdbms/lib
make -f ins_rdbms.mk uniaud_on ioracle

# 3. 启动数据库
sqlplus / as sysdba
STARTUP;
```

> **注意**：切换到纯 Unified Auditing 模式是不可逆操作（需要重新安装数据库才能回退）。如果当前使用 Mixed Mode 能满足需求，建议保持 Mixed Mode。大多数环境下 Mixed Mode 已经足够。

#### 验证启用状态

```sql
-- 验证Unified Auditing模式
SELECT PARAMETER, VALUE
FROM V$OPTION
WHERE PARAMETER = 'Unified Auditing';

-- 查看已有的审计策略（包括默认策略）
SELECT POLICY_NAME, ENABLED_OPT, USER_AUDIT_OPTION
FROM AUDIT_UNIFIED_POLICIES
ORDER BY POLICY_NAME;

-- 查看已启用的策略
SELECT POLICY_NAME, ENABLED_OPTION, ENTITY_NAME, ENTITY_TYPE
FROM AUDIT_UNIFIED_ENABLED_POLICIES;

-- 查看默认策略的具体审计项
SELECT POLICY_NAME, AUDIT_OPTION, AUDIT_OPTION_TYPE, OBJECT_SCHEMA, OBJECT_NAME
FROM AUDIT_UNIFIED_POLICIES
WHERE POLICY_NAME = 'ORA_SECURECONFIG'
ORDER BY AUDIT_OPTION;
```

### 3.2 创建审计策略

#### 权限审计策略

审计所有使用 `DROP ANY TABLE` 权限的操作，这是安全合规中最基本的要求之一：

```sql
-- 创建权限审计策略
CREATE AUDIT POLICY priv_drop_any_table_policy
  PRIVILEGES DROP ANY TABLE;

-- 启用策略（对所有用户生效）
AUDIT POLICY priv_drop_any_table_policy;

-- 仅对特定用户启用
AUDIT POLICY priv_drop_any_table_policy BY scott, hr;

-- 仅对非DBA用户启用（排除SYS和SYSDBA连接）
AUDIT POLICY priv_drop_any_table_policy EXCEPT SYS;
```

#### DML 操作审计策略

审计 HR 模式下核心人事表的所有 DML 操作，这类审计在等保测评中经常被要求：

```sql
-- 创建DML审计策略
CREATE AUDIT POLICY hr_dml_audit_policy
  ACTIONS INSERT ON HR.EMPLOYEES,
          UPDATE ON HR.EMPLOYEES,
          DELETE ON HR.EMPLOYEES,
          INSERT ON HR.DEPARTMENTS,
          UPDATE ON HR.DEPARTMENTS,
          DELETE ON HR.DEPARTMENTS;

-- 启用策略（排除SYS用户）
AUDIT POLICY hr_dml_audit_policy BY ALL EXCEPT SYS;
```

#### 登录失败审计

Oracle 默认已启用 `ORA_LOGON_FAILURES` 策略，但可以自定义更精细的登录审计策略，用于检测暴力破解和异常登录：

```sql
-- 创建登录审计策略
CREATE AUDIT POLICY login_audit_policy
  ACTIONS LOGON, LOGOFF,
  ROLES DBA, DATAPUMP_EXP_FULL_DATABASE;

-- 启用
AUDIT POLICY login_audit_policy;

-- 查询最近7天的登录失败记录
SELECT event_timestamp, dbusername, client_identifier,
       action_name, return_code, userhost,
       terminal, authentication_type
FROM DBA_UNIFIED_AUDIT_TRAIL
WHERE action_name IN ('LOGON', 'LOGOFF')
  AND return_code != 0
  AND event_timestamp > SYSTIMESTAMP - INTERVAL '7' DAY
ORDER BY event_timestamp DESC;

-- 统计失败登录的用户分布
SELECT dbusername, COUNT(*) AS fail_count
FROM DBA_UNIFIED_AUDIT_TRAIL
WHERE action_name = 'LOGON'
  AND return_code != 0
  AND event_timestamp > SYSTIMESTAMP - INTERVAL '7' DAY
GROUP BY dbusername
ORDER BY fail_count DESC;
```

#### 特权操作审计

审计所有 DBA 角色用户的敏感操作，防止特权滥用：

```sql
-- 创建特权操作审计策略
CREATE AUDIT POLICY dba_operations_policy
  PRIVILEGES ALTER SYSTEM,
             ALTER DATABASE,
             ALTER USER,
             DROP USER,
             CREATE ANY TABLE,
             ALTER ANY TABLE,
             DROP ANY TABLE
  WHEN 'SYS_CONTEXT(''USERENV'',''SESSION_USER'') NOT IN (''SYS'',''SYSTEM'')'
  EVALUATE PER SESSION;

-- 启用
AUDIT POLICY dba_operations_policy BY USERS WITH GRANTED ROLES DBA;
```

策略创建完成后，可以查看策略的详细定义：

```sql
-- 查看策略详情
SELECT POLICY_NAME, AUDIT_OPTION, AUDIT_OPTION_TYPE,
       OBJECT_SCHEMA, OBJECT_NAME, COMMON
FROM AUDIT_UNIFIED_POLICIES
WHERE POLICY_NAME = 'DBA_OPERATIONS_POLICY';
```

### 3.3 FGA 配置

细粒度审计（FGA）通过 `DBMS_FGA` 包实现，是 Unified Auditing 中最灵活的审计方式。与普通操作审计不同，FGA 支持基于 WHERE 条件精确控制审计范围，适合对敏感数据的按条件审计。

#### FGA 策略创建

**场景一：审计对薪资敏感字段的 SELECT 访问**

当有人查询高薪员工的薪资信息时触发审计，这是金融和人力资源场景中的典型需求：

```sql
BEGIN
  DBMS_FGA.ADD_POLICY(
    object_schema   => 'HR',
    object_name     => 'EMPLOYEES',
    policy_name     => 'AUDIT_SALARY_ACCESS',
    audit_column    => 'SALARY,COMMISSION_PCT',
    audit_condition => 'SALARY > 10000',
    audit_column_opts => DBMS_FGA.ANY_COLUMNS,
    statement_types => 'SELECT',
    handler_schema  => NULL,
    handler_module  => NULL,
    enable          => TRUE
  );
END;
/
```

参数说明：
- `audit_column`：指定需要审计的列，多列用逗号分隔
- `audit_condition`：触发审计的条件，类似 WHERE 子句
- `audit_column_opts`：`ANY_COLUMNS` 表示访问任一指定列即触发；`ALL_COLUMNS` 表示访问所有指定列才触发
- `statement_types`：审计的 SQL 操作类型，支持 `SELECT`、`INSERT`、`UPDATE`、`DELETE`

**场景二：审计对财务交易表的 DELETE 操作**

删除财务交易记录是高风险操作，应无条件审计：

```sql
BEGIN
  DBMS_FGA.ADD_POLICY(
    object_schema   => 'FINANCE',
    object_name     => 'TRANSACTIONS',
    policy_name     => 'AUDIT_FINANCE_DELETE',
    audit_condition => '1=1',
    statement_types => 'DELETE',
    enable          => TRUE
  );
END;
/
```

**场景三：审计对客户信息的批量访问**

当查询涉及客户表的全部列（可能意味着批量数据导出）时触发审计：

```sql
BEGIN
  DBMS_FGA.ADD_POLICY(
    object_schema   => 'CRM',
    object_name     => 'CUSTOMERS',
    policy_name     => 'AUDIT_BULK_CUSTOMER_ACCESS',
    audit_condition => '1=1',
    statement_types => 'SELECT',
    audit_column_opts => DBMS_FGA.ALL_COLUMNS,
    enable          => TRUE
  );
END;
/
```

#### FGA 策略管理

FGA 策略支持动态启用、禁用和删除，无需重建策略：

```sql
-- 启用FGA策略
BEGIN
  DBMS_FGA.ENABLE_POLICY('HR', 'EMPLOYEES', 'AUDIT_SALARY_ACCESS');
END;
/

-- 禁用FGA策略
BEGIN
  DBMS_FGA.DISABLE_POLICY('HR', 'EMPLOYEES', 'AUDIT_SALARY_ACCESS');
END;
/

-- 删除FGA策略
BEGIN
  DBMS_FGA.DROP_POLICY('HR', 'EMPLOYEES', 'AUDIT_SALARY_ACCESS');
END;
/

-- 查看已有FGA策略
SELECT object_schema, object_name, policy_name,
       enabled, sel, ins, upd, del,
       audit_column, audit_condition
FROM DBA_AUDIT_POLICES;
```

#### FGA 日志查询

```sql
-- FGA审计日志在Unified Auditing模式下统一查询
SELECT event_timestamp, dbusername, object_schema,
       object_name, sql_text, sql_binds
FROM DBA_UNIFIED_AUDIT_TRAIL
WHERE audit_type = 'FGA AUDIT'
  AND event_timestamp > SYSTIMESTAMP - INTERVAL '1' DAY
ORDER BY event_timestamp DESC;

-- 按对象统计FGA触发次数
SELECT object_schema, object_name, COUNT(*) AS trigger_count
FROM DBA_UNIFIED_AUDIT_TRAIL
WHERE audit_type = 'FGA AUDIT'
  AND event_timestamp > SYSTIMESTAMP - INTERVAL '7' DAY
GROUP BY object_schema, object_name
ORDER BY trigger_count DESC;
```

### 3.4 审计日志维护

审计日志维护是生产环境中最容易被忽视，却又最容易出问题的环节。没有及时清理的审计日志会迅速填满 SYSAUX 表空间，导致数据库异常。

#### 初始化审计清理框架

```sql
-- 初始化审计清理配置（只需执行一次）
BEGIN
  DBMS_AUDIT_MGMT.INIT_CLEANUP(
    audit_trail_type         => DBMS_AUDIT_MGMT.AUDIT_TRAIL_UNIFIED,
    default_cleanup_interval => 720  -- 720分钟=12小时检查一次
  );
END;
/

-- 设置审计记录保留天数（90天）
BEGIN
  DBMS_AUDIT_MGMT.SET_LAST_ARCHIVE_TIMESTAMP(
    audit_trail_type  => DBMS_AUDIT_MGMT.AUDIT_TRAIL_UNIFIED,
    last_archive_time => SYSTIMESTAMP - INTERVAL '90' DAY
  );
END;
/
```

#### 日志清理脚本

```sql
-- 手动执行清理（清除超过保留期的审计记录）
BEGIN
  DBMS_AUDIT_MGMT.CLEAN_AUDIT_TRAIL(
    audit_trail_type        => DBMS_AUDIT_MGMT.AUDIT_TRAIL_UNIFIED,
    use_last_arch_timestamp => TRUE
  );
END;
/

-- 设置自动清理Job（推荐，每日自动清理）
BEGIN
  DBMS_AUDIT_MGMT.CREATE_PURGE_JOB(
    audit_trail_type           => DBMS_AUDIT_MGMT.AUDIT_TRAIL_UNIFIED,
    audit_trail_purge_interval => 24,     -- 每24小时执行一次
    audit_trail_purge_name     => 'UNIFIED_AUDIT_PURGE_JOB',
    use_last_arch_timestamp    => TRUE
  );
END;
/

-- 查看清理Job状态
SELECT JOB_NAME, JOB_STATUS, JOB_FREQUENCY
FROM DBA_AUDIT_MGMT_CLEANUP_JOBS;
```

#### 归档策略

建议在清理前先归档到独立表空间，保留历史数据以满足合规留存要求：

```sql
-- 创建归档表空间（建议放在独立磁盘组上）
CREATE TABLESPACE aud_archive_ts
  DATAFILE '+DATA' SIZE 10G AUTOEXTEND ON NEXT 1G MAXSIZE 50G
  EXTENT MANAGEMENT LOCAL AUTOALLOCATE;

-- 创建归档用户
CREATE USER aud_archive IDENTIFIED BY "StrongPass123!"
  DEFAULT TABLESPACE aud_archive_ts
  QUOTA UNLIMITED ON aud_archive_ts;

GRANT CREATE TABLE TO aud_archive;

-- 按月归档（以2026年5月为例）
CREATE TABLE aud_archive.audit_202605
TABLESPACE aud_archive_ts
AS SELECT * FROM SYS.UNIFIED_AUDIT_TRAIL
WHERE event_timestamp >= DATE '2026-05-01'
  AND event_timestamp <  DATE '2026-06-01';

-- 归档完成后，设置归档时间戳，允许清理该时段及之前的数据
BEGIN
  DBMS_AUDIT_MGMT.SET_LAST_ARCHIVE_TIMESTAMP(
    audit_trail_type  => DBMS_AUDIT_MGMT.AUDIT_TRAIL_UNIFIED,
    last_archive_time => TO_TIMESTAMP('2026-06-01 00:00:00', 'YYYY-MM-DD HH24:MI:SS')
  );
END;
/
```

