---
title: "SQL Execution Plan Analysis Mastery: Cost, Cardinality, Access Path, and Join Optimization"
date: 2026-03-08 10:00:00
categories: Oracle
tags: [SQL优化, 执行计划, CBO, Cost, Cardinality, 10053]
lang: en
---

In the field of Oracle database performance optimization, execution plan analysis is the most core skill. Truly understanding an execution plan isn't about seeing whether it uses an Index or Table Scan — it's about understanding *why* the CBO made that choice: how Cost was calculated, what Cardinality was estimated, and whether the Access Path and Join Method are reasonable. This article systematically covers the complete methodology of execution plan analysis, from principles to practice.

<!--more-->

## 1. Background

Slow SQL is the primary cause of database performance issues. Based on experience, over 80% of database performance issues ultimately trace back to SQL statements. However, many DBAs have a common misconception when analyzing execution plans: they only look at what path was taken (Index Scan vs Full Table Scan) without understanding the underlying logic of why the CBO (Cost-Based Optimizer) made that choice.

A simple example: a SQL statement uses a Full Table Scan, and many DBAs' first reaction is "we should add an index." But in reality, if the table is small or most of the data needs to be returned, Full Table Scan may be the optimal choice. True SQL optimization requires a deep understanding of the CBO's decision logic — what information it's based on, how it calculates Cost, and why it chose a particular Access Path and Join Method.

## 2. Theoretical Analysis

### 2.1 CBO (Cost-Based Optimizer) Fundamentals

Oracle's CBO is a cost-based optimizer. Its core workflow is:

1. **Parse the SQL statement**, generating a syntax tree
2. **Query the data dictionary**, obtaining statistics
3. **Enumerate possible execution plans** (combinations of Access Path, Join Method, and Join Order)
4. **Calculate the Cost of each plan**, selecting the execution plan with the lowest Cost

**Selectivity** refers to the proportion of data that a predicate condition filters out. For example, if `status = 'ACTIVE'` matches 200 out of 1000 rows in a table, then Selectivity = 200/1000 = 0.2 (i.e., 20%).

**Cardinality** is Selectivity multiplied by the total number of rows in the table, representing the expected number of rows satisfying the condition. In the above example, Cardinality = 0.2 × 1000 = 200.

```
Cardinality = Num_Rows × Selectivity
Cost = IO_Cost + CPU_Cost / CPUSpeed
```

**Statistics** are the foundation of CBO decisions. If statistics are stale or inaccurate, the CBO will make incorrect Cost estimates and choose inefficient execution plans. Key statistics include:

- Table level: `NUM_ROWS`, `BLOCKS`, `AVG_ROW_LEN`
- Column level: `NUM_DISTINCT`, `LOW_VALUE`, `HIGH_VALUE`, `NUM_NULLS`, `HISTOGRAM`
- Index level: `BLEVEL`, `LEAF_BLOCKS`, `DISTINCT_KEYS`, `CLUSTERING_FACTOR`

### 2.2 Access Path

Access Path is how Oracle retrieves data from a table. Different Access Paths have different Cost characteristics:

**Full Table Scan (FTS)**: Reads all blocks of a table. Suitable for scenarios returning large amounts of data (typically more than 5%-10% of the table). Cost mainly depends on the table's block count and multi-block read parameter (`db_file_multiblock_read_count`).

```
FTS_Cost = Blocks / MBRC × mreadcost + CPU_Cost
```

**Index Unique Scan**: Precisely locates a single row through a unique index. Cost = B-Tree height + 1 table access I/O.

**Index Range Scan**: Index range scan, used for range queries or non-unique index equality queries. Cost depends on the number of leaf blocks scanned and table access I/O.

**Index Full Scan**: Sequentially scans all leaf blocks of an index. Used when sorted results are needed and the index contains the required columns, avoiding additional sorting.

**Index Fast Full Scan (IFFS)**: Multi-block read scan of all index blocks (order not guaranteed). Used when query columns are fully covered by the index and no sorting is needed.

