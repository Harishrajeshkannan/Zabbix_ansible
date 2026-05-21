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

// ============= SIMPLE FILE + CONSOLE LOGGER =============
const LOG_DIR = path.join(__dirname, 'logs');
const SERVER_LOG_FILE = path.join(LOG_DIR, 'server.log');

async function ensureLogDir() {
  try {
    await fs.mkdir(LOG_DIR, { recursive: true });
    await fs.chmod(LOG_DIR, 0o777);
  } catch {
    // ignore mkdir errors
  }
}

async function writeLogEntry(level, message) {
  try {
    await ensureLogDir();
    const line = `${new Date().toISOString()} [${level}] ${typeof message === 'string' ? message : JSON.stringify(message)}\n`;
    await fs.appendFile(SERVER_LOG_FILE, line, 'utf8');
    await fs.chmod(SERVER_LOG_FILE, 0o666);
  } catch {
    console.error('Failed to write event log');
  }
}

async function writeServerLog(level, message) {
  try {
    await writeLogEntry(level, message);
  } catch {
    // writing logs should not break the app
    console.error('Failed to write server log');
  }
}

function truncateText(value, maxLength = 2000) {
  const text = typeof value === 'string' ? value : String(value || '');
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength)}... [truncated ${text.length - maxLength} chars]`;
}

function redactSensitiveText(value) {
  const text = typeof value === 'string' ? value : String(value || '');
  return text
    .replace(/("ansible_password"\s*:\s*")[^"]+(")/g, '$1[REDACTED]$2')
    .replace(/("ansible_become_password"\s*:\s*")[^"]+(")/g, '$1[REDACTED]$2')
    .replace(/("ansible_ssh_private_key_file"\s*:\s*")[^"]+(")/g, '$1[REDACTED]$2')
    .replace(/(ANSIBLE_SSH_PASSWORD=)[^\s'"`]+/g, '$1[REDACTED]');
}

function logInfo(msg) {
  console.log(msg);
  void writeServerLog('INFO', msg);
}

function logError(msg, err) {
  console.error(msg, err || '');
  const errText = err ? (err.stack || err.message || JSON.stringify(err)) : '';
  void writeServerLog('ERROR', `${msg} ${errText}`);
}

// ============= HELPER FUNCTIONS =============

/**
 * Execute shell command with proper error handling
 */
async function executeShellCommand(command, options = {}) {
  const {
    timeout = 180000,
    maxBuffer = 5 * 1024 * 1024,
    cwd,
    env,
    logFullOutput = false
  } = options;

  const redactedCommand = redactSensitiveText(command);

  logInfo(`[executeShellCommand] Received command: "${redactedCommand}"`);
  logInfo(`[executeShellCommand] Command length: ${command.length}`);
  logInfo(`[executeShellCommand] Timeout: ${timeout}ms`);
  if (cwd) logInfo(`[executeShellCommand] CWD: ${cwd}`);

  const start = Date.now();
  try {
    const { stdout, stderr } = await execAsync(command, {
      timeout,
      maxBuffer,
      cwd,
      env,
      shell: '/bin/bash'
    });

    const duration = Date.now() - start;
    logInfo(`[executeShellCommand] Execution successful (duration: ${duration}ms)`);

    if (stdout && String(stdout).trim()) {
      const out = redactSensitiveText(stdout);
      logInfo(`[executeShellCommand] stdout: ${truncateText(out, logFullOutput ? 20000 : 2000)}`);
    }
    if (stderr && String(stderr).trim()) {
      const errOut = redactSensitiveText(stderr);
      logInfo(`[executeShellCommand] stderr: ${truncateText(errOut, logFullOutput ? 20000 : 2000)}`);
    }

    return { stdout, stderr, success: true, durationMs: duration, exitCode: 0 };
  } catch (error) {
    const duration = Date.now() - start;
    const exitCode = error.code || error.signal || 'unknown';
    logError(`[executeShellCommand] Execution failed (duration: ${duration}ms, exitCode: ${exitCode}): ${error.message}`, error);

    if (error.stdout && String(error.stdout).trim()) {
      const out = redactSensitiveText(error.stdout);
      logError(`[executeShellCommand] stdout: ${truncateText(out, logFullOutput ? 20000 : 2000)}`);
    }
    if (error.stderr && String(error.stderr).trim()) {
      const errOut = redactSensitiveText(error.stderr);
      logError(`[executeShellCommand] stderr: ${truncateText(errOut, logFullOutput ? 20000 : 2000)}`);
    }

    return {
      stdout: error.stdout || '',
      stderr: error.stderr || '',
      success: false,
      error: error.message,
      durationMs: duration,
      exitCode: exitCode
    };
  }
}


/**
 * Run an Ansible playbook against a single target host.
 * Uses a one-host inline inventory so the controller runs the tasks on `host`.
 * Ansible connection credentials are read from environment variables for authentication.
 */
