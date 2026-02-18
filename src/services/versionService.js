import { ZABBIX_CONFIG } from '../config/zabbixConfig';

// Zabbix official download page
const ZABBIX_DOWNLOAD_URL = 'https://www.zabbix.com/download_agents';

/**
 * Simple semver comparison function
 * Returns 1 if v1 > v2, -1 if v1 < v2, 0 if equal
 */
const compareSemver = (v1, v2) => {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);
  
  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    
    if (p1 > p2) return 1;
    if (p1 < p2) return -1;
  }
  
  return 0;
};

/**
 * Check if a tag is a valid semver (e.g., 7.0.5)
 */
const isValidSemver = (tag) => {
  const semverRegex = /^\d+\.\d+\.\d+$/;
  return semverRegex.test(tag);
};

/**
 * Fetch latest Zabbix agent version by scraping download page
 * @returns {Promise<string>} Latest version or fallback
 */
export const getLatestAgentVersion = async () => {
  console.log('Version Service: Scraping Zabbix download page...');
  console.log('Fallback version:', ZABBIX_CONFIG.latestAgentVersion);

  try {
    const response = await fetch(ZABBIX_DOWNLOAD_URL);
    const html = await response.text();

    // Extract all MSI versions from the page
    const versionRegex = /zabbix_agent2-([0-9]+\.[0-9]+\.[0-9]+)-windows-amd64-openssl\.msi/g;
    const versions = new Set();
    let match;

    while ((match = versionRegex.exec(html)) !== null) {
      const version = match[1];
      if (isValidSemver(version)) {
        versions.add(version);
      }
    }

    const versionArray = Array.from(versions);
    console.log(`Found ${versionArray.length} unique versions from download page`);

    if (versionArray.length === 0) {
      console.warn('No valid agent versions found on download page, using fallback');
      return ZABBIX_CONFIG.latestAgentVersion;
    }

    // Sort versions and get the highest
    versionArray.sort(compareSemver);
    const latestVersion = versionArray[versionArray.length - 1];

    console.log('Latest Zabbix Agent version from download page:', latestVersion);
    return latestVersion;
  } catch (err) {
    console.error('Failed to fetch version from download page, using fallback:', err);
    return ZABBIX_CONFIG.latestAgentVersion;
  }
};

export default getLatestAgentVersion;