---
title: "ORDS in Practice: Transforming Oracle Database into a RESTful API Service"
date: 2026-05-29 10:00:00
categories: Oracle
tags: [ORDS, REST API, JSON, 微服务, 数据库服务化]
lang: en
---

## 1. Problem Background

### 1.1 The Need for Database Service-Oriented Architecture

In modern enterprise architecture, databases rarely exist in isolation — they need to provide data support for frontend applications, mobile apps, third-party systems, and microservice architectures. With the widespread adoption of frontend-backend separation and microservice architecture, exposing database data as standardized RESTful APIs has become a rigid requirement in enterprise digital transformation.

The traditional approach is to build a middleware layer (Java Spring Boot, Node.js, etc.) on top of the database, connecting to the database via JDBC/ODBC, and then exposing REST APIs externally. While feasible, this approach has several notable pain points in practice:

- **High development costs**: Every data entity requires writing Controller, Service, and DAO layer code. A medium-sized system may involve dozens or even hundreds of entity classes, resulting in massive code volumes
- **Heavy maintenance burden**: When the database schema changes, middleware code must be modified in sync. Any field addition, deletion, or modification may trigger cascading changes
- **Increased latency**: An additional network hop increases response time and introduces fault points. Every request requires serialization and deserialization through the application server
- **Skill stack requirements**: DBA teams typically don't excel at Java/Node.js development, while development teams are unfamiliar with database internal logic, leading to high communication costs
- **Complex deployment**: Requires additional application server environments, increasing operational complexity and infrastructure costs

### 1.2 The Value of ORDS

Oracle REST Data Services (ORDS) provides an elegant alternative: **zero-code exposure of SQL queries and PL/SQL procedures as RESTful APIs**. DBAs only need to write SQL or PL/SQL, and ORDS automatically handles all web-layer logic including HTTP protocol processing, JSON serialization and deserialization, connection pool management, and security authentication and authorization. This means DBAs can focus on the data logic itself without needing to learn and maintain complex web development frameworks.

Core value is demonstrated in:

| Dimension | Traditional Middleware Approach | ORDS Approach |
|-----------|-------------------------------|---------------|
| Development Efficiency | Full-stack code required | SQL/PL/SQL is the API |
| Deployment Complexity | Application server + database | ORDS + database |
| Latency | Extra hop (application to database) | Direct database connection |
| Maintenance Cost | Schema changes require code changes | AutoREST automatically adapts |
| Skill Requirements | Java/JS + SQL | SQL/PL/SQL only |

### 1.3 Comparison with Traditional Middleware Solutions

ORDS is not intended to replace all middleware — it is best suited for **data-intensive CRUD services** and **database logic encapsulation**. For simple data CRUD operations, report queries, data exports, and similar scenarios, ORDS can achieve API exposure at the lowest cost. For complex business orchestration, multi-data-source aggregation, asynchronous message processing, and similar scenarios, traditional middleware is still needed. The two can coexist — ORDS handles APIs directly exposed from the database, while middleware handles complex business logic, with each playing its role.

From real-world project experience, in a typical microservice system, approximately 60-70% of APIs are simple data CRUD operations, which can be fully implemented with ORDS. The remaining 30-40% of APIs involving complex business logic require traditional middleware solutions. This division of labor can significantly reduce overall development costs and system complexity.

---

## 2. Theoretical Analysis

### 2.1 ORDS Architecture

ORDS is essentially a Java web application running on a JVM, acting as a bridge between the HTTP frontend and the Oracle database:

```
Client ──HTTP/HTTPS──▶ ORDS (Jetty/Tomcat/WLS) ──JDBC──▶ Oracle Database
                        │
                        ├── Connection Pool Management (UCP/HikariCP)
                        ├── Request Routing (Module → Template → Handler)
                        ├── Authentication & Authorization (OAuth2/Basic Auth)
                        └── Response Formatting (JSON/XML/CSV)
```

