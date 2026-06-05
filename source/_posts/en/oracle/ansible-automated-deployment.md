---
title: "Ansible Automated Oracle Deployment: From OS Preparation to Software Installation"
lang: en
date: 2026-01-31 10:00:00
categories: Oracle
tags: [Ansible, 自动化, DevOps, 安装部署, IaC]
---

As an OCM-certified DBA, I have deployed hundreds of Oracle database systems throughout my career. From the early days of manually typing commands step-by-step following MOS documents, to today's one-click completion of the entire process from OS preparation to database creation using Ansible, this transformation has given me a deep appreciation for the power of **Infrastructure as Code (IaC)**. This article will document how to implement automated Oracle database deployment using Ansible Roles, with code that can be directly used in production environments.

<!-- more -->

## I. Background

### 1.1 Pain Points of Manual Deployment

Every DBA has experienced this scenario: receiving a new server and starting Oracle deployment — configuring kernel parameters, installing dependency packages, creating users, setting environment variables, running `runInstaller`, executing `root.sh`, DBCA database creation, configuring listeners... The entire process takes 2-3 hours when things go smoothly, and could take an entire day if problems arise.

There are three core problems with manual deployment:

- **Time-consuming**: Each step requires manual execution and waiting, with no parallelization possible
- **Error-prone**: Missing a single `libaio-devel` package or a `shmmax` parameter can cause installation failure
- **Non-repeatable**: A successful deployment this time means starting from scratch in a different environment next time

### 1.2 New Requirements for DBAs in the DevOps Era

Modern enterprises require DBAs not only to manage databases but also to possess **Infrastructure as Code** capabilities. All environment configurations must be version-controlled, auditable, and traceable. When a development team requests "give me a test database identical to production," you need to deliver within 30 minutes, not 3 days.

### 1.3 Value of Oracle Deployment Automation

After implementing Oracle deployment automation with Ansible, we achieved:

- **Standardization**: Every environment configuration is completely consistent, eliminating "snowflake servers"
- **Version Control**: All configurations managed through Git, with traceable changes
- **Audit Compliance**: Playbooks serve as documentation, deployment processes are transparent and auditable
- **Rapid Delivery**: New environment deployment reduced from 3 hours to 40 minutes

## II. Theoretical Analysis

### 2.1 Automation Tool Selection

| Tool | Architecture | Learning Curve | Suitable Scenarios |
|------|-------------|---------------|-------------------|
| Ansible | Agentless, SSH push | Low | Configuration management, application deployment |
| Puppet | Agent/Master | Medium | Large-scale infrastructure management |
| Chef | Agent/Master | High | Complex orchestration, Ruby ecosystem |
| Terraform | Agentless, API calls | Medium | Cloud resource orchestration, infrastructure provisioning |

**Why is Ansible more suitable for Oracle deployment?**

1. **Agentless**: No additional software needed on target servers — the "cleaner" an Oracle server is, the better
2. **YAML Readability**: Playbooks serve as documentation; DBAs don't need to learn Ruby or DSL
3. **SSH Push**: Leverages existing SSH channels, no additional ports or security approvals needed
4. **Rich Modules**: `yum`, `template`, `user`, `sysctl` and other modules work out of the box
5. **Idempotency**: Repeated execution won't break existing state, suitable for routine inspections and fixes

### 2.2 Ansible Core Concepts

Before writing Playbooks, you need to understand the following core concepts:

**Inventory**: Defines the managed hosts and groups, which is the target scope of Ansible operations.

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

**Playbook**: Task orchestration files written in YAML format, defining "which tasks to execute on which hosts."

**Role**: An organizational approach for Playbooks, packaging tasks, handlers, templates, vars, etc. according to standard directory structure for easy reuse and sharing.

**Module**: Ansible's execution unit; each module performs a specific function, such as `yum` for installing packages and `template` for rendering template files.

**Jinja2 Template Engine**: Ansible uses Jinja2 as its template engine, allowing variable insertion, conditional logic, and loops in configuration files.

**Handler and Tag**: Handler is a task triggered by notification, typically used for restarting services; Tags are used to label tasks, allowing selective execution of specific tagged tasks.

