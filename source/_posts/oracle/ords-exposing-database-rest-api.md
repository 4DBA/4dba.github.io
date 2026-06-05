---
title: ORDS 实战：将 Oracle 数据库转化为 RESTful API 服务
date: 2026-05-29 10:00:00
categories: Oracle
tags: [ORDS, REST API, JSON, 微服务, 数据库服务化]
---

## 一、问题背景

### 1.1 数据库服务化的需求

在现代企业架构中，数据库往往不是孤立存在的——它需要为前端应用、移动端、第三方系统以及微服务架构提供数据支撑。随着前后端分离和微服务架构的普及，将数据库中的数据以标准化的 RESTful API 形式对外暴露，已经成为企业数字化转型中的刚性需求。

<!-- more -->


传统做法是在数据库之上搭建一层中间件（Java Spring Boot、Node.js 等），通过 JDBC/ODBC 连接数据库，再对外暴露 REST API。这种方案虽然可行，但在实际落地过程中存在几个明显痛点：

- **开发成本高**：每个数据实体都需要编写 Controller、Service、DAO 层代码，一个中等规模的系统可能涉及数十甚至上百个实体类，代码量巨大
- **维护负担重**：数据库 Schema 变更时，中间件代码需要同步修改，任何一个字段的增删改都可能引发连锁变更
- **延迟增加**：多了一层网络跳转，增加了响应时间和故障点，每次请求都要经过应用服务器的序列化和反序列化
- **技能栈要求**：DBA 团队通常不擅长 Java/Node.js 开发，而开发团队又不熟悉数据库内部逻辑，沟通成本高昂
- **部署复杂**：需要额外的应用服务器环境，增加了运维复杂度和基础设施成本

### 1.2 ORDS 的价值

Oracle REST Data Services（ORDS）提供了一种优雅的替代方案：**零代码将 SQL 查询、PL/SQL 过程直接暴露为 RESTful API**。DBA 只需要写 SQL 或 PL/SQL，ORDS 自动处理 HTTP 协议处理、JSON 序列化与反序列化、连接池管理、安全认证授权等所有 Web 层逻辑。这意味着 DBA 可以专注于数据逻辑本身，而无需学习和维护复杂的 Web 开发框架。

核心价值体现在：

| 维度 | 传统中间件方案 | ORDS 方案 |
|------|--------------|----------|
| 开发效率 | 需编写全栈代码 | SQL/PL/SQL 即 API |
| 部署复杂度 | 应用服务器 + 数据库 | ORDS + 数据库 |
| 延迟 | 多一跳（应用→数据库） | 直连数据库 |
| 维护成本 | Schema 变更需改代码 | AutoREST 自动适配 |
| 技能要求 | Java/JS + SQL | SQL/PL/SQL 即可 |

### 1.3 与传统中间件方案的对比

ORDS 并非要取代所有中间件，它最适合的场景是**数据密集型 CRUD 服务**和**数据库逻辑封装**。对于简单的数据增删改查、报表查询、数据导出等场景，ORDS 能够以最低的成本实现 API 暴露。对于复杂的业务编排、多数据源聚合、异步消息处理等场景，仍然需要传统中间件配合。两者可以共存——ORDS 负责数据库直接暴露的 API，中间件负责复杂业务逻辑，各司其职。

从实际项目经验来看，一个典型的微服务系统中，大约有 60%~70% 的 API 属于简单的数据 CRUD 操作，这些完全可以用 ORDS 来实现。剩下的 30%~40% 涉及复杂业务逻辑的 API，才需要传统的中间件方案。这种分工模式可以显著降低整体开发成本和系统复杂度。

---

## 二、理论分析

### 2.1 ORDS 架构

ORDS 本质上是一个运行在 JVM 上的 Java Web 应用，它在 HTTP 前端和 Oracle 数据库之间充当桥梁：

