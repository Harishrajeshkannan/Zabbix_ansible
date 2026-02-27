/**
 * Version Service - Manages Zabbix Agent versions for RHEL
 */

const API_BASE = 'http://localhost:3001/api';

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

    if (!Array.isArray(data.versions) || data.versions.length === 0) {
      throw new Error('No versions available');
    }

    // Return the latest (first) version
    const latestVersion = data.versions[0];
    console.log('Latest Zabbix Agent version for RHEL:', latestVersion);
    return latestVersion;
    
  } catch (error) {
    console.error('Failed to fetch version from RHEL repos, using fallback:', error);
    // Return fallback version if fetch fails
    return '7.0.5';
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
    
    // Return fallback versions for RHEL if fetch fails
    const fallbackData = {
      success: false,
      versions: [
        '7.0.5', '7.0.4', '7.0.3', '7.0.2', '7.0.1', '7.0.0',
        '6.4.18', '6.4.17', '6.4.16', '6.4.15', '6.4.14',
        '6.0.33', '6.0.32', '6.0.31', '6.0.30',
        '5.0.44', '5.0.43', '5.0.42'
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
    return { latest: '7.0.5', stable: '7.0.5', lts: '6.0.33' };
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
      ['6.0.33', '5.0.44', '7.0.5'].includes(version) // Known stable versions
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