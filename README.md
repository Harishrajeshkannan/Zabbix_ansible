# Zabbix Deployment Portal

A web application for deploying Zabbix Agent 2 on RHEL-based systems (RHEL, CentOS, Rocky Linux, AlmaLinux).

## Overview

This portal provides a simple web interface to install and manage Zabbix Agent 2 on RHEL servers. The application consists of:

- **Frontend**: React-based web interface built with Vite
- **Backend**: Node.js/Express server with installation APIs
- **Installation**: Shell scripts for automated RHEL installation

## Features

- 🐧 **RHEL Support**: Compatible with RHEL 7, 8, and 9
- 📦 **Repository Installation**: Uses official Zabbix repositories
- 🔐 **Secure Authentication**: PSK encryption support
- 📊 **Version Management**: Support for multiple Zabbix versions
- 📋 **Installation Logging**: Detailed logs and status tracking
- 🔧 **System Information**: Display OS and installation status

## Requirements

### Server Requirements
- RHEL-based operating system (RHEL, CentOS, Rocky, AlmaLinux)
- Node.js 16+ and npm
- Internet connectivity for package downloads
- Passwordless sudo configured for installation script

### System Dependencies
- `bash` shell  
- Network connectivity to Zabbix repositories
- Configure passwordless sudo (see [server/SECURITY_SETUP.md](server/SECURITY_SETUP.md))

## Quick Start

### 1. Clone and Install
```bash
git clone <repository-url>
cd Zabbix-Deployment-Portal
npm install
```

### 2. Start the Application
```bash
# Development mode (frontend + backend)
npm run dev:full

# Or start components separately
npm run dev      # Frontend only
npm run server   # Backend only
```

### 3. Access the Portal
- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost:3001

## Installation Process

1. **Select Version**: Choose from available Zabbix Agent versions
2. **Configure Settings**: Set server IP, hostname, and encryption
3. **Provide Credentials**: Enter sudo user and password
4. **Install**: Automated installation via RHEL repositories
5. **Verify**: Check service status and connectivity

## Configuration

### Environment Variables
Create `.env` file in the root directory:
```env
# Optional: Customize default settings
ZABBIX_DEFAULT_VERSION=7.0.5
ZABBIX_DEFAULT_PORT=10051
```

### Manual Installation
You can also run the installation script directly:
```bash
# Make script executable
chmod +x server/install-zabbix-rhel.sh

# Interactive installation
./server/install-zabbix-rhel.sh

# Command line installation
./server/install-zabbix-rhel.sh 7.0.5 192.168.1.100 myserver.local 10051 "psk-key" "psk-identity"
```

## API Endpoints

- `GET /api/health` - Server health check
- `GET /api/agent-versions` - Available Zabbix versions
- `GET /api/system-info` - RHEL system information
- `POST /api/install-localhost` - Install Zabbix agent
- `GET /api/logs` - Installation logs
- `POST /api/cleanup-temp` - Clean temporary files

## File Structure

```
Zabbix-Deployment-Portal/
├── src/                    # React frontend
├── server/                 # Node.js backend
│   ├── index.js           # Main server file
│   ├── install-zabbix-rhel.sh # RHEL installation script
│   ├── setup-sudo.sh      # Passwordless sudo setup
│   └── SECURITY_SETUP.md  # Security configuration guide
├── agent-logs/            # Installation logs
├── package.json
└── README.md
```

## Platform Architecture

This application is built for **RHEL-based Linux systems**:

- ✅ **Native RHEL Support**: Uses yum/dnf package managers
- ✅ **Repository-based**: Official Zabbix repositories
- ✅ **Secure Installation**: Signed packages from trusted sources
- ✅ **Standard Package Management**: Integrates with RHEL ecosystem
- ✅ **Passwordless Sudo**: Industry-standard automation pattern

## Troubleshooting

### Common Issues

1. **Passwordless Sudo Not Configured**
   - Run: `cd server && ./setup-sudo.sh`
   - See: PASSWORDLESS_SUDO_QUICKSTART.md

2. **Repository Not Found**
   - Verify RHEL version compatibility
   - Check internet connectivity to repo.zabbix.com

3. **Service Start Failed**
   - Check configuration in `/etc/zabbix/zabbix_agent2.conf`
   - Verify firewall settings (port 10050)

### Useful Commands
```bash
# Check Zabbix agent status
sudo systemctl status zabbix-agent2

# View agent logs
sudo journalctl -u zabbix-agent2 -f

# Test configuration
sudo -u zabbix zabbix_agent2 -t zabbix.agent.ping

# Check firewall
sudo firewall-cmd --list-ports
```

## Development

### Local Development
```bash
# Install dependencies
npm install

# Start development server
npm run dev:full
```

### Adding Features
1. Backend changes: Modify `server/index.js`
2. Frontend changes: Modify files in `src/`
3. Installation logic: Update `server/install-zabbix-rhel.sh`

## License

This project is licensed under the MIT License.

## Support

For issues and feature requests, please check the documentation files:
- [Quick Start Guide](QUICK_START.md)
- [Setup Guide](SETUP_GUIDE.md)
- [Deployment Instructions](DEPLOYMENT_INSTRUCTIONS.md)
