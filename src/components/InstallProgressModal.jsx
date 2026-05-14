import React, { useState, useEffect, useRef } from 'react';
import './InstallProgressModal.css';

const INSTALLATION_STEPS = [
  { id: 'downloading-repo', label: 'Downloading repository' },
  { id: 'installing-package', label: 'Installing package' },
  { id: 'configuring-agent', label: 'Configuring agent' },
  { id: 'starting-service', label: 'Starting service' },
];

const POLL_MS = 500;

const InstallProgressModal = ({ isOpen, requestId, onClose, backendApiUrl }) => {
  const [progress, setProgress] = useState({});
  const [status, setStatus] = useState(null);
  const pollRef = useRef(null);

  useEffect(() => {
    if (!isOpen || !requestId) return;

    const poll = async () => {
      try {
        const res = await fetch(`${backendApiUrl}/install-progress/${requestId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!data || !data.success) return;

          setStatus(data.status || 'in-progress');
          const newProgress = {};
          (data.steps || []).forEach(s => { newProgress[s.id] = s.status; });

          // if backend hasn't reported any steps yet, assume first step started
          if (Object.keys(newProgress).length === 0 && data.status === 'in-progress') {
            newProgress[INSTALLATION_STEPS[0].id] = 'in-progress';
          }

          setProgress(newProgress);

          // Only auto-close when all known steps are completed
          const allCompleted = INSTALLATION_STEPS.every(step => newProgress[step.id] === 'completed');
          if (allCompleted) {
            if (pollRef.current) clearInterval(pollRef.current);
            setTimeout(() => {
              onClose && onClose();
            }, 900);
          }
      } catch (e) {
        // ignore polling errors
      }
    };

    // initial and interval
    poll();
    pollRef.current = setInterval(poll, POLL_MS);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [isOpen, requestId, backendApiUrl, onClose]);

  if (!isOpen || !requestId) return null;

  return (
    <div className="install-toast" role="status" aria-live="polite">
      {INSTALLATION_STEPS.map(step => {
        const s = progress[step.id];
        return (
          <div key={step.id} className={`toast-step ${s === 'completed' ? 'completed' : s === 'in-progress' ? 'in-progress' : ''}`}>
            <div className="toast-icon">
              {s === 'completed' ? '✓' : s === 'in-progress' ? <span className="spinner">⟳</span> : '○'}
            </div>
            <div className="toast-label">{step.label}</div>
          </div>
        );
      })}
    </div>
  );
};

export default InstallProgressModal;
