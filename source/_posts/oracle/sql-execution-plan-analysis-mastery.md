---
title: SQL 执行计划分析精通：Cost, Cardinality, Access Path 与连接优化
date: 2026-03-08 10:00:00
categories: Oracle
tags: [SQL优化, 执行计划, CBO, Cost, Cardinality, 10053]
---

在Oracle数据库性能优化领域，执行计划分析是最核心的技能。真正读懂一个执行计划，不是看它走了Index还是Table Scan，而是理解CBO为什么做出这个选择——Cost是怎么算的，Cardinality估了多少，Access Path和Join Method是否合理。本文将从原理到实战，系统地讲解执行计划分析的完整方法论。

<!--more-->

## 一、问题背景

慢SQL是数据库性能问题的首要原因。根据经验，80%以上的数据库性能问题最终都指向SQL语句。然而，很多DBA在分析执行计划时存在一个常见误区：只看走了什么路径（Index Scan还是Full Table Scan），却不理解CBO（Cost-Based Optimizer）做出这个选择的底层逻辑。

举个简单的例子：一个SQL走了Full Table Scan，很多DBA的第一反应是"应该加索引"。但实际上，如果表很小或者需要返回大部分数据，Full Table Scan可能就是最优选择。真正的SQL优化，需要深入理解CBO的决策逻辑——它基于什么信息，怎么计算Cost，为什么选择这个Access Path和Join Method。

## 二、理论分析

### 2.1 CBO (Cost-Based Optimizer) 基础

Oracle的CBO是一个基于成本的优化器，其核心工作流程是：

1. **解析SQL语句**，生成语法树
2. **查询数据字典**，获取统计信息
3. **枚举可能的执行计划**（Access Path、Join Method、Join Order的组合）
4. **计算每个计划的Cost**，选择Cost最低的执行计划

**选择性（Selectivity）** 是指一个谓词条件能过滤掉多少比例的数据。例如 `status = 'ACTIVE'` 如果表中有1000行，其中200行是ACTIVE状态，则Selectivity = 200/1000 = 0.2（即20%）。

**基数（Cardinality）** 是Selectivity乘以表的总行数，表示满足条件的预期行数。上例中Cardinality = 0.2 × 1000 = 200。

```
Cardinality = Num_Rows × Selectivity
Cost = IO_Cost + CPU_Cost / CPUSpeed
```

**统计信息** 是CBO决策的基础。如果统计信息过期或不准确，CBO就会做出错误的Cost估算，从而选择低效的执行计划。关键的统计信息包括：

- 表级别：`NUM_ROWS`、`BLOCKS`、`AVG_ROW_LEN`
- 列级别：`NUM_DISTINCT`、`LOW_VALUE`、`HIGH_VALUE`、`NUM_NULLS`、`HISTOGRAM`
- 索引级别：`BLEVEL`、`LEAF_BLOCKS`、`DISTINCT_KEYS`、`CLUSTERING_FACTOR`

### 2.2 Access Path (访问路径)

Access Path是Oracle从表中获取数据的方式。不同的Access Path有不同的Cost特征：

**Full Table Scan (FTS)**：读取表的所有块。适用于返回大量数据（通常超过表的5%-10%）的场景。Cost主要取决于表的块数和多块读参数（`db_file_multiblock_read_count`）。

```
FTS_Cost = Blocks / MBRC × mreadcost + CPU_Cost
```

**Index Unique Scan**：通过唯一索引精确查找一行。Cost = B-Tree高度 + 1次回表IO。

**Index Range Scan**：索引范围扫描，用于范围查询或非唯一索引等值查询。Cost取决于扫描的叶子块数和回表IO。

**Index Full Scan**：顺序扫描索引的所有叶子块。当需要排序结果且索引包含所需列时使用，避免额外排序。

**Index Fast Full Scan (IFFS)**：多块读扫描索引的所有块（不保证顺序）。当查询列完全被索引覆盖且不需要排序时使用。

**Index Skip Scan**：当复合索引的前导列基数很低时，可以跳过前导列进行扫描。例如索引 `(gender, employee_id)`，查询 `employee_id = 100` 时，CBO可能选择Skip Scan，按gender的每个不同值分别查找。

来看一个执行计划示例：

