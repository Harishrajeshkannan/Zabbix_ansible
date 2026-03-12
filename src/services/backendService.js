const BACKEND_API_URL = import.meta.env.VITE_BACKEND_API_URL || '/api';

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
 * Install Zabbix agent on remote RHEL server via SSH
 * Connects to remote server, uploads script, executes installation, and retrieves logs
 * @param {Object} installData - Installation configuration including SSH credentials
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
      throw new Error('Installation timeout - The installation is taking too long. Please check SSH connectivity and server resources.');
    }
    throw error;
  }
};

export default { logAgentAction, getLogFiles, fetchAgentVersions, downloadAgentPackage, installRemoteAgent };