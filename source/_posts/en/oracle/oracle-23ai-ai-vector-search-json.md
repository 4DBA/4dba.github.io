---
title: "Oracle 23ai New Features: AI Vector Search & JSON Relational Duality"
date: 2026-06-03 10:00:00
categories: Oracle
tags: [23ai, AI Vector Search, JSON, 新特性, 向量数据库, AI]
---

> This is article #28 (final) in the Oracle New Features series, focusing on Oracle 23ai's two most core AI features: AI Vector Search and JSON Relational Duality View.

## I. Problem Background

With the explosive growth of LLM (Large Language Model) and RAG (Retrieval Augmented Generation) applications, databases are no longer just warehouses for storing structured data—they also need **vector retrieval** and **semantic search** capabilities. The traditional approach is to store vector data in specialized vector databases (such as Milvus, Pinecone), but this means an additional component in the architecture, increasing data synchronization, consistency, and operational complexity.

Oracle officially positions itself as an **AI Database** in the 23ai version. The core idea is: **make relational databases natively support vector operations**—no need to introduce external vector stores, vector storage, indexing, and similarity search can all be completed at the SQL level. At the same time, 23ai introduces JSON Relational Duality View, completely bridging the gap between relational and document models.

For DBAs, these features are not "nice to have" but **must-have skills**:

- Application teams increasingly require vector retrieval at the database layer rather than maintaining additional vector stores
- JSON Duality View lets developers use JSON interfaces to operate relational tables, and DBAs need to understand the underlying mechanism for performance tuning
- 23ai's AI features have entered production environments—mastering them earlier means building technical barriers sooner

<!-- more -->

## II. Theoretical Analysis

### 2.1 AI Vector Search

#### Vector Data Type: VECTOR

Oracle 23ai introduces the new `VECTOR` data type for storing high-dimensional vector data. It supports multiple dimensions and formats:

- **FLOAT32**: 32-bit floating point (default), suitable for most AI model outputs
- **FLOAT64**: 64-bit floating point, higher precision
- **INT8**: 8-bit integer, saves storage space, suitable for quantized vectors
- **BINARY**: Binary format, suitable for Hamming distance calculation

Vector dimensions are specified at column definition time, for example `VECTOR(384, FLOAT32)` represents a 384-dimensional 32-bit floating-point vector. You can also define dynamic dimensions as `VECTOR(*, FLOAT32)`.

#### Vector Distance Functions

Oracle 23ai provides four built-in distance/similarity functions:

| Function | Description | Use Case |
|----------|-------------|----------|
| `COSINE` | Cosine similarity | Text embedding vectors, most commonly used |
| `EUCLIDEAN` / `L2` | Euclidean distance | Image feature vectors |
| `MANHATTAN` / `L1` | Manhattan distance | Sparse vectors |
| `HAMMING` | Hamming distance | Binary vectors, hash comparison |

These functions can be used directly in SQL, for example:

```sql
SELECT product_name, VECTOR_DISTANCE(description_vec, :query_vec, COSINE) AS similarity
FROM products
ORDER BY similarity ASC
FETCH FIRST 10 ROWS ONLY;
```

#### Vector Indexes: IVF and HNSW

To accelerate vector retrieval, 23ai provides two Approximate Nearest Neighbor (ANN) indexes:

- **IVF (Inverted File Index)**: Partitions the vector space into clusters and searches only the nearest clusters during queries. Suitable for large data volumes, faster to build, but slightly lower precision.
- **HNSW (Hierarchical Navigable Small World)**: Graph-based index with high query precision, but longer build time and larger memory footprint. Suitable for scenarios with high precision requirements.

Both indexes can be created via `CREATE VECTOR INDEX` statements and support configuring target accuracy parameters.

#### Seamless Integration with Traditional SQL

23ai's greatest advantage is: **vector operations fully integrated into SQL syntax**. You can:

- Use vector distance filtering in `WHERE` clauses
- Sort by similarity in `ORDER BY`
- Combine vector retrieval with traditional relational query conditions
- Use `FETCH FIRST N ROWS ONLY` to limit return count

This means developers don't need to learn new APIs or query languages—existing SQL skills can be directly reused.

### 2.2 JSON Relational Duality View

#### Core Concept