```
---------------------------------------------------------------------------
| Id | Operation                   | Name        | Rows | Bytes | Cost  |
---------------------------------------------------------------------------
|  0 | SELECT STATEMENT            |             |    1 |    50 |     4 |
|  1 |  TABLE ACCESS BY INDEX ROWID| EMPLOYEES   |    1 |    50 |     4 |
|* 2 |   INDEX RANGE SCAN          | IDX_EMP_DEP |   10 |       |     2 |
---------------------------------------------------------------------------

Predicate Information (identified by operation id):
---------------------------------------------------
   2 - access("DEPARTMENT_ID"=50)
```

解读：
- Id=2的Index Range Scan先在索引上找到约10行（E-Rows=10），Cost=2
- Id=1通过ROWID回表取数据，过滤到1行（E-Rows=1），总Cost=4
- 注意E-Rows是CBO估算的行数，A-Rows（实际行数）才是真实的

### 2.3 Join Methods

Oracle有三种主要的Join方法，各有适用场景：

**Nested Loop Join (NLJ)**：外表驱动，对每一行在内表上做索引查找。适用于外表小、内表有高效索引的场景。

```
Cost = Outer_Rows × (Index_Cost + Table_Access_Cost) + Outer_Scan_Cost
```

**Hash Join**：对较小的表（build table）建哈希表，然后用较大表（probe table）探测。适用于等值连接、大表连接。

```
Cost = Build_Table_Cost + Probe_Table_Cost + Hash_Build_Cost
```

**Sort Merge Join (SJ)**：先对两个表排序，再合并。适用于已排序数据或非等值连接（`>`、`<`、`BETWEEN`）。

来看一个Hash Join的执行计划：

```
--------------------------------------------------------------------------------
| Id | Operation          | Name      | Rows  | Bytes |TempSpc| Cost (%CPU)|
--------------------------------------------------------------------------------
|  0 | SELECT STATEMENT   |           |  5000 |  732K |       |  1520 (1)  |
|* 1 |  HASH JOIN         |           |  5000 |  732K |       |  1520 (1)  |
|  2 |   TABLE ACCESS FULL| DEPT      |   100 |  2200 |       |     3 (0)  |
|  3 |   TABLE ACCESS FULL| EMP       | 50000 |  620K |       |  1510 (1)  |
--------------------------------------------------------------------------------

Predicate Information (identified by operation id):
---------------------------------------------------
   1 - access("E"."DEPT_ID"="D"."DEPT_ID")
```

解读：DEPT表（100行）作为Build Table建哈希表，EMP表（50000行）作为Probe Table。如果反过来选择EMP作为Build Table，需要更多内存和CPU，Cost会更高。CBO通过比较两个表的统计信息自动选择最优方案。

### 2.4 Join Order

Join Order是指多表连接时各表的连接顺序。N个表有N!种可能的连接顺序，Oracle使用**左深树（Left-Deep Tree）** 来限制搜索空间。

驱动表（Driving Table）的选择至关重要。理想情况下：
- 驱动表应该是过滤后行数最少的表
- 驱动表的结果集越小，内层循环次数越少
- 在Nested Loop中，驱动表的选择对性能影响最大

**Star Transformation** 是Oracle针对星型模式（Star Schema）的优化技术。当事实表通过多个维度表进行查询时，CBO可以将连接查询转换为对事实表位图索引的Bitmap AND/OR操作，显著减少IO。

### 2.5 常见执行计划问题

**索引失效的常见原因：**

```sql
-- 隐式类型转换：列是VARCHAR2，传入NUMBER
SELECT * FROM orders WHERE order_no = 12345;  -- 索引失效
SELECT * FROM orders WHERE order_no = '12345'; -- 索引生效

-- 对索引列使用函数
SELECT * FROM employees WHERE UPPER(last_name) = 'SMITH'; -- 索引失效
-- 解决：创建函数索引
CREATE INDEX idx_emp_upper ON employees(UPPER(last_name));

-- 前导通配符
SELECT * FROM products WHERE name LIKE '%phone%'; -- 索引失效
```

**Cardinality估算偏差** 是执行计划问题的核心。当E-Rows与A-Rows差距巨大时，CBO可能选择错误的执行计划。常见原因包括：直方图缺失、多列谓词相关性（CBO默认假设列独立）、统计信息过期。

**绑定变量窥视（Bind Variable Peeking）**：首次硬解析时，Oracle会窥视绑定变量的真实值来估算Cardinality。但后续的软解析都使用第一次的执行计划，如果首次的值不具代表性，后续可能产生严重的性能问题。Oracle 11g引入了**自适应游标共享（Adaptive Cursor Sharing）** 来缓解这个问题。

## 三、实战操作

### 3.1 执行计划获取方法

