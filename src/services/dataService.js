import { zabbixApi } from './zabbixApi';
import { ZABBIX_CONFIG } from '../config/zabbixConfig';
import { getLatestAgentVersion } from './versionService';
import { fetchAgentVersions } from './backendService';

/**
 * Data transformation service
 * Converts Zabbix API data to application format
 */

/**
 * Determine agent status based on current and latest versions
 * @param {string|null} currentVersion - Current agent version
 * @param {string} latestVersion - Latest available version
 * @returns {string} Status: 'Up to Date', 'Outdated', or 'No Agent'
 */
export const determineAgentStatus = (currentVersion, latestVersion) => {
  if (!currentVersion) {
    return 'No Agent';
  }
  
  // Simple version comparison (you may want to use a library like semver for production)
  const normalizeVersion = (ver) => {
    return ver.split('.').map(num => parseInt(num, 10) || 0);
  };
  
  const current = normalizeVersion(currentVersion);
  const latest = normalizeVersion(latestVersion);
  
  for (let i = 0; i < Math.max(current.length, latest.length); i++) {
    const c = current[i] || 0;
    const l = latest[i] || 0;
    if (c < l) return 'Outdated';
    if (c > l) return 'Up to Date';
  }
  
  return 'Up to Date';
};

/**
 * Transform Zabbix host data to application format
 * @param {Array} zabbixHosts - Raw Zabbix hosts
 * @param {Object} agentVersions - Map of hostid to agent version
 * @returns {Array} Transformed hosts
 */
export const transformHostsData = (zabbixHosts, agentVersions = {}, latestVersion = ZABBIX_CONFIG.latestAgentVersion) => {
  console.log('Transforming hosts data...');
  console.log('Total hosts:', zabbixHosts.length);
  console.log('Agent versions available:', Object.keys(agentVersions).length);
  
  return zabbixHosts.map((host, index) => {
    const currentVersion = agentVersions[host.hostid] || null;
    
    // Debug logging for first host
    if (index === 0) {
      console.log('Raw Zabbix host data:', host);
      console.log('Host groups from API:', host.groups);
      console.log('Current version for first host:', currentVersion);
      console.log('Agent versions object:', agentVersions);
    }
    
    const hostGroup = host.groups && host.groups.length > 0 
      ? host.groups[0].name 
      : 'Ungrouped';
    
    // Get primary interface IP
    const primaryInterface = host.interfaces && host.interfaces.length > 0 
      ? host.interfaces[0] 
      : null;
    const ip = primaryInterface ? (primaryInterface.ip || primaryInterface.dns) : 'N/A';
    
    // Get OS information
    const os = host.inventory && host.inventory.os 
      ? host.inventory.os 
      : (host.inventory && host.inventory.os_full 
        ? host.inventory.os_full 
        : 'Unknown');
    
    return {
      id: parseInt(host.hostid) || index,
      hostname: host.name || host.host,
      ip: ip,
      hostGroup: hostGroup,
      hostGroups: host.groups || [],
      os: os,
      currentVersion: currentVersion,
      latestVersion: latestVersion,
      status: determineAgentStatus(currentVersion, latestVersion),
      zabbixStatus: host.status,
      available: host.available,
      rawData: host, // Keep original data for reference
    };
  });
};

/**
 * Transform Zabbix host groups data
 * @param {Array} zabbixGroups - Raw Zabbix host groups
 * @returns {Array} Array of group names
 */
export const transformHostGroupsData = (zabbixGroups) => {
  if (!zabbixGroups || !Array.isArray(zabbixGroups)) {
    console.warn('Invalid host groups data:', zabbixGroups);
    return [];
  }
  return zabbixGroups
    .map(group => group.name)
    .filter(name => name) // Remove any undefined/null names
    .sort();
};

// Derive host group names directly from host data (more reliable when API hostgroup list is limited)
export const deriveHostGroupsFromHosts = (hosts) => {
  if (!hosts || !Array.isArray(hosts)) {
    return [];
  }

  const names = new Set();
  hosts.forEach((host) => {
    if (host.hostGroups && Array.isArray(host.hostGroups)) {
      host.hostGroups.forEach((grp) => {
        if (grp && grp.name) {
          names.add(grp.name);
        }
      });
    }
    if (host.hostGroup) {
      names.add(host.hostGroup);
    }
  });

  return Array.from(names).sort();
};

