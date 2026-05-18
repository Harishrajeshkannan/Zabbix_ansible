import React, { useEffect, useMemo, useRef, useState } from 'react';
import './InstallProgressModal.css';

const INSTALLATION_STEPS = [
  { id: 'download-agent', label: 'Download agent' },
  { id: 'install-agent', label: 'Install agent' },
  { id: 'configure-agent', label: 'Configure agent' },
  { id: 'restart-agent', label: 'Restart agent' },
];

const POLL_MS = 700;
const SIMULATED_STEP_MS = [5000, 7000, 6000, 5000];

const createInitialProgress = () => INSTALLATION_STEPS.reduce((acc, step, index) => {
  acc[step.id] = index === 0 ? 'in-progress' : 'pending';
  return acc;
}, {});

const InstallProgressModal = ({ isOpen, requestId, onClose, backendApiUrl, host, version }) => {
  const [progress, setProgress] = useState(() => createInitialProgress());
  const [status, setStatus] = useState('in-progress');
  const pollRef = useRef(null);
  const timeoutRefs = useRef([]);

  const completedCount = useMemo(
    () => INSTALLATION_STEPS.reduce((count, step) => count + (progress[step.id] === 'completed' ? 1 : 0), 0),
    [progress]
  );

  const clearTimers = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }

    timeoutRefs.current.forEach((timerId) => clearTimeout(timerId));
    timeoutRefs.current = [];
  };

  const resetProgress = () => {
    setProgress(createInitialProgress());
    setStatus('in-progress');
  };

  useEffect(() => {
    if (!isOpen) {
      clearTimers();
      return undefined;
    }

    resetProgress();

    if (requestId) {
      const poll = async () => {
        try {
          const res = await fetch(`${backendApiUrl}/install-progress/${requestId}`);
          if (!res.ok) return;
          const data = await res.json();
          if (!data || !data.success) return;

          setStatus(data.status || 'in-progress');

          const newProgress = createInitialProgress();
          (data.steps || []).forEach((step) => {
            newProgress[step.id] = step.status || 'pending';
          });

          if ((data.steps || []).length === 0 && data.status === 'in-progress') {
            newProgress[INSTALLATION_STEPS[0].id] = 'in-progress';
          }

          setProgress(newProgress);

          const allCompleted = INSTALLATION_STEPS.every((step) => newProgress[step.id] === 'completed');
          if (allCompleted) {
            clearTimers();
            window.setTimeout(() => {
              onClose?.();
            }, 900);
          }
        } catch {
          // ignore polling errors
        }
      };

      poll();
      pollRef.current = window.setInterval(poll, POLL_MS);
      return () => clearTimers();
    }

    let cancelled = false;
    let elapsed = 0;

    INSTALLATION_STEPS.forEach((step, index) => {
      const delay = SIMULATED_STEP_MS[index];
      elapsed += delay;
      const timerId = window.setTimeout(() => {
        if (cancelled) return;

        setProgress((current) => {
          const next = { ...current };
          next[step.id] = 'completed';

          const nextStep = INSTALLATION_STEPS[index + 1];
          if (nextStep) {
            next[nextStep.id] = 'in-progress';
          }

          return next;
        });

        if (index === INSTALLATION_STEPS.length - 1) {
          setStatus('completed');
        }
      }, elapsed);

      timeoutRefs.current.push(timerId);
    });

    return () => {
      cancelled = true;
      clearTimers();
    };
  }, [isOpen, requestId, backendApiUrl, onClose]);

  if (!isOpen) return null;

  return (
    <div className="install-toast" role="status" aria-live="polite" aria-label="Installation progress">
      <div className="install-toast-header">
        <div>
          <div className="install-toast-title">Installing Zabbix Agent</div>
          <div className="install-toast-subtitle">
            {host ? `${host.hostname || host.host || 'Target host'}${version ? ` · ${version}` : ''}` : 'Working through the install steps'}
          </div>
        </div>
        <div className="install-toast-counter">
          {completedCount}/{INSTALLATION_STEPS.length}
        </div>
      </div>

      <div className="install-toast-bar" aria-hidden="true">
        <span style={{ width: `${(completedCount / INSTALLATION_STEPS.length) * 100}%` }} />
      </div>

      <div className="install-toast-steps">
        {INSTALLATION_STEPS.map((step) => {
          const stepStatus = progress[step.id] || 'pending';
          return (
            <div key={step.id} className={`toast-step ${stepStatus}`}>
              <div className="toast-icon">
                {stepStatus === 'completed' ? '✓' : stepStatus === 'in-progress' ? <span className="spinner">⟳</span> : '○'}
              </div>
              <div className="toast-label">{step.label}</div>
            </div>
          );
        })}
      </div>

      <div className="install-toast-footer">
        {status === 'completed' ? 'Installation complete' : 'Installation in progress'}
      </div>
    </div>
  );
};

export default InstallProgressModal;