**方法一：EXPLAIN PLAN FOR**

```sql
EXPLAIN PLAN FOR
SELECT e.employee_id, e.last_name, d.department_name
FROM employees e, departments d
WHERE e.department_id = d.department_id
AND d.department_name = 'Sales';

SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY(NULL, NULL, 'ALL'));
```

注意：`EXPLAIN PLAN FOR` 生成的是预估执行计划，不使用实际的绑定变量值，可能与实际执行计划不同。

**方法二：DBMS_XPLAN.DISPLAY_CURSOR（推荐）**

```sql
-- 先执行SQL
SELECT /*+ GATHER_PLAN_STATISTICS */ e.employee_id, e.last_name
FROM employees e
WHERE e.department_id = 50;

-- 获取实际执行计划（含A-Rows）
SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY_CURSOR(NULL, NULL, 'ALLSTATS LAST'));
```

`GATHER_PLAN_STATISTICS` Hint让Oracle收集实际执行统计信息（A-Rows、A-Time等），这是分析执行计划最准确的方法。

**方法三：AUTOTRACE**

```sql
SET AUTOTRACE TRACEONLY
SELECT * FROM employees WHERE department_id = 50;
SET AUTOTRACE OFF
```

### 3.2 执行计划解读

下面是一个详细的执行计划解读示例：

```
--------------------------------------------------------------------------------------------------------------------
| Id | Operation                           | Name           | E-Rows | A-Rows | A-Time   | Buffers | Reads |
--------------------------------------------------------------------------------------------------------------------
|  0 | SELECT STATEMENT                    |                |        |   1000 |00:00:00.1|    1520 |    15 |
|  1 |  NESTED LOOPS                       |                |   1000 |   1000 |00:00:00.1|    1520 |    15 |
|  2 |   NESTED LOOPS                      |                |   1000 |   1000 |00:00:00.1|     520 |     5 |
|* 3 |    TABLE ACCESS FULL                | DEPARTMENTS    |      1 |      1 |00:00:00.1|       5 |     5 |
|* 4 |    INDEX RANGE SCAN                 | IDX_EMP_DEPT   |   1000 |   1000 |00:00:00.1|     515 |     0 |
|  5 |   TABLE ACCESS BY INDEX ROWID       | EMPLOYEES      |      1 |   1000 |00:00:00.1|    1000 |    10 |
--------------------------------------------------------------------------------------------------------------------

Predicate Information (identified by operation id):
---------------------------------------------------
   3 - filter("D"."DEPARTMENT_NAME"='Sales')
   4 - access("E"."DEPARTMENT_ID"="D"."DEPARTMENT_ID")
```

关键解读要素：

1. **Operation与Options**：操作类型和选项，如 `TABLE ACCESS FULL`、`INDEX RANGE SCAN`
2. **E-Rows vs A-Rows**：估算行数与实际行数。Id=3处E-Rows=1, A-Rows=1，估算准确；若差距大则需关注
3. **Buffers**：逻辑IO，是衡量SQL效率的关键指标
4. **Reads**：物理IO，首次执行或数据不在缓存时产生
5. **Predicate Information**：`access` 表示索引访问条件（高效），`filter` 表示过滤条件（需要逐行检查）

### 10053 Trace解读

10053 Trace是理解CBO决策过程的终极工具。启用方法：

```sql
ALTER SESSION SET EVENTS '10053 trace name context forever, level 1';
EXPLAIN PLAN FOR SELECT ...;  -- 要分析的SQL
ALTER SESSION SET EVENTS '10053 trace name context off';
```

10053 Trace文件的关键部分：

**1. 统计信息部分（Statistics）**

```
Table Stats::
  Table: EMPLOYEES  Alias: E
    #Rows: 107  #Blks: 5  AvgRowLen: 68.00  ChainCnt: 0.00
Column (#2): DEPARTMENT_ID(NUMBER)
    AvgLen: 4 NDV: 11 Nulls: 1 Density: 0.009346
    Histogram: HtBal  #Bkts: 11  UncompBkts: 11  EndPtVals: 11
```

这里可以看到表的行数、块数、行平均长度，以及列的不同值数（NDV）、空值数、密度和直方图信息。

**2. Selectivity计算**

```
ColGroup Usage:: PredCnt: 2  Matches#: 1  Density: 0.001234
  Access Path: IndexRangeScan
    Cost: 4.00  Resp: 4.00  Degree: 1
      Index: IDX_EMP_DEPT
        io_cost: 3.00  cpu_cost: 25870
```