```
客户端 ──HTTP/HTTPS──▶ ORDS (Jetty/Tomcat/WLS) ──JDBC──▶ Oracle Database
                        │
                        ├── 连接池管理 (UCP/HikariCP)
                        ├── 请求路由 (Module → Template → Handler)
                        ├── 认证授权 (OAuth2/Basic Auth)
                        └── 响应格式化 (JSON/XML/CSV)
```

**连接池机制**：ORDS 使用 Universal Connection Pool (UCP) 管理数据库连接。每个数据库连接配置（称为 `database connection`）维护一个独立的连接池，支持连接复用、超时回收、健康检查等特性。连接池的大小可以通过配置文件灵活调整，初始连接数、最大连接数、空闲超时时间等参数都可以根据实际负载进行调优。这是 ORDS 性能的关键所在——避免了每次请求都建立新连接的开销，显著降低了数据库的连接管理压力。在高并发场景下，合理的连接池配置能够将 API 响应时间降低数倍。

**与 APEX 的关系**：ORDS 的前身就是 APEX Listener，它天然支持 Oracle APEX 应用的运行。APEX 的页面渲染、动态操作等功能都是通过 ORDS 来处理 HTTP 请求的。但 ORDS 的功能远不止于 APEX——它可以独立于 APEX 使用，纯粹作为 REST API 服务。在没有安装 APEX 的数据库上，ORDS 同样可以正常工作。实际上，很多企业使用 ORDS 的场景完全不涉及 APEX，只是利用它来暴露数据库服务。

**部署架构灵活性**：ORDS 支持多种部署方式。在开发和测试阶段，可以使用内置的 Jetty 服务器以独立模式（Standalone）运行，启动简单、无需额外依赖。在生产环境中，推荐将 ORDS 部署到 Tomcat 或 WebLogic Server 中，配合 Nginx 反向代理实现负载均衡和 SSL 卸载。此外，ORDS 还支持容器化部署，可以打包为 Docker 镜像运行在 Kubernetes 集群中。

### 2.2 REST API 设计

ORDS 的 REST API 设计遵循层级结构：

```
Base Path (e.g., /ords/hr/)
  └── Module (e.g., employees/)
       └── Template (e.g., {id}/)
            └── Handler (e.g., GET → SELECT ... WHERE id = :id)
```

- **Module**：逻辑分组，类似 API 的命名空间
- **Template**：URL 路径模板，支持 `{param}` 占位符
- **Handler**：绑定具体的 HTTP 方法（GET/POST/PUT/DELETE）和 SQL/PL/SQL

**参数绑定**支持三种来源：
- **URI 模板参数**：`{id}` → `:id`，用于标识资源的唯一性，例如 `/employees/{empno}` 中的 `empno`
- **Query String 参数**：`?status=ACTIVE` → `:status`，用于过滤、排序和分页控制
- **Request Body 参数**（POST/PUT 的 JSON body）→ `:field_name`，用于创建和更新操作的数据传递

**响应格式**默认为 JSON，也支持 XML 和 CSV。JSON 响应遵循 Oracle 的标准格式，包含 `items` 数组、分页元数据（`hasMore`、`limit`、`offset`、`count`）以及相关链接（`links`）等。这种标准化的响应格式使得前端开发者能够快速对接，无需额外的格式转换逻辑。对于列表查询，ORDS 自动实现分页功能，开发者只需在 Handler 中设置 `items_per_page` 参数即可。

### 2.3 AutoREST

AutoREST 是 ORDS 最强大也最具革命性的特性之一。它彻底改变了数据库暴露 API 的方式——只需一条 PL/SQL 命令，就能将任意表或视图自动暴露为完整的 RESTful API，无需编写任何 SQL Handler 代码。