JSON Relational Duality View is another revolutionary feature of 23ai. It allows creating JSON document views on **the same relational data**. The application layer can perform CRUD operations through JSON interfaces, while the underlying data is still stored in relational table form.

Simply put: **one dataset, two access methods**.

- Developers see JSON documents (NoSQL experience)
- DBAs see relational tables (traditional RDBMS experience)
- There's only one copy of data, no synchronization issues

#### Comparison with Traditional JSON Storage

In traditional approaches, there are usually two ways to store JSON in Oracle:

1. **JSON Document Storage** (LOB columns): Good flexibility, but cannot efficiently query internal JSON fields
2. **Relational tables + JSON mapping layer**: Good query performance, but high development workload

Duality View is a third approach, combining the advantages of both:

| Feature | JSON LOB | Relational + Mapping | Duality View |
|---------|----------|---------------------|--------------|
| Query Performance | Poor | Good | Good |
| Development Efficiency | High | Low | High |
| Data Consistency | N/A | Application-level | Database-level |
| ACID | Strong | Strong | Strong |
| Index Support | Limited | Complete | Complete |

#### CRUD Operations

Through Duality View, applications can directly perform CRUD operations on JSON views:

```json
-- Query (GET)
{
  "orderId": 1001,
  "customer": { "name": "John Doe", "phone": "138xxxx" },
  "items": [
    { "product": "Oracle License", "qty": 2, "price": 50000 }
  ]
}

-- Insert (POST): directly insert JSON document
-- Update (PATCH): only modify changed fields
-- Delete (DELETE): delete by primary key
```

The underlying relational tables are automatically updated without manual synchronization.

#### Schema-Relational Duality

The essence of Duality View is **Schema-Relational Duality**: relational schemas and document schemas can be converted to each other. A Duality View can map multiple relational tables into a nested JSON document structure, and vice versa. This allows the same data to simultaneously serve relational backends and document-oriented frontends.

### 2.3 Other 23ai New Features Overview

In addition to AI Vector Search and JSON Duality View, 23ai also contains many noteworthy new features:

- **SQL Domains**: Similar to custom data types, can define constraints and display formats at the column level, more flexible than CHECK constraints
- **True Cache**: Automatic caching at the database layer, reducing primary database I/O pressure, with significant effects for read-intensive applications
- **SQL Firewall**: Built-in SQL firewall in the database that can identify and block abnormal SQL statements, preventing SQL injection
- **Blockchain Tables Enhancement**: Improvements to immutable tables, supporting more flexible lifecycle management
- **Boolean Data Type**: Oracle finally natively supports `BOOLEAN` column type (yes, after 40 years!)
- **IF NOT EXISTS Syntax**: `CREATE TABLE IF NOT EXISTS`, goodbye to ORA-955 error handling

While these features aren't as "glamorous" as AI Vector Search, they are very practical in daily operations and development. Especially the Boolean type and IF NOT EXISTS syntax, which are on almost every Oracle developer's "wish list."

## III. Practical Operations

### 3.1 AI Vector Search Configuration

#### Enabling Vector Functionality

Oracle 23ai has VECTOR support enabled by default, no additional configuration needed. You can confirm with:

```sql
-- Confirm database version
SELECT BANNER FROM V$VERSION WHERE BANNER LIKE '%23%';

-- Confirm VECTOR type is available
DESC VECTOR;
```

#### Creating VECTOR Columns

```sql
-- Create products table with vector columns
CREATE TABLE products (
    product_id   NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    product_name VARCHAR2(200),
    description  CLOB,
    category     VARCHAR2(50),
    -- 384-dimensional float vector, suitable for all-MiniLM-L6-v2 and similar lightweight models
    description_vec  VECTOR(384, FLOAT32),
    -- Can also use dynamic dimensions
    image_vec    VECTOR(*, FLOAT32)
);

-- Order table prepared for JSON Duality View
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

#### Inserting Vector Data

In real scenarios, vectors are usually generated by AI models (such as OpenAI Embeddings, Sentence Transformers) and then written to the database. Here's a simplified simulation:

```sql
-- Simulate inserting product data with vectors
INSERT INTO products (product_name, description, category, description_vec)
VALUES (
    'Oracle Database 23ai',
    'Oracle latest generation AI database with native vector search support',
    'Database',
    TO_VECTOR('[0.02, -0.15, 0.33, 0.08, -0.21, 0.45, 0.12, -0.09, 0.27, 0.03]', FLOAT32, 384)
);

