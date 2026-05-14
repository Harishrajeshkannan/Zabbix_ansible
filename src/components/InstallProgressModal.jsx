import React, { useState, useEffect } from 'react';
import './InstallProgressModal.css';

const INSTALLATION_STEPS = [
  { id: 'gathering', label: 'Gathering Facts', order: 0 },
  { id: 'validating-inputs', label: 'Validating Inputs', order: 1 },
  { id: 'validating-version', label: 'Validating Version', order: 2 },
  { id: 'deriving-config', label: 'Deriving Configuration', order: 3 },
  { id: 'querying-repo', label: 'Querying Repository', order: 4 },
  { id: 'validating-package', label: 'Validating Agent Package', order: 5 },
  { id: 'installing-package', label: 'Installing Agent Package', order: 6 },
  { id: 'configuring', label: 'Configuring Agent', order: 7 },
  { id: 'starting-service', label: 'Starting Service', order: 8 },
];

const InstallProgressModal = ({ isOpen, requestId, host, version, onClose, backendApiUrl }) => {
  const [progress, setProgress] = useState({});
  const [status, setStatus] = useState('in-progress'); // in-progress, completed, failed
  const [error, setError] = useState(null);
  const [logs, setLogs] = useState([]);
  const pollIntervalRef = React.useRef(null);
  const lastSinceRef = React.useRef(0);

  useEffect(() => {
    if (!isOpen || !requestId) return;

    const pollProgress = async () => {
      try {
        const response = await fetch(
          `${backendApiUrl}/install-progress/${requestId}?since=${lastSinceRef.current}`
        );

        if (!response.ok) {
          console.error('Failed to fetch progress:', response.status);
          return;
        }

        const data = await response.json();

        if (data.success) {
          setStatus(data.status);

          // Update progress tracking
          if (data.progress && data.progress.length > 0) {
            const newProgress = {};
            data.progress.forEach(entry => {
              newProgress[entry.step] = entry.status;
              setLogs(prev => [...prev, entry]);
            });
            setProgress(prev => ({ ...prev, ...newProgress }));
          }

          lastSinceRef.current = data.nextSince || lastSinceRef.current;

          // Stop polling if completed or failed
          if (data.status === 'completed' || data.status === 'failed') {
            if (pollIntervalRef.current) {
              clearInterval(pollIntervalRef.current);
              pollIntervalRef.current = null;
            }
            if (data.status === 'failed' && data.progress && data.progress.length > 0) {
              const lastEntry = data.progress[data.progress.length - 1];
              setError(lastEntry.message || 'Installation failed');
            }
          }
        }
      } catch (err) {
        console.error('Error polling progress:', err);
      }
    };

    // Initial poll
    pollProgress();

    // Set up polling interval
    pollIntervalRef.current = setInterval(pollProgress, 500);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [isOpen, requestId, backendApiUrl]);

  if (!isOpen) return null;

  const isCompleted = status === 'completed';
  const isFailed = status === 'failed';
  const isInProgress = status === 'in-progress';

  return (
    <div className="modal-overlay" onClick={!isCompleted && !isFailed ? onClose : undefined}>
      <div className="modal-content progress-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>
            {isCompleted ? '✅ Installation Complete' : isFailed ? '❌ Installation Failed' : '⏳ Installing Zabbix Agent'}
          </h2>
          {!isInProgress && (
            <button className="modal-close" onClick={onClose}>&times;</button>
          )}
        </div>

        <div className="progress-container">
          <div className="installation-details">
            <p><strong>Host:</strong> {host}</p>
            <p><strong>Version:</strong> {version}</p>
            <p><strong>Request ID:</strong> <code>{requestId}</code></p>
          </div>

          <div className="steps-container">
            <h3>Installation Steps</h3>
            <div className="steps-list">
              {INSTALLATION_STEPS.map(step => {
                const stepProgress = progress[step.label];
                const isStepCompleted = stepProgress === 'completed';
                const isStepFailed = stepProgress === 'failed';
                const isStepInProgress = stepProgress === 'in-progress' || (isInProgress && !stepProgress);

                return (
                  <div key={step.id} className={`step ${isStepCompleted ? 'completed' : ''} ${isStepFailed ? 'failed' : ''} ${isStepInProgress ? 'in-progress' : ''}`}>
                    <div className="step-icon">
                      {isStepCompleted && <span className="icon">✓</span>}
                      {isStepFailed && <span className="icon">✗</span>}
                      {isStepInProgress && <span className="icon spinner">⟳</span>}
                      {!stepProgress && <span className="icon">○</span>}
                    </div>
                    <div className="step-label">{step.label}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {logs.length > 0 && (
            <div className="logs-container">
              <h3>Recent Activity</h3>
              <div className="logs-list">
                {logs.slice(-5).map((log, idx) => (
                  <div key={idx} className={`log-entry ${log.level.toLowerCase()}`}>
                    <span className="log-time">{new Date(log.timestamp).toLocaleTimeString()}</span>
                    <span className="log-step">{log.step}</span>
                    <span className={`log-status ${log.status}`}>{log.status}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {error && (
            <div className="error-container">
              <h3>Error Details</h3>
              <p className="error-message">{error}</p>
            </div>
          )}

          {isCompleted && (
            <div className="success-message">
              <p>✨ Zabbix Agent {version} has been successfully installed on {host}!</p>
            </div>
          )}

          {isFailed && (
            <div className="failed-message">
              <p>Installation failed. Please check the server logs for more details.</p>
            </div>
          )}
        </div>

        {(isCompleted || isFailed) && (
          <div className="modal-actions">
            <button className="btn-close" onClick={onClose}>
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default InstallProgressModal;
