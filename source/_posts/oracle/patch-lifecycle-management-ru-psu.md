---
title: 补丁生命周期管理：RU/PSU 应用、OPlan 冲突检测与滚动升级
lang: zh-CN
date: 2026-05-08 10:00:00
categories: Oracle
tags: [补丁, RU, PSU, OPlan, OPatch, 升级, 回滚]
---

## 一、问题背景

补丁管理是 Oracle DBA 日常运维中最核心、最高频的工作之一。一个成熟的 DBA，不仅要能熟练安装补丁，更要掌握补丁从下载、分析、冲突检测、应用到回滚的完整生命周期管理。在生产环境中，任何一次补丁操作的失误都可能导致数据库无法启动、业务中断，甚至数据丢失。

Oracle 的补丁体系经历了一次重要的演变：从 12c 之前的 **PSU (Patch Set Update)** 体系，转变为 12c 及之后的 **RU (Release Update)** 体系。理解这一演变过程，对于正确选择和应用补丁至关重要。

补丁应用失败的生产风险不容小觑。常见问题包括：补丁冲突导致安装失败、patch 后 datapatch 未执行导致数据字典不一致、RAC 环境节点间版本不一致等。因此，建立标准化的补丁管理流程是每个 DBA 团队的必修课。

---

## 二、理论分析

### 2.1 Oracle 补丁体系

Oracle 提供了多种类型的补丁，理解它们的定位和适用场景是补丁管理的基础：

| 补丁类型 | 说明 | 适用场景 |
|---------|------|---------|
| **CPU (Critical Patch Update)** | 关键安全补丁，季度发布 | 修复安全漏洞 |
| **PSU (Patch Set Update)** | 包含 CPU + 重要 Bug 修复（11g 及之前） | 11g 及更早版本的定期维护 |
| **RU (Release Update)** | 替代 PSU 的季度累积补丁（12.2+） | 12c R2 及之后版本的定期维护 |
| **RUR (Release Update Revision)** | RU 的修订版，仅含安全修复和回退修复 | 不想升级 RU 但仍需安全修复 |
| **One-off Patch (Interim Patch)** | 针对特定 Bug 的单点修复 | 解决特定问题，不包含在 RU 中 |

从 12.2 版本开始，Oracle 用 RU 替代了 PSU。RU 每季度发布，包含安全修复和经过充分测试的 Bug 修复。RUR 则是 RU 的修订版，适用于希望保持当前 RU 版本但仍需接收安全修复的场景。

补丁编号的演进规律：
- **11g**: PSU 11.2.0.4.x（如 11.2.0.4.190115）
- **12.1**: PSU 12.1.0.2.x
- **12.2+**: RU 12.2.0.1.x、19.x.x（如 19.23.0.0.0）

### 2.2 OPatch 工具

**OPatch** 是 Oracle 提供的补丁管理命令行工具，位于 `$ORACLE_HOME/OPatch/` 目录下。它的主要功能包括：

**OPatch 版本管理**

OPatch 自身也需要定期更新。在应用任何补丁之前，首先需要确认 OPatch 版本满足要求：

```bash
# 查看当前 OPatch 版本
$ORACLE_HOME/OPatch/opatch version
$ORACLE_HOME/OPatch/opatch lsinventory
```

MOS 文档通常会指明所需的最低 OPatch 版本。版本不满足时，需要先升级 OPatch：

```bash
# 备份旧版 OPatch
mv $ORACLE_HOME/OPatch $ORACLE_HOME/OPatch.bak

# 解压新版 OPatch
unzip p6880880_<platform>.zip -d $ORACLE_HOME/
```

**补丁冲突检测**

OPatch 在应用补丁前会自动进行冲突检测，检查新补丁是否与已安装的补丁存在冲突：

```bash
# 预检查（dry-run），不实际应用补丁
cd <patch_number>
$ORACLE_HOME/OPatch/opatch prereq CheckConflictAgainstOHWithDetail -ph ./
```

冲突分为两类：
- **Duplicated patch conflict**: 新补丁是已安装补丁的子集，已安装的补丁版本更高
- **Subset patch conflict**: 已安装的补丁是新补丁的子集，需要用新补丁替换

**补丁回滚机制**

OPatch 支持通过补丁编号回滚已安装的补丁：

```bash
# 回滚指定补丁
$ORACLE_HOME/OPatch/opatch rollback -id <patch_number>
```

回滚时 OPatch 会使用 `$ORACLE_HOME/.patch_storage/<patch_number>/` 下保存的原始文件进行恢复。

### 2.3 OPlan

**OPlan (Oracle Patch Planning Tool)** 是 Oracle 提供的补丁规划和冲突预检测工具，用于在正式应用补丁之前进行全面分析，生成详细的分析报告。