- **表/视图的 AutoREST**：启用后，ORDS 会自动为该表生成五个标准 REST 端点——GET 列表（支持分页、过滤、排序）、GET 单条记录（按主键查询）、POST 创建记录、PUT 更新记录、DELETE 删除记录。这些端点完全遵循 RESTful 规范，返回标准化的 JSON 响应。更强大的是，AutoREST 支持通过 Query String 参数进行灵活的过滤和排序，例如 `?q={"salary":{"$gt":5000}}` 可以实现类似 MongoDB 的查询语法
- **PL/SQL 过程暴露**：除了表和视图，ORDS 还可以将存储过程、函数直接映射为 POST 端点。参数自动从 JSON Request Body 中提取，输出参数自动包含在 JSON 响应中。这使得复杂的数据库逻辑也能以 API 的形式对外提供服务
- **安全控制**：AutoREST 默认不暴露任何对象，必须显式授权才能访问。支持 Schema 级别、对象级别、甚至列级别的精细权限控制。可以通过 OAuth2 客户端角色来管理访问权限，确保只有经过授权的应用才能访问特定的数据资源。这种"默认拒绝"的安全模型，使得 AutoREST 在生产环境中使用也非常安全

---

## 三、实战操作

### 3.1 ORDS 安装配置

#### 3.1.1 环境准备

ORDS 23.x 要求 JDK 17+ 和 Oracle Database 19c+。以下基于 ORDS 23.4 + Oracle 19c 环境。

```bash
# 安装 JDK 17
sudo yum install -y java-17-openjdk java-17-openjdk-devel

# 验证 Java 版本
java -version
# openjdk version "17.0.x" ...

# 创建 ORDS 安装目录
sudo mkdir -p /opt/oracle/ords
sudo chown oracle:oinstall /opt/oracle/ords
```

#### 3.1.2 ORDS 安装

```bash
# 下载 ORDS（从 OTN 或 edelivery）
cd /opt/oracle/ords
unzip ords-23.4.0.24.1153.zip -d /opt/oracle/ords/

# 创建配置目录
mkdir -p /opt/oracle/ords/config/ords
```

#### 3.1.3 数据库连接配置

创建 `databases/default/connection.xml` 配置文件（或使用安装命令交互式配置）：

```bash
# 交互式安装配置
cd /opt/oracle/ords
java -jar ords.war install advanced

# 安装过程中需要指定：
# - 数据库连接类型：Basic (SID) 或 Service Name
# - 主机名、端口（默认1521）
# - 数据库 SID 或 Service Name
# - ORDS 公共用户密码
# - 管理员连接信息
```

也可以使用命令行非交互式配置：

```bash
# 配置数据库连接
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

#### 3.1.4 安装 ORDS Schema

```bash
# 以 SYSDBA 身份在数据库中安装 ORDS 元数据
# 这会创建 ORDS 相关的 schema 和对象
java -jar ords.war install simple \
  --database ORCLPDB1 \
  --host dbserver.example.com \
  --port 1521 \
  --passwordFile /opt/oracle/ords/admin_password.txt
```

#### 3.1.5 配置独立模式（Standalone）或 Tomcat 部署

**独立模式**（适合开发/测试）：

```bash
# 启动 ORDS 独立模式
java -jar ords.war standalone \
  --port 8080 \
  --host 0.0.0.0

# 生产环境建议使用 systemd 管理
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

**Tomcat 部署**（适合生产）：

```bash
# 将 ORDS 部署到 Tomcat
cp /opt/oracle/ords/ords.war $CATALINA_HOME/webapps/ords.war
# 重启 Tomcat
$CATALINA_HOME/bin/shutdown.sh
$CATALINA_HOME/bin/startup.sh
```

#### 3.1.6 HTTPS 配置

生产环境必须启用 HTTPS。推荐通过 Nginx 反向代理实现：

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

### 3.2 创建 REST 服务

#### 3.2.1 手动创建 Module/Template/Handler

通过 SQL Developer 或直接在数据库中执行 PL/SQL 来创建 REST 服务：