async function runAnsiblePlaybook(playbookPath, host, extraVars = {}) {
  const ansibleRoot = path.resolve(__dirname, '../ansible');
  const ansibleConfigPath = path.join(ansibleRoot, 'ansible.cfg');
  const inventory = `${host},`;
  const playbookVars = { ...(extraVars || {}) };
  
  // Read Ansible connection credentials from environment variables
  const sshUser = (process.env.ANSIBLE_SSH_USER || '').trim();
  const sshPassword = process.env.ANSIBLE_SSH_PASSWORD || '';
  const becomePassword = process.env.ANSIBLE_BECOME_PASSWORD || process.env.ANSIBLE_SUDO_PASSWORD || '';
  const sshPort = (process.env.ANSIBLE_SSH_PORT || '22').trim();
  const sshKeyFile = (process.env.ANSIBLE_SSH_PRIVATE_KEY_FILE || '').trim();

  if (!sshUser) {
    throw new Error('ANSIBLE_SSH_USER is not set in the backend environment');
  }
  if (!sshKeyFile && !sshPassword) {
    throw new Error('Set ANSIBLE_SSH_PASSWORD or ANSIBLE_SSH_PRIVATE_KEY_FILE in the backend environment');
  }

  // Pass connection values as Ansible variables so non-interactive auth works reliably.
  playbookVars.ansible_user = sshUser;
  playbookVars.ansible_port = sshPort;
  if (sshKeyFile) {
    playbookVars.ansible_ssh_private_key_file = sshKeyFile;
  } else if (sshPassword) {
    playbookVars.ansible_password = sshPassword;
  }

  // Keep become non-interactive too. If a dedicated become password is not provided,
  // default to SSH password which matches many sudo setups.
  if (becomePassword) {
    playbookVars.ansible_become_password = becomePassword;
  } else if (sshPassword) {
    playbookVars.ansible_become_password = sshPassword;
  }

  const extraVarsJson = JSON.stringify(playbookVars);
  
  // Build ansible-playbook command with connection credentials
  let cmd = `${ANSIBLE_PLAYBOOK_CMD} -i ${shellQuote(inventory)} ${shellQuote(playbookPath)} --extra-vars ${shellQuote(extraVarsJson)}`;

  // Do not use interactive prompt flags (-k/-K) in backend execution.
  // Credentials are passed via extra-vars for non-interactive runs.

  if (sshKeyFile) {
    logInfo(`[ANSIBLE] Using key-based authentication for user ${sshUser}`);
  } else if (sshPassword) {
    logInfo(`[ANSIBLE] Using password-based authentication for user ${sshUser}`);
  } else {
    logInfo(`[ANSIBLE] No password/key configured, relying on controller connection defaults for user ${sshUser}`);
  }
  logInfo(`[ANSIBLE] Running playbook ${playbookPath} on host ${host}`);
  
  const envVars = {
    ...process.env,
    ANSIBLE_CONFIG: ansibleConfigPath,
    ANSIBLE_ROLES_PATH: path.join(ansibleRoot, 'roles')
  };
  
  const result = await executeShellCommand(cmd, {
    timeout: 10 * 60 * 1000,
    maxBuffer: 20 * 1024 * 1024,
    cwd: ansibleRoot,
    env: envVars,
    logFullOutput: true
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
function detectAnsibleFailureReason(text = '') {
  const msg = String(text || '').toLowerCase();
  if (msg.includes('unreachable! =>') || msg.includes(': unreachable!')) return 'host_unreachable';
  if (msg.includes('permission denied')) return 'ssh_auth_failed';
  if (msg.includes('connection timed out')) return 'ssh_connection_timeout';
  if (msg.includes('no route to host')) return 'network_no_route';
  if (msg.includes('connection refused')) return 'ssh_connection_refused';
  if (msg.includes('could not resolve hostname')) return 'dns_resolution_failed';
  if (msg.includes('failure downloading') && msg.includes('http error 404')) return 'repo_package_not_found';
  if (msg.includes('sudo') && msg.includes('password')) return 'sudo_become_failed';
  if (msg.includes('space separated string of packages')) return 'invalid_package_argument';
  if (msg.includes('failed to validate gpg signature') || msg.includes('public key for')) return 'repo_gpg_validation_failed';
  if (msg.includes('failed!') || msg.includes('fatal:')) return 'ansible_task_failed';
  return 'unknown';
}

function extractAnsibleTaskTimeline(stdout = '') {
  const lines = String(stdout || '').split(/\r?\n/);
  const timeline = [];
  let currentTask = null;

  for (const line of lines) {
    const taskMatch = line.match(/^TASK \[(.+?)\]/);
    if (taskMatch) {
      currentTask = taskMatch[1];
      continue;
    }

    const statusMatch = line.match(/^\s*(ok|changed|skipping|fatal|failed|ignored):/i);
    if (currentTask && statusMatch) {
      timeline.push(`${currentTask} :: ${statusMatch[1].toUpperCase()}`);
      if (/^(fatal|failed)$/i.test(statusMatch[1])) {
        break;
      }
      currentTask = null;
    }
  }

  return timeline;
}

function extractInstallDebugContext(stdout = '') {
  const text = String(stdout || '');
  const packageMatch = text.match(/zabbix-agent2-[0-9.]+-release[0-9]+\.el[0-9]+\.x86_64\.rpm/i);
  const urlMatch = text.match(/https?:\/\/repo\.zabbix\.com\/[^\s"\\]+\.rpm/i);
  const installedMatch = text.match(/Installed package verification:\s*\\n([^"\n\\]+)/i)
    || text.match(/Installed package verification:\s*\n([^\n]+)/i);
  const taskMatches = extractAnsibleTaskTimeline(text);
  const failedLine = text
    .split(/\r?\n/)
    .find((line) => /fatal:|FAILED!|failed_when_result/i.test(line)) || '';

  return {
    packageName: packageMatch ? packageMatch[0].trim() : '',
    packageUrl: urlMatch ? urlMatch[0].trim() : '',
    installedPackage: installedMatch ? installedMatch[1].trim() : '',
    taskTimeline: taskMatches,
    failedLine: failedLine.trim()
  };
}

function buildInstallLogContent({ requestId, host, hostname, version, serverIP, serverPort, listenerPort, result }) {
  const debugContext = extractInstallDebugContext(result.stdout);
  const failureReason = result.success ? 'none' : detectAnsibleFailureReason(`${result.stderr || ''}\n${result.stdout || ''}\n${result.error || ''}`);

  return [
    '========================================',
    'Zabbix Agent Install Run',
    '========================================',
    `Request ID: ${requestId}`,
    `Host: ${host}`,
    `Hostname: ${hostname}`,
    `Requested Version: ${version}`,
    `Server IP: ${serverIP}`,
    `Server Port: ${serverPort}`,
    `Listener Port: ${listenerPort}`,
    `Timestamp: ${new Date().toISOString()}`,
    `Status: ${result.success ? 'SUCCESS' : 'FAILED'}`,
    `Failure Reason: ${failureReason}`,
    '',
    '--- Resolved Package Context ---',
    `Package Name: ${debugContext.packageName || 'n/a'}`,
    `Package URL: ${debugContext.packageUrl || 'n/a'}`,
    `Installed Package: ${debugContext.installedPackage || 'n/a'}`,
    `Version Match Requested: ${debugContext.installedPackage ? (debugContext.installedPackage.includes(`-${version}-`) ? 'yes' : 'no') : 'unknown'}`,
    `Task Count: ${debugContext.taskTimeline.length}`,
    `Failed Line: ${debugContext.failedLine || 'n/a'}`,
    '',
    '--- Task Timeline ---',
    ...(debugContext.taskTimeline.length > 0 ? debugContext.taskTimeline.map((line) => `* ${line}`) : ['* No task timeline could be parsed from stdout']),
    '',
    '--- STDOUT ---',
    result.stdout || '',
    '',
    '--- STDERR ---',
    result.stderr || result.error || '',
    '',
    '========================================',
    ''
  ].join('\n');
}
// ============= END HELPER FUNCTIONS =============

const app = express();
const PORT = 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Logs directory - create in project root
const LOGS_DIR = path.join(__dirname, 'agent-logs');
const INSTALL_LOGS_DIR = path.join(__dirname, 'logs');

async function ensureInstallLogsDir() {
  await fs.mkdir(INSTALL_LOGS_DIR, { recursive: true }).catch(() => {});
}

function buildInstallLogFilename(hostname, requestId) {
  const safeHostname = String(hostname || 'unknown-host')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_');
  const safeRequestId = String(requestId || Date.now())
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${safeHostname}_install_${safeRequestId}_${timestamp}.txt`;
}

async function writeInstallLogFile({ hostname, requestId, content }) {
  await ensureInstallLogsDir();
  const filename = buildInstallLogFilename(hostname, requestId);
  const fullPath = path.join(INSTALL_LOGS_DIR, filename);
  await fs.writeFile(fullPath, content, 'utf8');
  await executeShellCommand(`chmod 777 "${fullPath}"`);
  return { filename, fullPath };
}

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

    logInfo(`✓ Log file created: ${filename}`);
    
    res.json({
      success: true,
      message: `${action === 'install' ? 'Installed' : 'Updated'} ${statusText === 'success' ? 'successfully' : 'with errors'}`,
      logFile: filename,
      fullPath: filepath
    });

  } catch (error) {
    logError('Error creating log file:', error);
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
    logError('Error listing logs:', error);
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
    logError('Error reading log file:', error);
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
    
    // Construct repository URL - only use repo.zabbix.com (stable path for 7.2+)
    const stablePath = majorNum >= 7.2 ? '/stable' : '';
    const repoUrl = `https://repo.zabbix.com/zabbix/${majorVersion}${stablePath}/rhel/${rhelVersion}/x86_64/`;
    console.log(`[DOWNLOAD] Checking repository: ${repoUrl}`);

    const searchCmd = `curl -s "${repoUrl}" | grep -oP "zabbix-agent2-${version}-release[0-9]+\\.el${rhelVersion}\\.x86_64\\.rpm" | sort -V | tail -1`;
    const searchResult = await executeShellCommand(searchCmd);

    if (!searchResult.success || !searchResult.stdout.trim()) {
      console.log(`[DOWNLOAD] ✗ Package not found in repository: ${repoUrl}`);
      return res.status(404).json({
        error: 'Package not found',
        details: `Zabbix Agent ${version} not found in repository ${repoUrl}. Verify the version exists.`,
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
    logInfo(`[DOWNLOAD] Downloading package...`);
    
    const downloadCmd = `curl -f -L --progress-bar "${packageUrl}" -o "${downloadPath}"`;
    const downloadResult = await executeShellCommand(downloadCmd, { timeout: 300000 }); // 5 minutes
    
    if (!downloadResult.success) {
      logError(`[DOWNLOAD] ✗ Download failed`, downloadResult.stderr || downloadResult.error);
      return res.status(500).json({
        error: 'Download failed',
        details: downloadResult.stderr || 'Failed to download package from repository',
        packageUrl: packageUrl
      });
    }
    
    // Verify download
    const verifyResult = await executeShellCommand(`test -f "${downloadPath}" && stat -c%s "${downloadPath}" 2>/dev/null || stat -f%z "${downloadPath}"`);
    
    if (!verifyResult.success) {
      logError(`[DOWNLOAD] ✗ Downloaded file verification failed`, verifyResult.stderr || verifyResult.error);
      return res.status(500).json({
        error: 'Download verification failed',
        details: 'File downloaded but could not be verified'
      });
    }
    
    const fileSize = parseInt(verifyResult.stdout.trim()) || 0;
    
    // Set permissions on downloaded RPM file
    await executeShellCommand(`chmod 755 "${downloadPath}"`);
    
    logInfo(`[DOWNLOAD] ✓ Downloaded successfully (${(fileSize / 1024 / 1024).toFixed(2)} MB)\n`);
    
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
    logError(`[DOWNLOAD] ✗ Exception: ${error.message}\n`, error);

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
  logInfo('\n[ANSIBLE-INSTALL] /api/install-remote endpoint HIT!');
  try {
    const host = resolveTargetHost(req.body || {});
    const { version, serverIP, serverPort = 10051, listenerPort = 10050, hostname } = req.body;
    const requestId = String(req.body?.requestId || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

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
    const logContent = buildInstallLogContent({
      requestId,
      host,
      hostname,
      version,
      serverIP,
      serverPort,
      listenerPort,
      result
    });
    const installLog = await writeInstallLogFile({ hostname, requestId, content: logContent });

    if (result.success) {
      return res.json({ success: true, message: `Ansible playbook ran for ${host}`, output: result.stdout, logFile: installLog.filename, fullPath: installLog.fullPath });
    }

    const status = classifyAnsibleFailureStatus(result.stderr || result.error, 500);
    const reason = detectAnsibleFailureReason(`${result.stderr || ''}\n${result.stdout || ''}\n${result.error || ''}`);
    logError(`[ANSIBLE-INSTALL] Completed with failure host=${host} httpStatus=${status} reason=${reason} exitCode=${result.exitCode ?? 'unknown'} durationMs=${result.durationMs ?? 'unknown'}`);
    return res.status(status).json({ success: false, error: 'Playbook failed', details: result.stderr || result.error, output: result.stdout, logFile: installLog.filename, fullPath: installLog.fullPath });
  } catch (error) {
    logError('[ANSIBLE-INSTALL] Failed:', error);
    return res.status(500).json({ success: false, error: 'Installation failed', details: error.message });
  }
});

/**
 * Install Zabbix agent on multiple remote RHEL servers via Ansible.
 */
app.post('/api/install-remote-batch', async (req, res) => {
  logInfo('\n[ANSIBLE-INSTALL-BATCH] /api/install-remote-batch endpoint HIT!');
  try {
    const { hosts, version, serverIP, serverPort = 10051, listenerPort = 10050 } = req.body || {};

    if (!Array.isArray(hosts) || hosts.length === 0) {
      return res.status(400).json({ error: 'Missing required fields', details: 'hosts array is required' });
    }

    if (!version || !serverIP) {
      return res.status(400).json({ error: 'Missing required fields', details: 'version and serverIP are required' });
    }

    if (!/^\d+\.\d+\.\d+$/.test(version)) {
      return res.status(400).json({ error: 'Invalid version format', details: 'Version must be in format X.Y.Z (e.g., 7.4.6)' });
    }

    const playbookPath = path.resolve(__dirname, '../ansible/playbooks/install.yml');
    const results = [];

    for (const hostEntry of hosts) {
      const host = String(hostEntry?.host || hostEntry?.hostname || hostEntry?.ip || '').trim();
      const hostname = String(hostEntry?.hostname || hostEntry?.host || hostEntry?.ip || host).trim();

      if (!host) {
        results.push({ host: hostname || 'unknown', success: false, error: 'host is required' });
        continue;
      }

      const extraVars = { host, version, serverIP, serverPort, listenerPort, hostname };
      const result = await runAnsiblePlaybook(playbookPath, host, extraVars);

      if (result.success) {
        results.push({ host, hostname, success: true, output: result.stdout });
      } else {
        const status = classifyAnsibleFailureStatus(result.stderr || result.error, 500);
        const reason = detectAnsibleFailureReason(`${result.stderr || ''}\n${result.stdout || ''}\n${result.error || ''}`);
        results.push({
          host,
          hostname,
          success: false,
          status,
          reason,
          error: result.stderr || result.error,
          output: result.stdout
        });
      }
    }

    const successCount = results.filter((item) => item.success).length;
    const failureCount = results.length - successCount;

    return res.json({
      success: failureCount === 0,
      message: `Batch installation completed on ${successCount}/${results.length} hosts`,
      summary: { total: results.length, successCount, failureCount },
      results
    });
  } catch (error) {
    logError('[ANSIBLE-INSTALL-BATCH] Failed:', error);
    return res.status(500).json({ success: false, error: 'Batch installation failed', details: error.message });
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
    logError('[ANSIBLE-RESTART] Failed:', error);
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
    logError('Error getting system info:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get system information',
      details: error.message
    });
  }
});

/**
 * Cleanup temporary files created by Ansible operations
 */
app.post('/api/cleanup-temp', async (req, res) => {
  try {
    // Clean up old persistent RPM cache and temporary Ansible-related files
    const result = await executeShellCommand('find /tmp -name "zabbix_agent_download_*" -type d -mtime +7 -exec rm -rf {} + 2>/dev/null; find /tmp -name "ansible_*" -type d -mtime +1 -exec rm -rf {} + 2>/dev/null; echo "Cleanup completed"');
    
    logInfo(`Temp cleanup: ${truncateText(result.stdout)}`);
    
    res.json({
      success: true,
      message: result.stdout.trim()
    });
  } catch (error) {
    logError('Error during cleanup:', error);
    res.status(500).json({
      error: 'Cleanup failed',
      details: error.message
    });
  }
});

// ============= REMOTE FILE MANAGER HELPERS =============

/**
 * Validate and normalize a relative path to stay within /etc/zabbix
 * @param {string} relativePath - The relative path from /etc/zabbix
 * @returns {string} Normalized path or throws error
 */
function validateRelativePath(relativePath) {
  const normalized = String(relativePath || '')
    .trim()
    .replace(/^\/+/, '') // Remove leading slashes
    .replace(/\/+$/, ''); // Remove trailing slashes
  
  // Reject absolute paths and dangerous patterns
  if (normalized.startsWith('/') || normalized.includes('..') || normalized.includes('\0')) {
    throw new Error('Invalid path: must be relative and cannot contain .. or null bytes');
  }
  
  if (normalized === '' || normalized === '.') {
    return ''; // Root of /etc/zabbix
  }
  
  // Validate each path component
  const parts = normalized.split('/');
  for (const part of parts) {
    if (!part || part === '.' || part === '..') {
      throw new Error('Invalid path component');
    }
    // Reject shell metacharacters and control chars
    if (!/^[a-zA-Z0-9._-]+$/.test(part)) {
      throw new Error(`Invalid path component: ${part}`);
    }
  }
  
  return normalized;
}

/**
 * Sanitize file/folder names to prevent injection
 * @param {string} name - The name to validate
 * @returns {string} Sanitized name or throws error
 */
function sanitizeName(name) {
  const sanitized = String(name || '').trim();
  
  if (!sanitized || sanitized === '.' || sanitized === '..') {
    throw new Error('Invalid name');
  }
  
  if (!/^[a-zA-Z0-9._-]+$/.test(sanitized)) {
    throw new Error(`Invalid name characters: ${sanitized}`);
  }
  
  return sanitized;
}

/**
 * Convert file stat info to response metadata
 */
function _buildFileMetadata(statInfo) {
  try {
    return {
      size: parseInt(statInfo.size || 0),
      mode: String(statInfo.mode || '0644'),
      mtime: statInfo.mtime || new Date().toISOString()
    };
  } catch {
    return { size: 0, mode: '0644', mtime: new Date().toISOString() };
  }
}

/**
 * Parse Ansible find output to build file list
 */
async function parseFileList(host, relativePath) {
  const playbookPath = path.resolve(__dirname, '../ansible/playbooks/files.yml');
  const targetPath = `/etc/zabbix${relativePath ? '/' + relativePath : ''}`;
  
  const result = await runAnsiblePlaybook(playbookPath, host, {
    file_operation: 'list',
    file_target_path: targetPath
  });
  
  if (!result.success) {
    throw new Error(result.stderr || result.error || 'Failed to list files');
  }
  
  // Parse ansible find output from result.stdout
  const items = [];
  try {
    // Extract file list from Ansible output
    const findOutput = result.stdout;
    const lines = findOutput.split('\n');
    
    for (const line of lines) {
      // Look for "ok: [hostname] =>" style output from Ansible find task
      if (line.includes('"path"') || line.includes('"isdir"')) {
        try {
          // Extract JSON-like structure from Ansible verbose output
          const match = line.match(/\{[^}]*"path"[^}]*\}/);
          if (match) {
            const fileInfo = JSON.parse(match[0]);
            items.push({
              name: path.basename(fileInfo.path),
              relativePath: fileInfo.path.replace('/etc/zabbix/', '').replace('/etc/zabbix', ''),
              type: fileInfo.isdir ? 'directory' : 'file',
              size: fileInfo.size || 0,
              mode: String(fileInfo.mode || '0644'),
              mtime: fileInfo.mtime || new Date().toISOString()
            });
          }
        } catch {
          // Skip lines that don't parse
        }
      }
    }
  } catch (parseErr) {
    logError('Error parsing file list:', parseErr);
  }
  
  return items;
}

// ============= END REMOTE FILE MANAGER HELPERS =============

/**
 * Remote file manager - list files and folders under /etc/zabbix
 */
app.post('/api/remote-files/list', async (req, res) => {
  logInfo('[REMOTE-FILES-LIST] Endpoint HIT');
  try {
    const host = resolveTargetHost(req.body || {});
    let relativePath = String(req.body?.relativePath || '').trim();
    
    // Validate relative path
    relativePath = validateRelativePath(relativePath);
    
    const items = await parseFileList(host, relativePath);
    const currentPath = relativePath;
    
    return res.json({
      success: true,
      currentPath,
      items,
      message: `Listed ${items.length} items in /etc/zabbix${currentPath ? '/' + currentPath : ''}`
    });
  } catch (error) {
    logError('[REMOTE-FILES-LIST] Error:', error);
    const status = error.message.includes('Invalid path') ? 400 : 500;
    return res.status(status).json({
      success: false,
      error: error.message || 'Failed to list files',
      details: error.message
    });
  }
});

/**
 * Remote file manager - read a text file under /etc/zabbix
 */
app.post('/api/remote-files/read', async (req, res) => {
  logInfo('[REMOTE-FILES-READ] Endpoint HIT');
  try {
    const host = resolveTargetHost(req.body || {});
    let relativePath = String(req.body?.relativePath || '').trim();
    
    // Validate relative path
    relativePath = validateRelativePath(relativePath);
    
    if (!relativePath) {
      return res.status(400).json({
        success: false,
        error: 'Invalid path',
        details: 'Must specify a file path (not root directory)'
      });
    }
    
    const fullPath = `/etc/zabbix/${relativePath}`;
    const playbookPath = path.resolve(__dirname, '../ansible/playbooks/files.yml');
    
    const result = await runAnsiblePlaybook(playbookPath, host, {
      file_operation: 'read',
      file_target_path: fullPath
    });
    
    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: 'Failed to read file',
        details: result.stderr || result.error
      });
    }
    
    // Extract file content from Ansible slurp output
    let content = '';
    try {
      // Parse slurp base64 encoded content from Ansible output
      const sourceMatch = result.stdout.match(/"content":\s*"([^"]+)"/);
      if (sourceMatch) {
        content = Buffer.from(sourceMatch[1], 'base64').toString('utf-8');
      }
    } catch (parseErr) {
      logError('Error parsing file content:', parseErr);
      content = result.stdout; // Fallback to raw output
    }
    
    return res.json({
      success: true,
      relativePath,
      content,
      metadata: {
        size: Buffer.byteLength(content, 'utf-8'),
        mode: '0644',
        mtime: new Date().toISOString()
      }
    });
  } catch (error) {
    logError('[REMOTE-FILES-READ] Error:', error);
    const status = error.message.includes('Invalid path') ? 400 : 500;
    return res.status(status).json({
      success: false,
      error: error.message || 'Failed to read file',
      details: error.message
    });
  }
});

/**
 * Remote file manager - save file content under /etc/zabbix
 */
app.post('/api/remote-files/write', async (req, res) => {
  logInfo('[REMOTE-FILES-WRITE] Endpoint HIT');
  try {
    const host = resolveTargetHost(req.body || {});
    let relativePath = String(req.body?.relativePath || '').trim();
    const content = String(req.body?.content || '');
    
    // Validate relative path
    relativePath = validateRelativePath(relativePath);
    
    if (!relativePath) {
      return res.status(400).json({
        success: false,
        error: 'Invalid path',
        details: 'Must specify a file path (not root directory)'
      });
    }
    
    const fullPath = `/etc/zabbix/${relativePath}`;
    const playbookPath = path.resolve(__dirname, '../ansible/playbooks/files.yml');
    
    const result = await runAnsiblePlaybook(playbookPath, host, {
      file_operation: 'write',
      file_target_path: fullPath,
      file_content_data: content,
      file_create_mode: '0644'
    });
    
    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: 'Failed to write file',
        details: result.stderr || result.error
      });
    }
    
    return res.json({
      success: true,
      relativePath,
      metadata: {
        size: Buffer.byteLength(content, 'utf-8'),
        mode: '0644',
        mtime: new Date().toISOString()
      },
      message: `File saved successfully at ${fullPath}`
    });
  } catch (error) {
    logError('[REMOTE-FILES-WRITE] Error:', error);
    const status = error.message.includes('Invalid path') ? 400 : 500;
    return res.status(status).json({
      success: false,
      error: error.message || 'Failed to write file',
      details: error.message
    });
  }
});

/**
 * Remote file manager - create a new file under /etc/zabbix
 */
app.post('/api/remote-files/create', async (req, res) => {
  logInfo('[REMOTE-FILES-CREATE] Endpoint HIT');
  try {
    const host = resolveTargetHost(req.body || {});
    let directoryPath = String(req.body?.directoryPath || '').trim();
    const fileName = sanitizeName(req.body?.fileName);
    const content = String(req.body?.content || '');
    
    // Validate directory path
    directoryPath = validateRelativePath(directoryPath);
    
    const relativePath = directoryPath ? `${directoryPath}/${fileName}` : fileName;
    const fullPath = `/etc/zabbix/${relativePath}`;
    
    const playbookPath = path.resolve(__dirname, '../ansible/playbooks/files.yml');
    
    const result = await runAnsiblePlaybook(playbookPath, host, {
      file_operation: 'create_file',
      file_target_path: fullPath,
      file_content_data: content,
      file_create_mode: '0644'
    });
    
    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: 'Failed to create file',
        details: result.stderr || result.error
      });
    }
    
    return res.json({
      success: true,
      relativePath,
      metadata: {
        size: Buffer.byteLength(content, 'utf-8'),
        mode: '0644',
        mtime: new Date().toISOString()
      },
      message: `File created successfully at ${fullPath}`
    });
  } catch (error) {
    logError('[REMOTE-FILES-CREATE] Error:', error);
    const status = error.message.includes('Invalid') ? 400 : 500;
    return res.status(status).json({
      success: false,
      error: error.message || 'Failed to create file',
      details: error.message
    });
  }
});

