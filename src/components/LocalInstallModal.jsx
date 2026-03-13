import React, { useState, useEffect } from 'react';
import './LocalInstallModal.css';

const resolvePreferredSSHHost = (host) => {
  if (!host) return '';

  const ip = (host.ip || '').trim();
  if (ip && ip.toUpperCase() !== 'N/A') {
    return ip;
  }

  return host.hostname || '';
};

const LocalInstallModal = ({ isOpen, onClose, onInstall, availableVersions, latestVersion, selectedHost, action = 'install' }) => {
  const [formData, setFormData] = useState({
    host: resolvePreferredSSHHost(selectedHost),
    sshPort: '22',
    sshUser: '',
    sshPassword: '',
    version: latestVersion,
    serverIP: '',
    serverPort: '10051',
    hostname: selectedHost?.hostname || '',
    usePSK: false,
    psk: '',
    pskIdentity: ''
  });
  const [installing, setInstalling] = useState(false);

  // Update form when selectedHost changes
  useEffect(() => {
    if (selectedHost) {
      setFormData(prev => ({
        ...prev,
        host: resolvePreferredSSHHost(selectedHost),
        hostname: selectedHost.hostname || '',
        // Pre-fill version with current version for updates
        version: action === 'update' && selectedHost.agentVersion 
          ? selectedHost.agentVersion 
          : latestVersion
      }));
    }
  }, [selectedHost, action, latestVersion]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setInstalling(true);
    
    console.log('[LocalInstallModal] Form submitted');
    console.log('[LocalInstallModal] Form data:', formData);
    
    try {
      await onInstall(formData);
      onClose();
    } catch (error) {
      console.error('Installation failed:', error);
    } finally {
      setInstalling(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{action === 'update' ? 'Update' : 'Install'} Zabbix Agent via SSH</h2>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        
        <form onSubmit={handleSubmit} className="install-form">
          <div className="form-section">
            <h3>SSH Connection</h3>
            {action === 'update' && selectedHost?.agentVersion && (
              <div className="update-info" style={{ marginBottom: '15px', padding: '10px', background: '#e3f2fd', borderRadius: '4px' }}>
                <strong>Current Version:</strong> {selectedHost.agentVersion}
              </div>
            )}
            
            <div className="form-group">
              <label htmlFor="host">Remote Server IP/Hostname *</label>
              <input
                type="text"
                id="host"
                name="host"
                value={formData.host}
                onChange={handleChange}
                placeholder="192.168.1.100 or server.example.com"
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="sshPort">SSH Port</label>
              <input
                type="number"
                id="sshPort"
                name="sshPort"
                value={formData.sshPort}
                onChange={handleChange}
                min="1"
                max="65535"
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="sshUser">SSH Username *</label>
              <input
                type="text"
                id="sshUser"
                name="sshUser"
                value={formData.sshUser}
                onChange={handleChange}
                placeholder="root or username with sudo access"
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="sshPassword">SSH Password *</label>
              <input
                type="password"
                id="sshPassword"
                name="sshPassword"
                value={formData.sshPassword}
                onChange={handleChange}
                placeholder="SSH password"
                required
              />
            </div>
          </div>

          <div className="form-section">
            <h3>Zabbix Agent Configuration</h3>
            
            <div className="form-group">
              <label htmlFor="version">Agent Version</label>
            <select
              id="version"
              name="version"
              value={formData.version}
              onChange={handleChange}
              required
            >
              {availableVersions.map(v => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
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
            <label htmlFor="serverPort">Server Port</label>
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
            <label htmlFor="hostname">Agent Hostname (for Zabbix)</label>
            <input
              type="text"
              id="hostname"
              name="hostname"
              value={formData.hostname}
              onChange={handleChange}
              placeholder="Hostname as it appears in Zabbix"
              required
            />
          </div>
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

          <div className="form-info">
            <strong>{action === 'update' ? 'Update' : 'Installation'} Process:</strong>
            <ul>
              <li>Connect to remote server via SSH</li>
              <li>Download Zabbix Agent RPM package</li>
              <li>{action === 'update' ? 'Update' : 'Install'} zabbix-agent2 via DNF</li>
              <li>Configure agent with server details</li>
              <li>Enable and start zabbix-agent2 service</li>
              <li>Retrieve {action === 'update' ? 'update' : 'installation'} logs</li>
            </ul>
            <div style={{ marginTop: '10px', padding: '10px', background: '#fff3cd', borderRadius: '4px', fontSize: '0.9em' }}>
              <strong>⚠️ Requirements:</strong>
              <ul style={{ margin: '5px 0', paddingLeft: '20px' }}>
                <li>RHEL 8+ operating system</li>
                <li>SSH access (port 22 or custom)</li>
                <li>User with sudo privileges</li>
                <li>Internet access to repo.zabbix.com</li>
              </ul>
            </div>
          </div>

          <div className="modal-actions">
            <button type="button" className="btn-cancel" onClick={onClose} disabled={installing}>
              Cancel
            </button>
            <button type="submit" className="btn-install" disabled={installing}>
              {installing 
                ? (action === 'update' ? 'Updating...' : 'Installing...') 
                : (action === 'update' ? 'Update Agent' : 'Install Agent')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default LocalInstallModal;
  <div style={{ marginTop: '10px', padding: '10px', background: '#f0f7ff', borderRadius: '4px', fontSize: '0.9em' }}>
              <strong>⚠️ Prerequisite:</strong> Passwordless sudo must be configured on the server.
              <br />
              See setup instructions in server documentation.
            </div>
          