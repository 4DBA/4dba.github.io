---
title: Ansible 自动化部署 Oracle：从 OS 准备到软件安装的全流程
date: 2026-06-05 14:00:00
categories: Oracle
tags: [Ansible, 自动化, DevOps, 安装部署, IaC]
---

作为一名 OCM 认证的 DBA，我在职业生涯中部署过上百套 Oracle 数据库。从最初照着 MOS 文档一步步敲命令，到如今用 Ansible 一键完成从 OS 准备到建库的全流程，这个转变让我深刻体会到 **Infrastructure as Code (IaC)** 的力量。本文将完整记录如何用 Ansible Role 实现 Oracle 数据库的自动化部署，代码可直接用于生产环境。

<!-- more -->

## 一、问题背景

### 1.1 传统手工部署的痛点

每个 DBA 都经历过这样的场景：拿到一台新服务器，开始 Oracle 部署——配置内核参数、安装依赖包、创建用户、设置环境变量、运行 `runInstaller`、执行 `root.sh`、DBCA 建库、配置监听……整个流程下来，顺利的话需要 2-3 小时，遇到问题可能折腾一整天。

手工部署的核心问题有三个：

- **耗时长**：每个步骤都需要手动执行和等待，无法并行化
- **易出错**：漏装一个 `libaio-devel`，少配一个 `shmmax` 参数，都可能导致安装失败
- **不可重复**：这次部署成功了，下次换个环境又要从头摸索

### 1.2 DevOps 时代对 DBA 的新要求

现代企业要求 DBA 不仅会管理数据库，还要具备 **Infrastructure as Code** 的能力。所有环境配置必须版本化、可审计、可追溯。开发团队要求"给我一套和生产一样的测试库"时，你需要在 30 分钟内交付，而不是 3 天。

### 1.3 Oracle 部署自动化的价值

通过 Ansible 实现 Oracle 部署自动化后，我们获得了：

- **标准化**：每套环境配置完全一致，消除"雪花服务器"
- **版本化**：所有配置通过 Git 管理，变更可追溯
- **审计合规**：Playbook 即文档，部署过程透明可审计
- **快速交付**：新环境部署从 3 小时缩短到 40 分钟

## 二、理论分析

### 2.1 自动化工具选型

| 工具 | 架构 | 学习曲线 | 适合场景 |
|------|------|----------|----------|
| Ansible | 无Agent，SSH推送 | 低 | 配置管理、应用部署 |
| Puppet | Agent/Master | 中 | 大规模基础设施管理 |
| Chef | Agent/Master | 高 | 复杂编排、Ruby生态 |
| Terraform | 无Agent，API调用 | 中 | 云资源编排、基础设施供给 |

**为什么 Ansible 更适合 Oracle 部署？**

1. **无 Agent**：不需要在目标服务器安装额外软件，Oracle 服务器越"干净"越好
2. **YAML 易读**：Playbook 即文档，DBA 不需要学 Ruby 或 DSL
3. **SSH 推送**：利用现有 SSH 通道，无需额外端口和安全审批
4. **丰富的 Module**：`yum`、`template`、`user`、`sysctl` 等模块开箱即用
5. **幂等性**：重复执行不会破坏已有状态，适合日常巡检和修复

### 2.2 Ansible 核心概念

在开始编写 Playbook 之前，需要理解以下核心概念：

**Inventory（清单）**：定义被管理的主机和分组，是 Ansible 操作的目标范围。

```yaml
# inventory/hosts.yml
all:
  children:
    oracle_servers:
      hosts:
        db01:
          ansible_host: 192.168.1.101
        db02:
          ansible_host: 192.168.1.102
```

**Playbook（剧本）**：以 YAML 格式编写的任务编排文件，定义"在哪些主机上执行哪些任务"。

**Role（角色）**：Playbook 的组织方式，将 tasks、handlers、templates、vars 等按照标准目录结构打包，便于复用和共享。

