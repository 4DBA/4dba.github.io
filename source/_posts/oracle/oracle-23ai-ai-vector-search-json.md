---
title: Oracle 23ai 新特性尝鲜：AI Vector Search 与 JSON Relational Duality
date: 2026-06-03 10:00:00
categories: Oracle
tags: [23ai, AI Vector Search, JSON, 新特性, 向量数据库, AI]
---

> 本文是 Oracle 新特性系列的第 28 篇（收官篇），聚焦 Oracle 23ai 最核心的两个 AI 特性：AI Vector Search 与 JSON Relational Duality View。

## 一、问题背景

随着 LLM（大语言模型）和 RAG（Retrieval Augmented Generation）应用的爆发式增长，数据库不再只是存储结构化数据的仓库，它还需要具备**向量检索**和**语义搜索**的能力。传统做法是将向量数据存入专用的向量数据库（如 Milvus、Pinecone），但这意味着架构中多了一个组件，数据同步、一致性、运维复杂度都会随之增加。

Oracle 在 23ai 版本中正式将自己定位为 **AI Database**，核心思路是：**让关系型数据库原生支持向量操作**，无需引入外部向量库，就能在 SQL 层面完成向量存储、索引和相似度检索。同时，23ai 推出了 JSON Relational Duality View，彻底打通关系模型与文档模型之间的壁垒。

对于 DBA 而言，这些特性不是"锦上添花"，而是**必须掌握的技能栈**：

- 应用团队越来越多地要求在数据库层做向量检索，而不是维护额外的向量库
- JSON Duality View 让开发者用 JSON 接口操作关系表，DBA 需要理解其背后的机制才能做好性能调优
- 23ai 的 AI 特性已经进入生产环境，早一步掌握就意味着早一步建立技术壁垒

<!-- more -->

## 二、理论分析

### 2.1 AI Vector Search

#### 向量数据类型：VECTOR

Oracle 23ai 引入了全新的 `VECTOR` 数据类型，用于存储高维向量数据。它支持多种维度和格式：

- **FLOAT32**：32 位浮点数（默认），适合大多数 AI 模型输出
- **FLOAT64**：64 位浮点数，精度更高
- **INT8**：8 位整数，节省存储空间，适合量化向量
- **BINARY**：二进制格式，适合 Hamming 距离计算

向量维度在列定义时指定，例如 `VECTOR(384, FLOAT32)` 表示 384 维的 32 位浮点向量。也可以定义为动态维度 `VECTOR(*, FLOAT32)`。

#### 向量距离函数

Oracle 23ai 提供四种内置的距离/相似度函数：

| 函数 | 说明 | 适用场景 |
|------|------|----------|
| `COSINE` | 余弦相似度 | 文本嵌入向量，最常用 |
| `EUCLIDEAN` / `L2` | 欧氏距离 | 图像特征向量 |
| `MANHATTAN` / `L1` | 曼哈顿距离 | 稀疏向量 |
| `HAMMING` | 汉明距离 | 二进制向量、哈希比较 |

这些函数可以直接在 SQL 中使用，例如：

```sql
SELECT product_name, VECTOR_DISTANCE(description_vec, :query_vec, COSINE) AS similarity
FROM products
ORDER BY similarity ASC
FETCH FIRST 10 ROWS ONLY;
```

#### 向量索引：IVF 与 HNSW

为了加速向量检索，23ai 提供两种近似最近邻（ANN）索引：

- **IVF（Inverted File Index）**：将向量空间划分为若干聚类，查询时只搜索最近的聚类。适合大数据量场景，构建速度快，但精度略低。
- **HNSW（Hierarchical Navigable Small World）**：基于图结构的索引，查询精度高，但构建时间和内存占用更大。适合对精度要求高的场景。

两种索引都可以通过 `CREATE VECTOR INDEX` 语句创建，并支持配置目标精度（accuracy）参数。

#### 与传统 SQL 的无缝结合

23ai 最大的优势在于：**向量操作完全融入 SQL 语法**。你可以：

- 在 `WHERE` 子句中使用向量距离过滤
- 在 `ORDER BY` 中按相似度排序
- 将向量检索与传统的关系查询条件组合
- 使用 `FETCH FIRST N ROWS ONLY` 限制返回数量

