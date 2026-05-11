/**
 * Version Service - Manages Zabbix Agent versions for RHEL
 */

import { resolveBackendApiUrl } from './apiBase';

const API_BASE = resolveBackendApiUrl();

/**
 * Fetch available Zabbix agent versions from RHEL repositories
 */
export const getLatestAgentVersion = async () => {
  console.log('Version Service: Fetching versions from RHEL repositories...');
  
  try {
    const response = await fetch(`${API_BASE}/agent-versions`);
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.details || data.error || 'Failed to fetch versions');
    }

    if (!data.latest) {
      throw new Error('No latest version available in response');
    }

    // Return the latest version from scraped or fallback data
    const latestVersion = data.latest;
    const source = data.source || 'unknown';
    console.log(`Latest Zabbix Agent version for RHEL: ${latestVersion} (source: ${source})`);
    return latestVersion;
    
  } catch (error) {
    console.error('Failed to fetch version from RHEL repos, using fallback:', error);
    // Return fallback version if fetch fails (latest stable as of March 2026)
    return '7.4.7';
  }
};

/**
 * Fetch all available Zabbix agent versions from RHEL repositories
 */
export const getAvailableVersions = async () => {
  console.log('Version Service: Fetching all available versions for RHEL...');
  
  try {
    const response = await fetch(`${API_BASE}/agent-versions`);
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.details || data.error || 'Failed to fetch versions');
    }

    console.log(`Found ${data.versions?.length || 0} RHEL-compatible versions`);
    return data;
    
  } catch (error) {
    console.error('Error fetching versions:', error);
    
    // Return fallback versions for RHEL if fetch fails (updated for March 2026)
    const fallbackData = {
      success: false,
      versions: [
        '7.6.0', '7.4.6', '7.4.5', '7.4.4', '7.4.3', '7.4.0',
        '7.2.0', '7.0.6', '7.0.5', '7.0.4',
        '6.4.18', '6.4.17', '6.4.16', '6.4.15',
        '6.0.35', '6.0.34', '6.0.33', '6.0.32',
        '5.0.45', '5.0.44', '5.0.43'
      ],
      count: 19,
      source: 'fallback-rhel',
      error: error.message
    };
    
    console.log('Using fallback RHEL version list');
    return fallbackData;
  }
};

/**
 * Get version recommendations based on stability and recency
 */
export const getVersionRecommendations = (versions) => {
  if (!Array.isArray(versions) || versions.length === 0) {
    return { latest: '7.6.0', stable: '7.6.0', lts: '6.0.35' };
  }

  const recommendations = {
    latest: versions[0],
    stable: null,
    lts: null
  };

  // Find latest stable (non-alpha/beta/rc)
  recommendations.stable = versions.find(version => 
    !version.includes('alpha') && 
    !version.includes('beta') && 
    !version.includes('rc')
  ) || versions[0];

  // Find LTS versions (typically major versions ending in .0 or well-established versions)
  const ltsVersions = versions.filter(version => {
    const parts = version.split('.');
    return (
      (parts[2] === '0' && parseInt(parts[0]) >= 5) || // Major releases
      ['6.0.35', '6.0.34', '6.0.33', '5.0.45', '5.0.44'].includes(version) // Known LTS versions
    );
  });
  
  recommendations.lts = ltsVersions[0] || recommendations.stable;

  return recommendations;
};

/**
 * Get version details and compatibility info
 */
export const getVersionDetails = (version) => {
  const parts = version.split('.');
  const majorMinor = `${parts[0]}.${parts[1]}`;
  
  const details = {
    version,
    majorVersion: parts[0],
    majorMinor,
    isLTS: false,
    isStable: !version.includes('alpha') && !version.includes('beta') && !version.includes('rc'),
    releaseType: 'stable',
    compatibility: {
      rhel7: true,
      rhel8: true,
      rhel9: parseInt(parts[0]) >= 6
    },
    installation: {
      method: 'yum/dnf repository',
      packageName: 'zabbix-agent2',
      architecture: 'x86_64'
    }
  };

  // Determine release type
  if (version.includes('alpha')) {
    details.releaseType = 'alpha';
    details.isStable = false;
  } else if (version.includes('beta')) {
    details.releaseType = 'beta';
    details.isStable = false;
  } else if (version.includes('rc')) {
    details.releaseType = 'release-candidate';
    details.isStable = false;
  }

  // Identify LTS versions
  if (['6.0', '5.0', '7.0'].includes(majorMinor)) {
    details.isLTS = true;
  }

  return details;
};

/**
 * Check if a version is available for installation on RHEL
 */
export const isVersionAvailable = async (version) => {
  try {
    const data = await getAvailableVersions();
    return data.versions.includes(version);
  } catch (error) {
    console.error('Error checking version availability:', error);
    return false;
  }
};

export default getLatestAgentVersion;