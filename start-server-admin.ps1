# Zabbix Portal Server - Auto-elevate to Admin
# This script automatically requests admin privileges and starts the Node.js server

param()

# Get the directory where this script is located
$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path

# Check if running as Administrator
$currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
$isAdmin = $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "Requesting Administrator privileges..." -ForegroundColor Yellow
    Write-Host "Please click 'Yes' on the UAC prompt to continue." -ForegroundColor Yellow
    
    # Relaunch this script as Administrator
    $arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$($MyInvocation.MyCommand.Path)`""
    Start-Process powershell.exe -Verb RunAs -ArgumentList $arguments
    
    # Exit the non-elevated instance
    exit
}

# We are now running as Administrator
Write-Host "" 
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Zabbix Deployment Portal - Server" -ForegroundColor Green
Write-Host "  Running with Administrator privileges" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""

# Change to the script directory
Set-Location $scriptPath

# Check if node_modules exists
if (-not (Test-Path "node_modules")) {
    Write-Host "Installing dependencies..." -ForegroundColor Cyan
    npm install
    Write-Host ""
}

# Start the server
Write-Host "Starting backend server..." -ForegroundColor Cyan
Write-Host "Press Ctrl+C to stop the server" -ForegroundColor Gray
Write-Host ""

# Run the server
npm run server
