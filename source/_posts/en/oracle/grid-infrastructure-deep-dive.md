---
title: "Grid Infrastructure Deep Dive: OCR/Voting Disk/SCAN and Cluster Startup Logic"
date: 2026-01-19 10:00:00
categories: Oracle
tags: [Grid Infrastructure, RAC, OCR, Voting Disk, SCAN, GPNP, Cluster]
lang: en
---

Oracle Grid Infrastructure (GI) is the cornerstone of the RAC architecture, responsible for three core functions: cluster management, storage management, and network management. However, many DBAs' understanding of GI only extends to the level of `crsctl start/stop`. When encountering production failures such as OCR corruption, Voting Disk loss, or SCAN IP drift, they are often helpless. This article starts from the underlying mechanisms, deeply analyzing GI's core components and startup logic, helping readers build a systematic understanding of the GI architecture.

<!-- more -->

## I. Problem Background

In daily operations, we frequently encounter scenarios such as:

- A storage failure causes the disk group containing OCR to become unavailable, and the entire RAC cluster goes down instantly
- Network jitter triggers Voting Disk arbitration failure, and nodes are evicted from the cluster
- SCAN IP cannot be resolved, causing a large number of application connection failures

The root cause of these problems lies in our insufficient understanding of GI's underlying mechanisms. **Only knowing how to use `srvctl` and `crsctl` to manage the cluster without understanding the operational logic behind them is like being able to drive without understanding engine principles—fine when things work, completely lost when something breaks.**

> This article is based on Oracle 12c/19c versions. Some content differs in 11gR2 and will be noted in the text. It references roger wiki's RAC internal mechanism analysis and multiple MOS documents.

---

## II. Theoretical Analysis

### 2.1 GI Architecture Overview

Before diving into each component, let's describe GI's overall architecture:

```
┌─────────────────────────────────────────────────────┐
│               Application / Database Layer            │
│              Oracle RAC Database Instances            │
├─────────────────────────────────────────────────────┤
│                Resource Management (CRSD)             │
│     Database / Service / Listener / VIP / SCAN VIP    │
├─────────────────────────────────────────────────────┤
│                Cluster Synchronization (OCSSD)        │
│        CSS (Cluster Synchronization Services)          │
│              Voting Disk / Network Heartbeat           │
├─────────────────────────────────────────────────────┤
│                Cluster Registry Layer                  │
│              OCR (Cluster Registry)                    │
│              GPNP (Grid Plug and Play)                 │
├─────────────────────────────────────────────────────┤
│                Base Services (OHASD)                   │
│          OHASD -> CSSDAGENT -> OCSSD                   │
│              ASM / Network / Storage Management        │
├─────────────────────────────────────────────────────┤
│                OS / Network / Storage                  │
└─────────────────────────────────────────────────────┘
```

GI's layer relationships can be summarized as: **OHASD is the lowest-level daemon responsible for starting the entire cluster stack; OCSSD handles inter-node heartbeat synchronization and split-brain arbitration; CRSD manages all cluster resources; ASM handles storage management.** These components have strict startup order dependencies, which will be analyzed in detail below.

---

### 2.2 OCR (Oracle Cluster Registry)

#### 2.2.1 OCR's Role and Storage Structure

OCR is the "configuration center" of the entire RAC cluster, storing the following key information:

- Cluster node list and node numbers
- Database, instance, and Service configuration information
- VIP, SCAN VIP, and Listener network configuration
- ASM disk group configuration
- Resource attributes (such as `AUTO_START`, `START_DEPENDENCIES`, etc.)

**OCR's storage structure has undergone significant evolution:**

| Version | Storage Location | Redundancy Method |
|---------|-----------------|-------------------|
| 10g/11gR1 | Shared raw device/OCFS | OCR + OCR Mirror (max 2 copies) |
| 11gR2+ | ASM disk group | Normal Redundancy = 3 copies, High = 5 copies |
| 12c+ | ASM disk group | Same as 11gR2, but introduced OCR backup stored in ASM |

In 11.2.0.2+, OCR is stored by default in ASM disk groups (typically the `+CRS` disk group). Oracle creates a file named `SYSTEMDG` in the disk group to store OCR. The benefit of this design is leveraging ASM's mirroring mechanism to protect OCR, eliminating the need to separately manage OCR Mirror.