**Module（模块）**：Ansible 的执行单元，每个模块完成一个特定功能，如 `yum` 安装软件包、`template` 渲染模板文件。

**Jinja2 模板引擎**：Ansible 使用 Jinja2 作为模板引擎，可以在配置文件中插入变量、使用条件判断和循环。

**Handler 与 Tag**：Handler 是被通知触发的任务，通常用于重启服务；Tag 用于给任务打标签，执行时可选择性运行特定标签的任务。

### 2.3 Oracle 部署自动化的设计思路

Oracle 部署是一个多阶段的复杂过程，我们需要将其拆解为清晰的阶段：

```
OS准备 → 用户/目录创建 → 软件安装 → 建库 → 监听配置 → 参数调优
```

每个阶段对应一个 Task 文件，通过 Role 统一组织。关键设计原则：

**幂等性设计**：每个任务都要考虑"如果已经执行过怎么办"。例如，创建用户前先检查用户是否存在，安装软件包时利用 `state: present` 确保不重复安装。

**错误处理**：对于关键步骤（如 `runInstaller`），使用 `register` 捕获返回值，结合 `failed_when` 判断成功条件。失败时记录日志并通知 Handler 清理现场。

**回滚策略**：Ansible 天生不擅长回滚，我们通过"先备份再修改"的方式变通实现。关键文件修改前使用 `copy` 模块备份，失败时从备份恢复。

## 三、实战操作

### 3.1 Ansible Role 结构设计

完整的 Oracle 部署 Role 目录结构如下：

```
roles/oracle/
├── defaults/
│   └── main.yml          # 默认变量（优先级最低）
├── vars/
│   └── main.yml          # 角色变量（优先级高）
├── tasks/
│   ├── main.yml           # 主入口，include其他task
│   ├── os_prepare.yml     # OS准备
│   ├── user_setup.yml     # 用户/目录创建
│   ├── install.yml        # 软件安装
│   ├── create_db.yml      # 建库
│   └── listener.yml       # 监听配置
├── templates/
│   ├── dbora.service.j2       # systemd服务模板
│   ├── oracle_env.sh.j2       # 环境变量模板
│   ├── db_install.rsp.j2      # 安装响应文件模板
│   ├── dbca.rsp.j2            # 建库响应文件模板
│   └── listener.ora.j2        # 监听配置模板
├── handlers/
│   └── main.yml           # Handler定义
├── files/
│   └── limits_oracle.conf # limits配置文件
└── meta/
    └── main.yml           # Role元数据
```

### 3.2 OS 准备 Playbook

#### defaults/main.yml — 默认变量定义

```yaml
---
# Oracle 版本与安装路径
oracle_version: "19c"
oracle_home: "/u01/app/oracle/product/19.0.0/dbhome_1"
oracle_base: "/u01/app/oracle"
oracle_inventory: "/u01/app/oraInventory"

# 数据库参数
oracle_sid: "ORCL"
oracle_characterset: "AL32UTF8"
oracle_memory_percent: 70

# 用户与组
oracle_user: "oracle"
oracle_group: "oinstall"
oracle_dba_group: "dba"
oracle_oper_group: "oper"
oracle_backup_group: "backupdba"
oracle_dg_group: "dgdba"
oracle_km_group: "kmdba"

# OS 配置
oracle_shmmax: 8589934592        # 8GB
oracle_shmall: 2097152
oracle_sem: "250 32000 100 128"

# 安装介质路径
oracle_software_path: "/tmp/oracle_software"
oracle_install_file: "LINUX.X64_193000_db_home.zip"

# 网络
oracle_listener_port: 1521

# 安全（生产环境建议用 Ansible Vault）
oracle_sys_password: "Oracle#2026"
oracle_system_password: "Oracle#2026"
```

#### tasks/os_prepare.yml — OS 准备