/**
 * Remote file manager - create a new directory under /etc/zabbix
 */
app.post('/api/remote-files/mkdir', async (req, res) => {
  logInfo('[REMOTE-FILES-MKDIR] Endpoint HIT');
  try {
    const host = resolveTargetHost(req.body || {});
    let directoryPath = String(req.body?.directoryPath || '').trim();
    const folderName = sanitizeName(req.body?.folderName);
    
    // Validate directory path
    directoryPath = validateRelativePath(directoryPath);
    
    const relativePath = directoryPath ? `${directoryPath}/${folderName}` : folderName;
    const fullPath = `/etc/zabbix/${relativePath}`;
    
    const playbookPath = path.resolve(__dirname, '../ansible/playbooks/files.yml');
    
    const result = await runAnsiblePlaybook(playbookPath, host, {
      file_operation: 'mkdir',
      file_target_path: fullPath
    });
    
    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: 'Failed to create directory',
        details: result.stderr || result.error
      });
    }
    
    return res.json({
      success: true,
      relativePath,
      message: `Directory created successfully at ${fullPath}`
    });
  } catch (error) {
    logError('[REMOTE-FILES-MKDIR] Error:', error);
    const status = error.message.includes('Invalid') ? 400 : 500;
    return res.status(status).json({
      success: false,
      error: error.message || 'Failed to create directory',
      details: error.message
    });
  }
});