#### 2.2.2 OCR Backup Mechanism

OCR has three backup methods:

**1) Automatic Backup**

The CRSD process automatically backs up OCR according to the following strategy:

- **Every 4 hours**: Retains the most recent 3 backups
- **Once daily**: Retains the most recent 1 day's backup
- **Once weekly**: Retains the most recent 1 week's backup

Backup files are stored in the `$GRID_HOME/cdata/<cluster_name>/` directory.

**2) Manual Backup**

```bash
# Manual OCR backup
ocrconfig -manualbackup

# View manual backup list
ocrconfig -showbackup manual

node1 2026/06/05 10:30:15 /u01/app/19c/grid/cdata/rac-cluster/backup_20260605_103015.ocr
```

**3) Logical Export**

```bash
# Export OCR to file (recommended before major changes)
ocrconfig -export /tmp/ocr_export_$(date +%Y%m%d).bak
```

> **Best Practice**: Before every CRS change (adding/removing nodes, modifying network configuration), manually execute `ocrconfig -manualbackup` and `ocrconfig -export`. MOS Doc ID 394654.1 details OCR backup and recovery strategies.

#### 2.2.3 OCR Recovery Process

When OCR is corrupted, you can use the following recovery process:

```bash
# 1. Stop CRS on all nodes
crsctl stop crs -f

# 2. Start CRS in exclusive mode on one node
crsctl start crs -excl

# 3. View available OCR backups
ocrconfig -showbackup

# 4. Restore OCR
ocrconfig -restore /u01/app/19c/grid/cdata/rac-cluster/backup_20260604_040000.ocr

# 5. Stop CRS in exclusive mode
crsctl stop crs -f

# 6. Start CRS normally on all nodes
crsctl start crs
```

> **Note**: If using 12c+ and OCR is stored in ASM, ensure the ASM disk group is mounted before recovery.

---

### 2.3 Voting Disk

#### 2.3.1 Voting Disk's Role

The Voting Disk is the "arbiter" of the RAC cluster, serving two core responsibilities:

**1) Node Health Check**

Each node's OCSSD process periodically writes heartbeat information to the Voting Disk (called **disk heartbeat**). If a node fails to write its heartbeat within `Misscount` (default 30 seconds), other nodes consider the node "dead" and evict it from the cluster.

**2) Split Brain Resolution**

When the cluster network experiences partitioning (network split), it's possible for two partitions to each consider themselves "alive." At this point, the Voting Disk's arbitration mechanism comes into play:

- Nodes in each partition attempt to read other nodes' heartbeat information from the Voting Disk
- The partition with the **majority of nodes** (> N/2) wins and continues running
- The minority partition nodes are evicted

```
Node A ──┐           ┌── Node B
Node C ──┤ Net Split ├── Node D
         └───────────┘
Partition 1: 2 nodes → Wins, continues running
Partition 2: 2 nodes → Depends on Voting Disk arbitration result
```

> **Key Parameters**:
> - `Misscount`: Default 30 seconds (configurable in 12c+), node considered dead if heartbeat not written within this time
> - `Disktimeout`: Default 200 seconds, Voting Disk I/O operation timeout
> - `Reboottime`: Wait time after node eviction before reboot, default 3 seconds

#### 2.3.2 Voting Disk Storage Evolution

Similar to OCR, Voting Disk in 11gR2+ is also stored in ASM disk groups:

```bash
# Query Voting Disk location
crsctl query css votedisk

##  STATE    File Universal Id                File Name Disk group
--  -----    -----------------                --------- ---------
 1. ONLINE   a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6 (DATA01) [DATA]
 2. ONLINE   b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7 (DATA02) [DATA]
 3. ONLINE   c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8 (DATA03) [DATA]
Located 3 voting file(s).
```

**Redundancy Requirements:**
- External Redundancy: At least 1 Voting Disk
- Normal Redundancy: At least 3 Voting Disks (recommended)
- High Redundancy: At least 5 Voting Disks

> **Important**: Before 11gR2, Voting Disk could be stored on raw devices or OCFS, requiring manual redundancy management. After 11gR2, Voting Disk redundancy is entirely managed by ASM. MOS Doc ID 1388755.1 details the changes in 11gR2 for Voting Disk storage in ASM.

---

### 2.4 SCAN (Single Client Access Name)