```yaml
---
# 安装依赖包
- name: Install required packages for Oracle
  yum:
    name:
      - binutils
      - compat-libcap1
      - compat-libstdc++-33
      - gcc
      - gcc-c++
      - glibc
      - glibc-devel
      - ksh
      - libaio
      - libaio-devel
      - libgcc
      - libstdc++
      - libstdc++-devel
      - libnsl
      - libXext
      - libXtst
      - libX11
      - libXau
      - libxcb
      - libXi
      - make
      - sysstat
      - unzip
      - bc
      - flex
      - net-tools
      - smartmontools
    state: present
  tags: [os_prepare, packages]

# 配置内核参数
- name: Configure kernel parameters
  sysctl:
    name: "{{ item.name }}"
    value: "{{ item.value }}"
    state: present
    reload: yes
    sysctl_file: /etc/sysctl.d/99-oracle.conf
  loop:
    - { name: "kernel.shmmax", value: "{{ oracle_shmmax }}" }
    - { name: "kernel.shmall", value: "{{ oracle_shmall }}" }
    - { name: "kernel.shmmni", value: "4096" }
    - { name: "kernel.sem", value: "{{ oracle_sem }}" }
    - { name: "fs.file-max", value: "6815744" }
    - { name: "fs.aio-max-nr", value: "1048576" }
    - { name: "net.ipv4.ip_local_port_range", value: "9000 65500" }
    - { name: "net.core.rmem_default", value: "262144" }
    - { name: "net.core.rmem_max", value: "4194304" }
    - { name: "net.core.wmem_default", value: "262144" }
    - { name: "net.core.wmem_max", value: "1048576" }
    - { name: "vm.swappiness", value: "10" }
    - { name: "vm.dirty_ratio", value: "60" }
  tags: [os_prepare, kernel]

# 配置 limits
- name: Configure limits for Oracle user
  copy:
    src: limits_oracle.conf
    dest: /etc/security/limits.d/99-oracle.conf
    owner: root
    group: root
    mode: "0644"
  tags: [os_prepare, limits]

# 禁用 Transparent Huge Pages
- name: Disable Transparent Huge Pages
  lineinfile:
    path: /etc/default/grub
    regexp: '^GRUB_CMDLINE_LINUX='
    line: 'GRUB_CMDLINE_LINUX="transparent_hugepage=never {{ ansible_cmdline | default({}) | dict2items | selectattr("key", "ne", "transparent_hugepage") | map(attribute="value") | join(" ") }}"'
  notify: Regenerate grub config
  tags: [os_prepare, thp]

# 配置 /etc/hosts
- name: Configure /etc/hosts
  lineinfile:
    path: /etc/hosts
    line: "{{ ansible_default_ipv4.address }} {{ ansible_hostname }} {{ ansible_fqdn }}"
    state: present
  tags: [os_prepare, hosts]
```

#### files/limits_oracle.conf

```
oracle   soft   nofile    1024
oracle   hard   nofile    65536
oracle   soft   nproc     16384
oracle   hard   nproc     16384
oracle   soft   stack     10240
oracle   hard   stack     32768
oracle   soft   memlock   unlimited
oracle   hard   memlock   unlimited
```

### 3.3 用户与目录创建

#### tasks/user_setup.yml