**OPlan 的作用**：
- 在补丁下载前分析目标环境与补丁的兼容性
- 检测补丁与已安装补丁的冲突
- 生成应用补丁所需的操作步骤
- 评估补丁对系统的影响

**OPlan 使用流程**：

```bash
# 1. 下载 OPlan 工具（从 MOS 下载 oplan 包）
# 解压到指定目录
unzip oplan_<version>.zip -d /opt/oracle/oplan/

# 2. 执行分析
# opcheck 模式：分析补丁与当前环境的兼容性
$ORACLE_HOME/OPatch/oplan/oplan/opcheck <patch_location> <target_version>

# 3. 生成报告
# report 模式：生成详细的补丁应用步骤
$ORACLE_HOME/OPatch/oplan/oplan/report <patch_location> <target_version>
```

生成的报告位于 `<patch_location>/opcheck_report.html` 或 `report.html`，包含以下关键信息：
- 环境信息（Oracle Home、数据库版本、已安装补丁列表）
- 冲突检测结果
- 推荐的操作步骤
- 预计停机时间

### 2.4 RAC 滚动补丁

**Rolling Patch（滚动补丁）** 是 RAC 环境中实现零停机补丁应用的关键技术。其原理是逐节点应用补丁，每次只停止一个节点进行补丁操作，其余节点继续提供服务。

**Rolling Patch 的前提条件**：
- 补丁必须标记为 rolling capable
- 使用 `opatch auto` 或手动逐节点操作
- 确保集群在任一节点停止时仍能满足业务负载

**OPatch auto (RAC)**

Oracle 提供了 `opatch auto` 命令来自动化 RAC 环境的滚动补丁过程：

```bash
# opatch auto 自动处理以下步骤：
# 1. 停止当前节点的数据库实例
# 2. 应用 GI 和 DB Home 补丁
# 3. 执行 datapatch
# 4. 重启当前节点实例
# 5. 移动到下一个节点重复以上步骤
```

**零停机补丁策略**：

真正的零停机需要配合应用层的连接管理。典型策略包括：

1. **Service-based failover**：通过 Oracle Service 实现连接漂移
2. **节点逐一下线**：每次从集群中移除一个节点进行补丁
3. **滚动重启**：补丁完成后节点重新加入集群
4. **数据字典更新**：通过 datapatch 在所有节点完成后统一执行

---

## 三、实战操作

### 3.1 补丁下载与分析

**步骤一：MOS 补丁搜索**