**Index Skip Scan**: When the leading column of a composite index has very low cardinality, the leading column can be skipped during scanning. For example, with index `(gender, employee_id)` and query `employee_id = 100`, the CBO may choose Skip Scan, searching separately for each distinct value of gender.

Here's an execution plan example:

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

Interpretation:
- Id=2's Index Range Scan first finds approximately 10 rows on the index (E-Rows=10), Cost=2
- Id=1 accesses the table via ROWID, filtering down to 1 row (E-Rows=1), total Cost=4
- Note that E-Rows is the CBO's estimated row count; A-Rows (actual row count) is the real number

### 2.3 Join Methods

Oracle has three main Join methods, each with its own applicable scenarios:

**Nested Loop Join (NLJ)**: Outer-table driven, performs an index lookup on the inner table for each row. Suitable when the outer table is small and the inner table has an efficient index.

```
Cost = Outer_Rows × (Index_Cost + Table_Access_Cost) + Outer_Scan_Cost
```

**Hash Join**: Builds a hash table from the smaller table (build table), then probes with the larger table (probe table). Suitable for equi-joins and large table joins.

```
Cost = Build_Table_Cost + Probe_Table_Cost + Hash_Build_Cost
```

**Sort Merge Join (SMJ)**: Sorts both tables first, then merges. Suitable for already-sorted data or non-equi-joins (`>`, `<`, `BETWEEN`).

Here's a Hash Join execution plan:

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

Interpretation: The DEPT table (100 rows) serves as the Build Table to construct the hash table, while the EMP table (50,000 rows) serves as the Probe Table. If EMP were chosen as the Build Table instead, more memory and CPU would be required, resulting in higher Cost. The CBO automatically selects the optimal approach by comparing statistics from both tables.

### 2.4 Join Order

Join Order refers to the sequence in which tables are joined in multi-table joins. N tables have N! possible join orders. Oracle uses **Left-Deep Trees** to limit the search space.

The selection of the driving table is crucial. Ideally:
- The driving table should be the one with the fewest rows after filtering
- The smaller the driving table's result set, the fewer inner loop iterations
- In Nested Loop joins, the driving table selection has the greatest impact on performance

**Star Transformation** is an Oracle optimization technique for star schemas. When a fact table is queried through multiple dimension tables, the CBO can transform the join query into Bitmap AND/OR operations on the fact table's bitmap indexes, significantly reducing I/O.

### 2.5 Common Execution Plan Issues

**Common causes of index ineffectiveness:**

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

**Cardinality estimation deviation** is at the core of execution plan issues. When E-Rows and A-Rows differ significantly, the CBO may choose the wrong execution plan. Common causes include: missing histograms, multi-column predicate correlation (CBO assumes columns are independent by default), and stale statistics.

**Bind Variable Peeking**: During the first hard parse, Oracle peeks at the actual bind variable values to estimate Cardinality. However, subsequent soft parses all use the first execution plan. If the first value is not representative, this can cause serious performance issues in subsequent executions. Oracle 11g introduced **Adaptive Cursor Sharing** to mitigate this problem.

## 3. Hands-On Operations

### 3.1 Execution Plan Retrieval Methods

**Method 1: EXPLAIN PLAN FOR**

```sql
EXPLAIN PLAN FOR
SELECT e.employee_id, e.last_name, d.department_name
FROM employees e, departments d
WHERE e.department_id = d.department_id
AND d.department_name = 'Sales';

SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY(NULL, NULL, 'ALL'));
```

Note: `EXPLAIN PLAN FOR` generates an estimated execution plan that does not use actual bind variable values, and may differ from the actual execution plan.

**Method 2: DBMS_XPLAN.DISPLAY_CURSOR (Recommended)**

