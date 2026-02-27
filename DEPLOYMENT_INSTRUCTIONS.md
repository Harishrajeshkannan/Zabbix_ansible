# Zabbix Deployment Portal - RHEL Deployment Instructions

This guide provides detailed instructions for deploying the Zabbix Agent deployment portal on RHEL-based systems.

## Overview

The Zabbix Deployment Portal now runs natively on RHEL systems and installs Zabbix agents using official repositories instead of MSI packages. This approach provides:

- ✅ **Native Linux Operation**: No Windows dependencies
- ✅ **Repository-based Installation**: Uses official Zabbix YUM/DNF repositories  
- ✅ **Better Security**: Signed packages, no MSI downloads
- ✅ **Simplified Management**: Standard Linux package management

## System Requirements

### Server Requirements
- **Operating System**: RHEL 7/8/9, CentOS 7/8, Rocky Linux 8/9, AlmaLinux 8/9
- **Node.js**: Version 16.0 or higher
- **Memory**: Minimum 512MB RAM (1GB+ recommended)
- **Disk Space**: At least 1GB free space
- **Network**: Internet connectivity for package repositories

### User Requirements
- **Sudo Access**: User must have sudo privileges with password
- **Shell Access**: Bash shell access to the server
- **Package Management**: Access to install system packages

### Network Requirements
- **Outbound HTTP/HTTPS**: Access to repo.zabbix.com (port 80/443)
- **Zabbix Server**: Connectivity to Zabbix server (typically port 10051)
- **Agent Port**: Zabbix server must reach agent port 10050

## Quick Start

### 1. Install Prerequisites
```bash
# Update system
sudo yum update -y || sudo dnf update -y

# Install Node.js (if needed)
curl -sL https://rpm.nodesource.com/setup_18.x | sudo bash -
sudo yum install -y nodejs || sudo dnf install -y nodejs

# Install system dependencies
sudo yum install -y expect curl wget git || sudo dnf install -y expect curl wget git
```

### 2. Deploy Application
```bash
# Clone and install
git clone <repository-url>
cd Zabbix-Deployment-Portal
npm install

# Start the application
npm run dev:full
```

### 3. Access Portal
- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost:3001

## Installation Process

The portal now uses a native RHEL installation approach:

### 1. **Repository Setup**: Automatically adds official Zabbix repositories
### 2. **Package Installation**: Uses yum/dnf to install zabbix-agent2
### 3. **Configuration**: Updates /etc/zabbix/zabbix_agent2.conf
### 4. **Service Management**: Enables and starts systemd service
### 5. **Firewall**: Configures firewalld rules if needed

## Authentication

Instead of Windows admin credentials, the system now requires:
- **Sudo User**: Linux username with sudo privileges
- **Sudo Password**: Password for the sudo user

## Security Features

- **Sudo Password Automation**: Uses `expect` to handle password prompts
- **Temporary Scripts**: Installation scripts are cleaned up after use
- **Repository Verification**: Uses official Zabbix GPG-signed packages
- **Service Isolation**: Zabbix agent runs as dedicated zabbix user

## Manual Installation

You can also run the installation script directly:

```bash
# Make script executable
chmod +x server/install-zabbix-rhel.sh

# Interactive mode
./server/install-zabbix-rhel.sh

# Command line mode
./server/install-zabbix-rhel.sh 7.0.5 192.168.1.100 myserver 10051 "psk-key" "psk-identity"
```

## Troubleshooting

### Common Issues

#### Permission Denied
```bash
# Verify sudo access
sudo -l

# Check user groups
groups $USER
```

#### Repository Errors
```bash
# Check internet connectivity
ping -c 3 repo.zabbix.com

# Update package cache
sudo yum clean all || sudo dnf clean all
```

#### Service Start Failures
```bash
# Check service status
sudo systemctl status zabbix-agent2

# View detailed logs
sudo journalctl -u zabbix-agent2 -f

# Test configuration
sudo -u zabbix zabbix_agent2 -t zabbix.agent.ping
```

## Production Deployment

For production environments:

### 1. System Service
```bash
# Create systemd service for the portal
sudo tee /etc/systemd/system/zabbix-portal.service > /dev/null <<EOF
[Unit]
Description=Zabbix Deployment Portal
After=network.target

[Service]
Type=simple
User=zabbix-portal
WorkingDirectory=/opt/zabbix-portal
ExecStart=/usr/bin/node server/index.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl enable zabbix-portal
sudo systemctl start zabbix-portal
```

### 2. Security Hardening
```bash
# Create dedicated user
sudo useradd -r -s /bin/bash zabbix-portal

# Configure sudo access (minimal permissions)
echo "zabbix-portal ALL=(ALL) NOPASSWD: /usr/bin/yum install zabbix-agent2, /usr/bin/dnf install zabbix-agent2, /usr/bin/systemctl * zabbix-agent2" | sudo tee /etc/sudoers.d/zabbix-portal
```

### 3. Firewall Configuration
```bash
# Allow web interface access (adjust network as needed)
sudo firewall-cmd --permanent --add-rich-rule='rule family="ipv4" source address="192.168.1.0/24" port protocol="tcp" port="3001" accept'
sudo firewall-cmd --reload
```

## Migration Notes

If migrating from the Windows-based version:

1. **No More MSI Files**: Uses native Linux packages
2. **No PowerShell**: Pure bash scripts
3. **Repository-based**: More secure and maintainable
4. **Native Linux**: Better integration with RHEL ecosystem

The user interface remains the same, but the backend now uses RHEL-native installation methods.