INSERT INTO products (product_name, description, category, description_vec)
VALUES (
    'Oracle Exadata X9M',
    'High-performance database appliance with ultimate OLTP and OLAP performance',
    'Hardware',
    TO_VECTOR('[0.11, -0.08, 0.25, 0.19, -0.14, 0.38, 0.07, -0.22, 0.31, 0.15]', FLOAT32, 384)
);

-- Convert from external vector formats
-- Supports comma-separated, JSON array, hexadecimal and other formats
INSERT INTO products (product_name, description, category, description_vec)
VALUES (
    'MySQL HeatWave',
    'Cloud-native OLAP engine for real-time analysis of massive data',
    'Database',
    TO_VECTOR('[-0.05, 0.12, 0.41, -0.03, 0.18, 0.29, -0.11, 0.06, 0.35, -0.02]', FLOAT32, 384)
);

COMMIT;
```

#### Creating Vector Indexes

```sql
-- Create HNSW index (recommended, high precision)
CREATE VECTOR INDEX idx_prod_desc_vec ON products (description_vec)
    ORGANIZATION NEIGHBOR_PARTITIONS
    DISTANCE COSINE
    WITH TARGET ACCURACY 95;

-- Create IVF index (suitable for large data volumes)
CREATE VECTOR INDEX idx_prod_desc_ivf ON products (description_vec)
    ORGANIZATION NEIGHBOR_PARTITIONS
    DISTANCE COSINE
    WITH TARGET ACCURACY 90
    PARAMETERS (TYPE IVF, NEIGHBOR_PARTITIONS 100);

-- View index information
SELECT INDEX_NAME, INDEX_TYPE, TABLE_NAME, STATUS
FROM USER_INDEXES
WHERE INDEX_NAME LIKE '%VEC%';
```

#### Vector Similarity Query

```sql
-- Find 3 products most similar to the query vector
-- Assume the query vector is generated by the application's AI model
VARIABLE query_vec VARCHAR2(4000);
EXEC :query_vec := '[0.03, -0.12, 0.35, 0.06, -0.19, 0.42, 0.10, -0.11, 0.29, 0.05]';

SELECT product_name,
       category,
       ROUND(VECTOR_DISTANCE(description_vec, TO_VECTOR(:query_vec, FLOAT32, 384), COSINE), 4) AS distance
FROM products
ORDER BY VECTOR_DISTANCE(description_vec, TO_VECTOR(:query_vec, FLOAT32, 384), COSINE)
FETCH FIRST 3 ROWS ONLY;

-- Use similarity threshold filtering
SELECT product_name,
       ROUND(1 - VECTOR_DISTANCE(description_vec, TO_VECTOR(:query_vec, FLOAT32, 384), COSINE), 4) AS similarity
FROM products
WHERE VECTOR_DISTANCE(description_vec, TO_VECTOR(:query_vec, FLOAT32, 384), COSINE) < 0.3
ORDER BY VECTOR_DISTANCE(description_vec, TO_VECTOR(:query_vec, FLOAT32, 384), COSINE);

-- Combine vector retrieval with relational conditions
SELECT product_name,
       category,
       ROUND(VECTOR_DISTANCE(description_vec, TO_VECTOR(:query_vec, FLOAT32, 384), COSINE), 4) AS distance
FROM products
WHERE category = 'Database'
ORDER BY VECTOR_DISTANCE(description_vec, TO_VECTOR(:query_vec, FLOAT32, 384), COSINE)
FETCH FIRST 5 ROWS ONLY;
```

### 3.2 JSON Duality View

#### Creating a Duality View

Based on the previously created `orders` and `order_items` tables, create a JSON Duality View:

```sql
-- Create JSON Duality View for orders
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

Key syntax explanation:

- `WITH INSERT UPDATE DELETE`: Controls DML permissions at that level
- `WITH UPDATE`: Only allows updates
- `_id`: Primary key identifier for the JSON document
- Nested `SELECT JSON`: Defines sub-document structure

#### CRUD Through JSON View

