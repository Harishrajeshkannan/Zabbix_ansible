import React, { useState } from 'react';
import './LocalInstallModal.css';

const LocalInstallModal = ({ isOpen, onClose, onInstall, availableVersions, latestVersion }) => {
  const [formData, setFormData] = useState({
    version: latestVersion,
    serverIP: '',
    serverPort: '10051',
    hostname: 'localhost',
    usePSK: false,
    psk: '',
    pskIdentity: '',
    adminUsername: '',
    adminPassword: ''
  });
  const [installing, setInstalling] = useState(false);

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
          <h2>Install Zabbix Agent on Localhost</h2>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        
        <form onSubmit={handleSubmit} className="install-form">
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
            <label htmlFor="hostname">Hostname</label>
            <input
              type="text"
              id="hostname"
              name="hostname"
              value={formData.hostname}
              onChange={handleChange}
              required
            />
          </div>

          <div className="form-section-header">
            <strong>Admin Credentials (Required for Installation)</strong>
          </div>

          <div className="form-group">
            <label htmlFor="adminUsername">Admin Username *</label>
            <input
              type="text"
              id="adminUsername"
              name="adminUsername"
              value={formData.adminUsername}
              onChange={handleChange}
              placeholder="DOMAIN\\username or .\\username"
              required
            />
            <small>Use .\\username for local admin or DOMAIN\\username for domain admin</small>
          </div>

          <div className="form-group">
            <label htmlFor="adminPassword">Admin Password *</label>
            <input
              type="password"
              id="adminPassword"
              name="adminPassword"
              value={formData.adminPassword}
              onChange={handleChange}
              placeholder="Enter admin password"
              required
              autoComplete="off"
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

          <div className="form-info">
            <strong>Installation Location:</strong> C:\ZabbixInstall
            <br />
            <strong>Installation will:</strong>
            <ul>
              <li>Download the agent to C:\ZabbixInstall</li>
              <li>Install Zabbix Agent 2 service</li>
              <li>Configure and start the service</li>
            </ul>
          </div>

          <div className="modal-actions">
            <button type="button" className="btn-cancel" onClick={onClose} disabled={installing}>
              Cancel
            </button>
            <button type="submit" className="btn-install" disabled={installing}>
              {installing ? 'Installing...' : 'Install Agent'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default LocalInstallModal;
