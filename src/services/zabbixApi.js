import { ZABBIX_CONFIG } from '../config/zabbixConfig';

/**
 * Zabbix API Service
 * Handles all communication with the Zabbix server
 */

class ZabbixApiService {
  constructor() {
    this.apiUrl = ZABBIX_CONFIG.apiUrl;
    this.apiToken = ZABBIX_CONFIG.apiToken;
    this.requestId = 1;
  }

  /**
   * Make a JSON-RPC request to Zabbix API
   * @param {string} method - Zabbix API method name
   * @param {object} params - Method parameters
   * @returns {Promise<any>} API response data
   */
  async request(method, params = {}) {
    const requestBody = {
      jsonrpc: '2.0',
      method: method,
      params: params,
      id: this.requestId++,
    };

    // Build headers with Authorization Bearer token
    const headers = {
      'Content-Type': 'application/json',
    };

    if (this.apiToken) {
      headers['Authorization'] = `Bearer ${this.apiToken}`;
    }

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      if (data.error) {
        throw new Error(`Zabbix API error: ${data.error.message} (${data.error.code})`);
      }

      return data.result;
    } catch (error) {
      console.error('Zabbix API request failed:', error);
      throw error;
    }
  }

  /**
   * Get all host groups
   * @returns {Promise<Array>} Array of host groups
   */
  async getHostGroups() {
    return await this.request('hostgroup.get', {
      output: 'extend',
      selectHosts: ['hostid'],
    });
  }

  /**
   * Get all hosts with detailed information
   * @param {object} filters - Optional filters
   * @returns {Promise<Array>} Array of hosts
   */
  async getHosts(filters = {}) {
    const params = {
      output: [
        'hostid',
        'host',
        'name',
        'status',
        'available',
        'error',
        'maintenance_status',
      ],
      selectGroups: ['groupid', 'name'],
      selectInterfaces: ['ip', 'dns', 'port'],
      selectInventory: ['os', 'os_full'],
      ...filters,
    };

    const result = await this.request('host.get', params);
    console.log('Zabbix API hosts response sample:', result[0]);
    return result;
  }

  /**
   * Get hosts by host group
   * @param {string} groupId - Host group ID
   * @returns {Promise<Array>} Array of hosts
   */
  async getHostsByGroup(groupId) {
    return await this.getHosts({
      groupids: groupId,
    });
  }

  /**
   * Get Zabbix agent items for a host
   * @param {string} hostId - Host ID
   * @returns {Promise<Array>} Array of items
   */
  async getHostAgentItems(hostId) {
    return await this.request('item.get', {
      output: ['itemid', 'key_', 'lastvalue', 'name'],
      hostids: hostId,
      search: {
        key_: 'agent.version',
      },
      sortfield: 'name',
    });
  }

  /**
   * Get agent version for a specific host
   * @param {string} hostId - Host ID
   * @returns {Promise<string|null>} Agent version or null
   */
  async getAgentVersion(hostId) {
    const items = await this.getHostAgentItems(hostId);
    if (items && items.length > 0 && items[0].lastvalue) {
      return items[0].lastvalue;
    }
    return null;
  }

  /**
   * Get agent versions for multiple hosts (batch request)
   * @param {Array<string>} hostIds - Array of host IDs
   * @returns {Promise<Object>} Object mapping hostId to version
   */
  async getAgentVersionsBatch(hostIds) {
    console.log(`Fetching agent versions for ${hostIds.length} hosts...`);
    const versions = {};
    
    // Get all agent.version items for these hosts
    const items = await this.request('item.get', {
      output: ['itemid', 'hostid', 'lastvalue', 'key_', 'name'],
      hostids: hostIds,
      search: {
        key_: 'agent.version',
      },
    });

    console.log(`Found ${items.length} agent.version items`);
    if (items.length > 0) {
      console.log('Sample agent item:', items[0]);
    }

    items.forEach(item => {
      if (item.lastvalue) {
        versions[item.hostid] = item.lastvalue;
      }
    });

    console.log(`Agent versions mapped for ${Object.keys(versions).length} hosts`);
    const sampleHostId = Object.keys(versions)[0];
    if (sampleHostId) {
      console.log(`Sample version: Host ${sampleHostId} = ${versions[sampleHostId]}`);
    }

    return versions;
  }

  /**
   * Install Zabbix agent on a host
   * Note: This requires additional backend service/script
   * @param {string} hostId - Host ID
   * @param {string} version - Version to install
   * @returns {Promise<any>} Installation result
   */
  async installAgent(hostId, version) {
    // This would typically call your custom deployment API/script
    // For now, this is a placeholder that you'll need to implement
    console.log(`Install agent ${version} on host ${hostId}`);
    throw new Error('Agent installation requires backend implementation');
  }

  /**
   * Update Zabbix agent on a host
   * Note: This requires additional backend service/script
   * @param {string} hostId - Host ID
   * @param {string} fromVersion - Current version
   * @param {string} toVersion - Target version
   * @returns {Promise<any>} Update result
   */
  async updateAgent(hostId, fromVersion, toVersion) {
    // This would typically call your custom deployment API/script
    // For now, this is a placeholder that you'll need to implement
    console.log(`Update agent on host ${hostId} from ${fromVersion} to ${toVersion}`);
    throw new Error('Agent update requires backend implementation');
  }

  /**
   * Test API connection
   * @returns {Promise<boolean>} True if connection is successful
   */
  async testConnection() {
    try {
      const result = await this.request('apiinfo.version');
      console.log('Connected to Zabbix API version:', result);
      return true;
    } catch (error) {
      console.error('Failed to connect to Zabbix API:', error);
      return false;
    }
  }
}

// Export singleton instance
export const zabbixApi = new ZabbixApiService();

// Export class for testing
export default ZabbixApiService;