```sql
-- Insert new order (via JSON view)
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

-- Query order (returns JSON format)
SELECT * FROM order_dv WHERE JSON_VALUE(data, '$.orderId') = 2001;

-- Update order status
UPDATE order_dv d
SET d.data = JSON_MERGEPATCH(d.data, '{"status": "SHIPPED"}')
WHERE JSON_VALUE(d.data, '$.orderId') = 2001;

-- Delete order
DELETE FROM order_dv WHERE JSON_VALUE(data, '$.orderId') = 2001;
```

#### Nested JSON Handling

Duality View supports multi-level nesting, for example including product details in order items:

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

### 3.3 Practical Application Scenarios

#### Document Semantic Search

The most common application scenario: semantic search for enterprise knowledge bases. Store document embedding vectors in Oracle and use AI Vector Search to "find documents with similar meaning" rather than "find documents matching keywords."

```sql
-- Knowledge base semantic search
SELECT doc_title,
       ROUND(1 - VECTOR_DISTANCE(content_vec, TO_VECTOR(:query_embedding, FLOAT32, 1536), COSINE), 4) AS relevance
FROM knowledge_base
WHERE VECTOR_DISTANCE(content_vec, TO_VECTOR(:query_embedding, FLOAT32, 1536), COSINE) < 0.4
ORDER BY VECTOR_DISTANCE(content_vec, TO_VECTOR(:query_embedding, FLOAT32, 1536), COSINE)
FETCH FIRST 10 ROWS ONLY;
```

#### Image Similarity Search

Extract feature vectors from images using CNN models (such as ResNet, CLIP) and store them in the database to implement reverse image search:

```sql
-- Reverse image search
SELECT image_name,
       image_url,
       VECTOR_DISTANCE(feature_vec, TO_VECTOR(:query_image_vec, FLOAT32, 2048), EUCLIDEAN) AS distance
FROM image_gallery
ORDER BY VECTOR_DISTANCE(feature_vec, TO_VECTOR(:query_image_vec, FLOAT32, 2048), EUCLIDEAN)
FETCH FIRST 5 ROWS ONLY;
```

#### RAG Application Integration

In RAG architecture, Oracle 23ai can simultaneously serve as a **vector database** and **relational database**:

1. After document chunking, generate vectors through Embedding models and store in Oracle's VECTOR columns
2. When users ask questions, vectorize the question and perform similarity search in Oracle
3. Retrieved document fragments serve as context, sent to LLM for generating answers
4. Throughout the process, document metadata, user information, and access logs can all reside in the same database

This architecture is simpler than the "relational database + external vector store" combination, with better data consistency guarantees.

### 3.4 Operations Considerations

#### Vector Index Storage Overhead

Vector indexes (especially HNSW) can consume significant storage space. Rough estimates:

- HNSW index size ≈ 2-3x the original vector data size
- IVF index size ≈ 1-1.5x the original vector data size
- 1 million 384-dimensional FLOAT32 vectors are approximately 1.4GB of raw data, HNSW index approximately 3-4GB

Always consider index overhead when planning storage.

#### Vector Retrieval Performance Tuning

```sql
-- Adjust target accuracy: higher accuracy = slower queries
-- 95% accuracy typically provides a good balance between performance and accuracy
CREATE VECTOR INDEX idx_vec ON table_name (vec_column)
    ORGANIZATION NEIGHBOR_PARTITIONS
    DISTANCE COSINE
    WITH TARGET ACCURACY 95;

-- Monitor index build progress
SELECT * FROM V$VECTOR_INDEX_BUILD_PROGRESS;

-- View vector index statistics
SELECT * FROM USER_VECTOR_INDEX_STATS;
```

#### Integration with AI Frameworks

Oracle 23ai provides multiple ways to integrate with AI frameworks:

- **Python oracledb driver**: Native support for VECTOR type read/write
- **LangChain Integration**: `OracleVS` class can directly use Oracle as LangChain's Vector Store
- **LlamaIndex Integration**: Via `OracleVectorStore` connector
- **REST API**: Through Oracle REST Data Services (ORDS) to expose vector search interfaces

## IV. Results Verification

### VECTOR Data Type Verification