这意味着开发者不需要学习新的 API 或查询语言，现有的 SQL 技能可以直接复用。

### 2.2 JSON Relational Duality View

#### 核心概念

JSON Relational Duality View 是 23ai 的另一个革命性特性。它允许在**同一份关系数据**上创建 JSON 文档视图，应用层可以通过 JSON 接口进行 CRUD 操作，而底层数据仍然以关系表的形式存储。

简单来说：**同一份数据，两种访问方式**。

- 开发者看到的是 JSON 文档（NoSQL 体验）
- DBA 看到的是关系表（传统 RDBMS 体验）
- 数据只有一份，不存在同步问题

#### 与传统 JSON 存储的对比

传统方案中，要在 Oracle 里存 JSON 通常有两种方式：

1. **JSON 文档存储**（LOB 列）：灵活性好，但无法高效查询 JSON 内部字段
2. **关系表 + JSON 映射层**：查询性能好，但开发工作量大

Duality View 是第三种方案，兼得两者优势：

| 特性 | JSON LOB | 关系表 + 映射 | Duality View |
|------|----------|--------------|--------------|
| 查询性能 | 差 | 好 | 好 |
| 开发效率 | 高 | 低 | 高 |
| 数据一致性 | N/A | 应用层保证 | 数据库保证 |
| ACID | 强 | 强 | 强 |
| 索引支持 | 有限 | 完整 | 完整 |

#### CRUD 操作

通过 Duality View，应用可以直接对 JSON 视图执行增删改查：

```json
-- 查询（GET）
{
  "orderId": 1001,
  "customer": { "name": "张三", "phone": "138xxxx" },
  "items": [
    { "product": "Oracle License", "qty": 2, "price": 50000 }
  ]
}

-- 插入（POST）：直接插入 JSON 文档
-- 更新（PATCH）：只修改需要变更的字段
-- 删除（DELETE）：通过主键删除
```

底层的关系表会自动更新，无需手动维护同步。

#### Schema-Relational Duality

Duality View 的精髓在于 **Schema-Relational Duality**：关系模式和文档模式可以互相转换。一个 Duality View 可以将多张关系表映射为一个嵌套的 JSON 文档结构，反之亦然。这使得同一份数据可以同时服务于关系型后端和文档型前端。

### 2.3 其他 23ai 新特性速览

除了 AI Vector Search 和 JSON Duality View，23ai 还包含大量值得关注的新特性：

- **SQL Domains**：类似自定义数据类型，可以在列级别定义约束和显示格式，比 CHECK 约束更灵活
- **True Cache**：数据库层的自动缓存，减少主库 I/O 压力，对读密集型应用效果显著
- **SQL Firewall**：内置在数据库中的 SQL 防火墙，可以识别和拦截异常 SQL 语句，防范 SQL 注入
- **Blockchain Tables 增强**：不可篡改表的改进，支持更灵活的生命周期管理
- **Boolean 数据类型**：Oracle 终于原生支持 `BOOLEAN` 列类型（是的，等了 40 年）
- **IF NOT EXISTS 语法**：`CREATE TABLE IF NOT EXISTS`，告别 ORA-955 错误处理

这些特性虽然不如 AI Vector Search 那么"性感"，但在日常运维和开发中非常实用。尤其是 Boolean 类型和 IF NOT EXISTS 语法，几乎是所有 Oracle 开发者的"愿望清单"。

## 三、实战操作

### 3.1 AI Vector Search 配置

#### 启用 Vector 功能

Oracle 23ai 默认已启用 VECTOR 支持，无需额外配置。可以通过以下方式确认：

```sql
-- 确认数据库版本
SELECT BANNER FROM V$VERSION WHERE BANNER LIKE '%23%';

-- 确认 VECTOR 类型可用
DESC VECTOR;
```

#### 创建 VECTOR 列

