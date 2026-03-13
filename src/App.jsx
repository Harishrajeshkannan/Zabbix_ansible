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
import { logAgentAction, downloadAgentPackage, installRemoteAgent } from './services/backendService';
import { ZABBIX_CONFIG } from './config/zabbixConfig';
import './App.css';

function App() {
  const canHostBeActioned = (host) => host.status === 'No Agent' || host.status === 'Outdated';
  const resolvePreferredSSHHost = (host) => {
    const ip = (host?.ip || '').trim();
    return ip && ip.toUpperCase() !== 'N/A' ? ip : (host?.hostname || '');
  };

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
  const [selectedHostIds, setSelectedHostIds] = useState([]);
  const [batchHosts, setBatchHosts] = useState([]);

  // Load data from Zabbix API
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
      console.log('Fetching data from Zabbix API...');
      const data = await fetchAllData();
      setHosts(data.hosts);
      setSelectedHostIds((prev) => prev.filter((id) => data.hosts.some((host) => host.id === id)));
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

  // Check backend server status on mount
  useEffect(() => {
    const checkBackendStatus = async () => {
      try {
        const response = await fetch('http://localhost:3001/api/health');
        if (response.ok) {
          const data = await response.json();
          toast.success('✅ Backend Server Running', {
            description: `Version: ${data.version} | Platform: ${data.platform} | Latest code deployed`,
            duration: 5000,
          });
        }
      } catch {
        toast.error('❌ Backend Server Not Responding', {
          description: 'Please ensure the backend server is running on port 3001',
          duration: 5000,
        });
      }
    };
    
    // Delay slightly to ensure UI is ready
    const timer = setTimeout(checkBackendStatus, 500);
    return () => clearTimeout(timer);
  }, []);

  // Auto-refresh data every 5 minutes
  useEffect(() => {
    const interval = setInterval(() => {
      console.log('Auto-refreshing data...');
      refreshHostData(latestVersion)
        .then(updatedHosts => {
          setHosts(updatedHosts);
          setSelectedHostIds((prev) => prev.filter((id) => updatedHosts.some((host) => host.id === id)));

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

  const selectedHosts = useMemo(
    () => hosts.filter((host) => selectedHostIds.includes(host.id)),
    [hosts, selectedHostIds]
  );

  const visibleActionableHosts = useMemo(
    () => paginatedHosts.filter(canHostBeActioned),
    [paginatedHosts]
  );

  const allVisibleSelected =
    visibleActionableHosts.length > 0 &&
    visibleActionableHosts.every((host) => selectedHostIds.includes(host.id));

  const selectedInstallCount = selectedHosts.filter((host) => host.status === 'No Agent').length;
  const selectedUpdateCount = selectedHosts.filter((host) => host.status === 'Outdated').length;

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

  const handleToggleHostSelection = (host) => {
    if (!canHostBeActioned(host)) return;

    setSelectedHostIds((prev) =>
      prev.includes(host.id) ? prev.filter((id) => id !== host.id) : [...prev, host.id]
    );
  };

  const handleToggleSelectAllVisible = (checked) => {
    const visibleIds = visibleActionableHosts.map((host) => host.id);

    setSelectedHostIds((prev) => {
      if (checked) {
        return [...new Set([...prev, ...visibleIds])];
      }
      return prev.filter((id) => !visibleIds.includes(id));
    });
  };

  const handleBatchAction = (action) => {
    const targets = selectedHosts.filter((host) =>
      action === 'install' ? host.status === 'No Agent' : host.status === 'Outdated'
    );

    if (targets.length < 1) {
      toast.error(`No eligible hosts selected for ${action}.`);
      return;
    }

    setBatchHosts(targets);
    setSelectedHost(targets[0]);
    setActionType(action);
    setLocalInstallModalOpen(true);
  };

  const handleCloseInstallModal = () => {
    setLocalInstallModalOpen(false);
    setBatchHosts([]);
  };

  // Action handlers
  const handleInstall = async (host) => {
    // Open SSH install modal for all hosts
    setSelectedHost(host);
    setActionType('install');
    setLocalInstallModalOpen(true);
  };

  const handleLocalInstall = async (installData) => {
    const action = actionType || 'install';
    const actionVerb = action === 'install' ? 'Installing' : 'Updating';
    const actionPastTense = action === 'install' ? 'installed' : 'updated';

    const isBatch = batchHosts.length > 1;
    const targets = isBatch ? batchHosts : [selectedHost].filter(Boolean);

    if (targets.length === 0) {
      toast.error('No host selected');
      throw new Error('No host selected');
    }

    if (!isBatch) {
      const toastId = toast.loading(`${actionVerb} Zabbix Agent on ${installData.host} via SSH...`);
      try {
        await installRemoteAgent(installData);
        toast.success(`Zabbix Agent ${actionPastTense} successfully on ${installData.host}!`, { id: toastId });
        setTimeout(() => {
          loadData();
        }, 2000);
      } catch (error) {
        toast.error(`${action === 'install' ? 'Installation' : 'Update'} failed: ${error.message}`, { id: toastId });
        throw error;
      }
      return;
    }

    const toastId = toast.loading(`${actionVerb} on 1/${targets.length}: ${targets[0].hostname}`);
    const failures = [];
    let successCount = 0;

    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];

      toast.loading(`${actionVerb} on ${i + 1}/${targets.length}: ${target.hostname}`, { id: toastId });

      const payload = {
        host: resolvePreferredSSHHost(target),
        sshPort: installData.sshPort,
        sshUser: installData.sshUser,
        sshPassword: installData.sshPassword,
        version: installData.version,
        serverIP: installData.serverIP,
        serverPort: installData.serverPort,
        hostname: target.hostname
      };

      try {
        await installRemoteAgent(payload);
        successCount += 1;
      } catch (error) {
        failures.push({ hostname: target.hostname, message: error.message });
      }
    }

    if (failures.length === 0) {
      toast.success(`Batch ${actionPastTense} completed on ${successCount}/${targets.length} hosts`, { id: toastId });
    } else {
      const failureSummary = failures
        .slice(0, 3)
        .map((item) => `${item.hostname}: ${item.message}`)
        .join(' | ');

      toast.error(
        `Batch finished with failures (${successCount}/${targets.length} successful)`,
        { id: toastId, description: failureSummary }
      );
    }

    setSelectedHostIds([]);
    setBatchHosts([]);
    await loadData();
  };

  const handleUpdate = async (host) => {
    // Open SSH install modal for update (reuse same modal)
    setSelectedHost(host);
    setActionType('update');
    setLocalInstallModalOpen(true);
  };

  const handleVersionSelected = async (selectedVersionOrData) => {
    if (!selectedHost) return;
    
    // Extract version - handle both string and object formats
    const selectedVersion = typeof selectedVersionOrData === 'string' 
      ? selectedVersionOrData 
      : selectedVersionOrData?.version;
    
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
              selectedHostIds={selectedHostIds}
              onToggleHostSelection={handleToggleHostSelection}
              onToggleSelectAllVisible={handleToggleSelectAllVisible}
              allVisibleSelected={allVisibleSelected}
            />
            {selectedHostIds.length > 1 && (
              <div className="batch-actions-bar">
                <div className="batch-actions-summary">
                  {selectedHostIds.length} hosts selected
                </div>
                <div className="batch-actions-buttons">
                  {selectedInstallCount > 0 && (
                    <button
                      type="button"
                      className="batch-btn batch-install"
                      onClick={() => handleBatchAction('install')}
                    >
                      Install Selected ({selectedInstallCount})
                    </button>
                  )}
                  {selectedUpdateCount > 0 && (
                    <button
                      type="button"
                      className="batch-btn batch-update"
                      onClick={() => handleBatchAction('update')}
                    >
                      Update Selected ({selectedUpdateCount})
                    </button>
                  )}
                </div>
              </div>
            )}
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

      {/* SSH Install/Update Modal */}
      <LocalInstallModal
        isOpen={localInstallModalOpen}
        onClose={handleCloseInstallModal}
        onInstall={handleLocalInstall}
        availableVersions={availableVersions}
        latestVersion={latestVersion}
        selectedHost={selectedHost}
        selectedHosts={batchHosts}
        action={actionType}
      />
    </div>
  );
}

export default App;