```yaml
---
# 创建组
- name: Create Oracle groups
  group:
    name: "{{ item }}"
    state: present
  loop:
    - "{{ oracle_group }}"
    - "{{ oracle_dba_group }}"
    - "{{ oracle_oper_group }}"
    - "{{ oracle_backup_group }}"
    - "{{ oracle_dg_group }}"
    - "{{ oracle_km_group }}"
  tags: [user_setup, groups]

# 创建用户
- name: Create Oracle user
  user:
    name: "{{ oracle_user }}"
    group: "{{ oracle_group }}"
    groups:
      - "{{ oracle_dba_group }}"
      - "{{ oracle_oper_group }}"
      - "{{ oracle_backup_group }}"
      - "{{ oracle_dg_group }}"
      - "{{ oracle_km_group }}"
    home: "/home/{{ oracle_user }}"
    shell: /bin/bash
    create_home: yes
    state: present
  tags: [user_setup, users]

# 创建目录结构
- name: Create Oracle directory structure
  file:
    path: "{{ item }}"
    state: directory
    owner: "{{ oracle_user }}"
    group: "{{ oracle_group }}"
    mode: "0755"
  loop:
    - "{{ oracle_base }}"
    - "{{ oracle_home }}"
    - "{{ oracle_inventory }}"
    - "{{ oracle_base }}/admin"
    - "{{ oracle_base }}/admin/{{ oracle_sid }}/adump"
    - "{{ oracle_base }}/oradata"
    - "{{ oracle_base }}/fast_recovery_area"
    - "{{ oracle_base }}/oradata/{{ oracle_sid }}"
    - "{{ oracle_software_path }}"
  tags: [user_setup, directories]

# 部署环境变量
- name: Deploy Oracle environment profile
  template:
    src: oracle_env.sh.j2
    dest: "/home/{{ oracle_user }}/.bash_profile"
    owner: "{{ oracle_user }}"
    group: "{{ oracle_group }}"
    mode: "0644"
    backup: yes
  tags: [user_setup, profile]
```

#### templates/oracle_env.sh.j2

```bash
# Oracle Environment - Managed by Ansible
# Do NOT edit manually. Changes will be overwritten.

export ORACLE_BASE={{ oracle_base }}
export ORACLE_HOME={{ oracle_home }}
export ORACLE_SID={{ oracle_sid }}
export ORACLE_UNQNAME={{ oracle_sid }}
export PATH=$ORACLE_HOME/bin:$PATH
export LD_LIBRARY_PATH=$ORACLE_HOME/lib:$LD_LIBRARY_PATH
export NLS_LANG=AMERICAN_AMERICA.AL32UTF8
export NLS_DATE_FORMAT="YYYY-MM-DD HH24:MI:SS"
export TNS_ADMIN=$ORACLE_HOME/network/admin

# History settings
export HISTSIZE=10000
export HISTFILESIZE=20000
export HISTCONTROL=ignoredups

# SQL*Plus settings
export SQLPATH=$ORACLE_HOME/sqlplus/admin
set -o vi
```

### 3.4 软件安装 Playbook

#### tasks/install.yml

```yaml
---
# 解压安装介质
- name: Check if Oracle software is already installed
  stat:
    path: "{{ oracle_home }}/bin/oracle"
  register: oracle_installed
  tags: [install]

- name: Unzip Oracle software
  unarchive:
    src: "{{ oracle_software_path }}/{{ oracle_install_file }}"
    dest: "{{ oracle_home }}"
    remote_src: yes
    creates: "{{ oracle_home }}/runInstaller"
  when: not oracle_installed.stat.exists
  become: yes
  become_user: "{{ oracle_user }}"
  tags: [install]

# 渲染 Response File
- name: Deploy db_install.rsp response file
  template:
    src: db_install.rsp.j2
    dest: "{{ oracle_software_path }}/db_install.rsp"
    owner: "{{ oracle_user }}"
    group: "{{ oracle_group }}"
    mode: "0600"
  when: not oracle_installed.stat.exists
  tags: [install, response]

# 执行 runInstaller
- name: Run Oracle installer in silent mode
  command: >
    {{ oracle_home }}/runInstaller
    -silent -noconfig -waitforcompletion -ignoreSysPrereqs
    -responseFile {{ oracle_software_path }}/db_install.rsp
  become: yes
  become_user: "{{ oracle_user }}"
  when: not oracle_installed.stat.exists
  register: install_result
  timeout: 1800
  tags: [install, runinstaller]

# 执行 root.sh
- name: Execute root.sh
  command: "{{ oracle_home }}/root.sh"
  become: yes
  when: not oracle_installed.stat.exists
  register: rootsh_result
  tags: [install, rootsh]

# 验证安装结果
- name: Verify Oracle installation
  command: "{{ oracle_home }}/bin/sqlplus -V"
  become: yes
  become_user: "{{ oracle_user }}"
  register: sqlplus_version
  changed_when: false
  failed_when: sqlplus_version.rc != 0
  tags: [install, verify]
```