**Connection Pool Mechanism**: ORDS uses Universal Connection Pool (UCP) to manage database connections. Each database connection configuration (called a `database connection`) maintains an independent connection pool, supporting connection reuse, timeout reclamation, health checks, and other features. The connection pool size can be flexibly adjusted through configuration files — initial connections, maximum connections, idle timeout, and other parameters can all be tuned based on actual load. This is key to ORDS performance — it avoids the overhead of establishing a new connection for every request, significantly reducing database connection management pressure. In high-concurrency scenarios, proper connection pool configuration can reduce API response times by several fold.

**Relationship with APEX**: ORDS was originally APEX Listener, and it natively supports running Oracle APEX applications. APEX's page rendering, dynamic actions, and other features all process HTTP requests through ORDS. But ORDS functionality extends far beyond APEX — it can be used independently of APEX, purely as a REST API service. On databases without APEX installed, ORDS works perfectly fine. In fact, many enterprises use ORDS in scenarios that don't involve APEX at all, simply leveraging it to expose database services.

**Deployment Architecture Flexibility**: ORDS supports multiple deployment methods. During development and testing, the built-in Jetty server can be used in Standalone mode — simple to start with no additional dependencies. In production, it's recommended to deploy ORDS to Tomcat or WebLogic Server, paired with Nginx reverse proxy for load balancing and SSL offloading. Additionally, ORDS supports containerized deployment — it can be packaged as a Docker image running in a Kubernetes cluster.

### 2.2 REST API Design

ORDS's REST API design follows a hierarchical structure:

```
Base Path (e.g., /ords/hr/)
  └── Module (e.g., employees/)
       └── Template (e.g., {id}/)
            └── Handler (e.g., GET → SELECT ... WHERE id = :id)
```

- **Module**: Logical grouping, similar to an API namespace
- **Template**: URL path template, supports `{param}` placeholders
- **Handler**: Binds a specific HTTP method (GET/POST/PUT/DELETE) with SQL/PL/SQL

**Parameter binding** supports three sources:

- **URI Template Parameters**: `{id}` → `:id`, used to identify unique resources, such as `empno` in `/employees/{empno}`
- **Query String Parameters**: `?status=ACTIVE` → `:status`, used for filtering, sorting, and pagination control
- **Request Body Parameters** (POST/PUT JSON body) → `:field_name`, used for data passing in create and update operations

**Response format** defaults to JSON, with XML and CSV also supported. JSON responses follow Oracle's standard format, containing an `items` array, pagination metadata (`hasMore`, `limit`, `offset`, `count`), and related links (`links`). This standardized response format enables frontend developers to integrate quickly without additional format conversion logic. For list queries, ORDS automatically implements pagination — developers just need to set the `items_per_page` parameter in the Handler.

### 2.3 AutoREST

AutoREST is one of ORDS's most powerful and revolutionary features. It fundamentally changes how databases expose APIs — with just one PL/SQL command, any table or view can be automatically exposed as a complete RESTful API, without writing any SQL Handler code.

- **Table/View AutoREST**: When enabled, ORDS automatically generates five standard REST endpoints for the table — GET list (supporting pagination, filtering, sorting), GET single record (query by primary key), POST create record, PUT update record, DELETE delete record. These endpoints fully comply with RESTful standards and return standardized JSON responses. More powerfully, AutoREST supports flexible filtering and sorting via Query String parameters — for example, `?q={"salary":{"$gt":5000}}` can implement MongoDB-like query syntax
- **PL/SQL Procedure Exposure**: Beyond tables and views, ORDS can also map stored procedures and functions directly to POST endpoints. Parameters are automatically extracted from the JSON Request Body, and output parameters are automatically included in the JSON response. This enables complex database logic to also be provided as API services
- **Security Control**: AutoREST does not expose any objects by default — explicit authorization is required for access. It supports fine-grained permission control at the Schema level, object level, and even column level. Access permissions can be managed through OAuth2 client roles, ensuring only authorized applications can access specific data resources. This "deny by default" security model makes AutoREST safe for production use

---

## 3. Practical Operations

### 3.1 ORDS Installation and Configuration

#### 3.1.1 Environment Preparation

