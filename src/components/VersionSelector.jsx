import { useState, useEffect } from 'react';
import './VersionSelector.css';

const VersionSelector = ({ isOpen, onClose, onSelect, action, hostname, currentVersion }) => {
  const [versions, setVersions] = useState([]);
  const [selectedVersion, setSelectedVersion] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isOpen) {
      fetchVersions();
    }
  }, [isOpen]);

  const fetchVersions = async () => {
    setLoading(true);
    try {
      const { fetchAgentVersions } = await import('../services/backendService');
      const data = await fetchAgentVersions();
      setVersions(data.versions || []);
      if (data.versions && data.versions.length > 0) {
        setSelectedVersion(data.versions[0]); // Select latest by default
      }
    } catch (error) {
      console.error('Failed to fetch versions:', error);
      // Fallback versions
      const fallbackVersions = ['7.4.5', '7.4.4', '7.4.3', '7.4.2', '7.4.1', '7.4.0'];
      setVersions(fallbackVersions);
      setSelectedVersion(fallbackVersions[0]);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = () => {
    if (selectedVersion) {
      onSelect(selectedVersion);
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Select Zabbix Agent Version</h2>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="version-info">
            <p><strong>Host:</strong> {hostname}</p>
            <p><strong>Action:</strong> {action === 'install' ? 'Install' : 'Update'}</p>
            {currentVersion && action === 'update' && (
              <p><strong>Current Version:</strong> {currentVersion}</p>
            )}
          </div>

          {loading ? (
            <div className="version-loading">Loading available versions...</div>
          ) : (
            <>
              <label htmlFor="version-select" className="version-label">
                Choose Version to {action === 'install' ? 'Install' : 'Update To'}:
              </label>
              <select
                id="version-select"
                className="version-select"
                value={selectedVersion}
                onChange={(e) => setSelectedVersion(e.target.value)}
              >
                {versions.map((version) => (
                  <option key={version} value={version}>
                    {version} {version === versions[0] ? '(Latest)' : ''}
                  </option>
                ))}
              </select>
              
              <div className="version-count">
                {versions.length} versions available
              </div>
            </>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn-cancel" onClick={onClose}>
            Cancel
          </button>
          <button 
            className="btn btn-confirm" 
            onClick={handleConfirm}
            disabled={!selectedVersion || loading}
          >
            {action === 'install' ? 'Install' : 'Update'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default VersionSelector;