### 2.3 Design Approach for Oracle Deployment Automation

Oracle deployment is a multi-stage complex process that we need to break down into clear stages:

```
OS Preparation → User/Directory Creation → Software Installation → DB Creation → Listener Configuration → Parameter Tuning
```

Each stage corresponds to a Task file, organized uniformly through a Role. Key design principles:

**Idempotency Design**: Every task should consider "what if it has already been executed." For example, check if a user exists before creating one, and use `state: present` when installing packages to ensure no duplicate installations.

**Error Handling**: For critical steps (such as `runInstaller`), use `register` to capture return values and combine with `failed_when` to determine success conditions. On failure, log the error and notify the Handler to clean up.

**Rollback Strategy**: Ansible natively doesn't handle rollback well, so we work around this with "backup before modify." Use the `copy` module to back up critical files before modification, and restore from backup on failure.

## III. Hands-On Operations

### 3.1 Ansible Role Structure Design

The complete Oracle deployment Role directory structure is as follows:

```
roles/oracle/
├── defaults/
│   └── main.yml          # Default variables (lowest priority)
├── vars/
│   └── main.yml          # Role variables (higher priority)
├── tasks/
│   ├── main.yml           # Main entry point, includes other tasks
│   ├── os_prepare.yml     # OS preparation
│   ├── user_setup.yml     # User/directory creation
│   ├── install.yml        # Software installation
│   ├── create_db.yml      # Database creation
│   └── listener.yml       # Listener configuration
├── templates/
│   ├── dbora.service.j2       # systemd service template
│   ├── oracle_env.sh.j2       # Environment variable template
│   ├── db_install.rsp.j2      # Installation response file template
│   ├── dbca.rsp.j2            # Database creation response file template
│   └── listener.ora.j2        # Listener configuration template
├── handlers/
│   └── main.yml           # Handler definitions
├── files/
│   └── limits_oracle.conf # limits configuration file
└── meta/
    └── main.yml           # Role metadata
```

### 3.2 OS Preparation Playbook

#### defaults/main.yml — Default Variable Definitions

```yaml
---
# Oracle version and installation paths
oracle_version: "19c"
oracle_home: "/u01/app/oracle/product/19.0.0/dbhome_1"
oracle_base: "/u01/app/oracle"
oracle_inventory: "/u01/app/oraInventory"

# Database parameters
oracle_sid: "ORCL"
oracle_characterset: "AL32UTF8"
oracle_memory_percent: 70

# Users and groups
oracle_user: "oracle"
oracle_group: "oinstall"
oracle_dba_group: "dba"
oracle_oper_group: "oper"
oracle_backup_group: "backupdba"
oracle_dg_group: "dgdba"
oracle_km_group: "kmdba"

# OS configuration
oracle_shmmax: 8589934592        # 8GB
oracle_shmall: 2097152
oracle_sem: "250 32000 100 128"

# Installation media path
oracle_software_path: "/tmp/oracle_software"
oracle_install_file: "LINUX.X64_193000_db_home.zip"

# Network
oracle_listener_port: 1521

# Security (production environments should use Ansible Vault)
oracle_sys_password: "Oracle#2026"
oracle_system_password: "Oracle#2026"
```

#### tasks/os_prepare.yml — OS Preparation

```yaml
---
# Install dependency packages
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

# Configure kernel parameters
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

# Configure limits
- name: Configure limits for Oracle user
  copy:
    src: limits_oracle.conf
    dest: /etc/security/limits.d/99-oracle.conf
    owner: root
    group: root
    mode: "0644"
  tags: [os_prepare, limits]

# Disable Transparent Huge Pages
- name: Disable Transparent Huge Pages
  lineinfile:
    path: /etc/default/grub
    regexp: '^GRUB_CMDLINE_LINUX='
    line: 'GRUB_CMDLINE_LINUX="transparent_hugepage=never {{ ansible_cmdline | default({}) | dict2items | selectattr("key", "ne", "transparent_hugepage") | map(attribute="value") | join(" ") }}"'
  notify: Regenerate grub config
  tags: [os_prepare, thp]

# Configure /etc/hosts
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

### 3.3 User and Directory Creation

#### tasks/user_setup.yml

```yaml
---
# Create groups
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

