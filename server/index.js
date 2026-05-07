import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';
import process from 'process';
import fs from 'fs/promises';
import { Buffer } from 'buffer';
import multer from 'multer';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ENV_PATH = process.env.SERVER_ENV_FILE || path.resolve(__dirname, '../.env');
dotenv.config({ path: ENV_PATH });
// Ansible will be used as the remote execution layer instead of direct SSH.
const ANSIBLE_PLAYBOOK_CMD = process.env.ANSIBLE_PLAYBOOK_CMD || 'ansible-playbook';
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 200,
    fileSize: 20 * 1024 * 1024
  }
});

// ============= HELPER FUNCTIONS =============

/**
 * Execute shell command with proper error handling
 */
async function executeShellCommand(command, options = {}) {
  const { timeout = 180000, maxBuffer = 5 * 1024 * 1024, cwd, env } = options;
  
  console.log(`[executeShellCommand] Received command: "${command}"`);
  console.log(`[executeShellCommand] Command length: ${command.length}`);
  console.log(`[executeShellCommand] Timeout: ${timeout}ms`);
  
  try {
    const { stdout, stderr } = await execAsync(command, {
      timeout, 
      maxBuffer,
      cwd,
      env,
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
 * Run an Ansible playbook against a single target host.
 * Uses a one-host inline inventory so the controller runs the tasks on `host`.
 * SSH credentials are read from environment variables for authentication.
 */
async function runAnsiblePlaybook(playbookPath, host, extraVars = {}) {
  const ansibleRoot = path.resolve(__dirname, '../ansible');
  const ansibleConfigPath = path.join(ansibleRoot, 'ansible.cfg');
  const inventory = `${host},`;
  const playbookVars = { ...(extraVars || {}) };
  
  // Read SSH credentials from environment variables
  const sshUser = process.env.ANSIBLE_SSH_USER || 'root';
  const sshPassword = process.env.ANSIBLE_SSH_PASSWORD || '';
  const sshPort = process.env.ANSIBLE_SSH_PORT || '22';
  const sshKeyFile = process.env.ANSIBLE_SSH_PRIVATE_KEY_FILE || '';

  // Pass connection values as Ansible variables so non-interactive auth works reliably.
  playbookVars.ansible_user = sshUser;
  playbookVars.ansible_port = sshPort;
  if (sshKeyFile) {
    playbookVars.ansible_ssh_private_key_file = sshKeyFile;
  } else if (sshPassword) {
    playbookVars.ansible_password = sshPassword;
  }

  const extraVarsJson = JSON.stringify(playbookVars);
  
  // Build ansible-playbook command with SSH credentials
  let cmd = `${ANSIBLE_PLAYBOOK_CMD} -i ${shellQuote(inventory)} ${shellQuote(playbookPath)} --extra-vars ${shellQuote(extraVarsJson)}`;

  // Add -k flag if using password auth so Ansible prompts for password (sshpass intercepts)
  if (sshPassword && !sshKeyFile) {
    cmd += ` -k`;
  }

  if (sshKeyFile) {
    console.log(`[ANSIBLE] Using key-based authentication for user ${sshUser}`);
  } else if (sshPassword) {
    console.log(`[ANSIBLE] Using password-based authentication for user ${sshUser}`);
  } else {
    console.log(`[ANSIBLE] No password/key configured, relying on SSH agent or default keys for user ${sshUser}`);
  }
  console.log(`[ANSIBLE] Running playbook ${playbookPath} on host ${host}`);
  
  const envVars = {
    ...process.env,
    ANSIBLE_CONFIG: ansibleConfigPath,
    ANSIBLE_ROLES_PATH: path.join(ansibleRoot, 'roles')
  };
  
  const result = await executeShellCommand(cmd, {
    timeout: 10 * 60 * 1000,
    maxBuffer: 10 * 1024 * 1024,
    cwd: ansibleRoot,
    env: envVars
  });
  return result;
}

/* SFTP upload helper removed. Use Ansible playbooks/roles for file copy operations. */

/* In-memory upload helper removed. Use Ansible roles/playbooks for uploading content. */

/* SFTP download helper removed. Use Ansible playbooks/roles for file retrieval. */

/**
 * Connect to remote server
 */
/* Direct SSH connection helper removed. Ansible will manage transport from controller. */

/**
 * Quote string for shell single-quoted context
 */
function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/**
 * Resolve target host from request body.
 */
function resolveTargetHost(body) {
  const host = String(body?.host || '').trim();
  if (!host) {
    throw new Error('host is required');
  }
  return host;
}

/**
 * Map common Ansible stderr patterns to an HTTP status for better API diagnostics.
 */
function classifyAnsibleFailureStatus(stderr = '', fallback = 500) {
  const msg = String(stderr || '').toLowerCase();
  if (
    msg.includes('unreachable') ||
    msg.includes('all configured authentication methods failed') ||
    msg.includes('permission denied') ||
    msg.includes('connection timed out') ||
    msg.includes('no route to host') ||
    msg.includes('connection refused') ||
    msg.includes('could not resolve hostname')
  ) {
    return 503;
  }
  return fallback;
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
 * Install Zabbix agent on remote RHEL server via Ansible
 */
app.post('/api/install-remote', async (req, res) => {
  console.log('\n[ANSIBLE-INSTALL] /api/install-remote endpoint HIT!');
  try {
    const host = resolveTargetHost(req.body || {});
    const { version, serverIP, serverPort = 10051, listenerPort = 10050, hostname } = req.body;

    if (!version || !serverIP || !hostname) {
      return res.status(400).json({ error: 'Missing required fields', details: 'version, serverIP and hostname are required' });
    }

    // Basic validation preserved from previous implementation
    if (!/^\d+\.\d+\.\d+$/.test(version)) {
      return res.status(400).json({ error: 'Invalid version format', details: 'Version must be in format X.Y.Z (e.g., 7.4.6)' });
    }

    // Invoke Ansible playbook
    const playbookPath = path.resolve(__dirname, '../ansible/playbooks/install.yml');
    const extraVars = { host, version, serverIP, serverPort, listenerPort, hostname };

    const result = await runAnsiblePlaybook(playbookPath, host, extraVars);

    if (result.success) {
      return res.json({ success: true, message: `Ansible playbook ran for ${host}`, output: result.stdout });
    }

    const status = classifyAnsibleFailureStatus(result.stderr || result.error, 500);
    return res.status(status).json({ success: false, error: 'Playbook failed', details: result.stderr || result.error, output: result.stdout });
  } catch (error) {
    console.error('[ANSIBLE-INSTALL] Failed:', error);
    return res.status(500).json({ success: false, error: 'Installation failed', details: error.message });
  }
});

/**
 * Restart Zabbix agent service on a remote host via Ansible
 */
app.post('/api/restart-agent', async (req, res) => {
  try {
    const host = resolveTargetHost(req.body || {});
    const playbookPath = path.resolve(__dirname, '../ansible/playbooks/restart.yml');
    const result = await runAnsiblePlaybook(playbookPath, host, { host });

    if (result.success) {
      return res.json({ success: true, message: `Restart playbook ran for ${host}`, output: result.stdout });
    }

    const status = classifyAnsibleFailureStatus(result.stderr || result.error, 500);
    return res.status(status).json({ success: false, error: 'Playbook failed', details: result.stderr || result.error, output: result.stdout });
  } catch (error) {
    console.error('[ANSIBLE-RESTART] Failed:', error);
    return res.status(500).json({ success: false, error: 'Restart failed', details: error.message });
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

/**
 * Remote file manager - list files and folders under /etc/zabbix
 */
app.post('/api/remote-files/list', async (req, res) => {
  // TODO: Implement remote file listing via Ansible modules/roles.
  return res.status(501).json({
    success: false,
    error: 'Not Implemented',
    details: 'Remote file manager is being migrated to Ansible. Use playbooks in ansible/playbooks/files.yml'
  });
});

/**
 * Remote file manager - read a text file under /etc/zabbix
 */
app.post('/api/remote-files/read', async (req, res) => {
  // TODO: Implement remote file read via Ansible (slurp/copy) and return content.
  return res.status(501).json({ success: false, error: 'Not Implemented', details: 'Remote file read is being migrated to Ansible.' });
});

/**
 * Remote file manager - save file content under /etc/zabbix
 */
app.post('/api/remote-files/write', async (req, res) => {
  // TODO: Implement write via Ansible (copy/template) and proper mtime handling.
  return res.status(501).json({ success: false, error: 'Not Implemented', details: 'Remote file write is being migrated to Ansible.' });
});

/**
 * Remote file manager - create a new file under /etc/zabbix
 */
app.post('/api/remote-files/create', async (req, res) => {
  // TODO: Implement create file via Ansible (copy/template tasks).
  return res.status(501).json({ success: false, error: 'Not Implemented', details: 'Remote file create is being migrated to Ansible.' });
});

/**
 * Remote file manager - create a new directory under /etc/zabbix
 */
app.post('/api/remote-files/mkdir', async (req, res) => {
  // TODO: Implement mkdir via Ansible (file module).
  return res.status(501).json({ success: false, error: 'Not Implemented', details: 'Remote directory create is being migrated to Ansible.' });
});

/**
 * Remote file manager - upload local files/folders to /etc/zabbix
 */
app.post('/api/remote-files/upload', upload.array('files'), async (req, res) => {
  // TODO: Implement bulk upload via Ansible (copy/synchronize or looped copy tasks).
  return res.status(501).json({ success: false, error: 'Not Implemented', details: 'Bulk upload is being migrated to Ansible.' });
});

app.listen(PORT, async () => {
  const DOWNLOADS_DIR = path.join(__dirname, 'downloads');
  
  console.log(`\n🚀 Backend server running on http://localhost:${PORT}`);
  console.log(`🐧 Platform: RHEL-based Linux`);  
  console.log(`🔐 Env source: ${ENV_PATH}`);
  console.log(`🔐 Ansible playbook command: ${ANSIBLE_PLAYBOOK_CMD}`);
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
  
  console.log('✨ Backend ready to accept Ansible remote installation requests\n');
});