```sql
-- 创建产品表，包含向量列
CREATE TABLE products (
    product_id   NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    product_name VARCHAR2(200),
    description  CLOB,
    category     VARCHAR2(50),
    -- 384维浮点向量，适合 all-MiniLM-L6-v2 等轻量模型
    description_vec  VECTOR(384, FLOAT32),
    -- 也可以用动态维度
    image_vec    VECTOR(*, FLOAT32)
);

-- 为JSON Duality View准备的订单表
CREATE TABLE orders (
    order_id     NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    customer_id  NUMBER NOT NULL,
    order_date   DATE DEFAULT SYSDATE,
    status       VARCHAR2(20) DEFAULT 'PENDING'
);

CREATE TABLE order_items (
    item_id      NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id     NUMBER REFERENCES orders(order_id),
    product_id   NUMBER REFERENCES products(product_id),
    quantity     NUMBER DEFAULT 1,
    unit_price   NUMBER(10,2)
);
```

#### 插入向量数据

在实际场景中，向量通常由 AI 模型（如 OpenAI Embeddings、Sentence Transformers）生成后写入数据库。以下用简化的方式模拟：

```sql
-- 模拟插入带向量的产品数据
INSERT INTO products (product_name, description, category, description_vec)
VALUES (
    'Oracle Database 23ai',
    'Oracle最新一代AI数据库，原生支持向量检索',
    'Database',
    TO_VECTOR('[0.02, -0.15, 0.33, 0.08, -0.21, 0.45, 0.12, -0.09, 0.27, 0.03]', FLOAT32, 384)
);

INSERT INTO products (product_name, description, category, description_vec)
VALUES (
    'Oracle Exadata X9M',
    '高性能数据库一体机，极致OLTP和OLAP性能',
    'Hardware',
    TO_VECTOR('[0.11, -0.08, 0.25, 0.19, -0.14, 0.38, 0.07, -0.22, 0.31, 0.15]', FLOAT32, 384)
);

-- 从外部向量格式转换
-- 支持逗号分隔、JSON数组、十六进制等多种格式
INSERT INTO products (product_name, description, category, description_vec)
VALUES (
    'MySQL HeatWave',
    '云原生OLAP引擎，实时分析海量数据',
    'Database',
    TO_VECTOR('[-0.05, 0.12, 0.41, -0.03, 0.18, 0.29, -0.11, 0.06, 0.35, -0.02]', FLOAT32, 384)
);

COMMIT;
```

#### 创建向量索引

```sql
-- 创建 HNSW 索引（推荐，精度高）
CREATE VECTOR INDEX idx_prod_desc_vec ON products (description_vec)
    ORGANIZATION NEIGHBOR_PARTITIONS
    DISTANCE COSINE
    WITH TARGET ACCURACY 95;

-- 创建 IVF 索引（适合大数据量）
CREATE VECTOR INDEX idx_prod_desc_ivf ON products (description_vec)
    ORGANIZATION NEIGHBOR_PARTITIONS
    DISTANCE COSINE
    WITH TARGET ACCURACY 90
    PARAMETERS (TYPE IVF, NEIGHBOR_PARTITIONS 100);

-- 查看索引信息
SELECT INDEX_NAME, INDEX_TYPE, TABLE_NAME, STATUS
FROM USER_INDEXES
WHERE INDEX_NAME LIKE '%VEC%';
```

#### 向量相似度查询

```sql
-- 查找与查询向量最相似的3个产品
-- 假设查询向量由应用层的AI模型生成
VARIABLE query_vec VARCHAR2(4000);
EXEC :query_vec := '[0.03, -0.12, 0.35, 0.06, -0.19, 0.42, 0.10, -0.11, 0.29, 0.05]';

SELECT product_name,
       category,
       ROUND(VECTOR_DISTANCE(description_vec, TO_VECTOR(:query_vec, FLOAT32, 384), COSINE), 4) AS distance
FROM products
ORDER BY VECTOR_DISTANCE(description_vec, TO_VECTOR(:query_vec, FLOAT32, 384), COSINE)
FETCH FIRST 3 ROWS ONLY;

-- 使用相似度阈值过滤
SELECT product_name,
       ROUND(1 - VECTOR_DISTANCE(description_vec, TO_VECTOR(:query_vec, FLOAT32, 384), COSINE), 4) AS similarity
FROM products
WHERE VECTOR_DISTANCE(description_vec, TO_VECTOR(:query_vec, FLOAT32, 384), COSINE) < 0.3
ORDER BY VECTOR_DISTANCE(description_vec, TO_VECTOR(:query_vec, FLOAT32, 384), COSINE);

-- 向量检索与关系条件结合
SELECT product_name,
       category,
       ROUND(VECTOR_DISTANCE(description_vec, TO_VECTOR(:query_vec, FLOAT32, 384), COSINE), 4) AS distance
FROM products
WHERE category = 'Database'
ORDER BY VECTOR_DISTANCE(description_vec, TO_VECTOR(:query_vec, FLOAT32, 384), COSINE)
FETCH FIRST 5 ROWS ONLY;
```

