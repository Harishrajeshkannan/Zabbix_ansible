# Backend Server for Zabbix Agent Deployment (RHEL)

This backend server handles Zabbix Agent installation, version management, and action logging for RHEL-based systems.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Start the backend server:
```bash
npm run server
```

The server will run on `http://localhost:3001`

## Running Both Frontend and Backend

To run both frontend and backend simultaneously:
```bash
npm run dev:full
```

This will start:
- Frontend on `http://localhost:5173`
- Backend on `http://localhost:3001`

## API Endpoints

### POST /api/log-action
Create a log file for install/update action

**Request Body:**
```json
{
  "action": "install",  // or "update"
  "hostname": "server1.example.com",
  "version": "7.4.5",
  "currentVersion": "7.0.0"  // only for update
}
```

**Response:**
```json
{
  "success": true,
  "message": "Installed successfully",
  "logFile": "server1_install_2025-12-16T10-30-00.txt",
  "fullPath": "/path/to/agent-logs/server1_install_2025-12-16T10-30-00.txt"
}
```

### POST /api/install-remote
Runs the Ansible installation playbook for a single host and writes a dedicated log file for that request.

The response includes `logFile` and `fullPath` so each install run can be tracked separately.

Install run logs are written under `agent-logs/installs/`.

### GET /api/logs
Get list of all log files

### GET /api/health
Health check endpoint

## Log Files

Log files are created in the `agent-logs` directory in the project root.

Each file contains:
- Hostname
- Action (INSTALL/UPDATE)
- Version information
- Timestamp
- Status message

Example log file content:
```
Host: server1.example.com
Action: INSTALL
Version: 7.4.5
Timestamp: 2025-12-16T10:30:00.000Z
Status: Successfully installed Zabbix Agent
```