#### 2.4.1 SCAN Principles

SCAN is a client connection abstraction layer introduced in 11gR2. Its core design philosophy is: **decouple client connections from cluster nodes**.

```
Client Application
    │
    ▼
SCAN Name: scan.example.com
    │
    ├── SCAN VIP 1 (192.168.1.100) → SCAN Listener 1 → Node1 Local Listener → Instance1
    ├── SCAN VIP 2 (192.168.1.101) → SCAN Listener 2 → Node2 Local Listener → Instance2
    └── SCAN VIP 3 (192.168.1.102) → SCAN Listener 3 → Node1 Local Listener → Instance1
```

**Key SCAN Characteristics:**

- **3 SCAN VIPs**: Oracle recommends configuring 3 SCAN VIPs, with DNS returning 3 IP addresses (round-robin)
- **2 SCAN Listeners**: By default, Oracle only starts 2 SCAN Listeners (on different nodes), because 2 Listeners can serve 3 VIPs
- **DNS or GNS resolution**: SCAN Name must be resolved through DNS or GNS (Grid Naming Service)

```bash
# Verify SCAN configuration
srvctl config scan

SCAN name: scan.example.com, Network: 1
Subnet IPv4: 192.168.1.0/255.255.255.0/eth0, static
Subnet IPv6:
SCAN 1 IPv4 VIP: 192.168.1.100/255.255.255.0
SCAN 2 IPv4 VIP: 192.168.1.101/255.255.255.0
SCAN 3 IPv4 VIP: 192.168.1.102/255.255.255.0

srvctl config scan_listener

SCAN Listener LISTENER_SCAN1 exists. Port: TCP:1521
SCAN Listener LISTENER_SCAN2 exists. Port: TCP:1521
SCAN Listener LISTENER_SCAN3 exists. Port: TCP:1521
```

#### 2.4.2 Relationship Between SCAN Listener and Local Listener

This is a point of confusion for many DBAs. Understanding this relationship is crucial for performance tuning and troubleshooting:

```
Client → SCAN Listener → Local Listener → Database Instance
```

**Complete Connection Flow:**

1. Client connects to the database using SCAN Name (e.g., `jdbc:oracle:thin:@scan.example.com:1521/service_name`)
2. DNS returns one of the 3 SCAN VIPs (round-robin)
3. Client connects to the corresponding SCAN Listener
4. SCAN Listener selects a Local Listener based on load balancing algorithm
5. SCAN Listener redirects the request to the Local Listener
6. Local Listener establishes the connection with the database instance

```bash
# Check SCAN Listener status
srvctl status scan_listener

SCAN Listener LISTENER_SCAN1 is enabled
SCAN Listener LISTENER_SCAN1 is running on node node2
SCAN Listener LISTENER_SCAN2 is enabled
SCAN Listener LISTENER_SCAN2 is running on node node1
SCAN Listener LISTENER_SCAN3 is enabled
SCAN Listener LISTENER_SCAN3 is running on node node2

# Check Local Listener configuration
srvctl config listener -l LISTENER

Name: LISTENER
Type: Database Listener
Network: 1, Owner: grid
Home: <CRS home>
End points: TCP:1521
Listener is enabled.
Listener is individually enabled on nodes:
Listener is individually disabled on nodes:
```

#### 2.4.3 SCAN Load Balancing Mechanism

SCAN provides two layers of load balancing:

**First Layer: DNS Round-Robin**

When a client resolves the SCAN Name, DNS returns one of the 3 IPs. This is the most basic load distribution mechanism.

**Second Layer: SCAN Listener Intelligent Routing**

SCAN Listener routes connection requests to the node with the lowest load based on each node's load conditions. This information comes from the `Load` metric registered by the PMON process with the Listener.

> **11.2 vs 12c Differences**: 12c introduced the concept of **Remote Listener**, where both Local Listener and SCAN Listener register with Remote Listener, enabling more flexible connection routing. Additionally, 12c's SCAN supports IPv6 and TLS encrypted connections.

#### 2.4.4 SCAN IP Change Process

In production environments, SCAN IP changes are a common requirement (such as network migration). The correct change process is as follows:

```bash
# 1. Stop SCAN-related resources
srvctl stop scan_listener
srvctl stop scan

# 2. Modify SCAN configuration
srvctl modify scan -scanname scan.newdomain.com

# 3. If you need to modify SCAN IP (scenario without DNS)
srvctl modify scan -scanname scan.example.com -netnum 1

# 4. Restart SCAN resources
srvctl start scan
srvctl start scan_listener

# 5. Verify configuration
srvctl config scan
srvctl status scan_listener
```

> **Important**: After modifying SCAN IP, you must simultaneously update DNS records or the `/etc/hosts` file (test environments only). Production environments strongly recommend using DNS resolution.

---

### 2.5 GPNP Profile

#### 2.5.1 GPNP's Role

GPNP (Grid Plug and Play) is a cluster configuration management framework introduced in 11gR2. Its core functions are:

- **Store cluster network configuration**: Node names, network interfaces, IP addresses, etc.
- **Support dynamic node addition/removal**: New nodes automatically obtain configuration when joining the cluster
- **Integration with OUI**: GPNP Profile is automatically created and distributed when installing GI

The GPNP Profile is stored in the `$GRID_HOME/gpnp/<hostname>/profiles/peer/profile.xml` file.

#### 2.5.2 profile.xml File Analysis

```xml
<?xml version="1.0" encoding="UTF-8"?>
<gpn:GpnPProfile
    xmlns:gpnp="http://www.oracle.com/GpnP/Profile"
    version="11.2.0.4.0"
    ...
    <gpnp:Network-Profile>
        <gpnp:HostNetwork id="gen" HostName="node1">
            <gpnp:Network id="net1"
                Adapter="eth0" IP="subnet" Prefix="24"
                Use="cluster_interconnect"/>
            <gpnp:Network id="net2"
                Adapter="eth1" IP="public" Prefix="24"
                Use="public"/>
        </gpnp:HostNetwork>
        <gpnp:Network id="net3"
            Adapter="eth2" IP="192.168.10.0" Prefix="24"
            Use="public"/>
    </gpnp:Network-Profile>
    <orcl:CSS-Profile id="css"
        DiscoveryString="+asm" LeaseDuration="400"/>
    <orcl:ASM-Profile id="asm"
        DiscoveryString="/dev/sd*" SPFile="+CRS/rac-cluster/ASMPARAMETERFILE/registry.253.xxx"/>
</gpn:GpnPProfile>
```

> **Note**: Do not manually modify profile.xml, as this will cause cluster configuration inconsistency. If profile.xml is corrupted, you can use the `gpnptool` tool to obtain the correct version from other nodes.

```bash
# View GPNP Profile
gpnptool get -o- 2>/dev/null | xmllint --format -

# Export GPNP Profile (for troubleshooting)
gpnptool getpval -asm_dis -pval 2>/dev/null
```

---

### 2.6 GI Cluster Startup Process

Understanding GI's startup sequence is key to troubleshooting cluster startup failures. The entire startup process can be divided into the following phases:

```
[OS Boot]
    │
    ▼
[init/systemd starts ohasd.service]
    │
    ▼
OHASD (Oracle High Availability Services Daemon)
    │
    ├──→ CSSDAGENT ──→ OCSSD (Cluster Synchronization Services)
    │                      │
    │                      ├── Read Voting Disk
    │                      ├── Establish inter-node heartbeat
    │                      └── Complete cluster member discovery
    │
    ├──→ ORAROOTAGENT ──→ Network resources (VIP, SCAN VIP, Node VIP)
    │
    ├──→ GPNPD (Grid Plug and Play Daemon)
    │       └── Load profile.xml
    │
    └──→ CTSSD (Cluster Time Synchronization Service)
            └── Time synchronization check
    │
    ▼
[OCSSD Ready, Cluster Members Confirmed]
    │
    ▼
CRSD (Cluster Ready Services Daemon)
    │
    ├──→ Read OCR
    │
    ├──→ ORAROOTAGENT
    │       ├── Start Node VIP
    │       ├── Start SCAN VIP
    │       └── Start Network Resource
    │
    └──→ ORAAGENT (grid user)
            ├── Start ASM instance
            ├── Start SCAN Listener
            └── Start Local Listener
    │
    ▼
[CRSD Ready, Can Manage Database Resources]
    │
    ▼
ORAAGENT (oracle user)
    ├── Start database instance
    ├── Start database Service
    └── Start database Listener (if using independent Listener)
```

