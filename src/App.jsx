import { useState, useEffect, useMemo, useCallback } from 'react';
import { Toaster, toast } from 'sonner';
import Header from './components/Header';
import StatsBar from './components/StatsBar';
import FilterPanel from './components/FilterPanel';
import HostTable from './components/HostTable';
import Pagination from './components/Pagination';
import Loading from './components/Loading';
import ErrorMessage from './components/ErrorMessage';
import VersionSelector from './components/VersionSelector';
import LocalInstallModal from './components/LocalInstallModal';
import LogsPage from './pages/LogsPage';
import { fetchAllData, refreshHostData } from './services/dataService';
import { logAgentAction, downloadAgentPackage, installLocalhostAgent } from './services/backendService';
import { ZABBIX_CONFIG } from './config/zabbixConfig';
import './App.css';

function App() {
  // View state
  const [currentView, setCurrentView] = useState('dashboard');
  
  // State management
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedHostGroup, setSelectedHostGroup] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  
  // Data state
  const [hosts, setHosts] = useState([]);
  const [hostGroups, setHostGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [latestVersion, setLatestVersion] = useState(ZABBIX_CONFIG.latestAgentVersion);
  
  // Version selector modal state
  const [versionSelectorOpen, setVersionSelectorOpen] = useState(false);
  const [localInstallModalOpen, setLocalInstallModalOpen] = useState(false);
  const [availableVersions, setAvailableVersions] = useState([]);
  const [selectedHost, setSelectedHost] = useState(null);
  const [actionType, setActionType] = useState('');

  // Load data from Zabbix API
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
      console.log('Fetching data from Zabbix API...');
      const data = await fetchAllData();
      setHosts(data.hosts);
      setHostGroups(data.hostGroups);
      if (data.latestVersion) setLatestVersion(data.latestVersion);
      if (data.availableVersions) setAvailableVersions(data.availableVersions);
      setLastUpdated(new Date());
      setLoading(false);
    } catch (err) {
      console.error('Failed to load data:', err);
      setError(err);
      setLoading(false);
    }
  }, []);

  // Load data on component mount
  useEffect(() => {
    const initializeData = async () => {
      await loadData();
    };
    initializeData();
  }, [loadData]);

  // Auto-refresh data every 5 minutes
  useEffect(() => {
    const interval = setInterval(() => {
      console.log('Auto-refreshing data...');
      refreshHostData(latestVersion)
        .then(updatedHosts => {
          setHosts(updatedHosts);

          // Derive host groups from refreshed hosts to keep filters in sync
          const derivedGroups = Array.from(new Set(updatedHosts.flatMap((h) => {
            const groups = [];
            if (h.hostGroup) groups.push(h.hostGroup);
            if (h.hostGroups && Array.isArray(h.hostGroups)) {
              h.hostGroups.forEach((g) => { if (g && g.name) groups.push(g.name); });
            }
            return groups;
          }))).sort();
          setHostGroups(derivedGroups);

          setLastUpdated(new Date());
        })
        .catch(err => {
          console.error('Auto-refresh failed:', err);
        });
    }, 5 * 60 * 1000); // 5 minutes

    return () => clearInterval(interval);
  }, [latestVersion]);

  // Filter hosts based on all criteria
  const filteredHosts = useMemo(() => {
    console.log('Filtering with selectedHostGroup:', selectedHostGroup);
    console.log('Total hosts:', hosts.length);
    
    const filtered = hosts.filter(host => {
      // Search filter
      const matchesSearch = searchTerm === '' || 
        host.hostname.toLowerCase().includes(searchTerm.toLowerCase()) ||
        host.ip.includes(searchTerm);

      // Host group filter - check if host belongs to selected group
      const matchesHostGroup = selectedHostGroup === '' || 
        host.hostGroup === selectedHostGroup ||
        (host.hostGroups && host.hostGroups.some(group => group.name === selectedHostGroup));

      // Debug logging
      if (selectedHostGroup !== '') {
        console.log(`Host: ${host.hostname}, hostGroup: ${host.hostGroup}, hostGroups:`, host.hostGroups, 'matches:', matchesHostGroup);
      }

      // Status filter
      const matchesStatus = statusFilter === '' || 
        host.status === statusFilter;

      return matchesSearch && matchesHostGroup && matchesStatus;
    });
    
    console.log('Filtered hosts count:', filtered.length);
    return filtered;
  }, [hosts, searchTerm, selectedHostGroup, statusFilter]);

  // Paginate filtered hosts
  const paginatedHosts = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    return filteredHosts.slice(startIndex, endIndex);
  }, [filteredHosts, currentPage, pageSize]);

  const totalPages = Math.ceil(filteredHosts.length / pageSize);

  const handlePageChange = (page) => {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handlePageSizeChange = (newSize) => {
    setPageSize(newSize);
    setCurrentPage(1);
  };

  // Filter change handlers that reset pagination
  const handleSearchChange = (value) => {
    setSearchTerm(value);
    setCurrentPage(1);
  };

  const handleHostGroupChange = (value) => {
    setSelectedHostGroup(value);
    setCurrentPage(1);
  };

  const handleStatusFilterChange = (value) => {
    setStatusFilter(value);
    setCurrentPage(1);
  };

  // Action handlers
  const handleInstall = async (host) => {
    // Check if localhost - open local install modal
    if (host.hostname.toLowerCase() === 'localhost') {
      setSelectedHost(host);
      setLocalInstallModalOpen(true);
      return;
    }
    
    // Open version selector modal for remote hosts
    setSelectedHost(host);
    setActionType('install');
    setVersionSelectorOpen(true);
  };

  const handleLocalInstall = async (installData) => {
    const toastId = toast.loading('Installing Zabbix Agent on local RHEL server...');
    
    try {
      await installLocalhostAgent(installData);
      
      toast.success('Zabbix Agent installed successfully on RHEL server!', { id: toastId });
      
      // Reload data to reflect the installation
      setTimeout(() => {
        loadData();
      }, 2000);
      
    } catch (error) {
      toast.error(`Installation failed: ${error.message}`, { id: toastId });
      throw error;
    }
  };

  const handleUpdate = async (host) => {
    // Open version selector modal
    setSelectedHost(host);
    setActionType('update');
    setVersionSelectorOpen(true);
  };

  const handleVersionSelected = async (selectedVersion) => {
    if (!selectedHost) return;
    
    if (!selectedVersion) {
      toast.error('Please select a version');
      return;
    }
    
    const host = selectedHost;
    const action = actionType;
    
    console.log(`\n=== ${action.toUpperCase()} INITIATED ===`);
    console.log(`Host: ${host.hostname}`);
    console.log(`Selected Version: ${selectedVersion}`);
    console.log(`Action: ${action}`);
    console.log(`========================\n`);
    
    const toastId = toast.loading(`Downloading Zabbix Agent ${selectedVersion}...`);
    
    try {
      // Download the agent package with selected version
      console.log(`Calling downloadAgentPackage with version: ${selectedVersion}`);
      const downloadResult = await downloadAgentPackage(selectedVersion);
      console.log(`Download completed: ${downloadResult.path}`);
      
      toast.loading(`${action === 'install' ? 'Installing' : 'Updating'} Zabbix Agent ${selectedVersion} on ${host.hostname}...`, {
        id: toastId,
      });
      
      // Log the action to a file via backend
      await logAgentAction(action, {
        ...host,
        latestVersion: selectedVersion,
        status: 'success'
      });
      
      toast.success(`Successfully ${action === 'install' ? 'installed' : 'updated'} Zabbix Agent ${selectedVersion} on ${host.hostname}`, {
        id: toastId,
        description: `Version: ${selectedVersion} | Downloaded to: ${downloadResult.path}`,
        duration: 6000,
      });
      
      // Reload data after installation/update
      await loadData();
    } catch (err) {
      console.error(`${action} failed:`, err);
      
      // Log the failed action
      try {
        await logAgentAction(action, {
          ...host,
          latestVersion: selectedVersion,
          status: 'failed',
          error: err.message
        });
      } catch (logError) {
        console.error('Failed to log error:', logError);
      }
      
      let errorMessage = err.message;
      if (errorMessage.includes('404')) {
        errorMessage = `Version ${selectedVersion} not available on Zabbix CDN. Try a different version.`;
      }
      
      toast.error(`Failed to ${action} agent on ${host.hostname}`, {
        id: toastId,
        description: errorMessage,
        duration: 7000,
      });
    }
  };

  const handleRefresh = () => {
    loadData();
  };

  // Show loading state
  if (loading && hosts.length === 0) {
    return (
      <div className="app">
        <Header onRefresh={handleRefresh} loading={loading} lastUpdated={lastUpdated} />
        <main className="main-content">
          <Loading message="Loading data from Zabbix server..." />
        </main>
      </div>
    );
  }

  // Show error state (with fallback data if available)
  if (error && hosts.length === 0) {
    return (
      <div className="app">
        <Header onRefresh={handleRefresh} loading={loading} lastUpdated={lastUpdated} />
        <main className="main-content">
          <ErrorMessage error={error} onRetry={handleRefresh} />
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      <Toaster position="top-right" richColors closeButton />
      <VersionSelector
        isOpen={versionSelectorOpen}
        onClose={() => setVersionSelectorOpen(false)}
        onSelect={handleVersionSelected}
        action={actionType}
        hostname={selectedHost?.hostname}
        currentVersion={selectedHost?.currentVersion}
      />
      <Header 
        onRefresh={handleRefresh} 
        loading={loading} 
        lastUpdated={lastUpdated}
        onNavigate={setCurrentView}
        currentView={currentView}
      />
      <main className="main-content">
        {currentView === 'logs' ? (
          <LogsPage />
        ) : (
          <>
            {error && (
              <div className="error-banner">
                <span>⚠️ Using cached data due to connection issue. </span>
                <button onClick={handleRefresh} className="refresh-link">Retry</button>
              </div>
            )}

            <StatsBar hosts={filteredHosts} />
            <FilterPanel
              hostGroups={hostGroups}
              selectedHostGroup={selectedHostGroup}
              onHostGroupChange={handleHostGroupChange}
              searchTerm={searchTerm}
              onSearchChange={handleSearchChange}
              statusFilter={statusFilter}
              onStatusFilterChange={handleStatusFilterChange}
              totalHosts={hosts.length}
              filteredHosts={filteredHosts.length}
            />
            <HostTable
              hosts={paginatedHosts}
              onInstall={handleInstall}
              onUpdate={handleUpdate}
            />
            {filteredHosts.length > 0 && (
              <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                pageSize={pageSize}
                totalItems={filteredHosts.length}
                onPageChange={handlePageChange}
                onPageSizeChange={handlePageSizeChange}
              />
            )}
          </>
        )}
      </main>

      {/* Local Install Modal */}
      <LocalInstallModal
        isOpen={localInstallModalOpen}
        onClose={() => setLocalInstallModalOpen(false)}
        onInstall={handleLocalInstall}
        availableVersions={availableVersions}
        latestVersion={latestVersion}
      />
    </div>
  );
}

export default App;