# Create user
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

# Create directory structure
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

# Deploy environment profile
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

### 3.4 Software Installation Playbook

#### tasks/install.yml

```yaml
---
# Check if Oracle software is already installed
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

# Render Response File
- name: Deploy db_install.rsp response file
  template:
    src: db_install.rsp.j2
    dest: "{{ oracle_software_path }}/db_install.rsp"
    owner: "{{ oracle_user }}"
    group: "{{ oracle_group }}"
    mode: "0600"
  when: not oracle_installed.stat.exists
  tags: [install, response]

# Run runInstaller
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

# Execute root.sh
- name: Execute root.sh
  command: "{{ oracle_home }}/root.sh"
  become: yes
  when: not oracle_installed.stat.exists
  register: rootsh_result
  tags: [install, rootsh]

# Verify installation result
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

# Installation type
oracle.install.option=INSTALL_DB_SWONLY

# UNIX group name
UNIX_GROUP_NAME={{ oracle_group }}

# Oracle Inventory location
INVENTORY_LOCATION={{ oracle_inventory }}

# Oracle Home
ORACLE_HOME={{ oracle_home }}
ORACLE_BASE={{ oracle_base }}

# Installation edition
oracle.install.db.InstallEdition=EE

# OSDBA and OSOPER groups
oracle.install.db.OSDBA_GROUP={{ oracle_dba_group }}
oracle.install.db.OSOPER_GROUP={{ oracle_oper_group }}
oracle.install.db.OSBACKUPDBA_GROUP={{ oracle_backup_group }}
oracle.install.db.OSDGDBA_GROUP={{ oracle_dg_group }}
oracle.install.db.OSKMDBA_GROUP={{ oracle_km_group }}
oracle.install.db.OSRACDBA_GROUP={{ oracle_dba_group }}

# Security updates (skip)
SECURITY_UPDATES_VIA_MYORACLESUPPORT=false
DECLINE_SECURITY_UPDATES=true

# Automatic memory management
oracle.install.db.ConfigureAsContainerDB=false
```

### 3.5 Database Creation Playbook

#### tasks/create_db.yml

```yaml
---
# Use DBCA silent mode to create database
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

# Render DBCA response file
- name: Deploy DBCA response file
  template:
    src: dbca.rsp.j2
    dest: "{{ oracle_software_path }}/dbca_{{ oracle_sid }}.rsp"
    owner: "{{ oracle_user }}"
    group: "{{ oracle_group }}"
    mode: "0600"
  when: "'0' in db_exists.stdout"
  tags: [create_db, response]

# Execute DBCA
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

# Verify database status
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

### 3.6 Listener Configuration and Parameter Tuning

#### tasks/listener.yml

```yaml
---
# Create listener using NETCA
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

# Deploy optimized listener.ora
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

# Deploy tnsnames.ora
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

# Performance parameters
INBOUND_CONNECT_TIMEOUT_LISTENER = 10
CONNECT_TIMEOUT_LISTENER = 10
LOG_LEVEL_LISTENER = ADMIN
DIAG_ADR_ENABLED_LISTENER = ON
ADR_BASE_LISTENER = {{ oracle_base }}
```

### 3.7 Main Entry and Handlers

#### tasks/main.yml

```yaml
---
# Oracle deployment main entry
# Execute in stages, can select specific stages with --tags

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

# Deploy systemd service (optional)
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

### 3.8 Main Playbook and Inventory

#### playbook.yml (project root)

```yaml
---
# Oracle automated deployment Playbook
# Usage: ansible-playbook -i inventory/hosts.yml playbook.yml

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
        fail_msg: "This Role only supports RHEL/CentOS 7+ systems"

    - name: Check minimum memory
      assert:
        that:
          - ansible_memtotal_mb >= 4096
        fail_msg: "Oracle 19c requires a minimum of 4GB memory"

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

## IV. Result Verification

### 4.1 Ansible Dry-Run

Before actually executing deployment, always use `--check` mode for a trial run:

```bash
# Check syntax
ansible-playbook playbook.yml --syntax-check

# Dry-run (no actual changes)
ansible-playbook -i inventory/hosts.yml playbook.yml --check --diff