ORDS 23.x requires JDK 17+ and Oracle Database 19c+. The following is based on ORDS 23.4 + Oracle 19c environment.

```bash
# Install JDK 17
sudo yum install -y java-17-openjdk java-17-openjdk-devel

# Verify Java version
java -version
# openjdk version "17.0.x" ...

# Create ORDS installation directory
sudo mkdir -p /opt/oracle/ords
sudo chown oracle:oinstall /opt/oracle/ords
```

#### 3.1.2 ORDS Installation

```bash
# Download ORDS (from OTN or edelivery)
cd /opt/oracle/ords
unzip ords-23.4.0.24.1153.zip -d /opt/oracle/ords/

# Create configuration directory
mkdir -p /opt/oracle/ords/config/ords
```

#### 3.1.3 Database Connection Configuration

Create `databases/default/connection.xml` configuration file (or use the install command for interactive configuration):

```bash
# Interactive installation configuration
cd /opt/oracle/ords
java -jar ords.war install advanced

# During installation, you need to specify:
# - Database connection type: Basic (SID) or Service Name
# - Hostname, port (default 1521)
# - Database SID or Service Name
# - ORDS public user password
# - Administrator connection information
```

Alternatively, use non-interactive command-line configuration:

```bash
# Configure database connection
java -jar ords.war set-properties <<EOF
db.hostname=dbserver.example.com
db.port=1521
db.servicename=ORCLPDB1
db.username=ORDS_PUBLIC_USER
db.password=<secure_password>
plsql.gateway.add=true
rest.services.apex.add=true
schema.tablespace.default=SYSAUX
schema.tablespace.temp=TEMP
standalone.mode=false
EOF
```

#### 3.1.4 Install ORDS Schema

```bash
# Install ORDS metadata in the database as SYSDBA
# This creates ORDS-related schemas and objects
java -jar ords.war install simple \
  --database ORCLPDB1 \
  --host dbserver.example.com \
  --port 1521 \
  --passwordFile /opt/oracle/ords/admin_password.txt
```

#### 3.1.5 Configure Standalone Mode or Tomcat Deployment

**Standalone Mode** (suitable for development/testing):

```bash
# Start ORDS in standalone mode
java -jar ords.war standalone \
  --port 8080 \
  --host 0.0.0.0

# Production environments recommend using systemd management
cat > /etc/systemd/system/ords.service <<'EOF'
[Unit]
Description=Oracle REST Data Services
After=network.target

[Service]
Type=simple
User=oracle
WorkingDirectory=/opt/oracle/ords
ExecStart=/usr/bin/java -Dconfig.url=/opt/oracle/ords/config -jar /opt/oracle/ords/ords.war standalone --port 8080
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable ords
sudo systemctl start ords
```

**Tomcat Deployment** (suitable for production):

```bash
# Deploy ORDS to Tomcat
cp /opt/oracle/ords/ords.war $CATALINA_HOME/webapps/ords.war
# Restart Tomcat
$CATALINA_HOME/bin/shutdown.sh
$CATALINA_HOME/bin/startup.sh
```

#### 3.1.6 HTTPS Configuration

Production environments must enable HTTPS. It's recommended to implement via Nginx reverse proxy:

```nginx
server {
    listen 443 ssl http2;
    server_name api.example.com;

    ssl_certificate     /etc/ssl/certs/api.example.com.crt;
    ssl_certificate_key /etc/ssl/private/api.example.com.key;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    location /ords/ {
        proxy_pass http://127.0.0.1:8080/ords/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### 3.2 Creating REST Services

#### 3.2.1 Manually Creating Module/Template/Handler

Create REST services via SQL Developer or by executing PL/SQL directly in the database:

```sql
-- 1. Enable ORDS schema (using HR user as example)
BEGIN
    ORDS.ENABLE_SCHEMA(
        p_enabled => TRUE,
        p_schema  => 'HR',
        p_url_mapping_type => 'BASE_PATH',
        p_url_mapping_pattern => 'hr',
        p_auto_rest_auth => FALSE
    );
    COMMIT;