#### Daemon Responsibilities

| Process | Full Name | Responsibility |
|---------|-----------|----------------|
| OHASD | Oracle High Availability Services Daemon | Lowest-level daemon, manages all local resources |
| OCSSD | Oracle Cluster Synchronization Services Daemon | Cluster synchronization, node discovery, split-brain arbitration |
| CSSDAGENT | CSS Daemon Agent | Monitors OCSSD health, responsible for node eviction |
| CRSD | Cluster Ready Services Daemon | Manages cluster resources (database, Service, VIP, etc.) |
| CTSSD | Cluster Time Synchronization Service Daemon | Cluster node time synchronization |
| GPNPD | Grid Plug and Play Daemon | Manages GPNP Profile |
| EVMD | Event Manager Daemon | Cluster event management |

#### Key Log Locations

When troubleshooting GI startup issues, pay attention to the following logs:

```bash
# OHASD log (starts first, check first)
$GRID_HOME/log/<hostname>/ohasd/ohasd.log

# OCSSD log (cluster synchronization issues)
$GRID_HOME/log/<hostname>/cssd/ocssd.log

# CRSD log (resource management issues)
$GRID_HOME/log/<hostname>/crsd/crsd.log

# ASM log (ASM instance startup issues)
$GRID_HOME/log/<hostname>/asm/asm_<+ASM1>.log

# ALERT log (cluster-level alerts)
$GRID_HOME/log/<hostname>/alert<hostname>.log

# Node eviction related logs
$GRID_HOME/log/<hostname>/cssd/cssdOUT.log
```

---

## III. Hands-On Operations

### 3.1 OCR Management

#### 3.1.1 Check OCR Status

```bash
# Check OCR integrity
ocrcheck

Status of Oracle Cluster Registry is as follows :
         Version                  :          4
         Total space (kbytes)     :     409600
         Used space (kbytes)      :       3456
         Available space (kbytes) :     406144
         ID                       : 1234567890
         Device/File Name         :       +CRS
                                    Device/File integrity check succeeded

         Device/File not configured

         Device/File not configured

         Device/File not configured

         Device/File not configured

         Cluster registry integrity check succeeded

         Logical corruption check bypassed due to insufficient quorum
```

> **Interpretation**: In 12c+, OCR is stored in ASM disk groups, and `Device/File Name` shows the disk group name (e.g., `+CRS`). If Normal Redundancy is configured, ASM automatically maintains 3 OCR copies.

#### 3.1.2 OCR Backup

```bash
# Manual OCR backup
ocrconfig -manualbackup

node1     2026/06/05 10:30:15     /u01/app/19c/grid/cdata/rac-cluster/backup_20260605.ocr
node2     2026/06/04 22:00:10     /u01/app/19c/grid/cdata/rac-cluster/backup_20260604.ocr

# View automatic backups
ocrconfig -showbackup auto

node1     2026/06/05 06:00:00     /u01/app/19c/grid/cdata/rac-cluster/backup00.ocr
node1     2026/06/05 02:00:00     /u01/app/19c/grid/cdata/rac-cluster/backup01.ocr
node1     2026/06/04 22:00:00     /u01/app/19c/grid/cdata/rac-cluster/backup02.ocr
node1     2026/06/04 18:00:00     /u01/app/19c/grid/cdata/rac-cluster/day.ocr
node1     2026/05/29 06:00:00     /u01/app/19c/grid/cdata/rac-cluster/week.ocr

# Logical export of OCR (recommended to do regularly)
ocrconfig -export /tmp/ocr_export_20260605.bak
```

#### 3.1.3 Adding/Removing OCR Mirror

```bash
# View current OCR configuration
ocrcheck
# Assuming current OCR is in +CRS disk group, need to add mirror to +DATA disk group

# Add OCR to another ASM disk group (use ocrconfig -add in 12c+)
ocrconfig -add +DATA

# Verify addition was successful
ocrcheck

Status of Oracle Cluster Registry is as follows :
         Version                  :          4
         Total space (kbytes)     :     409600
         Used space (kbytes)      :       3456
         Available space (kbytes) :     406144
         ID                       : 1234567890
         Device/File Name         :       +CRS
                                    Device/File integrity check succeeded
         Device/File Name         :       +DATA
                                    Device/File integrity check succeeded

# Remove OCR mirror (Note: cannot remove the last OCR copy)
ocrconfig -delete +DATA
```

