import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { FileText, RefreshCw, Check, X, Eye, XCircle, Server, Calendar, Filter, Search, ArrowUpDown } from 'lucide-react';
import './LogsPage.css';

const LogsPage = () => {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedLog, setSelectedLog] = useState(null);
  const [logContent, setLogContent] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // all, success, failed
  const [hostnameFilter, setHostnameFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [sortField, setSortField] = useState('timestamp');
  const [sortOrder, setSortOrder] = useState('desc');

  useEffect(() => {
    fetchLogs();
  }, []);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const response = await fetch('http://localhost:3001/api/logs');
      const data = await response.json();
      
      // Parse log filenames to extract info
      // Format: hostname_action_status_timestamp.txt
      const parsedLogsPromises = (data.logs || []).map(async (log) => {
        const parts = log.Name.replace('.txt', '').split('_');
        
        // Find where timestamp starts (it contains ISO format with dashes)
        let timestampStartIndex = parts.findIndex(part => part.match(/^\d{4}-\d{2}-\d{2}T/));
        
        let hostname, action, status;
        
        if (timestampStartIndex > 0) {
          // Everything before timestamp minus last 2 parts (action and status)
          hostname = parts.slice(0, timestampStartIndex - 2).join('_');
          action = parts[timestampStartIndex - 2];
          status = parts[timestampStartIndex - 1];
        } else {
          // Fallback parsing
          hostname = parts[0];
          action = parts[1] || 'unknown';
          status = parts[2] || 'unknown';
        }
        
        // Fetch log content to extract version
        let version = 'N/A';
        try {
          const contentResponse = await fetch(`http://localhost:3001/api/logs/${log.Name}`);
          const contentData = await contentResponse.json();
          if (contentData.success) {
            // Extract version from log content
            const versionMatch = contentData.content.match(/Version: ([\d.]+)/);
            if (versionMatch) {
              version = versionMatch[1];
            } else {
              // Try alternate pattern for "To Version:"
              const toVersionMatch = contentData.content.match(/To Version: ([\d.]+)/);
              if (toVersionMatch) {
                version = toVersionMatch[1];
              }
            }
          }
        } catch (err) {
          console.error(`Failed to fetch version for ${log.Name}:`, err);
        }
        
        // Parse LastWriteTime to proper date format
        const logDate = log.LastWriteTime ? new Date(log.LastWriteTime) : new Date();
        const displayTime = logDate.toLocaleString();
        
        return {
          ...log,
          hostname,
          action,
          status,
          version,
          timestamp: logDate,
          displayTime
        };
      });
      
      const parsedLogs = await Promise.all(parsedLogsPromises);
      parsedLogs.sort((a, b) => b.timestamp - a.timestamp);
      
      setLogs(parsedLogs);
    } catch (error) {
      console.error('Failed to fetch logs:', error);
      toast.error('Failed to load logs');
    } finally {
      setLoading(false);
    }
  };

  const viewLogContent = async (logName) => {
    try {
      const response = await fetch(`http://localhost:3001/api/logs/${logName}`);
      const data = await response.json();
      
      if (data.success) {
        setLogContent(data.content);
        setSelectedLog(logName);
      } else {
        toast.error('Failed to load log content');
      }
    } catch (error) {
      console.error('Failed to fetch log content:', error);
      toast.error('Failed to load log content');
    }
  };

  const closeModal = () => {
    setSelectedLog(null);
    setLogContent('');
  };

  const filteredLogs = logs.filter(log => {
    // Status filter
    if (statusFilter !== 'all' && log.status !== statusFilter) {
      return false;
    }
    
    // Hostname filter
    if (hostnameFilter && !log.hostname.toLowerCase().includes(hostnameFilter.toLowerCase())) {
      return false;
    }
    
    // Date filter
    if (dateFilter) {
      const filterDate = new Date(dateFilter);
      const logDate = new Date(log.timestamp);
      // Compare only the date part (ignore time)
      if (logDate.toDateString() !== filterDate.toDateString()) {
        return false;
      }
    }
    
    return true;
  }).sort((a, b) => {
    let aVal = a[sortField];
    let bVal = b[sortField];
    
    if (sortField === 'timestamp') {
      aVal = new Date(aVal).getTime();
      bVal = new Date(bVal).getTime();
    } else if (typeof aVal === 'string') {
      aVal = aVal.toLowerCase();
      bVal = bVal.toLowerCase();
    }
    
    if (sortOrder === 'asc') {
      return aVal > bVal ? 1 : -1;
    } else {
      return aVal < bVal ? 1 : -1;
    }
  });
  
  const handleSort = (field) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  const statsData = {
    total: filteredLogs.length,
    totalAll: logs.length,
    success: filteredLogs.filter(l => l.status === 'success').length,
    failed: filteredLogs.filter(l => l.status === 'failed').length
  };

  return (
    <div className="logs-page">
      <div className="logs-header">
        <div>
          <h1><FileText size={28} style={{ verticalAlign: 'middle', marginRight: '8px' }} /> Deployment Logs</h1>
          {statsData.total !== statsData.totalAll && (
            <p className="filter-info">
              <Filter size={14} /> Showing {statsData.total} of {statsData.totalAll} logs
            </p>
          )}
        </div>
        <button className="refresh-btn" onClick={fetchLogs} disabled={loading}>
          <RefreshCw size={16} className={loading ? 'spinning' : ''} /> {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      <div className="logs-stats">
        <div className="stat-card">
          <div className="stat-value">{statsData.total}</div>
          <div className="stat-label">Total Logs</div>
        </div>
        <div className="stat-card success">
          <div className="stat-value">{statsData.success}</div>
          <div className="stat-label">Successful</div>
        </div>
        <div className="stat-card failed">
          <div className="stat-value">{statsData.failed}</div>
          <div className="stat-label">Failed</div>
        </div>
      </div>

      <div className="logs-filter">
        <div className="filter-section">
          <label className="filter-label">
            <Server size={14} /> Hostname
          </label>
          <div className="search-input-wrapper">
            <Search size={16} className="search-icon" />
            <input 
              type="text"
              className="filter-search"
              placeholder="Search hostname..."
              value={hostnameFilter}
              onChange={(e) => setHostnameFilter(e.target.value)}
            />
            {hostnameFilter && (
              <button 
                className="clear-input-btn"
                onClick={() => setHostnameFilter('')}
                title="Clear"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        <div className="filter-section">
          <label className="filter-label">
            <Calendar size={14} /> Date
          </label>
          <input 
            type="date"
            className="filter-date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
          />
        </div>

        <div className="filter-section">
          <label className="filter-label">
            <Filter size={14} /> Status
          </label>
          <div className="filter-buttons">
            <button 
              className={`filter-btn ${statusFilter === 'all' ? 'active' : ''}`}
              onClick={() => setStatusFilter('all')}
            >
              All
            </button>
            <button 
              className={`filter-btn ${statusFilter === 'success' ? 'active' : ''}`}
              onClick={() => setStatusFilter('success')}
            >
              <Check size={16} style={{ marginRight: '4px', verticalAlign: 'middle' }} /> Success
            </button>
            <button 
              className={`filter-btn ${statusFilter === 'failed' ? 'active' : ''}`}
              onClick={() => setStatusFilter('failed')}
            >
              <XCircle size={16} style={{ marginRight: '4px', verticalAlign: 'middle' }} /> Failed
            </button>
          </div>
        </div>

        {(hostnameFilter || dateFilter || statusFilter !== 'all') && (
          <button 
            className="clear-filters-btn"
            onClick={() => {
              setHostnameFilter('');
              setDateFilter('');
              setStatusFilter('all');
            }}
            title="Clear all filters"
          >
            <X size={16} /> Clear All
          </button>
        )}
      </div>

      {loading ? (
        <div className="logs-loading">Loading logs...</div>
      ) : filteredLogs.length === 0 ? (
        <div className="logs-empty">
          {logs.length === 0 ? (
            <>
              <FileText size={48} style={{ opacity: 0.3, marginBottom: '16px' }} />
              <p>No deployment logs found</p>
              <p style={{ fontSize: '14px', color: '#9ca3af', marginTop: '8px' }}>Logs will appear here after agent installations or updates</p>
            </>
          ) : (
            <>
              <Filter size={48} style={{ opacity: 0.3, marginBottom: '16px' }} />
              <p>No logs match your filters</p>
              <button 
                className="clear-filters-btn" 
                style={{ marginTop: '16px' }}
                onClick={() => {
                  setHostnameFilter('');
                  setDateFilter('');
                  setStatusFilter('all');
                }}
              >
                <X size={16} /> Clear All Filters
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="logs-table-container">
          <table className="logs-table">
            <thead>
              <tr>
                <th 
                  className="sortable"
                  onClick={() => handleSort('status')}
                  title="Click to sort"
                >
                  Status {sortField === 'status' && <ArrowUpDown size={14} className="sort-icon" />}
                </th>
                <th 
                  className="sortable"
                  onClick={() => handleSort('hostname')}
                  title="Click to sort"
                >
                  Hostname {sortField === 'hostname' && <ArrowUpDown size={14} className="sort-icon" />}
                </th>
                <th 
                  className="sortable"
                  onClick={() => handleSort('action')}
                  title="Click to sort"
                >
                  Action {sortField === 'action' && <ArrowUpDown size={14} className="sort-icon" />}
                </th>
                <th 
                  className="sortable"
                  onClick={() => handleSort('version')}
                  title="Click to sort"
                >
                  Version {sortField === 'version' && <ArrowUpDown size={14} className="sort-icon" />}
                </th>
                <th 
                  className="sortable"
                  onClick={() => handleSort('timestamp')}
                  title="Click to sort"
                >
                  Timestamp {sortField === 'timestamp' && <ArrowUpDown size={14} className="sort-icon" />}
                </th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredLogs.map((log) => (
                <tr key={log.Name}>
                  <td>
                    <span className={`status-badge ${log.status}`}>
                      {log.status === 'success' ? <Check size={14} style={{ marginRight: '4px', verticalAlign: 'middle' }} /> : <X size={14} style={{ marginRight: '4px', verticalAlign: 'middle' }} />} {log.status.toUpperCase()}
                    </span>
                  </td>
                  <td className="hostname">{log.hostname}</td>
                  <td>
                    <span className={`action-badge ${log.action}`}>
                      {log.action.toUpperCase()}
                    </span>
                  </td>
                  <td>{log.version}</td>
                  <td>{log.displayTime}</td>
                  <td>
                    <button 
                      className="view-btn"
                      onClick={() => viewLogContent(log.Name)}
                    >
                      <Eye size={16} style={{ marginRight: '4px' }} /> View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedLog && (
        <div className="log-modal-overlay" onClick={closeModal}>
          <div className="log-modal" onClick={(e) => e.stopPropagation()}>
            <div className="log-modal-header">
              <h2><FileText size={20} style={{ verticalAlign: 'middle', marginRight: '8px' }} /> {selectedLog}</h2>
              <button className="close-btn" onClick={closeModal}><X size={20} /></button>
            </div>
            <div className="log-modal-content">
              <pre>{logContent}</pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LogsPage;
