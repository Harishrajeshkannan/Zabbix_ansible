// Zabbix API Configuration
// Update these values with your Zabbix server details

export const ZABBIX_CONFIG = {
  // Your Zabbix server URL (e.g., 'https://your-zabbix-server.com/api_jsonrpc.php')
  apiUrl: import.meta.env.VITE_ZABBIX_API_URL || 'http://localhost/zabbix/api_jsonrpc.php',
  
  // Your Zabbix API token
  // For security, use environment variable: VITE_ZABBIX_API_TOKEN
  apiToken: import.meta.env.VITE_ZABBIX_API_TOKEN || '',
  
  // Latest Zabbix agent version (update this manually or fetch from your deployment server)
  latestAgentVersion: '7.4.5',
};

// Validate configuration
export const validateConfig = () => {
  if (!ZABBIX_CONFIG.apiUrl) {
    throw new Error('Zabbix API URL is not configured. Please set VITE_ZABBIX_API_URL environment variable.');
  }
  
  if (!ZABBIX_CONFIG.apiToken) {
    throw new Error('Zabbix API Token is not configured. Please set VITE_ZABBIX_API_TOKEN environment variable.');
  }
  
  return true;
};