### 3.2 JSON Duality View

#### 创建 Duality View

基于前面创建的 `orders` 和 `order_items` 表，创建一个 JSON Duality View：

```sql
-- 创建订单的 JSON Duality View
CREATE JSON RELATIONAL DUALITY VIEW order_dv AS
SELECT JSON {
    '_id': o.order_id,
    'orderId': o.order_id,
    'orderDate': o.order_date WITH UPDATE,
    'status': o.status WITH UPDATE,
    'customerId': o.customer_id WITH UPDATE,
    'items': [
        SELECT JSON {
            'itemId': oi.item_id,
            'productId': oi.product_id WITH UPDATE,
            'quantity': oi.quantity WITH UPDATE,
            'unitPrice': oi.unit_price WITH UPDATE
        }
        FROM order_items oi WITH INSERT UPDATE DELETE
        WHERE oi.order_id = o.order_id
    ]
}
FROM orders o WITH INSERT UPDATE DELETE;
```

关键语法说明：

- `WITH INSERT UPDATE DELETE`：控制该层级的 DML 权限
- `WITH UPDATE`：只允许更新
- `_id`：JSON 文档的主键标识
- 嵌套的 `SELECT JSON`：定义子文档结构

#### 通过 JSON 视图进行 CRUD

```sql
-- 插入新订单（通过 JSON 视图）
INSERT INTO order_dv VALUES (
    '{
        "orderId": 2001,
        "orderDate": "2026-06-10T10:00:00",
        "status": "PENDING",
        "customerId": 101,
        "items": [
            {"itemId": 3001, "productId": 1, "quantity": 2, "unitPrice": 50000.00},
            {"itemId": 3002, "productId": 3, "quantity": 1, "unitPrice": 28000.00}
        ]
    }'
);

-- 查询订单（返回 JSON 格式）
SELECT * FROM order_dv WHERE JSON_VALUE(data, '$.orderId') = 2001;

-- 更新订单状态
UPDATE order_dv d
SET d.data = JSON_MERGEPATCH(d.data, '{"status": "SHIPPED"}')
WHERE JSON_VALUE(d.data, '$.orderId') = 2001;

-- 删除订单
DELETE FROM order_dv WHERE JSON_VALUE(data, '$.orderId') = 2001;
```

#### 嵌套 JSON 处理

Duality View 支持多层嵌套，例如在订单项中包含产品详情：

```sql
CREATE JSON RELATIONAL DUALITY VIEW order_full_dv AS
SELECT JSON {
    '_id': o.order_id,
    'orderId': o.order_id,
    'status': o.status WITH UPDATE,
    'customer': (
        SELECT JSON {
            'customerId': c.customer_id,
            'name': c.name,
            'email': c.email
        }
        FROM customers c
        WHERE c.customer_id = o.customer_id
    ),
    'items': [
        SELECT JSON {
            'itemId': oi.item_id,
            'product': (
                SELECT JSON {
                    'productId': p.product_id,
                    'name': p.product_name,
                    'category': p.category
                }
                FROM products p
                WHERE p.product_id = oi.product_id
            ),
            'quantity': oi.quantity WITH UPDATE
        }
        FROM order_items oi WITH INSERT UPDATE DELETE
        WHERE oi.order_id = o.order_id
    ]
}
FROM orders o WITH INSERT UPDATE DELETE;
```

### 3.3 实际应用场景

#### 文档语义搜索

