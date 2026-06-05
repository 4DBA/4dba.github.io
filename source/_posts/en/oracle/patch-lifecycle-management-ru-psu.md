---
title: "Patch Lifecycle Management: RU/PSU Application, OPlan Conflict Detection, and Rolling Upgrades"
date: 2026-05-08 10:00:00
categories: Oracle
tags: [补丁, RU, PSU, OPlan, OPatch, 升级, 回滚]
lang: en
---

## 1. Background

Patch management is one of the most critical and frequent tasks in a DBA's daily operations. A mature DBA should not only be proficient in applying patches but also master the complete lifecycle management of patches—from downloading and analysis, through conflict detection and application, to rollback. In production environments, any mistake during a patch operation can lead to database startup failures, service interruptions, or even data loss.

Oracle's patching system has undergone a major evolution: from the **PSU (Patch Set Update)** system used before 12c to the **RU (Release Update)** system introduced in 12c and later. Understanding this evolution is essential for correctly selecting and applying patches.

The risks of failed patch application in production cannot be underestimated. Common issues include: patch conflicts causing installation failures, failure to run datapatch after patching leading to data dictionary inconsistencies, and version mismatches between RAC nodes. Therefore, establishing standardized patch management processes is a mandatory requirement for every DBA team.

---

## 2. Theoretical Analysis

### 2.1 Oracle Patch System

Oracle provides several types of patches. Understanding their positioning and applicable scenarios is the foundation of patch management:

| Patch Type | Description | Applicable Scenario |
|-----------|-------------|---------------------|
| **CPU (Critical Patch Update)** | Critical security patches, released quarterly | Fixing security vulnerabilities |
| **PSU (Patch Set Update)** | Includes CPU + important bug fixes (11g and earlier) | Regular maintenance for 11g and earlier versions |
| **RU (Release Update)** | Quarterly cumulative patch replacing PSU (12.2+) | Regular maintenance for 12c R2 and later |
| **RUR (Release Update Revision)** | Revised version of RU, containing only security fixes and rollback fixes | When you don't want to upgrade the RU but still need security fixes |
| **One-off Patch (Interim Patch)** | Single-point fix for a specific bug | Resolving specific issues not included in RU |

Starting from version 12.2, Oracle replaced PSU with RU. RU is released quarterly and includes security fixes and thoroughly tested bug fixes. RUR is a revision of RU, suitable for scenarios where you want to maintain the current RU version but still receive security fixes.

Patch numbering evolution:
- **11g**: PSU 11.2.0.4.x (e.g., 11.2.0.4.190115)
- **12.1**: PSU 12.1.0.2.x
- **12.2+**: RU 12.2.0.1.x, 19.x.x (e.g., 19.23.0.0.0)

### 2.2 OPatch Tool

**OPatch** is Oracle's command-line patch management tool, located in the `$ORACLE_HOME/OPatch/` directory. Its main functions include:

**OPatch Version Management**

OPatch itself needs to be updated regularly. Before applying any patch, you must first confirm that the OPatch version meets the requirements:

```bash
# 查看当前 OPatch 版本
$ORACLE_HOME/OPatch/opatch version
$ORACLE_HOME/OPatch/opatch lsinventory
```

MOS documents typically specify the minimum required OPatch version. If the version does not meet the requirement, you need to upgrade OPatch first:

```bash
# 备份旧版 OPatch
mv $ORACLE_HOME/OPatch $ORACLE_HOME/OPatch.bak

# 解压新版 OPatch
unzip p6880880_<platform>.zip -d $ORACLE_HOME/
```

**Patch Conflict Detection**

OPatch automatically performs conflict detection before applying a patch, checking whether the new patch conflicts with already installed patches:

```bash
# 预检查（dry-run），不实际应用补丁
cd <patch_number>
$ORACLE_HOME/OPatch/opatch prereq CheckConflictAgainstOHWithDetail -ph ./
```

Conflicts fall into two categories:
- **Duplicated patch conflict**: The new patch is a subset of an already installed patch, and the installed patch version is higher.
- **Subset patch conflict**: The already installed patch is a subset of the new patch and needs to be replaced by the new patch.

**Patch Rollback Mechanism**

OPatch supports rolling back installed patches by patch number:

```bash
# 回滚指定补丁
$ORACLE_HOME/OPatch/opatch rollback -id <patch_number>
```

During rollback, OPatch uses the original files saved under `$ORACLE_HOME/.patch_storage/<patch_number>/` for restoration.

### 2.3 OPlan

**OPlan (Oracle Patch Planning Tool)** is Oracle's patch planning and conflict pre-detection tool, used to perform comprehensive analysis before formally applying patches and generate detailed analysis reports.

**OPlan's Role**:
- Analyze compatibility between the target environment and the patch before downloading
- Detect conflicts between the patch and already installed patches
- Generate the operational steps needed to apply the patch
- Assess the patch's impact on the system

**OPlan Usage Workflow**:

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

The generated report is located at `<patch_location>/opcheck_report.html` or `report.html`, containing the following key information:
- Environment information (Oracle Home, database version, list of installed patches)
- Conflict detection results
- Recommended operational steps
- Estimated downtime

### 2.4 RAC Rolling Patch

**Rolling Patch** is the key technology for achieving zero-downtime patch application in RAC environments. The principle is to apply patches node by node, stopping only one node at a time for patching while the remaining nodes continue to provide service.