END;
/

-- 2. Create Module
BEGIN
    ORDS.DEFINE_MODULE(
        p_module_name    => 'employees.api',
        p_base_path      => '/emp/',
        p_items_per_page => 25,
        p_status         => 'PUBLISHED',
        p_comments       => 'Employee Information REST API'
    );
    COMMIT;
END;
/

-- 3. Create Template (URL path template)
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'employees.api',
        p_pattern        => ':empno',
        p_priority       => 0,
        p_etag_type      => 'HASH',
        p_comments       => 'Query by employee number'
    );
    COMMIT;
END;
/

-- 4. Create Handler (GET method - query single employee)
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'employees.api',
        p_pattern        => ':empno',
        p_method         => 'GET',
        p_source_type    => 'json/query',
        p_items_per_page => 0,
        p_mimes_allowed  => '',
        p_comments       => '',
        p_source         => 'SELECT e.employee_id, e.first_name, e.last_name,
                                    e.email, e.salary, d.department_name
                             FROM employees e
                             JOIN departments d ON e.department_id = d.department_id
                             WHERE e.employee_id = :empno'
    );
    COMMIT;
END;
/

-- 5. Create Handler (GET method - query employee list)
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'employees.api',
        p_pattern     => 'list',
        p_comments    => 'Employee list query'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'employees.api',
        p_pattern        => 'list',
        p_method         => 'GET',
        p_source_type    => 'json/query',
        p_items_per_page => 25,
        p_source         => 'SELECT e.employee_id, e.first_name, e.last_name,
                                    e.salary, d.department_name
                             FROM employees e
                             JOIN departments d ON e.department_id = d.department_id
                             ORDER BY e.employee_id'
    );
    COMMIT;
END;
/
```

After creation, the following URLs are available:

```
GET https://api.example.com/ords/hr/emp/list
GET https://api.example.com/ords/hr/emp/100
```

#### 3.2.2 AutoREST Enablement

AutoREST can be enabled at the Schema level with one click:

```sql
-- Enable Schema REST service
BEGIN
    ORDS.ENABLE_SCHEMA(
        p_enabled => TRUE,
        p_schema  => 'HR',
        p_url_mapping_type => 'BASE_PATH',
        p_url_mapping_pattern => 'hr'
    );
    COMMIT;
END;
/

-- Enable table AutoREST (using EMPLOYEES table as example)
BEGIN
    ORDS.ENABLE_OBJECT(
        p_enabled      => TRUE,
        p_schema       => 'HR',
        p_object       => 'EMPLOYEES',
        p_object_type   => 'TABLE',
        p_object_alias  => 'employees'
    );
    COMMIT;
END;
/

-- Enable view AutoREST
BEGIN
    ORDS.ENABLE_OBJECT(
        p_enabled      => TRUE,
        p_schema       => 'HR',
        p_object       => 'EMP_DETAILS_VIEW',
        p_object_type   => 'VIEW',
        p_object_alias  => 'emp_details'
    );
    COMMIT;
END;
/
```

After enabling, the following endpoints are automatically available:

```
GET    /ords/hr/employees/          # List (supports pagination)
GET    /ords/hr/employees/:id       # Single record
POST   /ords/hr/employees/          # Create record
PUT    /ords/hr/employees/:id       # Update record
DELETE /ords/hr/employees/:id       # Delete record
```

#### 3.2.3 Parameterized Queries

Handlers support multiple parameter binding methods:

```sql
-- Query with pagination and filtering
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name => 'employees.api',
        p_pattern     => 'search',
        p_method      => 'GET',
        p_source_type => 'json/query',
        p_source      => 'SELECT employee_id, first_name, last_name, salary
                          FROM employees
                          WHERE (:min_salary IS NULL OR salary >= :min_salary)
                            AND (:dept_id IS NULL OR department_id = :dept_id)
                          ORDER BY salary DESC'
    );
    COMMIT;