最常见的应用场景：企业知识库的语义搜索。将文档的 Embedding 向量存入 Oracle，利用 AI Vector Search 实现"找意思相近的文档"而非"找关键词匹配的文档"。

```sql
-- 知识库语义搜索
SELECT doc_title,
       ROUND(1 - VECTOR_DISTANCE(content_vec, TO_VECTOR(:query_embedding, FLOAT32, 1536), COSINE), 4) AS relevance
FROM knowledge_base
WHERE VECTOR_DISTANCE(content_vec, TO_VECTOR(:query_embedding, FLOAT32, 1536), COSINE) < 0.4
ORDER BY VECTOR_DISTANCE(content_vec, TO_VECTOR(:query_embedding, FLOAT32, 1536), COSINE)
FETCH FIRST 10 ROWS ONLY;
```

#### 图片相似度搜索

将图片通过 CNN 模型（如 ResNet、CLIP）提取特征向量后存入数据库，实现以图搜图：

```sql
-- 以图搜图
SELECT image_name,
       image_url,
       VECTOR_DISTANCE(feature_vec, TO_VECTOR(:query_image_vec, FLOAT32, 2048), EUCLIDEAN) AS distance
FROM image_gallery
ORDER BY VECTOR_DISTANCE(feature_vec, TO_VECTOR(:query_image_vec, FLOAT32, 2048), EUCLIDEAN)
FETCH FIRST 5 ROWS ONLY;
```

#### RAG 应用集成

在 RAG 架构中，Oracle 23ai 可以同时扮演**向量数据库**和**关系数据库**的角色：

1. 文档分块后，通过 Embedding 模型生成向量，存入 Oracle 的 VECTOR 列
2. 用户提问时，将问题向量化，在 Oracle 中做相似度检索
3. 检索到的文档片段作为上下文，发送给 LLM 生成回答
4. 整个过程中，文档元数据、用户信息、访问日志都可以存在同一数据库中

这种架构比"关系库 + 外部向量库"的组合更简洁，数据一致性也更好保障。

### 3.4 运维注意事项

#### 向量索引的存储开销

向量索引（尤其是 HNSW）会占用显著的存储空间。粗略估算：

- HNSW 索引大小 ≈ 原始向量数据大小的 2~3 倍
- IVF 索引大小 ≈ 原始向量数据大小的 1~1.5 倍
- 100 万条 384 维 FLOAT32 向量的原始数据约 1.4GB，HNSW 索引约 3~4GB

规划存储时务必考虑索引开销。

#### 向量检索的性能调优

```sql
-- 调整目标精度（accuracy）：精度越高，查询越慢
-- 95% 精度通常在性能和准确性之间取得较好平衡
CREATE VECTOR INDEX idx_vec ON table_name (vec_column)
    ORGANIZATION NEIGHBOR_PARTITIONS
    DISTANCE COSINE
    WITH TARGET ACCURACY 95;

-- 监控索引构建进度
SELECT * FROM V$VECTOR_INDEX_BUILD_PROGRESS;

-- 查看向量索引的统计信息
SELECT * FROM USER_VECTOR_INDEX_STATS;
```

#### 与 AI 框架集成

Oracle 23ai 提供了多种与 AI 框架集成的方式：

- **Python oracledb 驱动**：原生支持 VECTOR 类型的读写
- **LangChain 集成**：`OracleVS` 类可直接将 Oracle 作为 LangChain 的 Vector Store
- **LlamaIndex 集成**：通过 `OracleVectorStore` 连接器
- **REST API**：通过 Oracle REST Data Services（ORDS）暴露向量检索接口

## 四、结果验证

### VECTOR 数据类型验证

```sql
-- 验证表结构
DESC products;

-- 验证向量数据正确存储
SELECT product_id, product_name,
       description_vec,
       VECTOR_DIMENSION_COUNT(description_vec) AS dimensions,
       VECTOR_DIMENSION_FORMAT(description_vec) AS format
FROM products;

-- 验证距离函数
SELECT VECTOR_DISTANCE(
    TO_VECTOR('[1,0,0]', FLOAT32, 3),
    TO_VECTOR('[0,1,0]', FLOAT32, 3),
    COSINE
) AS cos_distance FROM DUAL;
-- 预期结果：1（正交向量，余弦距离最大）
```