**3. Access Path评估**

```
Access Path: TableScan
    Cost: 3.00  Resp: 3.00  Degree: 0
Access Path: index (RangeScan)
    Index: IDX_EMP_DEPT
    Cost: 4.00  Resp: 4.00  Degree: 1
Best:: AccessPath: TableScan
       Cost: 3.00  Degree: 1  Resp: 3.00  Card: 10.00
```

可以看到CBO评估了TableScan（Cost=3）和Index RangeScan（Cost=4），最终选择了Cost更低的TableScan。

**4. Join评估**

```
NL Join
  Outer table: DEPARTMENTS
    Cost: 3.00  Card: 1.00  Bytes: 20
  Inner table: EMPLOYEES
    Access Path: IndexRangeScan IDX_EMP_DEPT
    Cost: 2.00  Card: 10.00  Bytes: 30
  NL Cost: 5.00

HA Join
  Outer table: DEPARTMENTS  Build Table
    Cost: 3.00  Card: 1.00
  Inner table: EMPLOYEES  Probe Table
    Cost: 3.00  Card: 107.00
  HA Cost: 6.00

Best:: JoinMethod: NestedLoop
       Cost: 5.00  Card: 10.00  Bytes: 500
```

CBO比较了Nested Loop（Cost=5）和Hash Join（Cost=6），选择了Nested Loop。

### 3.3 SQL Profile与SQL Plan Baseline

**SQL Profile** 是Oracle自动调优的产物，可以为SQL注入额外的统计信息（修正Cardinality估算），而不改变SQL文本。

```sql
-- 使用DBMS_SQLTUNE创建SQL Profile
DECLARE
  l_task VARCHAR2(30);
  l_sql  CLOB;
BEGIN
  l_task := DBMS_SQLTUNE.CREATE_TUNING_TASK(
    sql_text    => 'SELECT * FROM large_table WHERE ...',
    user_name   => 'SCOTT',
    task_name   => 'tune_sql_01'
  );
  DBMS_SQLTUNE.EXECUTE_TUNING_TASK(task_name => l_task);
  DBMS_SQLTUNE.ACCEPT_SQL_PROFILE(
    task_name   => l_task,
    profile_name => 'profile_sql_01'
  );
END;
/
```

**SQL Plan Baseline (SPM)** 是Oracle 11g引入的执行计划稳定性管理机制：

```sql
-- 启用SPM
ALTER SYSTEM SET optimizer_use_sql_plan_baseline = TRUE;

-- 加载计划基线
SET SERVEROUTPUT ON
DECLARE
  l_plans PLS_INTEGER;
BEGIN
  l_plans := DBMS_SPM.LOAD_PLANS_FROM_CURSOR_CACHE(
    sql_id => 'abc123def456'
  );
  DBMS_OUTPUT.PUT_LINE('Loaded ' || l_plans || ' plans');
END;
/

-- 查看计划基线
SELECT sql_handle, plan_name, enabled, accepted, fixed
FROM dba_sql_plan_baselines
WHERE sql_text LIKE '%large_table%';
```

SPM的核心思想是：只有已验证（accepted）的执行计划才会被使用。新的执行计划需要通过演进（evolution）验证性能不差于已有计划才会被接受。

### 3.4 Hint使用

**常用Hint：**

```sql
-- 强制使用索引
SELECT /*+ INDEX(e IDX_EMP_DEPT) */ * FROM employees e WHERE department_id = 50;

-- 强制使用Nested Loop
SELECT /*+ USE_NL(e d) */ e.last_name, d.department_name
FROM employees e, departments d
WHERE e.department_id = d.department_id;

-- 强制使用Hash Join
SELECT /*+ USE_HASH(e d) */ e.last_name, d.department_name
FROM employees e, departments d
WHERE e.department_id = d.department_id;

-- 并行执行
SELECT /*+ PARALLEL(e 4) */ * FROM employees e;

-- 禁用索引（强制FTS）
SELECT /*+ FULL(e) */ * FROM employees e WHERE department_id = 50;
```

**Hint有时不生效的原因：**

1. **Hint语法错误**：Oracle对错误的Hint静默忽略，不会报错
2. **对象别名问题**：Hint中必须使用表别名而非表名
3. **Hint冲突**：多个Hint相互矛盾时，CBO可能选择忽略
4. **查询转换**：CBO在某些查询转换后，原Hint可能不再适用

## 四、SQL优化完整案例

### 案例背景

某电商系统的一个订单查询SQL执行时间超过30秒：

