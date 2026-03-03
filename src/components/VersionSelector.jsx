import { useState, useEffect } from 'react';
import './VersionSelector.css';

const VersionSelector = ({ isOpen, onClose, onSelect, action, hostname, currentVersion }) => {
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formData, setFormData] = useState({
    version: '',
    serverIP: '',
    serverPort: '10051',
    hostname: hostname || 'localhost',
    usePSK: false,
    psk: '',
    pskIdentity: ''
  });

  useEffect(() => {
    if (isOpen) {
      fetchVersions();
      setFormData(prev => ({
        ...prev,
        hostname: hostname || 'localhost'
      }));
    }
  }, [isOpen, hostname]);

  const fetchVersions = async () => {
    setLoading(true);
    try {
      const { fetchAgentVersions } = await import('../services/backendService');
      const data = await fetchAgentVersions();
      setVersions(data.versions || []);
      if (data.versions && data.versions.length > 0) {
        setFormData(prev => ({
          ...prev,
          version: data.versions[0] // Select latest by default
        }));
      }
    } catch (error) {
      console.error('Failed to fetch versions:', error);
      // Fallback versions
      const fallbackVersions = ['7.4.5', '7.4.4', '7.4.3', '7.4.2', '7.4.1', '7.4.0'];
      setVersions(fallbackVersions);
      setFormData(prev => ({
        ...prev,
        version: fallbackVersions[0]
      }));
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const handleConfirm = (e) => {
    e.preventDefault();
    if (formData.version && formData.serverIP) {
      onSelect(formData);
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{action === 'install' ? 'Install' : 'Update'} Zabbix Agent</h2>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        
        <form onSubmit={handleConfirm} className="modal-body">
          <div className="version-info">
            <p><strong>Action:</strong> {action === 'install' ? 'Install' : 'Update'}</p>
            {currentVersion && action === 'update' && (
              <p><strong>Current Version:</strong> {currentVersion}</p>
            )}
          </div>

          {loading ? (
            <div className="version-loading">Loading available versions...</div>
          ) : (
            <>
              <div className="form-group">
                <label htmlFor="version-select" className="version-label">
                  Zabbix Agent Version *
                </label>
                <select
                  id="version-select"
                  name="version"
                  className="version-select"
                  value={formData.version}
                  onChange={handleChange}
                  required
                >
                  {versions.map((version) => (
                    <option key={version} value={version}>
                      {version} {version === versions[0] ? '(Latest)' : ''}
                    </option>
                  ))}
                </select>
                <small className="version-count">{versions.length} versions available</small>
              </div>

              <div className="form-group">
                <label htmlFor="serverIP">Zabbix Server IP/Hostname *</label>
                <input
                  type="text"
                  id="serverIP"
                  name="serverIP"
                  value={formData.serverIP}
                  onChange={handleChange}
                  placeholder="192.168.1.100 or zabbix.example.com"
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="serverPort">Zabbix Server Port</label>
                <input
                  type="number"
                  id="serverPort"
                  name="serverPort"
                  value={formData.serverPort}
                  onChange={handleChange}
                  min="1"
                  max="65535"
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="hostname">Agent Hostname</label>
                <input
                  type="text"
                  id="hostname"
                  name="hostname"
                  value={formData.hostname}
                  onChange={handleChange}
                  placeholder="localhost or hostname"
                  required
                />
              </div>

              <div className="form-group checkbox-group">
                <label>
                  <input
                    type="checkbox"
                    name="usePSK"
                    checked={formData.usePSK}
                    onChange={handleChange}
                  />
                  <span>Use PSK Encryption</span>
                </label>
              </div>

              {formData.usePSK && (
                <>
                  <div className="form-group">
                    <label htmlFor="pskIdentity">PSK Identity</label>
                    <input
                      type="text"
                      id="pskIdentity"
                      name="pskIdentity"
                      value={formData.pskIdentity}
                      onChange={handleChange}
                      placeholder="PSK Identity"
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="psk">PSK (Pre-Shared Key)</label>
                    <textarea
                      id="psk"
                      name="psk"
                      value={formData.psk}
                      onChange={handleChange}
                      placeholder="Enter PSK in hex format"
                      rows="3"
                    />
                    <small>Enter the pre-shared key in hexadecimal format (64 characters)</small>
                  </div>
                </>
              )}
            </>
          )}

          <div className="modal-footer">
            <button type="button" className="btn btn-cancel" onClick={onClose}>
              Cancel
            </button>
            <button 
              type="submit"
              className="btn btn-confirm" 
              disabled={!formData.version || !formData.serverIP || loading}
            >
              {action === 'install' ? 'Install' : 'Update'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default VersionSelector;
