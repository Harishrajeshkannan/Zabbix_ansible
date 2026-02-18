import express from 'express';
import cors from 'cors';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import os from 'os';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============= HELPER FUNCTIONS =============

/**
 * Execute PowerShell script from file with proper error handling
 */
async function executePowerShellScript(scriptContent, options = {}) {
  const { timeout = 180000, maxBuffer = 5 * 1024 * 1024 } = options;
  const tempScriptPath = path.join(os.tmpdir(), `ps-script-${Date.now()}.ps1`);
  
  try {
    await fs.writeFile(tempScriptPath, scriptContent, 'utf8');
    
    const { stdout, stderr } = await execAsync(
      `powershell.exe -NoProfile -NoLogo -ExecutionPolicy Bypass -Command "& '${tempScriptPath}' *>&1 | Out-String"`,
      { timeout, maxBuffer, windowsHide: true }
    );
    
    return { stdout, stderr, success: true };
  } catch (error) {
    return { 
      stdout: error.stdout || '', 
      stderr: error.stderr || '', 
      success: false, 
      error: error.message 
    };
  } finally {
    try {
      await fs.unlink(tempScriptPath);
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Generate download PowerShell script
 */
function generateDownloadScript(downloadUrl, outputPath) {
  return `
$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Stop'
$url = '${downloadUrl}'
$output = '${outputPath}'

Write-Host "Downloading from: $url"
Write-Host "Saving to: $output"

try {
    # Verify version exists
    Write-Host "Verifying version availability..."
    try {
        $headResponse = Invoke-WebRequest -Uri $url -Method Head -UseBasicParsing -TimeoutSec 15
        if ($headResponse.StatusCode -eq 404) {
            throw "VERSION_NOT_FOUND"
        }
        Write-Host "Version found (Status: $($headResponse.StatusCode))"
    } catch {
        if ($_.Exception.Response.StatusCode -eq 404) {
            throw "VERSION_NOT_FOUND"
        }
        Write-Host "Warning: HEAD request failed, attempting download anyway"
    }
    
    # Download file
    Write-Host "Downloading... (1-3 minutes)"
    Invoke-WebRequest -Uri $url -OutFile $output -UseBasicParsing -TimeoutSec 150
    
    # Verify download
    if (!(Test-Path $output)) {
        throw "File not found after download"
    }
    
    $fileSize = (Get-Item $output).Length
    $fileSizeMB = [math]::Round($fileSize/1MB, 2)
    
    if ($fileSize -lt 1000) {
        Remove-Item $output -Force -ErrorAction SilentlyContinue
        throw "Downloaded file too small ($fileSize bytes)"
    }
    
    Write-Host "SUCCESS: Downloaded $fileSizeMB MB"
    exit 0
    
} catch {
    $errorMsg = $_.Exception.Message
    if ($errorMsg -eq "VERSION_NOT_FOUND") {
        Write-Host "ERROR: Version not found on Zabbix CDN (404)" -ForegroundColor Red
    } else {
        Write-Host "ERROR: $errorMsg" -ForegroundColor Red
    }
    exit 1
}
`;
}

/**
 * Generate installation PowerShell script
 */
function generateInstallScript(config) {
  const { version, downloadUrl, installDir, installerPath, serverIP, serverPort, hostname, psk, pskIdentity } = config;
  
  const pskSetup = psk ? `
    Write-Host 'Configuring PSK encryption...' -ForegroundColor Cyan
    $pskFile = 'C:\\Program Files\\Zabbix Agent 2\\zabbix_agent2.psk'
    $configPath = 'C:\\Program Files\\Zabbix Agent 2\\zabbix_agent2.conf'
    
    Set-Content -Path $pskFile -Value '${psk}' -NoNewline
    
    $config = Get-Content $configPath -Raw
    $config = $config -replace '# TLSConnect=.*', 'TLSConnect=psk'
    $config = $config -replace '# TLSAccept=.*', 'TLSAccept=psk'
    $config = $config -replace '# TLSPSKIdentity=.*', 'TLSPSKIdentity=${pskIdentity || hostname}'
    $config = $config -replace '# TLSPSKFile=.*', 'TLSPSKFile=C:\\Program Files\\Zabbix Agent 2\\zabbix_agent2.psk'
    Set-Content -Path $configPath -Value $config
    
    Write-Host 'PSK configured successfully' -ForegroundColor Green
` : '';

  return `
$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Stop'
$logPath = '${installDir}\\install-log.txt'

Start-Transcript -Path $logPath -Append

try {
    # Verify admin rights
    $currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    $isAdmin = $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    
    Write-Host "Admin Status: $isAdmin" -ForegroundColor $(if ($isAdmin) { 'Green' } else { 'Red' })
    if (!$isAdmin) {
        throw 'Administrator privileges required'
    }
    
    # Create installation directory
    Write-Host 'Preparing installation directory...' -ForegroundColor Cyan
    if (!(Test-Path '${installDir}')) {
        New-Item -ItemType Directory -Path '${installDir}' -Force | Out-Null
    }
    
    # Download installer
    Write-Host 'Downloading Zabbix Agent ${version}...' -ForegroundColor Cyan
    Invoke-WebRequest -Uri '${downloadUrl}' -OutFile '${installerPath}' -UseBasicParsing -TimeoutSec 120
    
    if (!(Test-Path '${installerPath}')) {
        throw 'Download failed: Installer not found'
    }
    
    $fileSize = (Get-Item '${installerPath}').Length
    if ($fileSize -lt 1000) {
        throw "Downloaded file too small ($fileSize bytes)"
    }
    
    $fileSizeMB = [math]::Round($fileSize/1MB, 2)
    Write-Host "Downloaded $fileSizeMB MB" -ForegroundColor Green
    
    # Run MSI installation
    Write-Host 'Installing Zabbix Agent...' -ForegroundColor Cyan
    $msiArgs = @(
        '/i', '${installerPath}',
        '/qn', '/norestart',
        'SERVER=${serverIP}',
        'SERVERACTIVE=${serverIP}:${serverPort}',
        'HOSTNAME=${hostname}',
        'LISTENPORT=10050',
        'ENABLEPATH=1'
    )
    
    $process = Start-Process -FilePath 'msiexec.exe' -ArgumentList $msiArgs -Wait -PassThru -NoNewWindow
    
    if ($process.ExitCode -eq 1625) {
        throw 'POLICY_BLOCKED: Installation blocked by Group Policy (Error 1625)'
    }
    
    if ($process.ExitCode -ne 0) {
        throw "MSI installation failed (Exit Code: $($process.ExitCode))"
    }
    
    Write-Host 'Installation completed' -ForegroundColor Green
    ${pskSetup}
    
    # Start service
    Write-Host 'Starting Zabbix Agent service...' -ForegroundColor Cyan
    Restart-Service -Name 'Zabbix Agent 2' -Force
    Start-Sleep -Seconds 3
    
    $service = Get-Service -Name 'Zabbix Agent 2'
    if ($service.Status -ne 'Running') {
        throw "Service failed to start (Status: $($service.Status))"
    }
    
    Write-Host 'SUCCESS: Zabbix Agent ${version} installed and running' -ForegroundColor Green
    exit 0
    
} catch {
    Write-Host "ERROR: $_" -ForegroundColor Red
    exit 1
} finally {
    Stop-Transcript
}
`;
}

/**
 * Parse error from PowerShell output
 */
function parseInstallError(output) {
  if (output.includes('POLICY_BLOCKED') || output.includes('Error 1625')) {
    return {
      status: 403,
      error: 'Installation blocked by Group Policy',
      details: 'Your organization\'s Group Policy is blocking MSI installations. Contact your IT administrator to whitelist Zabbix Agent installations.'
    };
  }
  
  if (output.includes('Administrator privileges required')) {
    return {
      status: 403,
      error: 'Administrator privileges required',
      details: 'Server must run with administrator privileges to install software on localhost.'
    };
  }
  
  return {
    status: 500,
    error: 'Installation failed',
    details: output.substring(0, 500)
  };
}

/**
 * Check if running with admin privileges (Windows only)
 */
async function checkAdminRights() {
  if (os.platform() !== 'win32') {
    return true; // Not Windows, assume OK
  }

  try {
    const { stdout } = await execAsync(
      'powershell -Command "$currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent()); if ($currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { Write-Host \'ADMIN\' } else { Write-Host \'NOT_ADMIN\' }"',
      { timeout: 5000, windowsHide: true }
    );

    return stdout.includes('ADMIN');
  } catch {
    return false;
  }
}

// ============= END HELPER FUNCTIONS =============

const app = express();
const PORT = 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Logs directory - create in project root
const LOGS_DIR = path.join(__dirname, '..', 'agent-logs');

/**
 * Create log file using shell command
 */
app.post('/api/log-action', async (req, res) => {
  try {
    const { action, hostname, version, currentVersion, status, error, ip } = req.body;

    if (!action || !hostname) {
      return res.status(400).json({ error: 'Missing required fields: action, hostname' });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const statusText = status || 'success';
    const filename = `${hostname}_${action}_${statusText}_${timestamp}.txt`;
    const filepath = path.join(LOGS_DIR, filename);

    // Create detailed message
    let message = `========================================\n`;
    message += `Zabbix Agent Deployment Log\n`;
    message += `========================================\n\n`;
    message += `Host: ${hostname}\n`;
    if (ip) message += `IP Address: ${ip}\n`;
    message += `Action: ${action.toUpperCase()}\n`;
    
    if (action === 'install') {
      message += `Version: ${version}\n`;
    } else if (action === 'update') {
      message += `From Version: ${currentVersion}\n`;
      message += `To Version: ${version}\n`;
    }
    
    message += `Timestamp: ${new Date().toISOString()}\n`;
    message += `Status: ${statusText === 'success' ? 'SUCCESS' : 'FAILED'}\n`;
    
    if (error) {
      message += `\nError Details:\n`;
      message += `${error}\n`;
    }
    
    message += `\n========================================`;

    // Create logs directory if it doesn't exist (PowerShell command)
    const mkdirCommand = `if (!(Test-Path -Path '${LOGS_DIR}')) { New-Item -ItemType Directory -Path '${LOGS_DIR}' -Force | Out-Null }`;
    await execAsync(`powershell.exe -NoProfile -NoLogo -ExecutionPolicy Bypass -Command "${mkdirCommand}" 2>&1`, { windowsHide: true });

    // Write to file using PowerShell with proper path escaping
    const escapedPath = filepath.replace(/'/g, "''");
    const writeCommand = `Set-Content -Path '${escapedPath}' -Value @'
${message}
'@ -Force`;
    
    await execAsync(`powershell.exe -NoProfile -NoLogo -ExecutionPolicy Bypass -Command "${writeCommand}" 2>&1`, { windowsHide: true });

    console.log(`✓ Log file created: ${filename}`);
    
    res.json({
      success: true,
      message: `${action === 'install' ? 'Installed' : 'Updated'} ${statusText === 'success' ? 'successfully' : 'with errors'}`,
      logFile: filename,
      fullPath: filepath
    });

  } catch (error) {
    console.error('Error creating log file:', error);
    res.status(500).json({ 
      error: 'Failed to create log file',
      details: error.message 
    });
  }
});

/**
 * Get all log files
 */
app.get('/api/logs', async (req, res) => {
  try {
    const command = `if (Test-Path -Path '${LOGS_DIR}') { Get-ChildItem -Path '${LOGS_DIR}' -File | Select-Object Name, Length, LastWriteTime | ConvertTo-Json }`;
    const { stdout } = await execAsync(`powershell.exe -NoProfile -NoLogo -ExecutionPolicy Bypass -Command "${command}" 2>&1`, { windowsHide: true });
    
    if (stdout.trim()) {
      const logs = JSON.parse(stdout);
      res.json({ logs: Array.isArray(logs) ? logs : [logs] });
    } else {
      res.json({ logs: [] });
    }
  } catch (error) {
    console.error('Error listing logs:', error);
    res.json({ logs: [] });
  }
});

/**
 * Get log file content
 */
app.get('/api/logs/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    const filepath = path.join(LOGS_DIR, filename);
    
    // Security check: ensure filename doesn't contain path traversal
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }
    
    const command = `if (Test-Path -Path '${filepath}') { Get-Content -Path '${filepath}' -Raw } else { Write-Host 'File not found' -ForegroundColor Red; exit 1 }`;
    const { stdout } = await execAsync(`powershell.exe -NoProfile -NoLogo -ExecutionPolicy Bypass -Command "${command}" 2>&1`, { windowsHide: true });
    
    if (stdout) {
      res.json({ 
        success: true,
        content: stdout,
        filename: filename
      });
    } else {
      res.status(404).json({ error: 'Log file not found' });
    }
  } catch (error) {
    console.error('Error reading log file:', error);
    res.status(500).json({ 
      error: 'Failed to read log file',
      details: error.message 
    });
  }
});

/**
 * Get available Zabbix agent versions from official Zabbix download page
 */
app.get('/api/agent-versions', async (req, res) => {
  try {
    // Fetch from official Zabbix download agents page
    const zabbixDownloadUrl = 'https://www.zabbix.com/download_agents';
    
    console.log('Fetching Zabbix agent versions from official download page...');
    
    // Use native fetch to get the page content
    const response = await fetch(zabbixDownloadUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const html = await response.text();
    
    // Extract version numbers using regex
    // Looking for patterns like "zabbix_agent2-7.0.7-windows-amd64-openssl.msi"
    const versionRegex = /zabbix_agent2-(\d+\.\d+\.\d+)-windows-amd64-openssl\.msi/g;
    const versions = new Set();
    
    let match;
    while ((match = versionRegex.exec(html)) !== null) {
      versions.add(match[1]);
    }
    
    const versionArray = Array.from(versions);
    
    console.log(`Found ${versionArray.length} versions from Zabbix download page`);
    
    if (versionArray.length === 0) {
      throw new Error('No versions found on Zabbix download page');
    }
    
    // Sort versions in descending order (newest first)
    const sortedVersions = versionArray.sort((a, b) => {
      const aParts = a.split('.').map(Number);
      const bParts = b.split('.').map(Number);
      for (let i = 0; i < 3; i++) {
        if (aParts[i] !== bParts[i]) return bParts[i] - aParts[i];
      }
      return 0;
    }).slice(0, 30); // Limit to 30 most recent versions
    
    console.log(`Returning ${sortedVersions.length} installable versions:`, sortedVersions.slice(0, 8).join(', '), '...');
    
    res.json({
      success: true,
      versions: sortedVersions,
      count: sortedVersions.length,
      source: 'zabbix-official'
    });
    
  } catch (error) {
    console.error('Error fetching agent versions:', error.message);
    
    // Return error instead of fallback
    res.status(500).json({
      success: false,
      error: 'Failed to fetch versions from Zabbix download page',
      details: error.message,
      versions: [],
      count: 0
    });
  }
});

/**
 * Download Zabbix agent installer
 */
app.get('/api/download-agent/:version', async (req, res) => {
  try {
    const { version } = req.params;
    
    if (!version) {
      return res.status(400).json({ 
        error: 'Version required',
        details: 'Please specify a version to download'
      });
    }
    
    // Build download URL
    const majorMinor = version.split('.').slice(0, 2).join('.');
    const filename = `zabbix_agent2-${version}-windows-amd64-openssl.msi`;
    const downloadUrl = `https://cdn.zabbix.com/zabbix/binaries/stable/${majorMinor}/${version}/${filename}`;
    const outputPath = path.join(os.tmpdir(), filename);
    
    console.log(`\n[DOWNLOAD] Version ${version}`);
    console.log(`[DOWNLOAD] URL: ${downloadUrl}`);
    console.log(`[DOWNLOAD] Output: ${outputPath}\n`);
    
    // Generate and execute download script
    const script = generateDownloadScript(downloadUrl, outputPath);
    const result = await executePowerShellScript(script, { timeout: 180000 });
    
    console.log(`[DOWNLOAD] Output:\n${result.stdout}`);
    
    // Check results
    if (result.stdout.includes('SUCCESS')) {
      console.log(`[DOWNLOAD] ✓ Success\n`);
      return res.json({
        success: true,
        message: `Zabbix Agent ${version} downloaded successfully`,
        filename,
        path: outputPath,
        version
      });
    }
    
    // Handle specific errors
    if (result.stdout.includes('VERSION_NOT_FOUND')) {
      console.log(`[DOWNLOAD] ✗ Version not found\n`);
      return res.status(404).json({
        error: 'Version not found',
        details: `Version ${version} is not available on Zabbix CDN. It may not exist or may not be available for Windows.`
      });
    }
    
    // Generic failure
    const errorMsg = result.error || result.stdout.substring(result.stdout.lastIndexOf('ERROR'));
    console.log(`[DOWNLOAD] ✗ Failed: ${errorMsg}\n`);
    
    res.status(500).json({
      error: 'Download failed',
      details: errorMsg || 'Unknown error occurred during download'
    });
    
  } catch (error) {
    console.error(`[DOWNLOAD] ✗ Exception: ${error.message}\n`);
    
    // Categorize errors
    let details = error.message;
    if (error.message.includes('ETIMEDOUT') || error.message.includes('timeout')) {
      details = 'Download timeout - CDN may be slow or unreachable';
    } else if (error.message.includes('ENOTFOUND')) {
      details = 'Cannot reach Zabbix CDN - check internet connection';
    }
    
    res.status(500).json({ 
      error: 'Download failed',
      details
    });
  }
});

/**
 * Install Zabbix agent on localhost
 */
app.post('/api/install-localhost', async (req, res) => {
  try {
    const { version, serverIP, serverPort = 10051, hostname, psk, pskIdentity, adminUsername, adminPassword } = req.body;
    
    // Validate required fields
    if (!version || !serverIP || !hostname) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        details: 'version, serverIP, and hostname are required'
      });
    }
    
    if (!adminUsername || !adminPassword) {
      return res.status(400).json({ 
        error: 'Missing admin credentials',
        details: 'adminUsername and adminPassword are required'
      });
    }
    
    // Check if server has admin rights (warning only)
    const hasAdmin = await checkAdminRights();
    if (!hasAdmin) {
      console.log('[INSTALL] ⚠️  Warning: Server not running as admin - installation may require elevated credentials\n');
    }
    
    console.log(`\n[INSTALL] Version: ${version}`);
    console.log(`[INSTALL] Server: ${serverIP}:${serverPort}`);
    console.log(`[INSTALL] Hostname: ${hostname}`);
    console.log(`[INSTALL] PSK: ${psk ? 'Enabled' : 'Disabled'}`);
    console.log(`[INSTALL] Admin User: ${adminUsername}\n`);
    
    // Build installation config
    const majorMinor = version.split('.').slice(0, 2).join('.');
    const installDir = 'C:\\ZabbixInstall';
    const config = {
      version,
      downloadUrl: `https://cdn.zabbix.com/zabbix/binaries/stable/${majorMinor}/${version}/zabbix_agent2-${version}-windows-amd64-openssl.msi`,
      installDir,
      installerPath: `${installDir}\\zabbix_agent2-${version}-windows-amd64-openssl.msi`,
      serverIP,
      serverPort,
      hostname,
      psk,
      pskIdentity: pskIdentity || hostname
    };
    
    // Generate installation script
    const installScript = generateInstallScript(config);
    
    // Execute via scheduled task with admin credentials
    const taskName = `ZabbixInstall_${Date.now()}`;
    const escapedScript = installScript.replace(/'/g, "''");
    const escapedPassword = adminPassword.replace(/'/g, "''");
    
    const taskCommand = `
      $securePassword = ConvertTo-SecureString '${escapedPassword}' -AsPlainText -Force
      $credential = New-Object System.Management.Automation.PSCredential('${adminUsername}', $securePassword)
      $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -Command \`"${escapedScript}\`""
      $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddSeconds(2)
      $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
      
      Register-ScheduledTask -TaskName '${taskName}' -Action $action -Trigger $trigger -Settings $settings -User $credential.UserName -Password '${escapedPassword}' -Force | Out-Null
      Start-ScheduledTask -TaskName '${taskName}'
      
      # Wait for completion
      $maxWait = 300
      $elapsed = 0
      while ($elapsed -lt $maxWait) {
        Start-Sleep -Seconds 3
        $elapsed += 3
        $taskInfo = Get-ScheduledTaskInfo -TaskName '${taskName}' -ErrorAction SilentlyContinue
        if ($taskInfo -and $taskInfo.LastTaskResult -ne 0x41301) { break }
      }
      
      Unregister-ScheduledTask -TaskName '${taskName}' -Confirm:$false -ErrorAction SilentlyContinue
      Write-Host 'Task completed'
    `.trim();
    
    // Execute task
    let taskResult;
    try {
      taskResult = await execAsync(
        `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "${taskCommand}"`,
        { timeout: 420000, maxBuffer: 5 * 1024 * 1024, windowsHide: true }
      );
    } catch (error) {
      taskResult = { stdout: error.stdout || '', stderr: error.stderr || '' };
    }
    
    console.log(`[INSTALL] Task output:\n${taskResult.stdout}`);
    
    // Read installation log
    const logPath = path.join(installDir, 'install-log.txt');
    let logContent = '';
    try {
      logContent = await fs.readFile(logPath, 'utf8');
      console.log(`[INSTALL] Log:\n${logContent}`);
    } catch (logError) {
      console.log(`[INSTALL] Could not read log: ${logError.message}`);
    }
    
    const combinedOutput = logContent || taskResult.stdout;
    
    // Check for success
    if (combinedOutput.includes('SUCCESS') || combinedOutput.includes('Service started successfully')) {
      console.log(`[INSTALL] ✓ Success\n`);
      return res.json({
        success: true,
        message: `Zabbix Agent ${version} installed successfully`,
        output: combinedOutput
      });
    }
    
    // Parse and return error
    console.log(`[INSTALL] ✗ Failed\n`);
    const errorInfo = parseInstallError(combinedOutput);
    return res.status(errorInfo.status).json(errorInfo);
    
  } catch (error) {
    console.error(`[INSTALL] ✗ Exception: ${error.message}\n`);
    
    res.status(500).json({
      error: 'Installation failed',
      details: error.message
    });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * Cleanup old temp files (PowerShell scripts and XML files)
 */
app.post('/api/cleanup-temp', async (req, res) => {
  try {
    const tempDir = os.tmpdir();
    
    // PowerShell script to clean up old temp files
    const cleanupScript = `
      $tempDir = '${tempDir}'
      $patterns = @('fetch-versions-*.ps1', 'download-zabbix-*.ps1', '*-CliXml-*.xml')
      $deletedCount = 0
      
      foreach ($pattern in $patterns) {
        $files = Get-ChildItem -Path $tempDir -Filter $pattern -ErrorAction SilentlyContinue
        foreach ($file in $files) {
          try {
            # Only delete files older than 1 hour
            if ($file.LastWriteTime -lt (Get-Date).AddHours(-1)) {
              Remove-Item -Path $file.FullName -Force
              $deletedCount++
            }
          } catch {
            # Ignore errors for files in use
          }
        }
      }
      
      Write-Output "Deleted $deletedCount temp files"
    `;
    
    const tempScriptPath = path.join(os.tmpdir(), `cleanup-${Date.now()}.ps1`);
    await fs.writeFile(tempScriptPath, cleanupScript, 'utf8');
    
    const { stdout } = await execAsync(`powershell.exe -NoProfile -NoLogo -ExecutionPolicy Bypass -Command "& '${tempScriptPath}' *>&1 | Out-String"`, {
      timeout: 10000,
      windowsHide: true
    });
    
    // Clean up the cleanup script itself
    try {
      await fs.unlink(tempScriptPath);
    } catch {
      // Ignore
    }
    
    console.log('Temp cleanup:', stdout);
    
    res.json({
      success: true,
      message: stdout.trim()
    });
  } catch (error) {
    console.error('Error during cleanup:', error);
    res.status(500).json({
      error: 'Cleanup failed',
      details: error.message
    });
  }
});

app.listen(PORT, async () => {
  console.log(`\n🚀 Backend server running on http://localhost:${PORT}`);
  console.log(`📁 Logs directory: ${LOGS_DIR}`);
  
  // Check admin status
  const hasAdmin = await checkAdminRights();
  if (hasAdmin) {
    console.log(`✅ Running with Administrator privileges`);
  } else {
    console.log(`⚠️  Running WITHOUT Administrator privileges`);
    console.log(`   → Downloads will work`);
    console.log(`   → Localhost installation will fail (requires admin)`);
    console.log(`   → To enable: Run as Administrator or use .\\start-server-admin.ps1`);
  }
  console.log();
});