```sql
SELECT o.order_id, o.order_date, c.customer_name, p.product_name, oi.quantity
FROM orders o
JOIN customers c ON o.customer_id = c.customer_id
JOIN order_items oi ON o.order_id = oi.order_id
JOIN products p ON oi.product_id = p.product_id
WHERE o.order_date BETWEEN TO_DATE('2026-01-01','YYYY-MM-DD')
                       AND TO_DATE('2026-06-01','YYYY-MM-DD')
AND c.region = 'East'
AND p.category_id = 10;
```

### 步骤1：获取执行计划

```sql
SELECT /*+ GATHER_PLAN_STATISTICS */ o.order_id, o.order_date, c.customer_name
FROM orders o
JOIN customers c ON o.customer_id = c.customer_id
JOIN order_items oi ON o.order_id = oi.order_id
JOIN products p ON oi.product_id = p.product_id
WHERE o.order_date BETWEEN TO_DATE('2026-01-01','YYYY-MM-DD')
                       AND TO_DATE('2026-06-01','YYYY-MM-DD')
AND c.region = 'East'
AND p.category_id = 10;

SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY_CURSOR(NULL, NULL, 'ALLSTATS LAST +COST'));
```

**优化前执行计划：**

```
----------------------------------------------------------------------------------------------
| Id | Operation             | Name        | E-Rows | A-Rows | Buffers | Reads | Cost  |
----------------------------------------------------------------------------------------------
|  0 | SELECT STATEMENT      |             |        |  15000 |  520000 |  3200 | 8540  |
|* 1 |  HASH JOIN            |             |  15000 |  15000 |  520000 |  3200 | 8540  |
|  2 |   TABLE ACCESS FULL   | PRODUCTS    |    200 |    200 |      15 |    15 |     5 |
|* 3 |   HASH JOIN           |             |  75000 |  15000 |  520000 |  3185 | 8530  |
|* 4 |    TABLE ACCESS FULL  | CUSTOMERS   |  10000 |  10000 |    1500 |  1500 |   420 |
|* 5 |    HASH JOIN          |             | 150000 | 150000 |  518500 |  1685 | 7100  |
|* 6 |     TABLE ACCESS FULL | ORDERS      | 150000 | 150000 |   18500 |  1685 |  5100 |
|  7 |     TABLE ACCESS FULL | ORDER_ITEMS |  500000|  500000|   500000|     0 |  2000 |
----------------------------------------------------------------------------------------------
```

**问题分析：**
- 4个表全部走了Full Table Scan，Buffers高达52万
- ORDERS表150000行全表扫描（Cost=5100）
- E-Rows与A-Rows在Hash Join处差异大（75000 vs 15000），说明Cardinality估算有偏差

### 步骤2：分析原因

查看统计信息：

```sql
SELECT table_name, num_rows, last_analyzed
FROM user_tables
WHERE table_name IN ('ORDERS','CUSTOMERS','ORDER_ITEMS','PRODUCTS');

SELECT column_name, num_distinct, num_nulls, histogram
FROM user_tab_col_statistics
WHERE table_name = 'ORDERS' AND column_name = 'ORDER_DATE';
```

发现问题：
1. `ORDERS`表统计信息是3个月前收集的，当前数据量已增长50%
2. `ORDER_DATE`列没有直方图，CBO无法准确估算日期范围的选择性
3. `CUSTOMERS.REGION`列缺少索引

### 步骤3：优化方案

```sql
-- 1. 更新统计信息
BEGIN
  DBMS_STATS.GATHER_TABLE_STATS('SCOTT', 'ORDERS',
    method_opt => 'FOR ALL COLUMNS SIZE AUTO',
    granularity => 'AUTO',
    estimate_percent => DBMS_STATS.AUTO_SAMPLE_SIZE
  );
  DBMS_STATS.GATHER_TABLE_STATS('SCOTT', 'CUSTOMERS',
    method_opt => 'FOR ALL COLUMNS SIZE AUTO'
  );
END;
/

-- 2. 创建缺失的索引
CREATE INDEX idx_orders_date ON orders(order_date);
CREATE INDEX idx_customers_region ON customers(region);
CREATE INDEX idx_products_category ON products(category_id);
```

### 步骤4：结果验证

**优化后执行计划：**