```sql
-- 先执行SQL
SELECT /*+ GATHER_PLAN_STATISTICS */ e.employee_id, e.last_name
FROM employees e
WHERE e.department_id = 50;

-- 获取实际执行计划（含A-Rows）
SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY_CURSOR(NULL, NULL, 'ALLSTATS LAST'));
```

The `GATHER_PLAN_STATISTICS` hint tells Oracle to collect actual execution statistics (A-Rows, A-Time, etc.). This is the most accurate method for analyzing execution plans.

**Method 3: AUTOTRACE**

```sql
SET AUTOTRACE TRACEONLY
SELECT * FROM employees WHERE department_id = 50;
SET AUTOTRACE OFF
```

### 3.2 Execution Plan Interpretation

Below is a detailed execution plan interpretation example:

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

Key interpretation elements:

1. **Operation and Options**: Operation type and options, such as `TABLE ACCESS FULL`, `INDEX RANGE SCAN`
2. **E-Rows vs A-Rows**: Estimated rows vs actual rows. At Id=3, E-Rows=1 and A-Rows=1, so the estimate is accurate; significant gaps warrant attention
3. **Buffers**: Logical I/O, a key metric for measuring SQL efficiency
4. **Reads**: Physical I/O, occurs during first execution or when data is not in cache
5. **Predicate Information**: `access` indicates index access conditions (efficient), `filter` indicates filtering conditions (requires row-by-row checking)

### 10053 Trace Interpretation

10053 Trace is the ultimate tool for understanding the CBO's decision process. How to enable it:

```sql
ALTER SESSION SET EVENTS '10053 trace name context forever, level 1';
EXPLAIN PLAN FOR SELECT ...;  -- 要分析的SQL
ALTER SESSION SET EVENTS '10053 trace name context off';
```

Key sections of a 10053 Trace file:

**1. Statistics Section**

```
Table Stats::
  Table: EMPLOYEES  Alias: E
    #Rows: 107  #Blks: 5  AvgRowLen: 68.00  ChainCnt: 0.00
Column (#2): DEPARTMENT_ID(NUMBER)
    AvgLen: 4 NDV: 11 Nulls: 1 Density: 0.009346
    Histogram: HtBal  #Bkts: 11  UncompBkts: 11  EndPtVals: 11
```

Here you can see the table's row count, block count, average row length, as well as the column's number of distinct values (NDV), null count, density, and histogram information.

**2. Selectivity Calculation**

```
ColGroup Usage:: PredCnt: 2  Matches#: 1  Density: 0.001234
  Access Path: IndexRangeScan
    Cost: 4.00  Resp: 4.00  Degree: 1
      Index: IDX_EMP_DEPT
        io_cost: 3.00  cpu_cost: 25870
```

**3. Access Path Evaluation**

```
Access Path: TableScan
    Cost: 3.00  Resp: 3.00  Degree: 0
Access Path: index (RangeScan)
    Index: IDX_EMP_DEPT
    Cost: 4.00  Resp: 4.00  Degree: 1
Best:: AccessPath: TableScan
       Cost: 3.00  Degree: 1  Resp: 3.00  Card: 10.00
```

You can see the CBO evaluated TableScan (Cost=3) and Index RangeScan (Cost=4), ultimately selecting the lower-cost TableScan.

**4. Join Evaluation**

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

The CBO compared Nested Loop (Cost=5) with Hash Join (Cost=6) and selected Nested Loop.

### 3.3 SQL Profile and SQL Plan Baseline

**SQL Profile** is a product of Oracle's automatic tuning. It can inject additional statistics into a SQL statement (correcting Cardinality estimates) without changing the SQL text.

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

**SQL Plan Baseline (SPM)** is an execution plan stability management mechanism introduced in Oracle 11g:

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

The core idea of SPM is: only verified (accepted) execution plans will be used. New execution plans must pass evolution to verify their performance is not worse than existing plans before being accepted.

### 3.4 Hint Usage

**Common Hints:**

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

**Reasons why Hints sometimes don't take effect:**

