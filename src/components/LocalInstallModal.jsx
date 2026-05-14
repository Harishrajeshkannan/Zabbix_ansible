import React, { useState, useEffect, useRef } from 'react';
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
    serverIP: '',
    serverPort: '10051',
    listenerPort: '10050',
    hostname: selectedHost?.hostname || '',
    usePSK: false,
    psk: '',
    pskIdentity: ''
  });
  const [installing, setInstalling] = useState(false);
  const [installStatus, setInstallStatus] = useState(null);
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
      setInstalling(false);
      setInstallStatus(null);
    }
  }, [isOpen]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const updateInstallStatus = (patchOrUpdater) => {
    setInstallStatus((prev) => {
      const patch = typeof patchOrUpdater === 'function' ? patchOrUpdater(prev || {}) : patchOrUpdater;
      const nextSteps = Array.isArray(patch?.steps) && patch.steps.length > 0
        ? patch.steps
        : (prev?.steps || []);

      return {
        ...(prev || {}),
        ...patch,
        steps: nextSteps
      };
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setInstalling(true);
    updateInstallStatus({
      status: 'starting',
      phase: 'starting',
      message: 'Submitting install request...',
      percent: 0,
      currentTask: 'Preparing installation',
      steps: [
        { key: 'gathering_facts', label: 'Gathering facts', status: 'pending', detail: '' },
        { key: 'validate_inputs', label: 'Validate required inputs', status: 'pending', detail: '' },
        { key: 'validate_version', label: 'Validate semantic version', status: 'pending', detail: '' },
        { key: 'derive_values', label: 'Derive repo and channel values', status: 'pending', detail: '' },
        { key: 'query_repo', label: 'Query Zabbix repository', status: 'pending', detail: '' },
        { key: 'validate_repo_rpm', label: 'Validate RPM discovery', status: 'pending', detail: '' },
        { key: 'set_repo_url', label: 'Set RPM URL', status: 'pending', detail: '' },
        { key: 'install_agent', label: 'Install Zabbix Agent 2', status: 'pending', detail: '' },
        { key: 'deploy_config', label: 'Deploy configuration', status: 'pending', detail: '' },
        { key: 'enable_service', label: 'Enable and start service', status: 'pending', detail: '' }
      ]
    });

    try {
      await onInstall(formData, { update: updateInstallStatus });
      updateInstallStatus((prev) => ({
        ...prev,
        status: 'completed',
        phase: 'completed',
        message: 'Installation completed successfully',
        percent: 100,
        currentTask: 'Completed'
      }));
    } catch (error) {
      updateInstallStatus((prev) => ({
        ...prev,
        status: 'failed',
        phase: 'failed',
        message: error.message,
        currentTask: 'Failed'
      }));
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
          {installStatus && (
            <div className={`install-progress-card ${installStatus.status || 'running'}`}>
              <div className="install-progress-header">
                <div>
                  <div className="install-progress-kicker">
                    {installStatus.status === 'completed'
                      ? 'Completed'
                      : installStatus.status === 'failed'
                        ? 'Failed'
                        : 'Installing'}
                  </div>
                  <div className="install-progress-title">
                    {installStatus.currentHost || formData.hostname || formData.host || 'Target host'}
                  </div>
                </div>
                <div className="install-progress-percent">{Math.max(0, Math.min(100, installStatus.percent || 0))}%</div>
              </div>

              <div className="install-progress-message">{installStatus.message || 'Waiting for updates...'}</div>

              <div className="install-progress-bar">
                <div
                  className="install-progress-bar-fill"
                  style={{ width: `${Math.max(0, Math.min(100, installStatus.percent || 0))}%` }}
                />
              </div>

              {installStatus.steps?.length > 0 && (
                <ul className="install-progress-steps">
                  {installStatus.steps.map((step) => (
                    <li key={step.key} className={`install-progress-step ${step.status}`}>
                      <span className="step-status-dot" />
                      <div className="step-body">
                        <div className="step-label">{step.label}</div>
                        {step.detail && <div className="step-detail">{step.detail}</div>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
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
              {installStatus?.status === 'completed' || installStatus?.status === 'failed' ? 'Close' : 'Cancel'}
            </button>
            {!(installStatus?.status === 'completed' || installStatus?.status === 'failed') ? (
              <button type="submit" className="btn-install" disabled={installing}>
                {installing
                  ? (isInstallUpdateAction ? 'Processing...' : (isUpdateAction ? 'Updating...' : 'Installing...'))
                  : (isBatchMode
                    ? `${isInstallUpdateAction ? 'Install/Update' : (isUpdateAction ? 'Update' : 'Install')} Selected Hosts (${selectedHosts.length})`
                    : `${isInstallUpdateAction ? 'Install/Update' : (isUpdateAction ? 'Update' : 'Install')} Agent`)}
              </button>
            ) : (
              <button type="button" className="btn-install" onClick={onClose}>
                Done
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};

export default LocalInstallModal;
