# Deployment Instructions for Localhost Installation

## Important: Admin Rights Required

The localhost installation feature requires the server to run with Administrator privileges because it:
- Creates directories (C:\ZabbixInstall)
- Downloads MSI packages
- Installs software (msiexec.exe)
- Manages Windows services

## How to Run the Server as Administrator

### Option 1: Using the Admin Script (Recommended)
```powershell
npm run server:admin
```
This will:
1. Request UAC elevation (click "Yes")
2. Start the server with admin rights
3. Enable localhost installation

### Option 2: Manual Elevation
1. Right-click Visual Studio Code
2. Select "Run as Administrator"
3. Open the project folder
4. Run `npm run server` in the terminal

### Option 3: PowerShell Direct
```powershell
cd "c:\Users\k64169133\OneDrive - KONE Corporation\Documents\Zabbix_Deployment_Portal\Zabbix-Deployment-Portal"
powershell -ExecutionPolicy Bypass -File start-server-admin.ps1
```

## Verifying Admin Rights

When the server starts, you should see:
```
✅ Running with Administrator privileges
```

If you see:
```
⚠️ Server requires Administrator privileges for localhost installation feature
```
Then the server is not running as admin and localhost installation will fail.

## Common Issues

### "Access is denied" Error
**Cause**: Server is not running with admin rights
**Solution**: Stop the server and restart using one of the admin methods above

### UAC Prompt Dismissed
**Cause**: Clicking "No" on the UAC elevation prompt
**Solution**: Restart the server and click "Yes" when UAC prompts

### Domain Credentials
**Note**: The admin username/password fields in the installation modal are legacy fields from a previous implementation. The current implementation requires the **entire server** to run as admin, not individual credentials.

## Production Deployment

For production environments:
1. Run VS Code or the Node.js process as Administrator
2. Configure Windows to allow the service account to run elevated processes
3. Consider using Group Policy to pre-deploy Zabbix agents instead of on-demand installation
