import express from 'express';
import cors from 'cors';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============= HELPER FUNCTIONS =============

/**
 * Execute shell command with proper error handling
 */
async function executeShellCommand(command, options = {}) {
  const { timeout = 180000, maxBuffer = 5 * 1024 * 1024 } = options;
  
  try {
    const { stdout, stderr } = await execAsync(command, { 
      timeout, 
      maxBuffer,
      shell: '/bin/bash'
    });
    
    return { stdout, stderr, success: true };
  } catch (error) {
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

    // Write to file  
    await fs.writeFile(filepath, message, 'utf8');

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
 */
app.get('/api/agent-versions', async (req, res) => {
  try {
    console.log('Fetching available Zabbix versions for RHEL...');
    
    // Get RHEL version
    const rhelResult = await executeShellCommand('rpm -E %{rhel} 2>/dev/null || echo "8"');
    const rhelVersion = rhelResult.stdout.trim() || '8';
    
    console.log(`Detected RHEL version: ${rhelVersion}`);
    
    // Fetch available versions from Zabbix repository
    const majorVersions = ['7.0', '6.4', '6.0', '5.0'];
    const allVersions = [];
    
    for (const majorVersion of majorVersions) {
      try {
        const repoUrl = `https://repo.zabbix.com/zabbix/${majorVersion}/rhel/${rhelVersion}/x86_64/`;
        const result = await executeShellCommand(`curl -s "${repoUrl}" | grep -oP 'zabbix-release-[0-9.]+-' | grep -oP '[0-9.]+' | head -20`);
        
        if (result.success && result.stdout.trim()) {
          const versions = result.stdout.trim().split('\n').filter(v => v.match(/^\d+\.\d+\.\d+$/));
          allVersions.push(...versions);
        }
      } catch (error) {
        console.log(`Could not fetch versions for ${majorVersion}: ${error.message}`);
      }
    }
    
    // If curl method fails, provide known stable versions
    if (allVersions.length === 0) {
      console.log('Using fallback version list');
      allVersions.push(
        '7.0.5', '7.0.4', '7.0.3', '7.0.2', '7.0.1', '7.0.0',
        '6.4.18', '6.4.17', '6.4.16', '6.4.15', '6.4.14',
        '6.0.33', '6.0.32', '6.0.31', '6.0.30',
        '5.0.44', '5.0.43', '5.0.42'
      );
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
    
    res.json({
      success: true,
      versions: sortedVersions,
      count: sortedVersions.length,
      source: 'zabbix-rhel-repo',
      rhelVersion: rhelVersion
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
 * Install Zabbix agent on local RHEL server
 */
app.post('/api/install-localhost', async (req, res) => {
  try {
    const { version, serverIP, serverPort = 10051, hostname, psk, pskIdentity, sudoUser, sudoPassword } = req.body;
    
    // Validate required fields
    if (!version || !serverIP || !hostname) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        details: 'version, serverIP, and hostname are required'
      });
    }
    
    if (!sudoUser || !sudoPassword) {
      return res.status(400).json({ 
        error: 'Missing sudo credentials',
        details: 'sudoUser and sudoPassword are required for RHEL installation'
      });
    }
    
    console.log(`\n[INSTALL] Version: ${version}`);
    console.log(`[INSTALL] Server: ${serverIP}:${serverPort}`);
    console.log(`[INSTALL] Hostname: ${hostname}`);
    console.log(`[INSTALL] PSK: ${psk ? 'Enabled' : 'Disabled'}`);
    console.log(`[INSTALL] Sudo User: ${sudoUser}\n`);
    
    // Get the path to the installation script
    const scriptPath = path.join(__dirname, 'run-install.sh');
    
    // Make sure script is executable
    await executeShellCommand(`chmod +x "${scriptPath}"`);
    
    // Prepare parameters for the script
    const pskParam = psk || 'none';
    const pskIdentityParam = pskIdentity || hostname;
    
    // Create a temporary expect script to handle sudo password
    const expectScript = `/tmp/install_expect_${Date.now()}.exp`;
    const expectContent = `#!/usr/bin/expect -f
set timeout 300
set version [lindex $argv 0]
set server_ip [lindex $argv 1]
set hostname [lindex $argv 2]
set server_port [lindex $argv 3]
set psk [lindex $argv 4]
set psk_identity [lindex $argv 5]
set sudo_password [lindex $argv 6]
set script_path [lindex $argv 7]

spawn bash $script_path $version $server_ip $hostname $server_port $psk $psk_identity
expect {
    "password for*:" {
        send "$sudo_password\\r"
        exp_continue
    }
    "\\[sudo\\] password for*:" {
        send "$sudo_password\\r"
        exp_continue
    }
    "Proceed with installation?*" {
        send "Y\\r"
        exp_continue
    }
    eof
}
`;
    
    await fs.writeFile(expectScript, expectContent, { mode: 0o755 });
    
    console.log(`[INSTALL] Starting installation with expect script...`);
    
    // Execute installation using expect to handle password prompts
    const installCommand = `expect "${expectScript}" "${version}" "${serverIP}" "${hostname}" "${serverPort}" "${pskParam}" "${pskIdentityParam}" "${sudoPassword}" "${scriptPath}"`;
    
    const result = await executeShellCommand(installCommand, { timeout: 600000 });
    
    console.log(`[INSTALL] Output:\n${result.stdout}`);
    if (result.stderr) {
      console.log(`[INSTALL] Errors:\n${result.stderr}`);
    }
    
    // Clean up expect script
    try {
      await executeShellCommand(`rm -f "${expectScript}"`);
    } catch {
      // Ignore cleanup errors
    }
    
    const combinedOutput = `${result.stdout}\n${result.stderr}`.trim();
    
    // Check for success
    if (result.success && (combinedOutput.includes('successfully installed') || combinedOutput.includes('Installation completed'))) {
      console.log(`[INSTALL] ✓ Success\n`);
      return res.json({
        success: true,
        message: `Zabbix Agent ${version} installed successfully on RHEL`,
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
  res.json({ 
    status: 'ok', 
    platform: 'RHEL',
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

app.listen(PORT, () => {
  console.log(`\n🚀 Backend server running on http://localhost:${PORT}`);
  console.log(`🐧 Platform: RHEL-based Linux`);  
  console.log(`📁 Logs directory: ${LOGS_DIR}`);
  console.log(`📝 Installation: Zabbix Agent 2 via YUM/DNF repositories`);
  console.log(`🔐 Requirements: Sudo user with password for installations`);
  console.log();
});