登录 [My Oracle Support](https://support.oracle.com)，通过以下方式搜索补丁：

1. **按补丁编号搜索**：已知具体 Patch Number 时直接搜索
2. **按产品/版本搜索**：选择 Product = "Oracle Database"，Release = "19.x"
3. **推荐补丁**：查看 MOS 文档 **Doc ID 555.1** 获取最新推荐补丁

下载补丁后上传到服务器并解压：

```bash
# 上传补丁文件
scp p36233123_190000_Linux-x86-64.zip oracle@dbserver:/u01/patches/

# 解压补丁
cd /u01/patches/
unzip p36233123_190000_Linux-x86-64.zip
```

**步骤二：OPlan 分析报告**

在正式应用前，使用 OPlan 生成分析报告：

```bash
# 执行 opcheck 分析
cd /opt/oracle/oplan/
export ORACLE_HOME=/u01/app/oracle/product/19.0.0/dbhome_1
$ORACLE_HOME/OPatch/opatch prereq CheckConflictAgainstOHWithDetail \
    -phBaseDir /u01/patches/36233123

# 使用 OPlan 生成完整报告
cd /u01/patches/36233123
$ORACLE_HOME/OPatch/oplan/oplan report \
    /u01/patches/36233123 \
    19.0.0.0.0
```

**步骤三：OPatch 冲突检查**

```bash
# 确认 OPatch 版本满足要求
$ORACLE_HOME/OPatch/opatch version
# 预期输出：OPatch Version: 12.2.0.1.42

# 列出当前已安装的补丁
$ORACLE_HOME/OPatch/opatch lsinventory -detail

# 冲突检查
cd /u01/patches/36233123
$ORACLE_HOME/OPatch/opatch prereq CheckConflictAgainstOHWithDetail -ph ./

# 检查空间需求
$ORACLE_HOME/OPatch/opatch prereq CheckSystemSpace -ph ./
```

### 3.2 单机补丁应用

**完整补丁应用流程**：

```bash
# ============================================
# 1. 环境准备
# ============================================
export ORACLE_HOME=/u01/app/oracle/product/19.0.0/dbhome_1
export ORACLE_SID=orcl
export PATH=$ORACLE_HOME/OPatch:$PATH

# 确认数据库状态
sqlplus / as sysdba
SQL> select status from v$instance;
SQL> exit;

# 关闭数据库和监听器
srvctl stop database -d orcl
srvctl stop listener

# ============================================
# 2. 应用补丁（OPatch apply）
# ============================================
cd /u01/patches/36233123
$ORACLE_HOME/OPatch/opatch apply

# 应用过程中，OPatch 会执行以下检查：
# - 版本兼容性检查
# - 冲突检测
# - 空间检查
# - 备份原始文件
# - 应用补丁文件
# - 更新 inventory

# ============================================
# 3. 执行 datapatch（数据字典更新）
# ============================================
# 启动数据库到 OPEN 状态
sqlplus / as sysdba
SQL> startup
SQL> exit;

# 执行 datapatch 更新数据字典
cd $ORACLE_HOME/OPatch
./datapatch -verbose

# datapatch 执行内容：
# - 检查需要应用 SQL 补丁的 PDB 列表
# - 执行补丁相关的 SQL 脚本
# - 更新 DBA_REGISTRY_SQLPATCH 视图

# ============================================
# 4. 补丁后验证
# ============================================
# 确认补丁已应用
$ORACLE_HOME/OPatch/opatch lsinventory

# 确认 datapatch 执行成功
sqlplus / as sysdba
SQL> select PATCH_ID, PATCH_TYPE, ACTION, STATUS, DESCRIPTION
     from DBA_REGISTRY_SQLPATCH
     order by ACTION_TIME;

# 编译无效对象（可选但推荐）
sqlplus / as sysdba
SQL> @?/rdbms/admin/utlrp.sql
```

### 3.3 RAC 滚动补丁

**使用 opatch auto 的完整流程**：

```bash
# ============================================
# RAC 滚动补丁 - 节点1 操作
# ============================================

# 1. 确认集群状态
crsctl stat res -t

# 2. 在节点1上执行 opatch auto
# 该命令会自动完成：
#   - 停止节点1上的数据库实例
#   - 应用 GI Home 补丁
#   - 应用 DB Home 补丁
#   - 启动节点1上的数据库实例
cd /u01/patches/36233123
$ORACLE_HOME/OPatch/opatch auto /u01/patches/36233123 \
    -ocmrf /u01/patches/ocm.rsp

# 3. 验证节点1补丁状态
$ORACLE_HOME/OPatch/opatch lsinventory

# ============================================
# 节点2 操作（重复以上步骤）
# ============================================
ssh oracle@racnode2
export ORACLE_HOME=/u01/app/oracle/product/19.0.0/dbhome_1
cd /u01/patches/36233123
$ORACLE_HOME/OPatch/opatch auto /u01/patches/36233123 \
    -ocmrf /u01/patches/ocm.rsp

# ============================================
# 所有节点补丁完成后 - 执行 datapatch
# ============================================
# 仅在任意一个节点上执行一次 datapatch
# datapatch 会自动处理所有 PDB
sqlplus / as sysdba
SQL> alter pluggable database all open;
SQL> exit;

cd $ORACLE_HOME/OPatch
./datapatch -verbose

# ============================================
# RAC 零停机验证
# ============================================
# 检查所有节点补丁一致
srvctl config database -d orcl

# 确认所有实例正常
sqlplus / as sysdba
SQL> select inst_name, status from gv$instance;

# 确认数据字典更新成功
SQL> select PATCH_ID, ACTION, STATUS, DESCRIPTION
     from DBA_REGISTRY_SQLPATCH
     order by ACTION_TIME;
```

**手动滚动补丁（不使用 opatch auto）**：

当 `opatch auto` 遇到环境特殊配置问题时，可以手动执行滚动补丁：

```bash
# 在节点1上操作
# 1. 停止节点1实例
srvctl stop instance -d orcl -i orcl1

# 2. 应用补丁
cd /u01/patches/36233123
$ORACLE_HOME/OPatch/opatch apply -local

# 3. 启动节点1实例
srvctl start instance -d orcl -i orcl1

# 对其他节点重复以上步骤...

# 所有节点完成后执行 datapatch
cd $ORACLE_HOME/OPatch
./datapatch -verbose
```

### 3.4 补丁回滚

**当补丁应用后出现问题时，需要执行回滚操作**：

```bash
# ============================================
# 1. 单机环境回滚
# ============================================

# 回滚 OPatch 补丁
cd /u01/patches/36233123
$ORACLE_HOME/OPatch/opatch rollback -id 36233123

# 执行 datapatch 回滚数据字典变更
sqlplus / as sysdba
SQL> startup
SQL> exit;

cd $ORACLE_HOME/OPatch
./datapatch -rollback 36233123 -verbose

# 验证回滚
$ORACLE_HOME/OPatch/opatch lsinventory
sqlplus / as sysdba
SQL> select PATCH_ID, ACTION, STATUS, DESCRIPTION
     from DBA_REGISTRY_SQLPATCH
     order by ACTION_TIME;

# ============================================
# 2. RAC 环境回滚
# ============================================

# 逐节点回滚
# 节点1
srvctl stop instance -d orcl -i orcl1
$ORACLE_HOME/OPatch/opatch rollback -id 36233123 -local
srvctl start instance -d orcl -i orcl1

# 节点2（重复）
# ...

# 执行 datapatch 回滚
cd $ORACLE_HOME/OPatch
./datapatch -rollback 36233123 -verbose
```

> **回滚注意事项**：并非所有补丁都支持回滚。部分补丁在应用过程中修改了不可逆的数据结构，此时只能通过 RMAN 恢复或 Data Guard 切换实现回退。因此，补丁前的备份是至关重要的。

---

## 四、结果验证

补丁应用完成后，必须进行系统化的验证工作：

**4.1 opatch lsinventory 验证**

```bash
# 查看详细的补丁清单
$ORACLE_HOME/OPatch/opatch lsinventory -detail

# 查看补丁 ID 和描述
$ORACLE_HOME/OPatch/opatch lsinventory | grep -A5 "Patch"
```

输出应包含新应用的补丁编号、应用时间、补丁描述等信息。

**4.2 DBA_REGISTRY_SQLPATCH 验证**

```sql
-- 查看所有 SQL Patch 的应用状态
SELECT patch_id,
       patch_type,
       action,
       status,
       action_time,
       description
  FROM dba_registry_sqlpatch
 ORDER BY action_time DESC;

-- 确认无失败的补丁
SELECT COUNT(*) AS failed_count
  FROM dba_registry_sqlpatch
 WHERE status = 'WITH ERRORS';
```

**4.3 补丁后功能验证**

```sql
-- 检查数据库组件状态
SELECT comp_name, version, status
  FROM dba_registry
 WHERE status != 'VALID';

-- 检查无效对象数量
SELECT owner, object_type, COUNT(*)
  FROM dba_objects
 WHERE status = 'INVALID'
 GROUP BY owner, object_type;

-- 验证数据库基本功能
SELECT * FROM v$version;
SELECT instance_name, status FROM v$instance;

-- RAC 环境额外检查
SELECT inst_name, status FROM gv$instance;
SELECT name, open_mode FROM v$pdbs;
```

---

## 五、经验总结

**1. 补丁管理流程标准化**

建议制定标准化的补丁管理 SOP（Standard Operating Procedure），涵盖：
- 补丁评估与审批流程
- 补丁测试计划模板
- 补丁应用检查清单（Checklist）
- 补丁后验证脚本
- 回滚方案与应急措施

**2. 测试环境验证的重要性**

任何补丁在应用到生产环境之前，必须在测试环境完成以下验证：
- 补丁应用过程无报错
- datapatch 执行成功
- 核心业务功能回归测试
- 性能基准对比测试
- 回滚操作演练

**3. 补丁回滚策略**

- **OPatch rollback**: 适用于大部分补丁，依赖 `.patch_storage` 中的备份文件
- **RMAN 恢复**: 当补丁不支持回滚时的最终手段
- **Data Guard Switchover**: 如果有物理备库，可通过切换实现快速回退
- **存储快照恢复**: 利用存储层快照实现秒级回退

> 关键提醒：确保 `$ORACLE_HOME/.patch_storage/` 目录的完整性。OPatch 的回滚机制依赖此目录中保存的原始文件备份。不要手动清理此目录。

**4. 补丁窗口规划**

- **季度补丁窗口**：跟随 Oracle 的季度发布节奏（1月、4月、7月、10月）
- **紧急补丁窗口**：针对 Critical Patch Update 中的高危漏洞
- **补丁时间选择**：选择业务低谷期，通常为周末凌晨
- **补丁窗口时长**：预留足够的时间缓冲，建议至少 2-4 小时
- **通知机制**：提前通知相关方，确保有足够的人力支持

**补丁管理是 DBA 专业能力的重要体现**。通过标准化的流程、完善的测试验证和可靠的回滚策略，可以将补丁风险降到最低，确保数据库环境的安全与稳定。

---

> **参考文档**：
> - MOS Doc ID 555.1: Oracle Recommended Patches
> - MOS Doc ID 2162547.1: OPlan Patch Planning Tool
> - MOS Doc ID 2246070.1: RU/RUR Patch Naming Convention
> - Oracle Database OPatch User's Guide