/**
 * Fetch and transform all required data
 * @returns {Promise<Object>} Object containing hosts and hostGroups
 */
export const fetchAllData = async () => {
  try {
    // Fetch latest agent version (from search API or fallback config)
    let latestVersion = await getLatestAgentVersion();
    
    // Fetch available versions for installation - only from scraping
    let availableVersions = [latestVersion];
    try {
      const versionsData = await fetchAgentVersions();
      availableVersions = versionsData.versions || [latestVersion];

      // If backend returned a fresher latest value, prefer it over any earlier fallback.
      if (versionsData.latest) {
        latestVersion = versionsData.latest;
      } else if (availableVersions.length > 0) {
        latestVersion = availableVersions[0];
      }
    } catch (error) {
      console.warn('Could not fetch versions from Zabbix download page, using latest version only:', error.message);
      // Continue with just the latest version
    }

    // Fetch hosts and host groups in parallel
    const [hosts, hostGroups] = await Promise.all([
      zabbixApi.getHosts(),
      zabbixApi.getHostGroups(),
    ]);

    // Build a hostId -> group names map from hostGroups (for cases where host.get does not return groups)
    const hostIdToGroups = new Map();
    hostGroups.forEach((group) => {
      if (group.hosts && Array.isArray(group.hosts)) {
        group.hosts.forEach((h) => {
          if (!hostIdToGroups.has(h.hostid)) {
            hostIdToGroups.set(h.hostid, []);
          }
          hostIdToGroups.get(h.hostid).push({ groupid: group.groupid, name: group.name });
        });
      }
    });

    // Enrich hosts with group data if missing
    const enrichedHosts = hosts.map((h) => {
      if (!h.groups || h.groups.length === 0) {
        const groups = hostIdToGroups.get(h.hostid);
        if (groups && groups.length > 0) {
          return { ...h, groups };
        }
      }
      return h;
    });
    
    // Get agent versions for all hosts
    const hostIds = enrichedHosts.map(h => h.hostid);
    const agentVersions = await zabbixApi.getAgentVersionsBatch(hostIds);
    
    // Transform data
    const transformedHosts = transformHostsData(enrichedHosts, agentVersions, latestVersion);
    // Prefer deriving host groups from host data to ensure alignment
    const transformedGroups = deriveHostGroupsFromHosts(transformedHosts);
    
    console.log('Sample host data:', transformedHosts[0]);
    console.log('Derived host groups:', transformedGroups);
    
    return {
      hosts: transformedHosts,
      hostGroups: transformedGroups,
      latestVersion,
      availableVersions,
    };
  } catch (error) {
    console.error('Error fetching data from Zabbix:', error);
    throw error;
  }
};

/**
 * Refresh host data (for periodic updates)
 * @returns {Promise<Array>} Updated hosts
 */
export const refreshHostData = async (latestVersion = ZABBIX_CONFIG.latestAgentVersion) => {
  try {
    const [hosts, hostGroups] = await Promise.all([
      zabbixApi.getHosts(),
      zabbixApi.getHostGroups(),
    ]);

    // Build hostId -> groups map
    const hostIdToGroups = new Map();
    hostGroups.forEach((group) => {
      if (group.hosts && Array.isArray(group.hosts)) {
        group.hosts.forEach((h) => {
          if (!hostIdToGroups.has(h.hostid)) {
            hostIdToGroups.set(h.hostid, []);
          }
          hostIdToGroups.get(h.hostid).push({ groupid: group.groupid, name: group.name });
        });
      }
    });

    // Enrich hosts with groups if needed
    const enrichedHosts = hosts.map((h) => {
      if (!h.groups || h.groups.length === 0) {
        const groups = hostIdToGroups.get(h.hostid);
        if (groups && groups.length > 0) {
          return { ...h, groups };
        }
      }
      return h;
    });

    const hostIds = enrichedHosts.map(h => h.hostid);
    const agentVersions = await zabbixApi.getAgentVersionsBatch(hostIds);

    return transformHostsData(enrichedHosts, agentVersions, latestVersion);
  } catch (error) {
    console.error('Error refreshing host data:', error);
    throw error;
  }
};
