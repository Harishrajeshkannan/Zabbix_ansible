import React, { useState, useEffect } from 'react';
import './InstallProgressModal.css';

const INSTALLATION_STEPS = [
  { id: 'downloading-repo', label: 'Downloading repository', order: 0 },
  { id: 'installing-package', label: 'Installing package', order: 1 },
  { id: 'configuring-agent', label: 'Configuring agent', order: 2 },
  { id: 'starting-service', label: 'Starting service', order: 3 },
];

const InstallProgressModal = ({ isOpen, requestId, host, version, onClose, backendApiUrl }) => {
  const [progress, setProgress] = useState({});
  const [status, setStatus] = useState('in-progress');
  const [error, setError] = useState(null);
  const pollIntervalRef = React.useRef(null);

  useEffect(() => {
    if (!isOpen || !requestId) return;

    const pollProgress = async () => {
      try {
        const response = await fetch(
          `${backendApiUrl}/install-progress/${requestId}`
        );

        if (!response.ok) {
          console.error('Failed to fetch progress:', response.status);
          return;
        }

        const data = await response.json();

        if (data.success) {
          setStatus(data.status);

          // Update progress from steps array
          if (data.steps && Array.isArray(data.steps)) {
            const newProgress = {};
            data.steps.forEach(step => {
              newProgress[step.id] = step.status;
            });
            setProgress(newProgress);
          }

          // Set error if failed
          if (data.status === 'failed' && data.error) {
            setError(data.error);
          }

          // Stop polling if completed or failed
          if (data.status === 'completed' || data.status === 'failed') {
            if (pollIntervalRef.current) {
              clearInterval(pollIntervalRef.current);
              pollIntervalRef.current = null;
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
    <div className="modal-overlay progress-overlay" onClick={!isCompleted && !isFailed ? onClose : undefined}>
      <div className="modal-content progress-modal" onClick={e => e.stopPropagation()}>
        <div className="progress-container">
          <div className="progress-header">
            <h2>
              {isCompleted ? '✅ Installation Complete' : isFailed ? '❌ Installation Failed' : '⏳ Installing Zabbix Agent'}
            </h2>
            <p className="progress-subtitle">{host} • Version {version}</p>
          </div>

          <div className="steps-list">
            {INSTALLATION_STEPS.map(step => {
              const stepStatus = progress[step.id];
              const isStepCompleted = stepStatus === 'completed';
              const isStepInProgress = stepStatus === 'in-progress';

              return (
                <div key={step.id} className={`step-item ${isStepCompleted ? 'completed' : ''} ${isStepInProgress ? 'in-progress' : ''}`}>
                  <div className="step-icon">
                    {isStepCompleted && <span className="icon">✓</span>}
                    {isStepInProgress && <span className="icon spinner">⟳</span>}
                    {!stepStatus && <span className="icon">○</span>}
                  </div>
                  <div className="step-label">{step.label}</div>
                </div>
              );
            })}
          </div>

          {error && (
            <div className="error-box">
              <p>{error}</p>
            </div>
          )}

          {isCompleted && (
            <div className="success-box">
              <p>✨ Zabbix Agent {version} successfully installed on {host}!</p>
            </div>
          )}

          {isFailed && (
            <div className="failed-box">
              <p>Installation failed. Check the server logs for details.</p>
            </div>
          )}

          {(isCompleted || isFailed) && (
            <div className="modal-actions">
              <button className="btn-close" onClick={onClose}>
                Close
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default InstallProgressModal;
