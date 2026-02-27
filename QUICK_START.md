# Zabbix Deployment Portal - Quick Start Guide

Get up and running with the Zabbix Deployment Portal for RHEL systems in minutes.

## Prerequisites

### System Requirements
- **RHEL-based OS**: RHEL 7/8/9, CentOS, Rocky Linux, or AlmaLinux
- **Node.js**: Version 16 or higher
- **npm**: Comes with Node.js
- **Internet Access**: For downloading packages and repositories
- **Sudo User**: With password for system installations

### Check Prerequisites
```bash
# Check Node.js version
node --version  # Should be 16+

# Check if you're on RHEL-based system
cat /etc/redhat-release

# Test sudo access
sudo whoami
```

## Installation

### 1. Clone the Repository
```bash
git clone <your-repository-url>
cd Zabbix-Deployment-Portal
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Install System Dependencies
```bash
# Install expect (needed for password automation)
sudo yum install -y expect || sudo dnf install -y expect

# Ensure curl and wget are available
sudo yum install -y curl wget || sudo dnf install -y curl wget
```

## Running the Application

### Option 1: Full Development Mode (Recommended)
```bash
npm run dev:full
```
This starts both frontend and backend servers:
- **Frontend**: http://localhost:5173
- **Backend**: http://localhost:3001

### Option 2: Start Services Separately
```bash
# Terminal 1: Start backend
npm run server

# Terminal 2: Start frontend
npm run dev
```

## First Use

### 1. Access the Portal
Open your browser and go to: **http://localhost:5173**

### 2. Check System Information
The dashboard will show:
- Current OS and RHEL version
- Zabbix agent installation status
- Available sudo access

### 3. Install Zabbix Agent
1. **Select Version**: Choose a Zabbix Agent version (7.0.5 recommended)
2. **Configure Server**: 
   - Enter your Zabbix server IP/hostname
   - Set server port (default: 10051)
   - Choose a hostname for this agent
3. **Security (Optional)**:
   - Enable PSK encryption if needed
   - Set PSK key and identity
4. **Credentials**:
   - Enter sudo username
   - Enter sudo password
5. **Install**: Click "Install Agent"

### 4. Verify Installation
After installation:
- Check the installation logs
- Verify service is running: `sudo systemctl status zabbix-agent2`
- Test connectivity to Zabbix server

## Configuration Examples

### Basic Installation (No Encryption)
- Version: `7.0.5`
- Server: `192.168.1.100`
- Hostname: `myserver.local`
- PSK: Leave empty

### Secure Installation (With PSK)
- Version: `7.0.5`
- Server: `zabbix.company.com`
- Hostname: `prod-server-01`
- PSK Key: `your-secret-psk-key-here`
- PSK Identity: `prod-server-01`

## Manual Script Usage

You can also run the installation script directly:

### Interactive Mode
```bash
cd server
chmod +x install-zabbix-rhel.sh
./install-zabbix-rhel.sh
```

### Command Line Mode
```bash
./install-zabbix-rhel.sh 7.0.5 192.168.1.100 myserver 10051 "psk-key" "psk-identity"
```

## Troubleshooting

### Common Issues

#### "Permission denied" errors
```bash
# Check sudo access
sudo -l

# Verify user is in sudo group
groups $USER
```

#### "Command not found: expect"
```bash
# Install expect
sudo yum install -y expect || sudo dnf install -y expect
```

#### Frontend not loading
```bash
# Check if port 5173 is available
netstat -tlnp | grep :5173

# Try different port
npm run dev -- --port 3000
```

#### Backend connection errors
```bash
# Check if backend is running
curl http://localhost:3001/api/health

# Check system info endpoint
curl http://localhost:3001/api/system-info
```

#### Repository errors during installation
```bash
# Update system packages
sudo yum update -y || sudo dnf update -y

# Check internet connectivity
ping -c 3 repo.zabbix.com
```

### Getting Help

1. **Check Logs**: View installation logs in the web interface
2. **System Logs**: `sudo journalctl -u zabbix-agent2 -f`
3. **Manual Test**: Run the installation script manually
4. **Network**: Verify connectivity to Zabbix server and repositories

## What's Next?

- **Configure Monitoring**: Add hosts and items in your Zabbix server
- **Set Up Alerts**: Configure triggers and notifications
- **Scale Deployment**: Use the portal to install agents on multiple servers
- **Monitor Logs**: Regular check installation logs and agent status

## Development Mode

For developers wanting to modify the application:

```bash
# Install in development mode
npm run dev:full

# Make changes to:
# - Frontend: src/ directory
# - Backend: server/ directory
# - Installation script: server/install-zabbix-rhel.sh

# Changes will auto-reload in development mode
```

## Security Notes

- **Sudo Passwords**: Stored temporarily in memory only during installation
- **PSK Keys**: Generated locally, not transmitted to external servers
- **Network**: All RHEL package installations use official Zabbix repositories
- **Logs**: Installation logs are stored locally in `agent-logs/` directory

---

🎉 **You're all set!** The Zabbix Deployment Portal is now ready to deploy agents on your RHEL infrastructure.
