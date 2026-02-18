# Running the Server with Admin Privileges

For the localhost installation feature to work, the backend server needs to run with Administrator privileges.

## Quick Start

### Option 1: Using NPM Script (Recommended)
```bash
npm run server:admin
```
This will:
1. Automatically request admin privileges (UAC prompt will appear)
2. Start the server with elevated rights
3. Allow localhost agent installation to work

### Option 2: Manual PowerShell
```powershell
powershell -ExecutionPolicy Bypass -File start-server-admin.ps1
```

### Option 3: Right-click the Script
1. Right-click `start-server-admin.ps1`
2. Select "Run with PowerShell"
3. Click "Yes" on the UAC prompt

## Why Admin Rights Are Required

Windows security requires administrator privileges to:
- Create scheduled tasks with elevated permissions
- Install MSI packages system-wide
- Modify Windows services (start/stop Zabbix Agent)
- Write to Program Files directory

## Localhost Installation Credentials

When installing on localhost, use credentials in this format:
- **Domain user**: `DOMAIN\username` (e.g., `konenet\k64169133_T3`)
- **Local admin**: `.\username` or `COMPUTERNAME\username`

## Note

This elevated server is only needed when using the **localhost installation feature**. 
For regular Zabbix host management (non-localhost), you can run the server normally with `npm run server`.