# Only run OS preparation stage
ansible-playbook -i inventory/hosts.yml playbook.yml --tags "os_prepare" --check

# Exclude database creation stage (software installation only)
ansible-playbook -i inventory/hosts.yml playbook.yml --skip-tags "create_db"
```

### 4.2 Post-Installation Verification Script

After deployment, run a verification Playbook to confirm all component statuses are normal:

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
          ========== Oracle Deployment Verification Results ==========
          Oracle Binary:   {{ 'OK' if oracle_bin.stat.exists else 'MISSING' }}
          SQL*Plus:        {{ sqlplus_ver.stdout }}
          Listener:        {{ 'RUNNING' if 'running' in lsnr_status.stdout else 'NOT RUNNING' }}
          Database:        {{ db_status.stdout_lines | join('') }}
          ===========================================================
```

### 4.3 Idempotency Testing

Idempotency is one of Ansible's core values. Verification is simple — run it twice, and the second time should have no `changed` tasks:

```bash
# First execution
ansible-playbook -i inventory/hosts.yml playbook.yml

# Second execution, should show all "ok"
ansible-playbook -i inventory/hosts.yml playbook.yml
# Expected output: PLAY RECAP: ok=XX changed=0 failed=0
```

If the second run still has tasks marked as `changed`, the task has not properly implemented idempotency and needs `when` conditions or `creates`, `stat` approaches to improve.

## V. Lessons Learned

### 5.1 Best Practices

Based on multiple production deployments, here are the lessons learned:

1. **Execute in stages**: Don't run all tasks at once. Use `--tags` to verify each stage individually before full execution
2. **Backup first**: All operations involving configuration file changes must have `backup: yes` enabled
3. **Log archiving**: Redirect all Ansible execution output to files for auditing and troubleshooting
4. **Environment isolation**: Use different Inventory files for dev/staging/prod, with variables managed in layers through `group_vars`
5. **Version matrix**: Maintain Oracle version and patch level mappings in `defaults/main.yml` for easy upgrades

### 5.2 Security Considerations

Oracle database passwords should not be stored in plaintext in Inventory or variable files. Use **Ansible Vault** to encrypt sensitive information:

```bash
# Create encrypted file
ansible-vault create group_vars/all/vault.yml

# Encrypted file content example
# vault_oracle_sys_password: Oracle#2026
# vault_oracle_system_password: Oracle#2026

# Reference in defaults/main.yml
oracle_sys_password: "{{ vault_oracle_sys_password }}"

# Enter password during execution
ansible-playbook playbook.yml --ask-vault-pass

# Or use password file (CI/CD scenarios)
ansible-playbook playbook.yml --vault-password-file ~/.vault_pass
```

### 5.3 Version Management and Collaboration

Include the entire Ansible project in Git management:

```
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
│   │   └── vault.yml    # Encrypted
│   └── oracle_servers/
│       └── main.yml
├── roles/
│   └── oracle/
└── README.md
```

For team collaboration scenarios, consider deploying **Ansible Tower** or the open-source **AWX**, which provides enterprise-grade capabilities such as Web UI, RBAC, Job Scheduling, and credential management.

### 5.4 Integration with CI/CD

A typical architecture for incorporating Oracle deployment into a CI/CD pipeline:

```
Git Push → Jenkins/GitLab CI → AWX → Target Servers
              │                   │
              ├─ Lint (yamllint)   ├─ OS Prepare
              ├─ Syntax Check     ├─ Install Oracle
              └─ Molecule Test    └─ Create DB
```

Molecule can be used for automated testing of Ansible Roles, simulating deployment processes in containers to verify Role correctness and idempotency.

---

Automated deployment doesn't happen overnight — it requires continuous iteration and optimization. But once you've codified your Oracle deployment process with Ansible, you'll discover that new environment delivery is no longer a nightmare, but an elegant execution of `ansible-playbook`. As an OCM-certified DBA, mastering IaC capabilities is a fundamental skill of this era.

All Role code covered in this article has been verified in production environments and is suitable for Oracle 19c deployment. If you have questions or improvement suggestions, feel free to discuss in the comments.