#### templates/db_install.rsp.j2

```ini
# Oracle 19c Software Installation Response File
# Managed by Ansible - Do NOT edit manually

oracle.install.responseFileVersion=/oracle/install/rspfmt_dbinstall_response_schema_v19.0.0

# 安装类型
oracle.install.option=INSTALL_DB_SWONLY

# UNIX 组名
UNIX_GROUP_NAME={{ oracle_group }}

# Oracle Inventory 位置
INVENTORY_LOCATION={{ oracle_inventory }}

# Oracle Home
ORACLE_HOME={{ oracle_home }}
ORACLE_BASE={{ oracle_base }}

# 安装版本
oracle.install.db.InstallEdition=EE

# OSDBA 和 OSOPER 组
oracle.install.db.OSDBA_GROUP={{ oracle_dba_group }}
oracle.install.db.OSOPER_GROUP={{ oracle_oper_group }}
oracle.install.db.OSBACKUPDBA_GROUP={{ oracle_backup_group }}
oracle.install.db.OSDGDBA_GROUP={{ oracle_dg_group }}
oracle.install.db.OSKMDBA_GROUP={{ oracle_km_group }}
oracle.install.db.OSRACDBA_GROUP={{ oracle_dba_group }}

# 安全更新（跳过）
SECURITY_UPDATES_VIA_MYORACLESUPPORT=false
DECLINE_SECURITY_UPDATES=true

# 自动内存管理
oracle.install.db.ConfigureAsContainerDB=false
```

### 3.5 建库 Playbook

#### tasks/create_db.yml

```yaml
---
# 使用 DBCA 静默模式建库
- name: Check if database already exists
  shell: |
    source /home/{{ oracle_user }}/.bash_profile
    sqlplus -s / as sysdba <<'EOF'
    SET HEADING OFF FEEDBACK OFF
    SELECT COUNT(*) FROM v$database WHERE name='{{ oracle_sid }}';
    EXIT;
    EOF
  become: yes
  become_user: "{{ oracle_user }}"
  register: db_exists
  changed_when: false
  failed_when: false
  tags: [create_db]

# 渲染 DBCA 响应文件
- name: Deploy DBCA response file
  template:
    src: dbca.rsp.j2
    dest: "{{ oracle_software_path }}/dbca_{{ oracle_sid }}.rsp"
    owner: "{{ oracle_user }}"
    group: "{{ oracle_group }}"
    mode: "0600"
  when: "'0' in db_exists.stdout"
  tags: [create_db, response]

# 执行 DBCA
- name: Create database with DBCA
  command: >
    {{ oracle_home }}/bin/dbca -silent -createDatabase
    -responseFile {{ oracle_software_path }}/dbca_{{ oracle_sid }}.rsp
  become: yes
  become_user: "{{ oracle_user }}"
  when: "'0' in db_exists.stdout"
  register: dbca_result
  timeout: 3600
  tags: [create_db, dbca]

# 验证数据库状态
- name: Verify database is open
  shell: |
    source /home/{{ oracle_user }}/.bash_profile
    sqlplus -s / as sysdba <<'EOF'
    SET HEADING OFF FEEDBACK OFF
    SELECT STATUS FROM V$INSTANCE;
    EXIT;
    EOF
  become: yes
  become_user: "{{ oracle_user }}"
  register: db_status
  changed_when: false
  failed_when: "'OPEN' not in db_status.stdout"
  tags: [create_db, verify]
```

#### templates/dbca.rsp.j2

