const BACKEND_API_URL = import.meta.env.VITE_BACKEND_API_URL || '/api';

const parseApiResponse = async (response) => {
  const raw = await response.text();

  if (!raw || !raw.trim()) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return { rawResponse: raw };
  }
};

/**
 * Log agent action to file via backend
 * @param {string} action - 'install' or 'update'
 * @param {Object} host - Host object with hostname, version info
 * @returns {Promise<Object>} Response from backend
 */
export const logAgentAction = async (action, host) => {
  try {
    const response = await fetch(`${BACKEND_API_URL}/log-action`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action,
        hostname: host.hostname,
        version: host.latestVersion,
        currentVersion: host.currentVersion,
      }),
    });

    if (!response.ok) {
      throw new Error(`Backend error: ${response.status}`);
    }

    const data = await response.json();
    console.log('Log file created:', data.logFile);
    return data;
  } catch (error) {
    console.error('Failed to log action:', error);
    throw error;
  }
};

/**
 * Get all log files
 * @returns {Promise<Array>} List of log files
 */
export const getLogFiles = async () => {
  try {
    const response = await fetch(`${BACKEND_API_URL}/logs`);
    const data = await response.json();
    return data.logs || [];
  } catch (error) {
    console.error('Failed to fetch logs:', error);
    return [];
  }
};

/**
 * Fetch available Zabbix agent versions
 * @returns {Promise<Object>} Response with list of available versions
 */
export const fetchAgentVersions = async () => {
  try {
    const response = await fetch(`${BACKEND_API_URL}/agent-versions`, {
      method: 'GET',
    });

    const data = await response.json();
    
    if (!response.ok || !data.success) {
      throw new Error(data.details || 'Failed to fetch agent versions from Zabbix');
    }

    console.log('Available agent versions from Zabbix download page:', data.versions?.length || 0, 'versions');
    return data;
  } catch (error) {
    console.error('Failed to fetch agent versions from scraping:', error);
    throw error; // Propagate error instead of using fallback
  }
};

/**
 * Download Zabbix agent package to local system
 * @param {string} version - Agent version to download
 * @returns {Promise<Object>} Response from backend with download details
 */
export const downloadAgentPackage = async (version) => {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 200000); // 200 second timeout

    const response = await fetch(`${BACKEND_API_URL}/download-agent/${version}`, {
      method: 'GET',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Download failed' }));
      throw new Error(errorData.details || errorData.error || 'Failed to download agent package');
    }

    const data = await response.json();
    console.log('Agent package downloaded:', data.path);
    return data;
  } catch (error) {
    console.error('Failed to download agent package:', error);
    if (error.name === 'AbortError') {
      throw new Error('Download timeout - The download is taking too long. Please check your internet connection or try again later.');
    }
    throw error;
  }
};

/**
 * Install Zabbix agent on remote RHEL server via Ansible
 * Backend will invoke playbooks on the controller to perform installation and retrieve logs
 * @param {Object} installData - Installation configuration for the Ansible playbook
 * @returns {Promise<Object>} Response from backend
 */
export const installRemoteAgent = async (installData) => {
  console.log('[backendService] installRemoteAgent called');
  console.log('[backendService] Install data:', installData);
  console.log('[backendService] Backend URL:', BACKEND_API_URL);
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 600000); // 10 minute timeout

    console.log('[backendService] Making POST request to:', `${BACKEND_API_URL}/install-remote`);
    
    const response = await fetch(`${BACKEND_API_URL}/install-remote`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(installData),
      signal: controller.signal,
    });

    console.log('[backendService] Response status:', response.status);
    console.log('[backendService] Response ok:', response.ok);
    
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Installation failed' }));
      throw new Error(errorData.details || errorData.error || 'Installation failed');
    }

    const data = await response.json();
    console.log('Remote installation completed:', data);
    return data;
  } catch (error) {
    console.error('Failed to install on remote server:', error);
    if (error.name === 'AbortError') {
      throw new Error('Installation timeout - The installation is taking too long. Please check controller connectivity and server resources.');
    }
    throw error;
  }
};

/**
 * Restart Zabbix agent service on a remote host via Ansible
 * @param {Object} payload - Playbook payload (host, optional extra vars)
 * @returns {Promise<Object>} Response from backend
 */
