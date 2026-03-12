import express from 'express';
import cors from 'cors';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import { Client as SSHClient } from 'ssh2';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============= HELPER FUNCTIONS =============

/**
 * Execute shell command with proper error handling
 */
async function executeShellCommand(command, options = {}) {
  const { timeout = 180000, maxBuffer = 5 * 1024 * 1024 } = options;
  
  console.log(`[executeShellCommand] Received command: "${command}"`);
  console.log(`[executeShellCommand] Command length: ${command.length}`);
  console.log(`[executeShellCommand] Timeout: ${timeout}ms`);
  
  try {
    const { stdout, stderr } = await execAsync(command, { 
      timeout, 
      maxBuffer,
      shell: '/bin/bash'
    });
    
    console.log(`[executeShellCommand] Execution successful`);
    return { stdout, stderr, success: true };
  } catch (error) {
    console.log(`[executeShellCommand] Execution failed: ${error.message}`);
    return { 
      stdout: error.stdout || '', 
      stderr: error.stderr || '', 
      success: false, 
      error: error.message 
    };
  }
}



/**
 * Parse error from installation output
 */
function parseInstallError(output) {
  if (output.includes('permission denied') || output.includes('Permission denied')) {
    return {
      status: 403,
      error: 'Permission denied',
      details: 'Insufficient privileges to install packages. Ensure the user has sudo access.'
    };
  }
  
  if (output.includes('Repository') && output.includes('not found')) {
    return {
      status: 404,
      error: 'Repository not found',
      details: 'Zabbix repository not available for this RHEL version or the specified version does not exist.'
    };
  }

  if (output.includes('Connection refused') || output.includes('Network is unreachable')) {
    return {
      status: 503,
      error: 'Network error',
      details: 'Cannot reach package repositories or Zabbix server. Check network connectivity.'
    };
  }
  
  return {
    status: 500,
    error: 'Installation failed',
    details: output.substring(0, 500)
  };
}

/**
 * Execute command on remote server via SSH
 */
async function executeSSHCommand(conn, command) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    
    conn.exec(command, (err, stream) => {
      if (err) return reject(err);
      
      stream.on('close', (code) => {
        resolve({ stdout, stderr, code, success: code === 0 });
      }).on('data', (data) => {
        stdout += data.toString();
      }).stderr.on('data', (data) => {
        stderr += data.toString();
      });
    });
  });
}

/**
 * Upload file to remote server via SFTP
 */
async function uploadFileSSH(conn, localPath, remotePath) {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) return reject(err);
      
      sftp.fastPut(localPath, remotePath, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  });
}

/**
 * Download file from remote server via SFTP
 */
async function downloadFileSSH(conn, remotePath, localPath) {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) return reject(err);
      
      sftp.fastGet(remotePath, localPath, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  });
}

/**
 * Connect to remote server via SSH
 */
async function connectSSH(config) {
  return new Promise((resolve, reject) => {
    const conn = new SSHClient();
    
    conn.on('ready', () => {
      resolve(conn);
    }).on('error', (err) => {
      reject(err);
    }).connect(config);
  });
}

// ============= END HELPER FUNCTIONS =============