```
-----------------------------------------------------------------------------------------------
| Id | Operation                              | Name             | E-Rows | A-Rows | Buffers |
-----------------------------------------------------------------------------------------------
|  0 | SELECT STATEMENT                       |                  |        |  15000 |    8500 |
|  1 |  NESTED LOOPS                          |                  |  15000 |  15000 |    8500 |
|  2 |   NESTED LOOPS                         |                  |  15000 |  15000 |    7000 |
|  3 |    HASH JOIN                           |                  |   1500 |   1500 |     520 |
|  4 |     TABLE ACCESS BY INDEX ROWID        | CUSTOMERS        |   1000 |   1000 |      80 |
|* 5 |      INDEX RANGE SCAN                  | IDX_CUST_REGION  |   1000 |   1000 |       5 |
|  6 |     TABLE ACCESS BY INDEX ROWID        | ORDERS           | 150000 |  15000 |     440 |
|* 7 |      INDEX RANGE SCAN                  | IDX_ORDERS_DATE  | 150000 |  15000 |      30 |
|* 8 |    INDEX RANGE SCAN                    | IDX_OI_ORDER     |     10 |  15000 |    6480 |
|  9 |   TABLE ACCESS BY INDEX ROWID          | PRODUCTS         |      1 |  15000 |    1500 |
|*10 |    INDEX UNIQUE SCAN                   | PK_PRODUCTS      |      1 |  15000 |      10 |
-----------------------------------------------------------------------------------------------

Predicate Information (identified by operation id):
---------------------------------------------------
   5 - access("C"."REGION"='East')
   7 - access("O"."ORDER_DATE">=TO_DATE('2026-01-01') AND "O"."ORDER_DATE"<=TO_DATE('2026-06-01'))
   8 - access("O"."ORDER_ID"="OI"."ORDER_ID")
  10 - access("OI"."PRODUCT_ID"="P"."PRODUCT_ID")
```

**对比结果：**

| 指标 | 优化前 | 优化后 | 提升 |
|------|--------|--------|------|
| Buffer Gets | 520,000 | 8,500 | **98.4%** |
| Cost | 8,540 | 85 | **99%** |
| 执行时间 | 30秒 | 0.3秒 | **99%** |

优化效果显著。Buffers从52万降到8500，执行时间从30秒降到0.3秒。关键优化点：更新统计信息让CBO获得准确的Cardinality估算，创建索引提供高效的Access Path。

## 五、经验总结

### SQL优化的系统方法

1. **获取执行计划**：优先使用 `DBMS_XPLAN.DISPLAY_CURSOR` + `GATHER_PLAN_STATISTICS`
2. **对比E-Rows与A-Rows**：差距大说明Cardinality估算有问题
3. **检查统计信息**：`USER_TAB_STATISTICS`、`USER_TAB_COL_STATISTICS`
4. **分析Access Path**：是否走了正确的索引
5. **分析Join Method与Join Order**：大表是否作为驱动表
6. **必要时使用10053 Trace**深入分析CBO决策

### 10053 Trace的使用时机

- 统计信息准确但执行计划不合理时
- 需要理解CBO为什么选择某个Access Path/Join Method时
- 调试Hint为什么不生效时
- 理解Selectivity和Cardinality的具体计算过程时

### 统计信息收集策略

```sql
-- 推荐使用自动统计信息收集（Oracle默认开启）
-- 对关键表手动收集，确保及时性
BEGIN
  DBMS_STATS.GATHER_TABLE_STATS(
    ownname          => 'SCOTT',
    tabname          => 'ORDERS',
    estimate_percent => DBMS_STATS.AUTO_SAMPLE_SIZE,
    method_opt       => 'FOR ALL COLUMNS SIZE AUTO',
    granularity      => 'AUTO',
    cascade          => TRUE  -- 同时收集索引统计信息
  );
END;
/

-- 锁定统计信息（防止自动收集覆盖）
DBMS_STATS.LOCK_TABLE_STATS('SCOTT', 'CONFIG_TABLE');
```

### 常见SQL反模式

1. **隐式类型转换**：确保绑定变量类型与列类型一致
2. **函数包裹索引列**：使用函数索引或改写SQL
3. **SELECT ***：只查需要的列，尤其是覆盖索引场景
4. **缺少WHERE条件**：全表更新/删除务必加条件
5. **子查询替代JOIN**：现代优化器通常能自动转换，但复杂嵌套子查询仍可能导致问题
6. **过度使用Hint**：应先分析根本原因，Hint只是临时方案

执行计划分析是DBA的核心能力。掌握Cost、Cardinality、Access Path和Join优化的原理，结合10053 Trace的深度分析，才能真正实现SQL优化从"知其然"到"知其所以然"的跨越。