**Prerequisites for Rolling Patch**:
- The patch must be marked as rolling capable
- Use `opatch auto` or manual per-node operations
- Ensure the cluster can still meet business load requirements when any single node is stopped

**OPatch auto (RAC)**

Oracle provides the `opatch auto` command to automate the rolling patch process in RAC environments:

```bash
# opatch auto 自动处理以下步骤：
# 1. 停止当前节点的数据库实例
# 2. 应用 GI 和 DB Home 补丁
# 3. 执行 datapatch
# 4. 重启当前节点实例
# 5. 移动到下一个节点重复以上步骤
```

**Zero-Downtime Patch Strategy**:

True zero-downtime requires coordination with application-layer connection management. Typical strategies include:

1. **Service-based failover**: Use Oracle Services to achieve connection migration
2. **Node-by-node decommissioning**: Remove one node from the cluster at a time for patching
3. **Rolling restart**: Nodes rejoin the cluster after patching is complete
4. **Data dictionary update**: Execute datapatch uniformly after all nodes are completed

---

## 3. Hands-On Operations

### 3.1 Patch Download and Analysis

**Step 1: MOS Patch Search**

Log in to [My Oracle Support](https://support.oracle.com) and search for patches using the following methods:

1. **Search by Patch Number**: Directly search when the specific Patch Number is known
2. **Search by Product/Version**: Select Product = "Oracle Database", Release = "19.x"
3. **Recommended Patches**: Check MOS document **Doc ID 555.1** for the latest recommended patches

After downloading the patch, upload it to the server and extract:

```bash
# 上传补丁文件
scp p36233123_190000_Linux-x86-64.zip oracle@dbserver:/u01/patches/

# 解压补丁
cd /u01/patches/
unzip p36233123_190000_Linux-x86-64.zip
```

**Step 2: OPlan Analysis Report**

Before formal application, use OPlan to generate an analysis report:

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

**Step 3: OPatch Conflict Check**

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

### 3.2 Standalone Patch Application

**Complete Patch Application Workflow**:

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

### 3.3 RAC Rolling Patch

**Complete Workflow Using opatch auto**:

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

**Manual Rolling Patch (Without Using opatch auto)**:

When `opatch auto` encounters environment-specific configuration issues, you can execute the rolling patch manually:

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

### 3.4 Patch Rollback

**When issues arise after applying a patch, a rollback operation is required**:

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

> **Rollback Notes**: Not all patches support rollback. Some patches modify irreversible data structures during application, in which case the only option is to recover via RMAN or perform a Data Guard switchover. Therefore, a backup before patching is absolutely critical.

---

## 4. Result Verification

After patch application is complete, systematic verification must be performed:

**4.1 opatch lsinventory Verification**

```bash
# 查看详细的补丁清单
$ORACLE_HOME/OPatch/opatch lsinventory -detail

# 查看补丁 ID 和描述
$ORACLE_HOME/OPatch/opatch lsinventory | grep -A5 "Patch"
```

The output should include the newly applied patch number, application time, patch description, and other information.

**4.2 DBA_REGISTRY_SQLPATCH Verification**

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

**4.3 Post-Patch Functional Verification**

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

## 5. Lessons Learned

**1. Standardize Patch Management Processes**

It is recommended to establish a standardized patch management SOP (Standard Operating Procedure) covering:
- Patch evaluation and approval process
- Patch testing plan template
- Patch application checklist
- Post-patch verification scripts
- Rollback plan and emergency measures

**2. Importance of Test Environment Verification**

Before applying any patch to the production environment, the following verification must be completed in the test environment:
- Patch application process completes without errors
- datapatch executes successfully
- Core business function regression testing
- Performance baseline comparison testing
- Rollback operation rehearsal

**3. Patch Rollback Strategies**

- **OPatch rollback**: Applicable to most patches, relies on backup files in `.patch_storage`
- **RMAN recovery**: Last resort when patch does not support rollback
- **Data Guard Switchover**: If a physical standby exists, fast rollback can be achieved through switchover
- **Storage snapshot recovery**: Use storage-level snapshots to achieve second-level rollback

> **Key Reminder**: Ensure the integrity of the `$ORACLE_HOME/.patch_storage/` directory. OPatch's rollback mechanism relies on the original file backups stored in this directory. Do not manually clean up this directory.

**4. Patch Window Planning**

- **Quarterly patch window**: Follow Oracle's quarterly release schedule (January, April, July, October)
- **Emergency patch window**: For critical vulnerabilities in Critical Patch Updates
- **Patch timing**: Choose periods of low business activity, typically early weekend mornings
- **Patch window duration**: Allow sufficient time buffer, recommended at least 2-4 hours
- **Notification mechanism**: Notify stakeholders in advance to ensure adequate personnel support

**Patch management is an important reflection of a DBA's professional competence.** Through standardized processes, thorough testing and verification, and reliable rollback strategies, patch risks can be minimized to ensure the security and stability of the database environment.

---

> **Reference Documents**:
> - MOS Doc ID 555.1: Oracle Recommended Patches
> - MOS Doc ID 2162547.1: OPlan Patch Planning Tool
> - MOS Doc ID 2246070.1: RU/RUR Patch Naming Convention
> - Oracle Database OPatch User's Guide