END;
/
```

Usage example:

```bash
# Query employees with salary greater than 5000 and department ID 50
curl -X GET "https://api.example.com/ords/hr/emp/search?min_salary=5000&dept_id=50"
```

### 3.3 Security Configuration

#### 3.3.1 OAuth2 Authentication

```sql
-- Create OAuth2 client
BEGIN
    OAUTH.CREATE_CLIENT(
        p_name            => 'Employee App',
        p_grant_type      => 'client_credentials',
        p_owner           => 'HR Department',
        p_description     => 'Employee Management System API Client',
        p_support_email    => 'dba@example.com',
        p_privilege_names  => ''
    );
    COMMIT;
END;
/

-- Grant client role
BEGIN
    OAUTH.GRANT_CLIENT_ROLE(
        p_client_name => 'Employee App',
        p_role_name   => 'oracle.dbtools.autorest.any.schema'
    );
    COMMIT;
END;
/

-- Get Client ID and Secret
-- Query: SELECT * FROM OAUTH_APPROVALS;
```

```bash
# Get Access Token
curl -X POST "https://api.example.com/ords/hr/oauth/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials" \
  -d "client_id=<client_id>" \
  -d "client_secret=<client_secret>"

# Call API using Token
curl -X GET "https://api.example.com/ords/hr/employees/" \
  -H "Authorization: Bearer <token>"
```

#### 3.3.2 Role Authorization

```sql
-- Create custom role
BEGIN
    ORDS.CREATE_ROLE(p_role_name => 'hr_api_reader');
    COMMIT;
END;
/

-- Grant role to OAuth2 client
BEGIN
    OAUTH.GRANT_CLIENT_ROLE(
        p_client_name => 'Employee App',
        p_role_name   => 'hr_api_reader'
    );
    COMMIT;
END;
/

-- Require role at Module level
BEGIN
    ORDS.DEFINE_PRIVILEGE(
        p_privilege_name => 'hr.read.employees',
        p_roles          => 'hr_api_reader',
        p_patterns       => '/emp/*',
        p_modules        => 'employees.api',
        p_label          => 'HR Employees Read Access',
        p_description    => 'Allow reading employee information',
        p_comments       => ''
    );
    COMMIT;
END;
/

-- Enable privilege
BEGIN
    ORDS.ENABLE_PRIVILEGE(
        p_privilege_name => 'hr.read.employees',
        p_enabled        => TRUE
    );
    COMMIT;
END;
/
```

#### 3.3.3 Rate Limiting

Set global rate limits via ORDS configuration file:

```properties
# Configure in defaults.xml
<entry key="security.http.maxRequests">100</entry>
<entry key="security.http.maxRequests.window">60</entry>
```

Alternatively, implement more fine-grained rate limiting at the Nginx layer:

```nginx
# Nginx rate limiting configuration
limit_req_zone $binary_remote_addr zone=api_limit:10m rate=10r/s;

location /ords/ {
    limit_req zone=api_limit burst=20 nodelay;
    proxy_pass http://127.0.0.1:8080/ords/;
}
```

### 3.4 Example Applications

#### 3.4.1 Complete CRUD API Example

```sql
-- Create example table
CREATE TABLE api_demo.orders (
    order_id     NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    customer_id  NUMBER NOT NULL,
    order_date   DATE DEFAULT SYSDATE,
    total_amount NUMBER(10,2),
    status       VARCHAR2(20) DEFAULT 'PENDING',
    created_at   TIMESTAMP DEFAULT SYSTIMESTAMP,
    updated_at   TIMESTAMP DEFAULT SYSTIMESTAMP
);

-- Enable AutoREST
BEGIN
    ORDS.ENABLE_OBJECT(
        p_enabled     => TRUE,
        p_schema      => 'HR',
        p_object      => 'ORDERS',
        p_object_type  => 'TABLE',
        p_object_alias => 'orders'
    );
    COMMIT;
END;
/
```

```bash
# CREATE - Create order
curl -X POST "https://api.example.com/ords/hr/orders/" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "customer_id": 1001,
    "total_amount": 299.99,
    "status": "PENDING"
  }'

