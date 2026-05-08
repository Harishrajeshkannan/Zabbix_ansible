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
- **Backend Access**: Node.js service configured to run Ansible playbooks
- **Shell Access**: Bash shell access to the Ansible controller
- **Package Management**: Access to install system packages on the target host

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
sudo yum install -y curl wget git || sudo dnf install -y curl wget git
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

The system uses **Ansible connection credentials** configured in the backend environment:

- **Target Host User**: Set `ANSIBLE_SSH_USER`
- **Password or Key**: Set `ANSIBLE_SSH_PASSWORD` or `ANSIBLE_SSH_PRIVATE_KEY_FILE`
- **Audit Logging**: All actions are logged by the backend and Ansible output is returned to the UI

See [server/SECURITY_SETUP.md](server/SECURITY_SETUP.md) and the root `.env.example` for setup details.

## Security Features

- **Ansible Controller**: Playbooks execute from the backend against target hosts
- **Input Validation**: Strict regex patterns prevent command injection
- **Direct Execution**: No temporary scripts or intermediate files
- **Repository Verification**: Uses official Zabbix GPG-signed packages
- **Service Isolation**: Zabbix agent runs as dedicated zabbix user
- **No HTTP Passwords**: Zero credential transmission over network

## Ansible Deployment

The backend invokes Ansible playbooks directly. There is no separate shell-script deployment path.

## Troubleshooting

### Common Issues

#### Permission Denied
```bash
# Verify the controller environment has Ansible credentials
env | grep '^ANSIBLE_SSH_'

# Verify the target host is reachable from the controller
ansible -i 'your-host,' all -m ping
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
# SSH Connection Settings
ANSIBLE_SSH_USER=your_remote_user
ANSIBLE_SSH_PASSWORD=your_password
ANSIBLE_SSH_PORT=22
# OR use key-based authentication:
ANSIBLE_SSH_PRIVATE_KEY_FILE=/path/to/private/key

# Ensure proper permissions
chmod 600 .env
```

### 3. Firewall Configuration
```bash
# Allow web interface access (adjust network as needed)
sudo firewall-cmd --permanent --add-rich-rule='rule family="ipv4" source address="192.168.1.0/24" port protocol="tcp" port="3001" accept'
sudo firewall-cmd --reload
```

## Important Notes

### Security Configuration

This system uses **Ansible host authentication** for automation:

1. **Secure by Design**: Credentials are stored in the backend environment
2. **No Passwords In UI**: Authentication is handled server-side by the controller
3. **Audit Trail**: All actions are logged by the backend and Ansible output
4. **Easy Setup**: Configure `ANSIBLE_SSH_*` values in the backend environment

The user interface provides a clean, modern experience for deploying Zabbix agents to RHEL servers using native package management.