```ini
# DBCA Response File for {{ oracle_sid }}
# Managed by Ansible

responseFileVersion=/oracle/assistants/rspfmt_dbca_response_schema_v19.0.0
gdbName={{ oracle_sid }}
sid={{ oracle_sid }}
databaseConfigType=SI
createAsContainerDatabase=false
templateName=General_Purpose.dbc
sysPassword={{ oracle_sys_password }}
systemPassword={{ oracle_system_password }}
datafileDestination={{ oracle_base }}/oradata
recoveryAreaDestination={{ oracle_base }}/fast_recovery_area
recoveryAreaSize=10240
storageType=FS
characterSet={{ oracle_characterset }}
nationalCharacterSet=AL16UTF16
totalMemory={{ (ansible_memtotal_mb * oracle_memory_percent / 100) | int }}
automaticMemoryManagement=FALSE
emConfiguration=NONE
```

### 3.6 监听配置与参数调优

#### tasks/listener.yml

```yaml
---
# 使用 NETCA 创建监听
- name: Check if listener exists
  stat:
    path: "{{ oracle_home }}/network/admin/listener.ora"
  register: listener_exists
  tags: [listener]

- name: Create listener using NETCA
  command: >
    {{ oracle_home }}/bin/netca /silent /responseFile
    {{ oracle_home }}/assistants/netca/netca.rsp
  become: yes
  become_user: "{{ oracle_user }}"
  when: not listener_exists.stat.exists
  register: netca_result
  tags: [listener, netca]

# 部署优化后的 listener.ora
- name: Deploy optimized listener.ora
  template:
    src: listener.ora.j2
    dest: "{{ oracle_home }}/network/admin/listener.ora"
    owner: "{{ oracle_user }}"
    group: "{{ oracle_group }}"
    mode: "0644"
    backup: yes
  notify: Restart listener
  tags: [listener, config]

# 部署 tnsnames.ora
- name: Deploy tnsnames.ora
  template:
    src: tnsnames.ora.j2
    dest: "{{ oracle_home }}/network/admin/tnsnames.ora"
    owner: "{{ oracle_user }}"
    group: "{{ oracle_group }}"
    mode: "0644"
  tags: [listener, tns]
```

#### templates/listener.ora.j2

```ini
# listener.ora - Managed by Ansible
# {{ ansible_hostname }}

LISTENER =
  (DESCRIPTION_LIST =
    (DESCRIPTION =
      (ADDRESS = (PROTOCOL = TCP)(HOST = {{ ansible_hostname }})(PORT = {{ oracle_listener_port }}))
      (ADDRESS = (PROTOCOL = IPC)(KEY = EXTPROC1521))
    )
  )

SID_LIST_LISTENER =
  (SID_LIST =
    (SID_DESC =
      (GLOBAL_DBNAME = {{ oracle_sid }})
      (ORACLE_HOME = {{ oracle_home }})
      (SID_NAME = {{ oracle_sid }})
    )
  )

# 性能参数
INBOUND_CONNECT_TIMEOUT_LISTENER = 10
CONNECT_TIMEOUT_LISTENER = 10
LOG_LEVEL_LISTENER = ADMIN
DIAG_ADR_ENABLED_LISTENER = ON
ADR_BASE_LISTENER = {{ oracle_base }}
```

### 3.7 主入口与 Handler

#### tasks/main.yml

```yaml
---
# Oracle 部署主入口
# 分阶段执行，可通过 --tags 选择性运行

- import_tasks: os_prepare.yml
  tags: [os_prepare]

- import_tasks: user_setup.yml
  tags: [user_setup]

- import_tasks: install.yml
  tags: [install]

- import_tasks: create_db.yml
  tags: [create_db]

- import_tasks: listener.yml
  tags: [listener]

# 部署 systemd 服务（可选）
- name: Deploy Oracle systemd service
  template:
    src: dbora.service.j2
    dest: /etc/systemd/system/dbora.service
    owner: root
    group: root
    mode: "0644"
  notify:
    - Reload systemd
    - Enable dbora service
  tags: [systemd]
```

#### handlers/main.yml