# READ - Query order list (paginated)
curl -X GET "https://api.example.com/ords/hr/orders/?limit=10&offset=0" \
  -H "Authorization: Bearer <token>"

# READ - Query single order
curl -X GET "https://api.example.com/ords/hr/orders/1" \
  -H "Authorization: Bearer <token>"

# UPDATE - Update order status
curl -X PUT "https://api.example.com/ords/hr/orders/1" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "status": "COMPLETED",
    "total_amount": 350.00
  }'

# DELETE - Delete order
curl -X DELETE "https://api.example.com/ords/hr/orders/1" \
  -H "Authorization: Bearer <token>"
```

#### 3.4.2 PL/SQL API Example

Expose a stored procedure as a REST API:

```sql
-- Create stored procedure: Calculate department salary statistics
CREATE OR REPLACE PROCEDURE hr.get_dept_salary_stats(
    p_dept_id   IN  NUMBER,
    p_avg_salary OUT NUMBER,
    p_max_salary OUT NUMBER,
    p_min_salary OUT NUMBER,
    p_emp_count  OUT NUMBER
) AS
BEGIN
    SELECT AVG(salary), MAX(salary), MIN(salary), COUNT(*)
    INTO p_avg_salary, p_max_salary, p_min_salary, p_emp_count
    FROM employees
    WHERE department_id = p_dept_id;
END;
/

-- Expose as REST API
BEGIN
    ORDS.DEFINE_MODULE(
        p_module_name => 'salary.api',
        p_base_path   => '/salary/'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'salary.api',
        p_pattern     => 'dept-stats'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name => 'salary.api',
        p_pattern     => 'dept-stats',
        p_method      => 'POST',
        p_source_type => 'plsql/block',
        p_source      => 'BEGIN
                             hr.get_dept_salary_stats(
                                 p_dept_id    => :dept_id,
                                 p_avg_salary => :avg_salary,
                                 p_max_salary => :max_salary,
                                 p_min_salary => :min_salary,
                                 p_emp_count  => :emp_count
                             );
                          END;'
    );
    COMMIT;
END;
/
```

```bash
# Call PL/SQL API
curl -X POST "https://api.example.com/ords/hr/salary/dept-stats" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"dept_id": 50}'
```

#### 3.4.3 Batch Operations API

```sql
-- Create PL/SQL procedure for batch insert
CREATE OR REPLACE PROCEDURE hr.bulk_insert_orders(
    p_orders IN CLOB
) AS
    l_count NUMBER;
BEGIN
    INSERT INTO api_demo.orders (customer_id, total_amount, status)
    SELECT jt.customer_id, jt.total_amount, jt.status
    FROM JSON_TABLE(p_orders, '$[*]'
        COLUMNS (
            customer_id  NUMBER PATH '$.customer_id',
            total_amount NUMBER PATH '$.total_amount',
            status       VARCHAR2(20) PATH '$.status'
        )
    ) jt;

    l_count := SQL%ROWCOUNT;

    -- Return inserted count via ORDS response
    OWA_UTIL.STATUS_LINE(201, 'Created');
    HTP.PRINT('{"inserted": ' || l_count || '}');
END;
/

-- Expose as API
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name => 'orders.api',
        p_pattern     => 'bulk',
        p_method      => 'POST',
        p_source_type => 'plsql/block',
        p_source      => 'BEGIN hr.bulk_insert_orders(:body_text); END;'
    );
    COMMIT;
END;
/
```

```bash
# Bulk insert
curl -X POST "https://api.example.com/ords/hr/orders/bulk" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '[
    {"customer_id": 1001, "total_amount": 199.99, "status": "PENDING"},
    {"customer_id": 1002, "total_amount": 499.99, "status": "PENDING"},
    {"customer_id": 1003, "total_amount": 899.99, "status": "CONFIRMED"}
  ]'
```

---

## 4. Result Verification

### 4.1 API Call Testing

Verify that AutoREST endpoints are working properly:

```bash
# Health check
curl -s -o /dev/null -w "%{http_code}" "https://api.example.com/ords/hr/employees/"
# Expected output: 200