```sql
-- 1. 启用 ORDS schema（以 HR 用户为例）
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

-- 2. 创建 Module
BEGIN
    ORDS.DEFINE_MODULE(
        p_module_name    => 'employees.api',
        p_base_path      => '/emp/',
        p_items_per_page => 25,
        p_status         => 'PUBLISHED',
        p_comments       => '员工信息 REST API'
    );
    COMMIT;
END;
/

-- 3. 创建 Template（URL 路径模板）
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'employees.api',
        p_pattern        => ':empno',
        p_priority       => 0,
        p_etag_type      => 'HASH',
        p_comments       => '按员工编号查询'
    );
    COMMIT;
END;
/

-- 4. 创建 Handler（GET 方法 - 查询单个员工）
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

-- 5. 创建 Handler（GET 方法 - 查询员工列表）
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'employees.api',
        p_pattern     => 'list',
        p_comments    => '员工列表查询'
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

创建完成后，可以通过以下 URL 访问：

```
GET https://api.example.com/ords/hr/emp/list
GET https://api.example.com/ords/hr/emp/100
```

#### 3.2.2 AutoREST 启用

AutoREST 可以在 Schema 级别一键启用：

```sql
-- 启用 Schema 的 REST 服务
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

-- 启用表的 AutoREST（以 EMPLOYEES 表为例）
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

-- 启用视图的 AutoREST
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

启用后，以下端点自动可用：

```
GET    /ords/hr/employees/          # 列表（支持分页）
GET    /ords/hr/employees/:id       # 单条记录
POST   /ords/hr/employees/          # 创建记录
PUT    /ords/hr/employees/:id       # 更新记录
DELETE /ords/hr/employees/:id       # 删除记录
```

#### 3.2.3 参数化查询

在 Handler 中支持多种参数绑定方式：

```sql
-- 带分页和过滤的查询
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

调用示例：

```bash
# 查询薪资大于 5000 且部门 ID 为 50 的员工
curl -X GET "https://api.example.com/ords/hr/emp/search?min_salary=5000&dept_id=50"
```

### 3.3 安全配置

#### 3.3.1 OAuth2 认证

```sql
-- 创建 OAuth2 客户端
BEGIN
    OAUTH.CREATE_CLIENT(
        p_name            => 'Employee App',
        p_grant_type      => 'client_credentials',
        p_owner           => 'HR Department',
        p_description     => '员工管理系统 API 客户端',
        p_support_email    => 'dba@example.com',
        p_privilege_names  => ''
    );
    COMMIT;
END;
/

-- 授予客户端角色
BEGIN
    OAUTH.GRANT_CLIENT_ROLE(
        p_client_name => 'Employee App',
        p_role_name   => 'oracle.dbtools.autorest.any.schema'
    );
    COMMIT;
END;
/

-- 获取 Client ID 和 Secret
-- 查询: SELECT * FROM OAUTH_APPROVALS;
```

```bash
# 获取 Access Token
curl -X POST "https://api.example.com/ords/hr/oauth/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials" \
  -d "client_id=<client_id>" \
  -d "client_secret=<client_secret>"

# 使用 Token 调用 API
curl -X GET "https://api.example.com/ords/hr/employees/" \
  -H "Authorization: Bearer ***
```

#### 3.3.2 角色授权

```sql
-- 创建自定义角色
BEGIN
    ORDS.CREATE_ROLE(p_role_name => 'hr_api_reader');
    COMMIT;
END;
/

-- 将角色授予 OAuth2 客户端
BEGIN
    OAUTH.GRANT_CLIENT_ROLE(
        p_client_name => 'Employee App',
        p_role_name   => 'hr_api_reader'
    );
    COMMIT;
END;
/

-- 在 Module 级别要求角色
BEGIN
    ORDS.DEFINE_PRIVILEGE(
        p_privilege_name => 'hr.read.employees',
        p_roles          => 'hr_api_reader',
        p_patterns       => '/emp/*',