### 向量索引状态检查

```sql
-- 检查索引状态
SELECT INDEX_NAME, STATUS, NUM_ROWS, LAST_ANALYZED
FROM USER_INDEXES
WHERE INDEX_TYPE LIKE '%VECTOR%';

-- 验证索引是否被查询使用
EXPLAIN PLAN FOR
SELECT * FROM products
ORDER BY VECTOR_DISTANCE(description_vec, TO_VECTOR(:q, FLOAT32, 384), COSINE)
FETCH FIRST 3 ROWS ONLY;

SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY);
-- 预期：执行计划中应出现 VECTOR INDEX SCAN
```

### JSON Duality View 功能验证

```sql
-- 验证视图类型
SELECT VIEW_NAME, VIEW_TYPE
FROM USER_VIEWS
WHERE VIEW_NAME LIKE '%DV%';

-- 验证 JSON 输出格式
SELECT data FROM order_dv WHERE JSON_VALUE(data, '$.orderId') = 2001;

-- 验证关系表与JSON视图数据一致性
SELECT o.order_id, o.status, JSON_VALUE(d.data, '$.status') AS json_status
FROM orders o
JOIN order_dv d ON o.order_id = JSON_VALUE(d.data, '$.orderId')
WHERE o.order_id = 2001;
-- 预期：两列值相同
```

## 五、经验总结

### 23ai 的升级路径

Oracle 23ai 目前提供两种部署方式：

- **Oracle Database 23ai Free**：免费版，适合个人学习和 POC 验证，支持所有 AI 特性
- **Oracle Database 23ai Enterprise**：企业版，适合生产环境

从 19c 或 21c 升级到 23ai 的路径与以往版本升级类似，建议在非生产环境充分测试后再推进生产升级。

### AI 特性的适用场景评估

并非所有场景都需要在数据库层做向量检索：

- **数据量 < 100 万条**：Oracle AI Vector Search 完全胜任，无需引入外部向量库
- **数据量 100 万 ~ 1000 万条**：Oracle 仍然可行，但需要注意索引构建时间和存储成本
- **数据量 > 1000 万条**：需要评估 Oracle 的性能是否满足 SLA，可能需要考虑分区策略
- **已有完善的向量库架构**：不必急于迁移，新项目可以优先考虑 Oracle 一体化方案

### 运维团队的技能准备

作为 DBA，建议从以下方面储备技能：

1. **理解 Embedding 原理**：不需要训练模型，但要理解向量是什么、距离函数的含义
2. **掌握 VECTOR 类型的 DDL/DML**：创建表、索引、查询的标准语法
3. **熟悉 JSON Duality View**：理解映射关系，能够排查 JSON 视图的问题
4. **学习 Python + oracledb**：AI 应用通常用 Python 开发，DBA 需要能读懂和调试相关代码
5. **了解 LangChain/LlamaIndex 基础**：知道 RAG 的基本架构，才能做好数据库层的优化

### 23ai Free 版用于 POC

强烈建议用 Oracle 23ai Free 版本进行 POC 验证：

```sql
-- 快速验证向量功能
SELECT TO_VECTOR('[1,2,3]') FROM DUAL;

-- 快速验证 Duality View
CREATE JSON RELATIONAL DUALITY VIEW test_dv AS
SELECT JSON { '_id': t.id, 'name': t.name WITH UPDATE }
FROM test_table t WITH INSERT UPDATE DELETE;
```

Free 版完全支持 AI Vector Search 和 JSON Duality View，是学习和验证的最佳起点。

---

> **写在最后**：本文是 Oracle 新特性系列的第 28 篇，也是收官之作。从 12c 到 23ai，Oracle 数据库经历了从多租户到 AI 原生的巨大飞跃。作为 DBA，我们有幸见证并参与了这个历程。希望这个系列能帮助大家更好地理解和使用 Oracle 的新特性，在 AI 时代继续发挥数据库守护者的价值。
>
> 感谢每一位读者的陪伴，我们下个系列再见！
