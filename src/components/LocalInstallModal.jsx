import React, { useState, useEffect, useRef } from 'react';
import { ZABBIX_CONFIG } from '../config/zabbixConfig';
import './LocalInstallModal.css';

const resolvePreferredHost = (host) => {
  if (!host) return '';

  const ip = (host.ip || '').trim();
  if (ip && ip.toUpperCase() !== 'N/A') {
    return ip;
  }

  return host.hostname || '';
};

const LocalInstallModal = ({ isOpen, onClose, onInstall, availableVersions, latestVersion, selectedHost, selectedHosts = [], action = 'install' }) => {
  const isBatchMode = selectedHosts.length > 1;
  const isUpdateAction = action === 'update';
  const isInstallUpdateAction = action === 'install-update';
  const actionTitle = isInstallUpdateAction ? 'Install/Update' : (isUpdateAction ? 'Update' : 'Install');

  const [formData, setFormData] = useState({
    host: resolvePreferredHost(selectedHost),
    version: latestVersion,
    serverIP: ZABBIX_CONFIG.zabbixServerIP,
    serverPort: ZABBIX_CONFIG.zabbixServerPort,
    listenerPort: ZABBIX_CONFIG.agentListenerPort,
    hostname: selectedHost?.hostname || '',
    usePSK: false,
    psk: '',
    pskIdentity: ''
  });
  const [installing, setInstalling] = useState(false);
  const lastInitKeyRef = useRef('');

  useEffect(() => {
    if (!selectedHost) return;

    const initKey = `${selectedHost.id || selectedHost.hostname || ''}:${action}:${isBatchMode ? 'batch' : 'single'}`;
    if (lastInitKeyRef.current === initKey) {
      return;
    }

    lastInitKeyRef.current = initKey;

    setFormData(prev => ({
      ...prev,
      host: resolvePreferredHost(selectedHost),
      hostname: selectedHost.hostname || '',
      version: action === 'update' && selectedHost.agentVersion
        ? selectedHost.agentVersion
        : latestVersion
    }));
  }, [selectedHost, action, isBatchMode, latestVersion]);

  useEffect(() => {
    if (!isOpen) {
      lastInitKeyRef.current = '';
    }
  }, [isOpen]);

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
      const payload = { ...formData, selectedHosts };
      await onInstall(payload);
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
          <h2>{actionTitle} Zabbix Agent via Ansible</h2>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>

        <form onSubmit={handleSubmit} className="install-form">
          <div className="form-section">
            <h3>Target Host</h3>
            {isBatchMode && (
              <div className="batch-mode-note">
                Batch mode enabled: {selectedHosts.length} hosts selected. Remote host and agent hostname are auto-filled per host.
              </div>
            )}
            {isUpdateAction && selectedHost?.agentVersion && (
              <div className="update-info" style={{ marginBottom: '15px', padding: '10px', background: '#e3f2fd', borderRadius: '4px' }}>
                <strong>Current Version:</strong> {selectedHost.agentVersion}
              </div>
            )}

            {!isBatchMode && (
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
            )}
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
              <label htmlFor="listenerPort">Listener Port</label>
              <input
                type="number"
                id="listenerPort"
                name="listenerPort"
                value={formData.listenerPort}
                onChange={handleChange}
                min="1"
                max="65535"
                required
              />
            </div>

            {!isBatchMode && (
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
            )}
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

          <div className="modal-actions">
            <button type="button" className="btn-cancel" onClick={onClose} disabled={installing}>
              Cancel
            </button>
            <button type="submit" className="btn-install" disabled={installing}>
              {installing
                ? (isInstallUpdateAction ? 'Processing...' : (isUpdateAction ? 'Updating...' : 'Installing...'))
                : (isBatchMode
                  ? `${isInstallUpdateAction ? 'Install/Update' : (isUpdateAction ? 'Update' : 'Install')} Selected Hosts (${selectedHosts.length})`
                  : `${isInstallUpdateAction ? 'Install/Update' : (isUpdateAction ? 'Update' : 'Install')} Agent`)}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default LocalInstallModal;
