// Zabbix API Configuration
// Update these values with your Zabbix server details

export const ZABBIX_CONFIG = {
  // Your Zabbix server URL (e.g., 'https://your-zabbix-server.com/api_jsonrpc.php')
  apiUrl: import.meta.env.VITE_ZABBIX_API_URL || 'http://localhost/zabbix/api_jsonrpc.php',
  
  // Your Zabbix API token
  // For security, use environment variable: VITE_ZABBIX_API_TOKEN
  apiToken: import.meta.env.VITE_ZABBIX_API_TOKEN || '',
  
  // Latest Zabbix agent version (update this manually or fetch from your deployment server)
    latestAgentVersion: '7.4.7',

    // Zabbix server IP/hostname for agent configuration
    // Used to autofill the serverIP field in agent installation forms
    zabbixServerIP: import.meta.env.VITE_ZABBIX_SERVER_IP || '10.130.56.8',

    // Zabbix server port for agent communication
    zabbixServerPort: import.meta.env.VITE_ZABBIX_SERVER_PORT || '10051',

    // Zabbix agent listener port
    agentListenerPort: import.meta.env.VITE_AGENT_LISTENER_PORT || '10050',
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