const app = express();
const PORT = 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Logs directory - create in project root
const LOGS_DIR = path.join(__dirname, 'agent-logs');

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

    // Create logs directory if it doesn't exist
    await executeShellCommand(`mkdir -p "${LOGS_DIR}"`);
    await executeShellCommand(`chmod 755 "${LOGS_DIR}"`);

    // Write to file  
    await fs.writeFile(filepath, message, 'utf8');
    await executeShellCommand(`chmod 777 "${filepath}"`);

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
    const result = await executeShellCommand(`find "${LOGS_DIR}" -type f -name "*.txt" -printf "%f %s %T@\\n" 2>/dev/null | head -100`);
    
    const logs = [];
    if (result.stdout.trim()) {
      result.stdout.trim().split('\n').forEach(line => {
        const parts = line.split(' ');
        if (parts.length >= 3) {
          const name = parts[0];
          const size = parseInt(parts[1]);
          const timestamp = new Date(parseFloat(parts[2]) * 1000).toISOString();
          logs.push({ Name: name, Length: size, LastWriteTime: timestamp });
        }
      });
    }
    
    res.json({ logs });
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
    
    const result = await executeShellCommand(`test -f "${filepath}" && cat "${filepath}"`);
    
    if (result.success && result.stdout) {
      res.json({ 
        success: true,
        content: result.stdout,
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
 * Get available Zabbix agent versions for RHEL from official Zabbix repository
 * Uses native package manager for reliability instead of web scraping
 */
app.get('/api/agent-versions', async (req, res) => {
  try {
    console.log('Fetching available Zabbix versions for RHEL...');
    
    // Get RHEL version
    const rhelResult = await executeShellCommand('rpm -E %{rhel} 2>/dev/null || echo "8"');
    const rhelVersion = rhelResult.stdout.trim() || '8';
    
    console.log(`Detected RHEL version: ${rhelVersion}`);
    
    // Fetch available versions from Zabbix repository - include all major versions
    const majorVersions = ['7.8', '7.6', '7.4', '7.2', '7.0', '6.4', '6.0', '5.0'];
    const allVersions = [];
    let usedFallback = false;
    
    for (const majorVersion of majorVersions) {
      try {
        // Versions 7.2+ use /stable/ path, older versions don't
        const majorNum = parseFloat(majorVersion);
        const stablePath = majorNum >= 7.2 ? '/stable' : '';
        const repoUrl = `https://repo.zabbix.com/zabbix/${majorVersion}${stablePath}/rhel/${rhelVersion}/x86_64/`;
        // Look for actual zabbix-agent2 packages, not zabbix-release
        const result = await executeShellCommand(`curl -s "${repoUrl}" | grep -oP 'zabbix-agent2-[0-9.]+' | grep -oP '[0-9.]+' | sort -uV | head -20`);
        
        if (result.success && result.stdout.trim()) {
          const versions = result.stdout.trim().split('\n').filter(v => v.match(/^\d+\.\d+\.\d+$/));
          allVersions.push(...versions);
          console.log(`Found ${versions.length} versions for ${majorVersion}`);
        }
      } catch (error) {
        console.log(`Could not fetch versions for ${majorVersion}: ${error.message}`);
      }
    }
    
    // If curl method fails, provide known stable versions (updated March 2026)
    if (allVersions.length === 0) {
      usedFallback = true;
      console.log('⚠️  Scraping failed - Using fallback version list');
      allVersions.push(
        '7.4.7', '7.4.6', '7.4.5', '7.4.4', '7.4.3', '7.4.2', '7.4.1', '7.4.0',
        '7.2.0', '7.0.6', '7.0.5', '7.0.4',
        '6.4.18', '6.4.17', '6.4.16', '6.4.15',
        '6.0.35', '6.0.34', '6.0.33', '6.0.32',
        '5.0.45', '5.0.44', '5.0.43'
      );
    } else {
      console.log(`✓ Successfully scraped ${allVersions.length} versions from Zabbix repos`);
    }
    
    // Remove duplicates and sort
    const uniqueVersions = [...new Set(allVersions)];
    const sortedVersions = uniqueVersions.sort((a, b) => {
      const aParts = a.split('.').map(Number);
      const bParts = b.split('.').map(Number);
      for (let i = 0; i < 3; i++) {
        if (aParts[i] !== bParts[i]) return bParts[i] - aParts[i];
      }
      return 0;
    }).slice(0, 30);
    
    console.log(`Returning ${sortedVersions.length} available versions for RHEL ${rhelVersion}`);
    console.log(`Latest version: ${sortedVersions[0]}`);
    
    res.json({
      success: true,
      versions: sortedVersions,
      count: sortedVersions.length,
      source: usedFallback ? 'fallback' : 'zabbix-rhel-repo-scraped',
      rhelVersion: rhelVersion,
      latest: sortedVersions[0]
    });
    
  } catch (error) {
    console.error('Error fetching agent versions:', error.message);
    
    res.status(500).json({
      success: false,
      error: 'Failed to fetch versions from Zabbix repository',
      details: error.message,
      versions: [],
      count: 0
    });
  }
});

/**
 * Download Zabbix agent RPM package for RHEL
 */
app.get('/api/download-agent/:version', async (req, res) => {
  try {
    const { version } = req.params;
    
    console.log(`\n[DOWNLOAD] Requested version: ${version}`);
    
    // Validate version format
    if (!version.match(/^\d+\.\d+\.\d+$/)) {
      return res.status(400).json({ 
        error: 'Invalid version format',
        details: 'Version must be in format X.Y.Z (e.g., 7.0.5)'
      });
    }
    
    // Get RHEL version
    const rhelResult = await executeShellCommand('rpm -E %{rhel} 2>/dev/null || echo "8"');
    const rhelVersion = rhelResult.stdout.trim() || '8';
    
    console.log(`[DOWNLOAD] RHEL version: ${rhelVersion}`);
    
    // Determine major version (e.g., 7.0 from 7.0.5)
    const majorVersion = version.split('.').slice(0, 2).join('.');
    const majorNum = parseFloat(majorVersion);
    
    // Create download directory if it doesn't exist
    const downloadDir = path.join(__dirname, 'downloads');
    await executeShellCommand(`mkdir -p "${downloadDir}"`);
    await executeShellCommand(`chmod 755 "${downloadDir}"`);
    
    // Construct repository URL - versions 7.2+ use /stable/ path, older versions don't
    const stablePath = majorNum >= 7.2 ? '/stable' : '';
    const repoUrl = `https://repo.zabbix.com/zabbix/${majorVersion}${stablePath}/rhel/${rhelVersion}/x86_64/`;
    
    console.log(`[DOWNLOAD] Checking repository: ${repoUrl}`);
    
    // Search for the package in the repository
    // Package format: zabbix-agent2-{version}-release{N}.el{rhelVersion}.x86_64.rpm
    // Get the latest release if multiple exist (e.g., release1, release2)
    const searchCmd = `curl -s "${repoUrl}" | grep -oP "zabbix-agent2-${version}-release[0-9]+\\.el${rhelVersion}\\.x86_64\\.rpm" | sort -V | tail -1`;
    const searchResult = await executeShellCommand(searchCmd);
    
    if (!searchResult.success || !searchResult.stdout.trim()) {
      console.log(`[DOWNLOAD] ✗ Package not found in repository`);
      return res.status(404).json({
        error: 'Package not found',
        details: `Zabbix Agent ${version} not found in RHEL ${rhelVersion} repository. Verify the version exists.`,
        repoUrl: repoUrl
      });
    }
    
    const packageName = searchResult.stdout.trim();
    const packageUrl = `${repoUrl}${packageName}`;
    const downloadPath = path.join(downloadDir, packageName);
    
    console.log(`[DOWNLOAD] Package: ${packageName}`);
    console.log(`[DOWNLOAD] URL: ${packageUrl}`);
    
    // Check if already downloaded
    const checkExisting = await executeShellCommand(`test -f "${downloadPath}" && echo "exists" || echo "not_found"`);
    
    if (checkExisting.stdout.trim() === 'exists') {
      console.log(`[DOWNLOAD] ✓ Package already downloaded`);
      
      // Get file size
      const statResult = await executeShellCommand(`stat -c%s "${downloadPath}" 2>/dev/null || stat -f%z "${downloadPath}"`);
      const fileSize = parseInt(statResult.stdout.trim()) || 0;
      
      return res.json({
        success: true,
        message: 'Package already downloaded',
        path: downloadPath,
        packageName: packageName,
        size: fileSize,
        cached: true
      });
    }
    
    // Download the package
    console.log(`[DOWNLOAD] Downloading package...`);
    
    const downloadCmd = `curl -f -L --progress-bar "${packageUrl}" -o "${downloadPath}"`;
    const downloadResult = await executeShellCommand(downloadCmd, { timeout: 300000 }); // 5 minutes
    
    if (!downloadResult.success) {
      console.log(`[DOWNLOAD] ✗ Download failed`);
      return res.status(500).json({
        error: 'Download failed',
        details: downloadResult.stderr || 'Failed to download package from repository',
        packageUrl: packageUrl
      });
    }
    
    // Verify download
    const verifyResult = await executeShellCommand(`test -f "${downloadPath}" && stat -c%s "${downloadPath}" 2>/dev/null || stat -f%z "${downloadPath}"`);
    
    if (!verifyResult.success) {
      console.log(`[DOWNLOAD] ✗ Downloaded file verification failed`);
      return res.status(500).json({
        error: 'Download verification failed',
        details: 'File downloaded but could not be verified'
      });
    }
    
    const fileSize = parseInt(verifyResult.stdout.trim()) || 0;
    
    // Set permissions on downloaded RPM file
    await executeShellCommand(`chmod 755 "${downloadPath}"`);
    
    console.log(`[DOWNLOAD] ✓ Downloaded successfully (${(fileSize / 1024 / 1024).toFixed(2)} MB)\n`);
    
    res.json({
      success: true,
      message: `Zabbix Agent ${version} RPM package downloaded successfully`,
      path: downloadPath,
      packageName: packageName,
      size: fileSize,
      cached: false,
      repoUrl: packageUrl
    });
    
  } catch (error) {
    console.error(`[DOWNLOAD] ✗ Exception: ${error.message}\n`);
    
    res.status(500).json({
      error: 'Download failed',
      details: error.message
    });
  }
});

/**
 * Install Zabbix agent on remote RHEL server via SSH
 * Connects to remote server, uploads installation script, executes it, and retrieves logs
 */
app.post('/api/install-remote', async (req, res) => {
  console.log('\n[SSH-INSTALL] ========================================');
  console.log('[SSH-INSTALL] /api/install-remote endpoint HIT!');
  console.log('[SSH-INSTALL] ========================================\n');
  
  let connection = null;
  
  try {
    const { 
      host,           // Remote server IP/hostname
      sshPort = 22,   // SSH port
      sshUser,        // SSH username  
      sshPassword,    // SSH password
      version,        // Zabbix version
      serverIP,       // Zabbix server IP
      serverPort = 10051,  // Zabbix server port
      hostname        // Agent hostname
    } = req.body;
    
    console.log('[SSH-INSTALL] Parameters:');
    console.log(`  Host: ${host}:${sshPort}`);
    console.log(`  SSH User: ${sshUser}`);
    console.log(`  Zabbix Version: ${version}`);
    console.log(`  Zabbix Server: ${serverIP}:${serverPort}`);
    console.log(`  Agent Hostname: ${hostname}\n`);
    
    // Validate required fields
    if (!host || !sshUser || !sshPassword || !version || !serverIP || !hostname) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        details: 'host, sshUser, sshPassword, version, serverIP, and hostname are required'
      });
    }
    
    // Security: Input validation
    if (!/^\d+\.\d+\.\d+$/.test(version)) {
      return res.status(400).json({
        error: 'Invalid version format',
        details: 'Version must be in format X.Y.Z (e.g., 7.4.6)'
      });
    }
    
    if (!/^[a-zA-Z0-9.-]+$/.test(serverIP)) {
      return res.status(400).json({
        error: 'Invalid server IP/hostname',
        details: 'Server IP must contain only alphanumeric characters, dots, and hyphens'
      });
    }
    
    if (!/^[a-zA-Z0-9.-]+$/.test(hostname)) {
      return res.status(400).json({
        error: 'Invalid hostname',
        details: 'Hostname must contain only alphanumeric characters, dots, and hyphens'
      });
    }
    
    if (serverPort < 1 || serverPort > 65535) {
      return res.status(400).json({
        error: 'Invalid port',
        details: 'Port must be between 1 and 65535'
      });
    }
    
    // Connect to remote server via SSH
    console.log(`[SSH-INSTALL] Connecting to ${host}:${sshPort}...`);
    
    try {
      connection = await connectSSH({
        host,
        port: sshPort,
        username: sshUser,
        password: sshPassword
      });
      console.log(`[SSH-INSTALL] ✓ SSH connected successfully\n`);
    } catch (sshErr) {
      console.error(`[SSH-INSTALL] ✗ SSH connection failed: ${sshErr.message}`);
      return res.status(503).json({
        error: 'SSH connection failed',
        details: `Cannot connect to ${host}:${sshPort} - ${sshErr.message}`
      });
    }
    
    // Define remote paths (using /tmp/ instead of __dirname)
    const timestamp = Date.now();
    const remoteScriptPath = `/tmp/install-zabbix-rhel-${timestamp}.sh`;
    const remoteLogPattern = `/tmp/zabbix_install_*.log`;
    const localScriptPath = path.join(__dirname, 'install-zabbix-rhel.sh');
    const localLogsDir = path.join(__dirname, 'agent-logs');
    
    // Ensure local logs directory exists
    await executeShellCommand(`mkdir -p "${localLogsDir}"`);
    await executeShellCommand(`chmod 755 "${localLogsDir}"`);
    
    // Upload installation script to remote server
    console.log(`[SSH-INSTALL] Uploading script: ${localScriptPath} → ${remoteScriptPath}`);
    
    try {
      await uploadFileSSH(connection, localScriptPath, remoteScriptPath);
      console.log(`[SSH-INSTALL] ✓ Script uploaded successfully`);
      
      // Set executable permissions on remote script
      await executeSSHCommand(connection, `chmod 755 ${remoteScriptPath}`);
      console.log(`[SSH-INSTALL] ✓ Script permissions set to 755 (rwxr-xr-x)\n`);
    } catch (uploadErr) {
      console.error(`[SSH-INSTALL] ✗ Upload failed: ${uploadErr.message}`);
      connection.end();
      return res.status(500).json({
        error: 'Script upload failed',
        details: uploadErr.message
      });
    }
    
    // Execute installation on remote server with sudo password
    // Use echo with -S flag to pass password to sudo via stdin
    // Use 'sudo bash script.sh' instead of 'sudo script.sh' to avoid sudoers restrictions on script paths
    const escapedPassword = sshPassword.replace(/'/g, "'\\''"); // Escape single quotes for shell
    const installCommand = `echo '${escapedPassword}' | sudo -S bash ${remoteScriptPath} ${version} ${serverIP} ${hostname} ${serverPort}`;
    console.log(`[SSH-INSTALL] Executing installation command:`);
    console.log(`[SSH-INSTALL] sudo -S bash ${remoteScriptPath} ${version} ${serverIP} ${hostname} ${serverPort}\n`);
    
    let result;
    try {
      result = await executeSSHCommand(connection, installCommand);
      console.log(`[SSH-INSTALL] Command execution completed`);
      console.log(`[SSH-INSTALL] Exit code: ${result.code}`);
      console.log(`[SSH-INSTALL] Output:\n${result.stdout}`);
      if (result.stderr) {
        console.log(`[SSH-INSTALL] Errors:\n${result.stderr}`);
      }
    } catch (execErr) {
      console.error(`[SSH-INSTALL] ✗ Execution failed: ${execErr.message}`);
      connection.end();
      return res.status(500).json({
        error: 'Remote execution failed',
        details: execErr.message
      });
    }
    
    // Retrieve installation log from remote server
    console.log(`[SSH-INSTALL] Retrieving installation log...`);
    
    try {
      // Find the latest log file
      const findLogResult = await executeSSHCommand(connection, `ls -t ${remoteLogPattern} 2>/dev/null | head -1`);
      const remoteLogPath = findLogResult.stdout.trim();
      
      if (remoteLogPath) {
        const logFilename = `${hostname}_install_${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
        const localLogPath = path.join(localLogsDir, logFilename);
        
        await downloadFileSSH(connection, remoteLogPath, localLogPath);
        await executeShellCommand(`chmod 777 "${localLogPath}"`);
        
        console.log(`[SSH-INSTALL] ✓ Log retrieved: ${logFilename}\n`);
      } else {
        console.log(`[SSH-INSTALL] ⚠ No installation log found on remote server\n`);
      }
    } catch (logErr) {
      console.warn(`[SSH-INSTALL] ⚠ Could not retrieve log: ${logErr.message}`);
    }
    
    // Cleanup remote script
    try {
      const cleanupCommand = `echo '${escapedPassword}' | sudo -S rm -f ${remoteScriptPath}`;
      await executeSSHCommand(connection, cleanupCommand);
      console.log(`[SSH-INSTALL] ✓ Remote cleanup completed`);
    } catch (cleanErr) {
      console.warn(`[SSH-INSTALL] ⚠ Cleanup failed: ${cleanErr.message}`);
    }
    
    // Close SSH connection
    connection.end();
    console.log(`[SSH-INSTALL] ✓ SSH connection closed\n`);
    
    const combinedOutput = `${result.stdout}\n${result.stderr}`.trim();
    
    // Check for success
    if (result.success && (combinedOutput.includes('successfully installed') || combinedOutput.includes('Installation completed') || combinedOutput.includes('INSTALLATION COMPLETED'))) {
      console.log(`[SSH-INSTALL] ✓ Installation SUCCESS\n`);
      return res.json({
        success: true,
        message: `Zabbix Agent ${version} installed successfully on ${host}`,
        output: combinedOutput,
        host: host
      });
    }
    
    // Parse and return error
    console.log(`[SSH-INSTALL] ✗ Installation FAILED\n`);
    const errorInfo = parseInstallError(combinedOutput);
    return res.status(errorInfo.status).json({
      ...errorInfo,
      host: host,
      output: combinedOutput
    });
    
  } catch (error) {
    console.error(`[SSH-INSTALL] ✗ Exception: ${error.message}\n`);
    
    if (connection) {
      connection.end();
    }
    
    res.status(500).json({
      error: 'Installation failed',
      details: error.message
    });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    platform: 'RHEL',
    version: '2.0.0',
    features: 'DNF-only, PSK-removed, 755-permissions, detailed-logging',
    timestamp: new Date().toISOString() 
  });
});

/**
 * Check RHEL system information
 */
app.get('/api/system-info', async (req, res) => {
  try {
    const results = {};
    
    // Get OS information
    const osResult = await executeShellCommand('cat /etc/redhat-release 2>/dev/null || cat /etc/os-release | grep PRETTY_NAME | cut -d= -f2 | tr -d \'"\'');
    results.os = osResult.stdout.trim() || 'Unknown RHEL-based OS';
    
    // Get RHEL version
    const rhelResult = await executeShellCommand('rpm -E %{rhel} 2>/dev/null || echo "unknown"');
    results.rhelVersion = rhelResult.stdout.trim();
    
    // Check if Zabbix agent is already installed
    const zabbixResult = await executeShellCommand('rpm -qa | grep zabbix-agent2 || echo "not_installed"');
    results.zabbixInstalled = !zabbixResult.stdout.includes('not_installed');
    results.installedVersion = zabbixResult.stdout.includes('not_installed') ? null : zabbixResult.stdout.trim();
    
    // Check if service is running
    if (results.zabbixInstalled) {
      const serviceResult = await executeShellCommand('systemctl is-active zabbix-agent2 2>/dev/null || echo "inactive"');
      results.zabbixRunning = serviceResult.stdout.trim() === 'active';
    }
    
    // Check sudo privileges (will require password prompt in UI)
    const sudoResult = await executeShellCommand('timeout 1 sudo -n true 2>/dev/null && echo "passwordless" || echo "password_required"');
    results.sudoAccess = sudoResult.stdout.includes('passwordless') ? 'passwordless' : 'password_required';
    
    res.json({
      success: true,
      system: results
    });
    
  } catch (error) {
    console.error('Error getting system info:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get system information',
      details: error.message
    });
  }
});

/**
 * Cleanup temporary files
 */
app.post('/api/cleanup-temp', async (req, res) => {
  try {
    const result = await executeShellCommand('find /tmp -name "zabbix_install_*.sh" -mtime +0 -delete 2>/dev/null; find /tmp -name "zabbix_install_*.log" -mtime +1 -delete 2>/dev/null; echo "Cleanup completed"');
    
    console.log('Temp cleanup:', result.stdout);
    
    res.json({
      success: true,
      message: result.stdout.trim()
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
  const DOWNLOADS_DIR = path.join(__dirname, 'downloads');
  
  console.log(`\n🚀 Backend server running on http://localhost:${PORT}`);
  console.log(`🐧 Platform: RHEL-based Linux`);  
  console.log(`📁 Logs directory: ${LOGS_DIR}`);
  console.log(`📦 Downloads directory: ${DOWNLOADS_DIR}`);
  console.log(`📝 Installation: Zabbix Agent 2 via YUM/DNF repositories`);
  console.log();
  
  // Test /tmp/ write access
  const testLog = `/tmp/backend_test_${Date.now()}.log`;
  try {
    await fs.writeFile(testLog, `Backend started at ${new Date().toISOString()}\n`);
    await executeShellCommand(`chmod 777 ${testLog}`);
    console.log(`✅ /tmp/ directory is writable (test file: ${testLog})`);
  } catch (err) {
    console.error(`❌ ERROR: Cannot write to /tmp/ directory: ${err.message}`);
  }
  
  console.log('✨ Backend ready to accept SSH remote installation requests\n');
});