1. **Hint syntax errors**: Oracle silently ignores incorrect Hints without raising errors
2. **Object alias issues**: Hints must use table aliases, not table names
3. **Hint conflicts**: When multiple Hints contradict each other, the CBO may choose to ignore them
4. **Query transformations**: After certain CBO query transformations, the original Hint may no longer apply

## 4. Complete SQL Optimization Case Study

### Case Background

An e-commerce system's order query SQL had an execution time exceeding 30 seconds:

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

### Step 1: Obtain the Execution Plan

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

**Pre-optimization execution plan:**

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

**Problem analysis:**
- All 4 tables used Full Table Scan, with Buffers as high as 520,000
- ORDERS table full table scan of 150,000 rows (Cost=5100)
- E-Rows and A-Rows differ significantly at the Hash Join (75,000 vs 15,000), indicating Cardinality estimation deviation

### Step 2: Analyze the Cause

View statistics:

```sql
SELECT table_name, num_rows, last_analyzed
FROM user_tables
WHERE table_name IN ('ORDERS','CUSTOMERS','ORDER_ITEMS','PRODUCTS');

SELECT column_name, num_distinct, num_nulls, histogram
FROM user_tab_col_statistics
WHERE table_name = 'ORDERS' AND column_name = 'ORDER_DATE';
```

Problems found:
1. `ORDERS` table statistics were collected 3 months ago; current data volume has grown by 50%
2. `ORDER_DATE` column has no histogram; the CBO cannot accurately estimate date range selectivity
3. `CUSTOMERS.REGION` column lacks an index

### Step 3: Optimization Plan

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

### Step 4: Result Verification

**Post-optimization execution plan:**

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

**Comparison results:**

| Metric | Before Optimization | After Optimization | Improvement |
|------|--------|--------|------|
| Buffer Gets | 520,000 | 8,500 | **98.4%** |
| Cost | 8,540 | 85 | **99%** |
| Execution Time | 30 seconds | 0.3 seconds | **99%** |

The optimization results are remarkable. Buffers decreased from 520,000 to 8,500, and execution time dropped from 30 seconds to 0.3 seconds. Key optimization points: updating statistics enabled the CBO to obtain accurate Cardinality estimates, and creating indexes provided efficient Access Paths.

## 5. Lessons Learned

### Systematic Approach to SQL Optimization

1. **Obtain the execution plan**: Prefer `DBMS_XPLAN.DISPLAY_CURSOR` + `GATHER_PLAN_STATISTICS`
2. **Compare E-Rows with A-Rows**: Large gaps indicate Cardinality estimation issues
3. **Check statistics**: `USER_TAB_STATISTICS`, `USER_TAB_COL_STATISTICS`
4. **Analyze Access Path**: Whether the correct index was used
5. **Analyze Join Method and Join Order**: Whether large tables serve as driving tables
6. **Use 10053 Trace when necessary** for deep CBO decision analysis

### When to Use 10053 Trace

- When statistics are accurate but the execution plan is unreasonable
- When you need to understand why the CBO chose a particular Access Path/Join Method
- When debugging why a Hint isn't taking effect
- When you need to understand the specific Selectivity and Cardinality calculation process

### Statistics Collection Strategy

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

### Common SQL Anti-Patterns

1. **Implicit type conversion**: Ensure bind variable types match column types
2. **Functions wrapping index columns**: Use function indexes or rewrite SQL
3. **SELECT ***: Only query needed columns, especially in covering index scenarios
4. **Missing WHERE conditions**: Always add conditions for updates/deletes
5. **Subqueries replacing JOINs**: Modern optimizers can usually auto-transform, but complex nested subqueries may still cause issues
6. **Excessive Hint usage**: Analyze root causes first; Hints are only temporary solutions

Execution plan analysis is a core DBA skill. Mastering the principles of Cost, Cardinality, Access Path, and Join optimization, combined with deep 10053 Trace analysis, is the key to truly achieving the leap from "knowing what happened" to "knowing why it happened" in SQL optimization.
