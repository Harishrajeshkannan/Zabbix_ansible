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
 * Check if passwordless sudo is configured for the installation script
 */
async function checkPasswordlessSudo() {
  try {
    const scriptPath = path.join(__dirname, 'install-zabbix-rhel.sh');
    // Try to run sudo with -n (non-interactive) flag
    const result = await executeShellCommand(`sudo -n "${scriptPath}" 2>&1 || true`);
    
    // If we get "Insufficient arguments" error, passwordless sudo is working
    // If we get "password required", it's not configured
    if (result.stdout.includes('Insufficient arguments') || result.stdout.includes('USAGE:')) {
      return true; // Passwordless sudo is configured
    }
    return false; // Passwordless sudo not configured
  } catch {
    return false;
  }
}

/**
 * Automatically configure passwordless sudo by running setup-sudo.sh
 */
async function setupPasswordlessSudo() {
  try {
    const setupScript = path.join(__dirname, 'setup-sudo.sh');
    console.log('🔧 Configuring passwordless sudo automatically...');
    console.log(`   Running: ${setupScript}`);
    
    // Make setup script executable
    await executeShellCommand(`chmod +x "${setupScript}"`);
    
    // Run setup script with sudo (user may be prompted for password once)
    const result = await executeShellCommand(`sudo bash "${setupScript}"`, { timeout: 30000 });
    
    if (result.success || result.stdout.includes('Setup Complete')) {
      console.log('✅ Passwordless sudo configured successfully\n');
      return true;
    } else {
      console.error('❌ Failed to configure passwordless sudo');
      console.error('   Output:', result.stdout);
      console.error('   Error:', result.stderr);
      return false;
    }
  } catch (error) {
    console.error('❌ Error during sudo setup:', error.message);
    return false;
  }
}

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
    
    // Construct repository URL - versions 7.2+ use /stable/ path, older versions don't
    const stablePath = majorNum >= 7.2 ? '/stable' : '';
    const repoUrl = `https://repo.zabbix.com/zabbix/${majorVersion}${stablePath}/rhel/${rhelVersion}/x86_64/`;
    
    console.log(`[DOWNLOAD] Checking repository: ${repoUrl}`);
    
    // Search for the package in the repository
    // Package format: zabbix-agent2-{version}-release{N}.el{rhelVersion}.x86_64.rpm
    // Get the latest release if multiple exist (e.g., release1, release2)
    const searchCmd = `curl -s "${repoUrl}" | grep -oP 'zabbix-agent2-${version}-release[0-9]+\\.el${rhelVersion}\\.x86_64\\.rpm' | sort -V | tail -1`;
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
 * Install Zabbix agent on local RHEL server
 * SECURITY: Requires passwordless sudo configuration for install-zabbix-rhel.sh
 * 
 * Add to /etc/sudoers.d/zabbix-install:
 *   nodeuser ALL=(ALL) NOPASSWD: /path/to/install-zabbix-rhel.sh
 */
app.post('/api/install-localhost', async (req, res) => {
  try {
    const { version, serverIP, serverPort = 10051, hostname, psk, pskIdentity } = req.body;
    
    // Validate required fields
    if (!version || !serverIP || !hostname) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        details: 'version, serverIP, and hostname are required'
      });
    }
    
    // Check if passwordless sudo is configured before attempting installation
    console.log('\n[INSTALL] Checking passwordless sudo configuration...');
    const isSudoConfigured = await checkPasswordlessSudo();
    
    if (!isSudoConfigured) {
      console.log('[INSTALL] Passwordless sudo not configured. Attempting automatic setup...');
      const setupSuccess = await setupPasswordlessSudo();
      
      if (!setupSuccess) {
        return res.status(403).json({
          error: 'Passwordless sudo not configured',
          details: 'Installation requires passwordless sudo. Please run: sudo bash server/setup-sudo.sh'
        });
      }
      console.log('[INSTALL] Passwordless sudo configured successfully');
    } else {
      console.log('[INSTALL] Passwordless sudo is configured ✓');
    }
    
    // SECURITY: Strict input validation to prevent command injection
    if (!/^\d+\.\d+\.\d+$/.test(version)) {
      return res.status(400).json({
        error: 'Invalid version format',
        details: 'Version must be in format X.Y.Z (e.g., 7.0.5)'
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
    
    console.log(`\n[INSTALL] Version: ${version}`);
    console.log(`[INSTALL] Server: ${serverIP}:${serverPort}`);
    console.log(`[INSTALL] Hostname: ${hostname}`);
    console.log(`[INSTALL] PSK: ${psk ? 'Enabled' : 'Disabled'}\n`);
    
    // Get the path to the installation script
    const scriptPath = path.join(__dirname, 'install-zabbix-rhel.sh');
    
    // Make sure script is executable
    await executeShellCommand(`chmod +x "${scriptPath}"`);
    
    // Prepare parameters (validated above)
    const pskParam = psk || 'none';
    const pskIdentityParam = pskIdentity || hostname;
    
    console.log(`[INSTALL] Executing installation script with passwordless sudo...`);
    
    // SECURITY: No password handling - relies on sudoers configuration
    // Execute installation directly with sudo (requires passwordless sudo setup)
    const installCommand = `sudo "${scriptPath}" "${version}" "${serverIP}" "${hostname}" "${serverPort}" "${pskParam}" "${pskIdentityParam}"`;
    
    const result = await executeShellCommand(installCommand, { timeout: 600000 });
    
    console.log(`[INSTALL] Output:\n${result.stdout}`);
    if (result.stderr) {
      console.log(`[INSTALL] Errors:\n${result.stderr}`);
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

app.listen(PORT, async () => {
  const DOWNLOADS_DIR = path.join(__dirname, 'downloads');
  
  console.log(`\n🚀 Backend server running on http://localhost:${PORT}`);
  console.log(`🐧 Platform: RHEL-based Linux`);  
  console.log(`📁 Logs directory: ${LOGS_DIR}`);
  console.log(`📦 Downloads directory: ${DOWNLOADS_DIR}`);
  console.log(`📝 Installation: Zabbix Agent 2 via YUM/DNF repositories`);
  console.log();
  
  // Automatically check and configure passwordless sudo
  console.log('🔐 Checking passwordless sudo configuration...');
  const isSudoConfigured = await checkPasswordlessSudo();
  
  if (isSudoConfigured) {
    console.log('✅ Passwordless sudo is already configured\n');
  } else {
    console.log('⚠️  Passwordless sudo not configured. Setting up automatically...');
    const setupSuccess = await setupPasswordlessSudo();
    
    if (!setupSuccess) {
      console.log('\n⚠️  WARNING: Passwordless sudo setup failed!');
      console.log('   Installation may fail without proper sudo configuration.');
      console.log('   Manually run: cd server && sudo bash setup-sudo.sh\n');
    }
  }
  
  console.log('✨ Backend ready to accept requests\n');
});