export const restartRemoteAgent = async (payload) => {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000); // 2 minute timeout

    const response = await fetch(`${BACKEND_API_URL}/restart-agent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const data = await parseApiResponse(response);
    if (!response.ok || !data?.success) {
      const details = data?.details || data?.error || data?.rawResponse || `HTTP ${response.status}`;
      throw new Error(details);
    }

    return data;
  } catch (error) {
    console.error('Failed to restart remote agent:', error);
    if (error.name === 'AbortError') {
      throw new Error('Restart timeout - The restart command took too long.');
    }
    throw error;
  }
};

/**
 * List directory entries under /etc/zabbix on remote server
 * @param {Object} payload - Target context and relative path
 */
export const listRemoteFiles = async (payload) => {
  try {
    const response = await fetch(`${BACKEND_API_URL}/remote-files/list`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await parseApiResponse(response);
    if (!response.ok || !data?.success) {
      const details = data?.details || data?.error || data?.rawResponse || `HTTP ${response.status}`;
      throw new Error(details);
    }

    return data;
  } catch (error) {
    console.error('Failed to list remote files:', error);
    throw error;
  }
};

/**
 * Read file contents from /etc/zabbix on remote server
 * @param {Object} payload - Target context and target file path
 */
export const readRemoteFile = async (payload) => {
  try {
    const response = await fetch(`${BACKEND_API_URL}/remote-files/read`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await parseApiResponse(response);
    if (!response.ok || !data?.success) {
      const details = data?.details || data?.error || data?.rawResponse || `HTTP ${response.status}`;
      throw new Error(details);
    }

    return data;
  } catch (error) {
    console.error('Failed to read remote file:', error);
    throw error;
  }
};

/**
 * Save file contents to /etc/zabbix on remote server
 * @param {Object} payload - Target context and content
 */
export const writeRemoteFile = async (payload) => {
  try {
    const response = await fetch(`${BACKEND_API_URL}/remote-files/write`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await parseApiResponse(response);
    if (!response.ok || !data?.success) {
      const details = data?.details || data?.error || data?.rawResponse || `HTTP ${response.status}`;
      throw new Error(details);
    }

    return data;
  } catch (error) {
    console.error('Failed to save remote file:', error);
    throw error;
  }
};

/**
 * Create a new file under /etc/zabbix on remote server
 * @param {Object} payload - Target context, target directory, file name and content
 */
export const createRemoteFile = async (payload) => {
  try {
    const response = await fetch(`${BACKEND_API_URL}/remote-files/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await parseApiResponse(response);
    if (!response.ok || !data?.success) {
      const details = data?.details || data?.error || data?.rawResponse || `HTTP ${response.status}`;
      throw new Error(details);
    }

    return data;
  } catch (error) {
    console.error('Failed to create remote file:', error);
    throw error;
  }
};

/**
 * Create a new directory under /etc/zabbix on remote server
 * @param {Object} payload - Target context, target directory and folder name
 */
export const createRemoteDirectory = async (payload) => {
  try {
    const response = await fetch(`${BACKEND_API_URL}/remote-files/mkdir`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await parseApiResponse(response);
    if (!response.ok || !data?.success) {
      const details = data?.details || data?.error || data?.rawResponse || `HTTP ${response.status}`;
      throw new Error(details);
    }

    return data;
  } catch (error) {
    console.error('Failed to create remote directory:', error);
    throw error;
  }
};

/**
 * Upload local files/folders to /etc/zabbix on remote server
 * @param {FormData} formData - multipart payload with files and target context
 */
export const uploadRemoteFiles = async (formData) => {
  try {
    const response = await fetch(`${BACKEND_API_URL}/remote-files/upload`, {
      method: 'POST',
      body: formData
    });

    const data = await parseApiResponse(response);
    if (!response.ok || !data?.success) {
      const details = data?.details || data?.error || data?.rawResponse || `HTTP ${response.status}`;
      throw new Error(details);
    }

    return data;
  } catch (error) {
    console.error('Failed to upload remote files:', error);
    throw error;
  }
};

export default {
  logAgentAction,
  getLogFiles,
  fetchAgentVersions,
  downloadAgentPackage,
  installRemoteAgent,
  restartRemoteAgent,
  listRemoteFiles,
  readRemoteFile,
  writeRemoteFile,
  createRemoteFile,
  createRemoteDirectory,
  uploadRemoteFiles
};