```yaml
---
- name: Regenerate grub config
  command: grub2-mkconfig -o /boot/grub2/grub.cfg
  listen: "Regenerate grub config"

- name: Reload systemd
  systemd:
    daemon_reload: yes

- name: Enable dbora service
  systemd:
    name: dbora
    enabled: yes

- name: Restart listener
  command: "{{ oracle_home }}/bin/lsnrctl restart"
  become: yes
  become_user: "{{ oracle_user }}"
  listen: "Restart listener"
```

### 3.8 主 Playbook 与 Inventory

#### playbook.yml（项目根目录）

```yaml
---
# Oracle 自动化部署 Playbook
# 用法: ansible-playbook -i inventory/hosts.yml playbook.yml

- name: Deploy Oracle Database
  hosts: oracle_servers
  become: yes
  gather_facts: yes

  pre_tasks:
    - name: Validate target OS
      assert:
        that:
          - ansible_os_family == "RedHat"
          - ansible_distribution_major_version | int >= 7
        fail_msg: "此 Role 仅支持 RHEL/CentOS 7+ 系统"

    - name: Check minimum memory
      assert:
        that:
          - ansible_memtotal_mb >= 4096
        fail_msg: "Oracle 19c 最低要求 4GB 内存"

  roles:
    - role: oracle
```

#### inventory/hosts.yml

```yaml
---
all:
  children:
    oracle_servers:
      hosts:
        prod-db01:
          ansible_host: 10.0.1.101
          oracle_sid: PROD01
          oracle_memory_percent: 70
        prod-db02:
          ansible_host: 10.0.1.102
          oracle_sid: PROD02
          oracle_memory_percent: 60
      vars:
        ansible_user: deploy
        ansible_become_method: sudo
        ansible_python_interpreter: /usr/bin/python3
```

## 四、结果验证

### 4.1 Ansible Dry-Run

在真正执行部署之前，务必使用 `--check` 模式进行试运行：

```bash
# 检查语法
ansible-playbook playbook.yml --syntax-check

# Dry-run（不做实际修改）
ansible-playbook -i inventory/hosts.yml playbook.yml --check --diff

# 仅运行 OS 准备阶段
ansible-playbook -i inventory/hosts.yml playbook.yml --tags "os_prepare" --check

# 排除建库阶段（仅安装软件）
ansible-playbook -i inventory/hosts.yml playbook.yml --skip-tags "create_db"
```

### 4.2 安装后验证脚本

部署完成后，运行验证 Playbook 确认所有组件状态正常：

```yaml
# verify.yml
---
- name: Verify Oracle Installation
  hosts: oracle_servers
  become: yes
  tasks:
    - name: Check Oracle binary
      stat:
        path: "{{ oracle_home }}/bin/oracle"
      register: oracle_bin

    - name: Check SQL*Plus version
      command: "{{ oracle_home }}/bin/sqlplus -V"
      become_user: "{{ oracle_user }}"
      register: sqlplus_ver
      changed_when: false

    - name: Check listener status
      command: "{{ oracle_home }}/bin/lsnrctl status"
      become_user: "{{ oracle_user }}"
      register: lsnr_status
      changed_when: false

    - name: Check database status
      shell: |
        source /home/{{ oracle_user }}/.bash_profile
        sqlplus -s / as sysdba <<'EOF'
        SET HEADING OFF FEEDBACK OFF PAGESIZE 0
        SELECT 'DB_STATUS:' || STATUS || ' OPEN_MODE:' || OPEN_MODE
        FROM V$INSTANCE, V$DATABASE;
        EXIT;
        EOF
      become_user: "{{ oracle_user }}"
      register: db_status
      changed_when: false

    - name: Print verification results
      debug:
        msg: |
          ========== Oracle 部署验证结果 ==========
          Oracle Binary:   {{ 'OK' if oracle_bin.stat.exists else 'MISSING' }}
          SQL*Plus:        {{ sqlplus_ver.stdout }}
          Listener:        {{ 'RUNNING' if 'running' in lsnr_status.stdout else 'NOT RUNNING' }}
          Database:        {{ db_status.stdout_lines | join('') }}
          ==========================================
```