/**
 * Remote file manager - upload local files/folders to /etc/zabbix
 */
app.post('/api/remote-files/upload', upload.array('files'), async (req, res) => {
  logInfo('[REMOTE-FILES-UPLOAD] Endpoint HIT');
  try {
    const host = resolveTargetHost(req.body || {});
    let directoryPath = String(req.body?.directoryPath || '').trim();
    
    // Validate directory path
    directoryPath = validateRelativePath(directoryPath);
    
    const files = req.files || [];
    if (!files || files.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No files provided',
        details: 'At least one file must be uploaded'
      });
    }
    
    const targetDir = directoryPath ? `/etc/zabbix/${directoryPath}` : '/etc/zabbix';
    
    // Stage files in temp directory and prepare for upload
    const tempDir = path.join('/tmp', `upload_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
    await fs.mkdir(tempDir, { recursive: true }).catch(() => {});
    
    try {
      // Write uploaded files to temp directory
      const stagedFiles = [];
      for (const file of files) {
        const relativePaths = Array.isArray(req.body.relativePaths) 
          ? req.body.relativePaths 
          : [req.body.relativePaths || file.name];
        
        const fileName = relativePaths[stagedFiles.length] || file.name;
        const filePath = path.join(tempDir, fileName);
        
        // Ensure directory exists
        await fs.mkdir(path.dirname(filePath), { recursive: true }).catch(() => {});
        
        await fs.writeFile(filePath, file.buffer);
        stagedFiles.push(filePath);
      }
      
      // Use Ansible to sync staged files to target
      const playbookPath = path.resolve(__dirname, '../ansible/playbooks/files.yml');
      
      const result = await runAnsiblePlaybook(playbookPath, host, {
        file_operation: 'upload',
        file_target_path: targetDir,
        upload_files: stagedFiles
      });
      
      if (!result.success) {
        const detailsText = truncateText(result.stderr || result.stdout || result.error || 'Ansible playbook failed');
        return res.status(500).json({
          success: false,
          error: 'Failed to upload files',
          details: detailsText,
          output: {
            stdout: result.stdout || '',
            stderr: result.stderr || '',
            exitCode: result.exitCode || null
          }
        });
      }
      
      return res.json({
        success: true,
        uploadedCount: files.length,
        targetPath: targetDir,
        message: `Uploaded ${files.length} file(s) to ${targetDir}`
      });
    } finally {
      // Clean up temp directory
      await executeShellCommand(`rm -rf "${tempDir}"`).catch(() => {});
    }
  } catch (error) {
    logError('[REMOTE-FILES-UPLOAD] Error:', error);
    const status = error.message.includes('Invalid path') ? 400 : 500;
    return res.status(status).json({
      success: false,
      error: error.message || 'Failed to upload files',
      details: error.message
    });
  }
});


/**
 * Stream installation progress logs via SSE (Server-Sent Events)
 * Frontend polls this endpoint to get real-time installation progress
 */
app.get('/api/install-progress/:requestId', async (req, res) => {
  const { requestId } = req.params;
  
  try {
    // Read the single server log file for progress parsing
    const logContent = await fs.readFile(SERVER_LOG_FILE, 'utf-8').catch(() => '');
    const lines = logContent.split('\n');
    
    // Filter lines for this requestId
    const relevantLines = lines.filter(line => line.includes(`[req:${requestId}]`));
    
    // Map Ansible tasks to the 4 key progress steps
    const steps = {
      'downloading-repo': { label: 'Downloading repository', status: null },
      'installing-package': { label: 'Installing package', status: null },
      'configuring-agent': { label: 'Configuring agent', status: null },
      'starting-service': { label: 'Starting service', status: null }
    };
    
    relevantLines.forEach(line => {
      // Detect step completion from Ansible task messages
      if (line.includes('Query repository') || line.includes('Validating') || line.includes('Derive')) {
        steps['downloading-repo'].status = 'in-progress';
      }
      if (line.includes('Query repository') && line.includes('ok:')) {
        steps['downloading-repo'].status = 'completed';
      }
      
      if (line.includes('Install Zabbix Agent 2 package')) {
        steps['installing-package'].status = 'in-progress';
      }
      if (line.includes('Install Zabbix Agent 2 package') && (line.includes('ok:') || line.includes('changed:'))) {
        steps['installing-package'].status = 'completed';
      }
      
      if (line.includes('Deploy zabbix_agent2 configuration')) {
        steps['configuring-agent'].status = 'in-progress';
      }
      if (line.includes('Deploy zabbix_agent2 configuration') && (line.includes('ok:') || line.includes('changed:'))) {
        steps['configuring-agent'].status = 'completed';
      }
      
      if (line.includes('Ensure Zabbix Agent service')) {
        steps['starting-service'].status = 'in-progress';
      }
      if (line.includes('Ensure Zabbix Agent service') && (line.includes('ok:') || line.includes('changed:'))) {
        steps['starting-service'].status = 'completed';
      }
    });
    
    // Determine overall status
    let overallStatus = 'in-progress';
    if (relevantLines.some(l => l.includes('Playbook succeeded'))) {
      overallStatus = 'completed';
    } else if (relevantLines.some(l => l.includes('Playbook failed'))) {
      overallStatus = 'failed';
    }
    
    // Get error message if failed
    let errorMessage = null;
    if (overallStatus === 'failed') {
      const failedLine = relevantLines.find(l => l.includes('FAILED') || l.includes('fatal:'));
      if (failedLine) {
        const match = failedLine.match(/\] (.+)$/);
        errorMessage = match ? match[1] : 'Installation failed';
      }
    }
    
    // Convert to array format
    const progressArray = Object.entries(steps).map(([key, value]) => ({
      id: key,
      label: value.label,
      status: value.status
    }));
    
    res.json({
      success: true,
      requestId,
      status: overallStatus,
      steps: progressArray,
      error: errorMessage
    });
  } catch (error) {
    logError(`Error reading progress for ${requestId}:`, error);
    res.status(500).json({
      success: false,
      error: 'Failed to read progress',
      details: error.message
    });
  }
});

app.listen(PORT, async () => {
  const DOWNLOADS_DIR = path.join(__dirname, 'downloads');
  
  logInfo(`\n🚀 Backend server running on http://localhost:${PORT}`);
  logInfo(`🐧 Platform: RHEL-based Linux`);  
  logInfo(`🔐 Env source: ${ENV_PATH}`);
  logInfo(`🔐 Ansible playbook command: ${ANSIBLE_PLAYBOOK_CMD}`);
  logInfo(`📁 Logs directory: ${LOG_DIR}`);
  logInfo(`📄 Server log file: ${SERVER_LOG_FILE}`);
  logInfo(`📦 Downloads directory: ${DOWNLOADS_DIR}`);
  logInfo(`📝 Installation: Zabbix Agent 2 via YUM/DNF repositories`);
  logInfo('');
  
  // Test /tmp/ write access
  const testLog = `/tmp/backend_test_${Date.now()}.log`;
  try {
    await fs.writeFile(testLog, `Backend started at ${new Date().toISOString()}\n`);
    await executeShellCommand(`chmod 777 ${testLog}`);
    logInfo(`✅ /tmp/ directory is writable (test file: ${testLog})`);
  } catch (err) {
    logError(`❌ ERROR: Cannot write to /tmp/ directory: ${err.message}`, err);
  }
  
  logInfo('✨ Backend ready to accept Ansible remote installation requests\n');
});