> **MOS Reference**: Doc ID 394654.1 - OCR / Voting Disk Location and Management

---

### 3.2 Voting Disk Management

#### 3.2.1 View Voting Disk Status

```bash
crsctl query css votedisk

##  STATE    File Universal Id                File Name Disk group
--  -----    -----------------                --------- ---------
 1. ONLINE   a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6 (DATA01) [DATA]
 2. ONLINE   b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7 (DATA02) [DATA]
 3. ONLINE   c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8 (DATA03) [DATA]
Located 3 voting file(s).
```

#### 3.2.2 Adding/Removing Voting Disk

```bash
# Add Voting Disk to another ASM disk group
crsctl add css votedisk +FLASH

# Remove Voting Disk
crsctl delete css votedisk a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6

# Note: In 11gR2+, if Voting Disk is stored in an ASM disk group,
# the number of Voting Disks is determined by the disk group's redundancy level
# and cannot be manually increased or decreased.
# You can only migrate Voting Disk to another disk group with a different redundancy level.
```

> **Important**: In 11gR2+, if Voting Disk is stored in a Normal Redundancy ASM disk group, ASM automatically maintains 3 Voting Disk copies. You cannot manually add or delete individual Voting Disks; you can only migrate the Voting Disk entirely to another disk group.

---

### 3.3 SCAN Management

#### 3.3.1 View SCAN Configuration

```bash
# View SCAN configuration
srvctl config scan

SCAN name: scan.example.com, Network: 1
Subnet IPv4: 192.168.1.0/255.255.255.0/eth0, static
Subnet IPv6:
SCAN 1 IPv4 VIP: 192.168.1.100/255.255.255.0
SCAN 2 IPv4 VIP: 192.168.1.101/255.255.255.0
SCAN 3 IPv4 VIP: 192.168.1.102/255.255.255.0

# Check SCAN Listener status
srvctl status scan_listener

SCAN Listener LISTENER_SCAN1 is enabled
SCAN Listener LISTENER_SCAN1 is running on node node2
SCAN Listener LISTENER_SCAN2 is enabled
SCAN Listener LISTENER_SCAN2 is running on node node1
SCAN Listener LISTENER_SCAN3 is enabled
SCAN Listener LISTENER_SCAN3 is running on node node2

# Verify DNS resolution
nslookup scan.example.com

Server:         192.168.1.1
Address:        192.168.1.1#53

Name:   scan.example.com
Address: 192.168.1.100
Name:   scan.example.com
Address: 192.168.1.101
Name:   scan.example.com
Address: 192.168.1.102
```

#### 3.3.2 Complete SCAN IP Change Process

```bash
# Step 1: Update DNS records (operate on DNS server)
# Modify the A record for scan.example.com to the new IP address

# Step 2: Stop SCAN-related resources
srvctl stop scan_listener
srvctl stop scan

# Step 3: Modify SCAN configuration (if SCAN Name changes)
srvctl modify scan -scanname scan.newdomain.com

# Step 4: Update SCAN VIP (if IP address changes, need to get resource name first)
srvctl modify scan -scanname scan.example.com

# Step 5: Restart SCAN resources
srvctl start scan
srvctl start scan_listener

# Step 6: Verify
srvctl status scan
srvctl status scan_listener
nslookup scan.example.com
```

---

### 3.4 GI Startup Diagnostics

#### 3.4.1 Startup Failure Diagnostic Process

When GI fails to start, follow this order for troubleshooting:

```bash
# Step 1: Check OHASD log
tail -100 $GRID_HOME/log/$(hostname)/ohasd/ohasd.log

# Step 2: Check cluster alert log
tail -100 $GRID_HOME/log/$(hostname)/alert$(hostname).log

# Step 3: Check OCSSD log (if cluster synchronization fails)
tail -100 $GRID_HOME/log/$(hostname)/cssd/ocssd.log

# Step 4: Check CRS resource status
crsctl stat res -t -init

# Step 5: Check ASM instance status
srvctl status asm

# Step 6: Check disk group status
asmcmd lsdg
```

#### 3.4.2 Log Collection Tool

Oracle provides the `diagcollection.sh` tool, which can collect all GI-related logs with one command:

```bash
# Collect all GI logs (requires root privileges)
$GRID_HOME/bin/diagcollection.pl --collect --crs --crshome $GRID_HOME

# Collection results are packaged as .tar.gz files, typically in /tmp directory
# Filename format: crsData_<hostname>_<timestamp>.tar.gz
```

#### 3.4.3 Emergency Startup Mode

When CRS cannot start normally, you can use exclusive mode for emergency operations:

```bash
# Start CRS in exclusive mode (skips OCR and Voting Disk cluster checks)
crsctl start crs -excl

# In exclusive mode, you can perform the following operations:
# - Recover OCR
# - Modify network configuration
# - Repair ASM disk groups

# After completing repairs, stop CRS
crsctl stop crs -f

# Start CRS normally
crsctl start crs
```

> **Note**: `crsctl start crs -excl` starts a simplified CRS stack on the current node without performing cluster member verification. This is very useful when OCR or Voting Disk is corrupted.

#### 3.4.4 Common Startup Failures and Solutions

**Failure 1: OHASD Cannot Start**

```bash
# Symptoms: crsctl start crs reports error
# CRS-4640: Oracle High Availability Services is already active
# CRS-4000: Start command failed, or completed with errors.

# Solution:
crsctl stop crs -f
# If cannot stop, use kill
kill -9 $(pgrep -f ohasd)
# Restart
crsctl start crs
```

**Failure 2: OCSSD Cannot Join Cluster**

```bash
# Symptoms: ocssd.log shows
# CSSD]clssnmvDHBValidateNCopy: node 1, node1, has a disk HB, but no network HB
# CSSD]clssnmvDHBValidateNCopy: node 2, node2, has a disk HB, but no network HB

# Solution: Check network connectivity and firewall
# Check if private network is reachable
ping -c 3 <node2-priv-ip>
# Check if firewall allows traffic
iptables -L -n | grep 1521
```

**Failure 3: CRSD Startup Failure (OCR Inaccessible)**

```bash
# Symptoms: crsd.log shows
# CRS-1205: Auto-start failed for the CRS stack.
# CRS-2883: Resource 'ora.asm' failed during Clusterware stack start.

# Solution: Start in exclusive mode, check ASM disk group status
crsctl start crs -excl
asmcmd lsdg
# If ASM disk group needs repair
sqlplus / as sysasm
ALTER DISKGROUP DATA MOUNT;
```

---

## IV. Result Verification

After GI installation or changes, execute the following verification commands to confirm the cluster status is normal:

```bash
# 1. Check overall cluster status
crsctl check cluster -all

node1:
CRS-4537: Cluster Ready Services is online
CRS-4529: Cluster Synchronization Services is online
CRS-4533: Event Manager is online

node2:
CRS-4537: Cluster Ready Services is online
CRS-4529: Cluster Synchronization Services is online
CRS-4533: Event Manager is online

# 2. Check OCR integrity
ocrcheck

Status of Oracle Cluster Registry is as follows :
         Version                  :          4
         Total space (kbytes)     :     409600
         Used space (kbytes)      :       3456
         Available space (kbytes) :     406144
         ID                       : 1234567890
         Device/File Name         :       +CRS
                                    Device/File integrity check succeeded
         Cluster registry integrity check succeeded

# 3. Check Voting Disk status
crsctl query css votedisk

##  STATE    File Universal Id                File Name Disk group
--  -----    -----------------                --------- ---------
 1. ONLINE   a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6 (DATA01) [DATA]
 2. ONLINE   b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7 (DATA02) [DATA]
 3. ONLINE   c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8 (DATA03) [DATA]
Located 3 voting file(s).

# 4. Check SCAN Listener status
srvctl status scan_listener

SCAN Listener LISTENER_SCAN1 is enabled
SCAN Listener LISTENER_SCAN1 is running on node node2
SCAN Listener LISTENER_SCAN2 is enabled
SCAN Listener LISTENER_SCAN2 is running on node node1
SCAN Listener LISTENER_SCAN3 is enabled
SCAN Listener LISTENER_SCAN3 is running on node node2

# 5. Check all CRS resource status
crsctl stat res -t

# 6. Check ASM disk group status
asmcmd lsdg

# 7. Check inter-node network connectivity
oifcfg getif
eth0  192.168.1.0  global  public
eth1  10.10.10.0   global  cluster_interconnect
```