```sql
-- Verify table structure
DESC products;

-- Verify vector data is correctly stored
SELECT product_id, product_name,
       description_vec,
       VECTOR_DIMENSION_COUNT(description_vec) AS dimensions,
       VECTOR_DIMENSION_FORMAT(description_vec) AS format
FROM products;

-- Verify distance functions
SELECT VECTOR_DISTANCE(
    TO_VECTOR('[1,0,0]', FLOAT32, 3),
    TO_VECTOR('[0,1,0]', FLOAT32, 3),
    COSINE
) AS cos_distance FROM DUAL;
-- Expected result: 1 (orthogonal vectors, maximum cosine distance)
```

### Vector Index Status Check

```sql
-- Check index status
SELECT INDEX_NAME, STATUS, NUM_ROWS, LAST_ANALYZED
FROM USER_INDEXES
WHERE INDEX_TYPE LIKE '%VECTOR%';

-- Verify index is being used by queries
EXPLAIN PLAN FOR
SELECT * FROM products
ORDER BY VECTOR_DISTANCE(description_vec, TO_VECTOR(:q, FLOAT32, 384), COSINE)
FETCH FIRST 3 ROWS ONLY;

SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY);
-- Expected: execution plan should show VECTOR INDEX SCAN
```

### JSON Duality View Functionality Verification

```sql
-- Verify view type
SELECT VIEW_NAME, VIEW_TYPE
FROM USER_VIEWS
WHERE VIEW_NAME LIKE '%DV%';

-- Verify JSON output format
SELECT data FROM order_dv WHERE JSON_VALUE(data, '$.orderId') = 2001;

-- Verify data consistency between relational table and JSON view
SELECT o.order_id, o.status, JSON_VALUE(d.data, '$.status') AS json_status
FROM orders o
JOIN order_dv d ON o.order_id = JSON_VALUE(d.data, '$.orderId')
WHERE o.order_id = 2001;
-- Expected: both columns should have the same value
```

## V. Lessons Learned

### 23ai Upgrade Path

Oracle 23ai currently offers two deployment methods:

- **Oracle Database 23ai Free**: Free version, suitable for personal learning and POC validation, supports all AI features
- **Oracle Database 23ai Enterprise**: Enterprise version, suitable for production environments

The upgrade path from 19c or 21c to 23ai is similar to previous version upgrades. It's recommended to thoroughly test in non-production environments before proceeding with production upgrades.

### AI Feature Use Case Evaluation

Not all scenarios require vector retrieval at the database layer:

- **Data volume < 1 million records**: Oracle AI Vector Search handles it fully, no need to introduce external vector stores
- **Data volume 1-10 million records**: Oracle is still viable, but pay attention to index build time and storage costs
- **Data volume > 10 million records**: Need to evaluate if Oracle's performance meets SLA, may need to consider partitioning strategies
- **Existing mature vector store architecture**: No need to rush migration, new projects can prioritize Oracle's integrated solution

### Operations Team Skill Preparation

As a DBA, it's recommended to build skills in the following areas:

1. **Understand Embedding principles**: Don't need to train models, but should understand what vectors are and what distance functions mean
2. **Master VECTOR type DDL/DML**: Standard syntax for creating tables, indexes, and queries
3. **Familiarize with JSON Duality View**: Understand mapping relationships, be able to troubleshoot JSON view issues
4. **Learn Python + oracledb**: AI applications are usually developed in Python, DBAs need to read and debug related code
5. **Understand LangChain/LlamaIndex basics**: Know the basic RAG architecture to optimize at the database layer

### 23ai Free Version for POC

Strongly recommend using Oracle 23ai Free version for POC validation:

```sql
-- Quick vector functionality validation
SELECT TO_VECTOR('[1,2,3]') FROM DUAL;

-- Quick Duality View validation
CREATE JSON RELATIONAL DUALITY VIEW test_dv AS
SELECT JSON { '_id': t.id, 'name': t.name WITH UPDATE }
FROM test_table t WITH INSERT UPDATE DELETE;
```

The Free version fully supports AI Vector Search and JSON Duality View, making it the best starting point for learning and validation.

---

> **Final Note**: This is article #28 in the Oracle New Features series, and also the finale. From 12c to 23ai, Oracle Database has undergone a tremendous leap from multitenancy to AI-native. As DBAs, we are fortunate to witness and participate in this journey. I hope this series helps everyone better understand and use Oracle's new features, continuing to bring value as database guardians in the AI era.
>
> Thank you to every reader for your companionship. See you in the next series!