# Verify JSON response format
curl -s "https://api.example.com/ords/hr/employees/" | python3 -m json.tool
# Expected output: Contains items, hasMore, limit, offset, count, links, etc.

# Verify pagination
curl -s "https://api.example.com/ords/hr/employees/?limit=5&offset=5" | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print(f'Count: {d[\"count\"]}, HasMore: {d[\"hasMore\"]}')"
```

### 4.2 Performance Testing

Use Apache Bench or wrk for simple performance testing:

```bash
# Install ab
sudo yum install -y httpd-tools

# Benchmark: 100 concurrent, 10000 total requests
ab -n 10000 -c 100 \
  -H "Authorization: Bearer <token>" \
  "https://api.example.com/ords/hr/employees/"

# Expected results (reference values):
# Requests per second: 2000-5000 (depends on query complexity and database performance)
# Time per request: 20-50ms (mean)
# Failed requests: 0
```

### 4.3 Security Testing

```bash
# Test unauthenticated access (should return 401)
curl -s -o /dev/null -w "%{http_code}" "https://api.example.com/ords/hr/employees/"
# Expected: 401

# Test SQL injection protection
curl -s "https://api.example.com/ords/hr/employees/1%20OR%201=1"
# Expected: 400 Bad Request or empty result (ORDS auto-parameterizes, preventing injection)

# Test invalid Token
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer invalid_token" \
  "https://api.example.com/ords/hr/employees/"
# Expected: 401

# Test cross-origin request
curl -s -D- -o /dev/null \
  -H "Origin: https://evil.example.com" \
  "https://api.example.com/ords/hr/employees/"