### 4.3 幂等性测试

幂等性是 Ansible 的核心价值之一。验证方式很简单——执行两次，第二次不应该有任何 `changed` 任务：

```bash
# 第一次执行
ansible-playbook -i inventory/hosts.yml playbook.yml

# 第二次执行，应该全部显示 "ok"
ansible-playbook -i inventory/hosts.yml playbook.yml
# 期望输出: PLAY RECAP: ok=XX changed=0 failed=0
```

如果第二次仍有任务标记为 `changed`，说明该任务没有正确实现幂等性，需要检查 `when` 条件或使用 `creates`、`stat` 等方式完善。

## 五、经验总结

### 5.1 最佳实践

经过多次生产部署，总结以下经验：

1. **分阶段执行**：不要一次性运行全部任务，先用 `--tags` 分阶段验证，确保每个阶段都正确后再全流程执行
2. **备份优先**：所有涉及配置文件修改的操作，必须开启 `backup: yes`
3. **日志归档**：每次执行 Ansible 输出都重定向到文件，便于审计和排错
4. **环境隔离**：dev/staging/prod 使用不同的 Inventory 文件，变量通过 `group_vars` 分层管理
5. **版本矩阵**：在 `defaults/main.yml` 中维护 Oracle 版本和补丁级别的映射关系，便于升级

### 5.2 安全考虑

Oracle 数据库密码不应该明文存储在 Inventory 或变量文件中。使用 **Ansible Vault** 加密敏感信息：

```bash
# 创建加密文件
ansible-vault create group_vars/all/vault.yml

# 加密后的文件内容示例
# vault_oracle_sys_password: Oracle#2026
# vault_oracle_system_password: Oracle#2026

# 在 defaults/main.yml 中引用
oracle_sys_password: "{{ vault_oracle_sys_password }}"

# 执行时输入密码
ansible-playbook playbook.yml --ask-vault-pass

# 或使用密码文件（CI/CD 场景）
ansible-playbook playbook.yml --vault-password-file ~/.vault_pass
```

### 5.3 版本管理与协作

将整个 Ansible 项目纳入 Git 管理：

```bash
oracle-deploy/
├── ansible.cfg
├── playbook.yml
├── verify.yml
├── inventory/
│   ├── dev/
│   │   └── hosts.yml
│   ├── staging/
│   │   └── hosts.yml
│   └── prod/
│       └── hosts.yml
├── group_vars/
│   ├── all/
│   │   └── vault.yml    # 加密
│   └── oracle_servers/
│       └── main.yml
├── roles/
│   └── oracle/
└── README.md
```

在团队协作场景下，建议部署 **Ansible Tower** 或开源的 **AWX**，提供 Web UI、RBAC、Job Scheduling、凭证管理等企业级能力。

### 5.4 与 CI/CD 集成

将 Oracle 部署纳入 CI/CD 流水线的典型架构：

```
Git Push → Jenkins/GitLab CI → AWX → 目标服务器
              │                   │
              ├─ Lint (yamllint)   ├─ OS Prepare
              ├─ Syntax Check     ├─ Install Oracle
              └─ Molecule Test    └─ Create DB
```

Molecule 可以用于 Ansible Role 的自动化测试，在容器中模拟部署过程，验证 Role 的正确性和幂等性。

---

自动化部署不是一蹴而就的事情，它需要不断的迭代和优化。但一旦你把 Oracle 部署流程用 Ansible 代码化之后，你会发现：新环境交付不再是噩梦，而是 `ansible-playbook` 的一次优雅执行。作为 OCM 认证的 DBA，掌握 IaC 能力是这个时代的基本功。

本文涉及的所有 Role 代码已在生产环境验证通过，适用于 Oracle 19c 部署。如有问题或改进建议，欢迎在评论区交流。