---

## V. Lessons Learned

### 5.1 GI Daily Inspection Key Points

It is recommended to include the following commands in your daily inspection script:

```bash
#!/bin/bash
# GI daily inspection script

echo "=== Cluster Status Check ==="
crsctl check cluster -all

echo "=== OCR Status Check ==="
ocrcheck

echo "=== Voting Disk Status Check ==="
crsctl query css votedisk

echo "=== SCAN Listener Status ==="
srvctl status scan_listener

echo "=== ASM Disk Group Status ==="
asmcmd lsdg

echo "=== CRS Resource Status ==="
crsctl stat res -t

echo "=== Cluster Alert Log Last 50 Lines ==="
tail -50 $GRID_HOME/log/$(hostname)/alert$(hostname).log
```

### 5.2 OCR/Voting Disk Backup Strategy

| Backup Item | Frequency | Retention Policy | Tool |
|-------------|-----------|------------------|------|
| OCR automatic backup | Every 4 hours | Retain most recent 3 | CRSD automatic |
| OCR manual backup | Before every change | Retain permanently | `ocrconfig -manualbackup` |
| OCR logical export | Once weekly | Retain most recent 4 weeks | `ocrconfig -export` |
| GPNP Profile | Before every change | Retain permanently | `gpnptool get` |

### 5.3 SCAN Configuration Best Practices

1. **Always use DNS for SCAN Name resolution**, never use `/etc/hosts` in production
2. **Configure 3 SCAN VIPs**, ensuring DNS returns 3 IP addresses
3. **Regularly verify DNS resolution**: `nslookup scan.example.com` should return 3 IPs
4. **Use port 1521 uniformly for SCAN Listener**, to avoid complicating application connection configuration
5. **Do not bind SCAN VIP to specific nodes**, let Oracle automatically manage SCAN Listener distribution

### 5.4 Quick Diagnosis for Common GI Failures

| Failure Symptom | Possible Cause | Investigation Direction |
|----------------|---------------|------------------------|
| CRS startup failure | OCR corruption | Check ohsd.log, crsd.log |
| Frequent node evictions | Network jitter/storage timeout | Check cssd.log, review Misscount |
| SCAN IP unresolvable | DNS configuration error | nslookup, check DNS records |
| ASM instance cannot start | Disk group corruption | Check asm alert log, asmcmd lsdg |
| VIP drift anomaly | Network configuration error | oifcfg getif, check NIC configuration |
| Cluster time out of sync | NTP/CTSS configuration issue | Check ctssd.log, check clock offset |

### 5.5 Recommended MOS Documents

| Doc ID | Title | Applicable Scenario |
|--------|-------|---------------------|
| 394654.1 | OCR / Voting Disk Location and Management | OCR/Voting Disk management |
| 1068982.1 | How to restore OCR from backup | OCR recovery |
| 1388755.1 | Changes in 11.2.0.2 with Voting Disk on ASM | Voting Disk storage changes |
| 1481369.1 | SCAN VIP and Listener Configuration | SCAN configuration |
| 1323538.1 | 11gR2 Clusterware Startup Sequence | Cluster startup sequence |

---

## Summary

GI is the core of the RAC architecture, and deeply understanding its underlying mechanisms is crucial for DBAs. This article systematically analyzes GI's internal workings from five dimensions: OCR, Voting Disk, SCAN, GPNP, and cluster startup process, providing rich hands-on commands and troubleshooting methods.

**Core Takeaways:**

1. **OCR** is the cluster configuration center, stored in ASM in 12c+, protected by ASM redundancy mechanisms
2. **Voting Disk** is the cluster arbiter, responsible for node health checks and split-brain resolution
3. **SCAN** is the client connection abstraction layer, achieving load balancing through DNS resolution and SCAN Listener
4. **GPNP** stores cluster network configuration, supporting dynamic node management
5. **Cluster startup** has strict order dependencies: OHASD → CSSDAGENT → OCSSD → CRSD

Mastering this knowledge not only helps you quickly locate problems during production failures but also enables you to make wiser decisions during architecture design and capacity planning. As an OCM-certified DBA, I firmly believe: **Deeply understanding underlying principles is what distinguishes senior DBAs from average DBAs.**