# Check CORS headers match expected configuration
```

---

## 5. Lessons Learned

### 5.1 ORDS Deployment Best Practices

1. **Use Tomcat or WebLogic in Production**: Standalone mode is suitable for development and testing. For production, deploy on Tomcat/WLS with Nginx reverse proxy and load balancing. This provides better stability, monitoring capabilities, and fault recovery. Tomcat's thread pool management, connection timeout configuration, and other features can effectively prevent resource exhaustion.

2. **Connection Pool Parameter Tuning**: The connection pool is core to ORDS performance and needs careful adjustment based on actual concurrency and query response times. Initial connections should not be too large to avoid resource pressure at database startup; maximum connections should consider the database's maximum session limit — generally recommended at 1.5x expected concurrency.

```properties
# Connection pool configuration
jdbc.InitialLimit=5
jdbc.MinLimit=5
jdbc.MaxLimit=50
jdbc.MaxStatementsLimit=10
jdbc.InactivityTimeout=300
jdbc.MaxConnectionReuseCount=10000
```

3. **Enable AWR/ASH Monitoring**: SQL executed by ORDS will appear in database AWR reports, facilitating performance analysis and tuning.

4. **Log Configuration**:

```properties
# Enable debug logging (for troubleshooting)
log.level=INFO
# Production recommended
log.level=WARN
```

### 5.2 API Design Standards

1. **URL Naming**: Use lowercase, plural nouns (`/employees/` not `/Employee/`), maintaining naming consistency. URL hierarchy should not be too deep, generally no more than three levels. Resource names should use nouns rather than verbs — HTTP methods themselves express the operation intent
2. **Version Control**: Implemented through Module's `base_path` (`/v1/emp/`, `/v2/emp/`). Create new versions when API changes are incompatible. Old versions should maintain backward compatibility for a period, giving callers sufficient migration time
3. **Pagination**: Consistently use `limit` + `offset` parameters, with `hasMore` field and total count in the response. For large data volume interfaces, set reasonable default and maximum page size limits
4. **Error Handling**: Use `OWA_UTIL.STATUS_LINE` in PL/SQL Handlers to set correct HTTP status codes. Business exceptions return 4xx series, system exceptions return 5xx series. Response bodies should contain clear error codes and descriptions for callers to locate issues
5. **Response Format**: Always return JSON. For complex queries, consider returning custom JSON structures rather than the default format. For scenarios requiring large data returns, consider streaming responses or batch returns

### 5.3 Performance Optimization Recommendations

1. **Reduce N+1 Queries**: Use JOIN queries rather than per-record queries — the SQL in your Handler is your DAO layer. Try to complete all data fetching in a single Handler, avoiding multiple client API calls to assemble data
2. **Proper Pagination Settings**: `items_per_page` should not be too large — default 25 is reasonable, maximum should not exceed 500. For large data export scenarios, consider using cursors or streaming processing rather than loading all data at once
3. **Use Bind Variables**: ORDS automatically handles parameter binding, so you don't need to worry about SQL injection. You also benefit from cursor sharing advantages, reducing database hard parsing overhead
4. **Index Optimization**: Ensure columns involved in REST API queries have appropriate indexes. Create indexes for frequently filtered columns, sorted columns, and join columns. Use AWR reports to analyze ORDS-generated SQL execution plans and identify performance bottlenecks
5. **Result Caching**: For infrequently changing data, implement client-side caching via HTTP Cache-Control headers, reducing unnecessary repeated requests. Response caching can also be implemented at the Nginx layer to further reduce database pressure

### 5.4 Integration with API Gateway

In enterprise deployments, it's recommended to place ORDS behind an API Gateway. This layered architecture leverages each component's strengths, achieving separation of concerns:

```
Client → API Gateway (Kong/Apigee/AWS API GW) → Nginx → ORDS → Oracle DB
```

Key capabilities provided by API Gateway:

- **Unified Authentication**: JWT validation, OAuth2 Token proxy, API Key management, etc. Separating authentication logic from ORDS and handling it uniformly at the Gateway reduces ORDS complexity
- **Rate Limiting and Circuit Breaking**: More powerful than ORDS's own rate limiting, supporting multi-dimensional strategies based on client, API path, time window, etc. Circuit breaking mechanisms can automatically degrade during database anomalies, protecting backend systems
- **Request Transformation**: Request/response format conversion at the Gateway layer enables a single API to adapt to different clients' data format needs
- **Monitoring and Analytics**: Real-time monitoring and alerting for API call volume, latency distribution, error rates, throughput, and other key metrics, providing data support for capacity planning and performance tuning
- **Canary Releases**: Implement API version canary releases through routing rules — new API versions can be initially exposed to a small amount of traffic, verified correct before full cutover

### 5.5 Important Considerations

1. **Don't Expose Sensitive Columns**: AutoREST exposes all table columns, including fields that may contain sensitive information (such as password hashes, ID numbers, etc.). In production, always use manual Handlers to precisely control returned fields, or use views to filter sensitive columns
2. **Transaction Control**: AutoREST's POST/PUT/DELETE operations automatically commit transactions. For scenarios requiring cross-table operations or complex business logic, use PL/SQL Handlers to explicitly control transaction boundaries, ensuring data consistency
3. **Concurrency Safety**: In high-concurrency scenarios, watch for database lock and connection pool exhaustion issues. Use mechanisms like FOR UPDATE SKIP LOCKED in Handlers to avoid lock waits, and properly configure the connection pool's maximum connections
4. **Log Auditing**: Enable ORDS access logging and database auditing to record all API call times, callers, request parameters, and response statuses. This is critical for security auditing, troubleshooting, and compliance requirements
5. **Monitoring and Alerting**: Monitor ORDS key metrics including connection pool utilization, request response times, error rates, etc. Set reasonable alert thresholds to detect and address issues before they escalate

---

> **Summary**: ORDS is a seriously underestimated tool in the Oracle ecosystem. For systems centered on Oracle databases, it can expose database capabilities as standardized RESTful APIs at minimal development cost, making it particularly suitable for data service projects led by DBA teams. Through this practical guide, we've covered ORDS's core use cases comprehensively — from architecture principles to installation and configuration, from API creation to security hardening, from performance optimization to production deployment. With proper security configuration and API Gateway integration, ORDS is fully capable of supporting production-grade API services. If your team is struggling with database service-oriented architecture, give ORDS a try — it might bring you unexpected pleasant surprises.
