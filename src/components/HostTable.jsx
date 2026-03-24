import React from 'react';
import './HostTable.css';

const HostTable = ({
  hosts,
  onInstall,
  onUpdate,
  onManageFiles,
  selectedHostIds = [],
  onToggleHostSelection,
  onToggleSelectAllVisible,
  allVisibleSelected = false,
  onRestartSelected,
  restartInProgress = false
}) => {
  const canHostBeActioned = (host) => host.status === 'No Agent' || host.status === 'Outdated' || host.status === 'Up to Date';

  const getStatusClass = (status) => {
    switch (status) {
      case 'Up to Date':
        return 'status-success';
      case 'Outdated':
        return 'status-warning';
      case 'No Agent':
        return 'status-error';
      default:
        return '';
    }
  };

  const getActionButton = (host) => {
    const primaryAction = (() => {
      if (host.status === 'No Agent') {
        return (
          <button
            className="action-btn action-install"
            onClick={() => onInstall(host)}
          >
            Install
          </button>
        );
      }

      if (host.status === 'Outdated' || host.status === 'Up to Date') {
        return (
          <button
            className="action-btn action-update"
            onClick={() => onUpdate(host)}
          >
            Update
          </button>
        );
      }

      return <span className="action-none">No Action Required</span>;
    })();

    if (!onManageFiles) {
      return primaryAction;
    }

    return (
      <div className="action-group">
        {primaryAction}
        <button
          className="action-btn action-files"
          onClick={() => onManageFiles(host)}
        >
          Files
        </button>
      </div>
    );
  };

  const getSelectionCheckbox = (host) => {
    const disabled = !canHostBeActioned(host);
    return (
      <input
        type="checkbox"
        checked={selectedHostIds.includes(host.id)}
        disabled={disabled}
        onChange={() => onToggleHostSelection(host)}
        aria-label={`Select ${host.hostname}`}
      />
    );
  };

  return (
    <div className="table-container">
      <table className="host-table">
        <thead>
          <tr>
            <th className="select-col">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={(e) => onToggleSelectAllVisible(e.target.checked)}
                aria-label="Select all visible actionable hosts"
              />
            </th>
            <th>Hostname</th>
            <th>Host Group</th>
            <th>Operating System</th>
            <th>Current Version</th>
            <th>Latest Version</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {hosts.length === 0 ? (
            <tr>
              <td colSpan="8" className="no-data">
                No hosts found matching the current filters
              </td>
            </tr>
          ) : (
            hosts.map((host) => (
              <tr key={host.id}>
                <td className="select-col">{getSelectionCheckbox(host)}</td>
                <td className="hostname-cell">
                  <div className="hostname-content">
                    <span className="hostname">{host.hostname}</span>
                    <span className="host-ip">{host.ip}</span>
                  </div>
                </td>
                <td>{host.hostGroup}</td>
                <td>
                  <div className="os-cell">
                    <span className="os-name">{host.os}</span>
                  </div>
                </td>
                <td className="version-cell">
                  {host.currentVersion || <span className="not-available">N/A</span>}
                </td>
                <td className="version-cell">
                  {host.latestVersion}
                </td>
                <td>
                  <span className={`status-badge ${getStatusClass(host.status)}`}>
                    {host.status}
                  </span>
                </td>
                <td className="actions-cell">
                  {getActionButton(host)}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      {selectedHostIds.length > 0 && onRestartSelected && (
        <div className="table-footer-actions">
          <span className="table-footer-selection-count">
            {selectedHostIds.length} host{selectedHostIds.length > 1 ? 's' : ''} selected
          </span>
          <button
            type="button"
            className="action-btn action-restart"
            onClick={onRestartSelected}
            disabled={restartInProgress}
          >
            {restartInProgress
              ? 'Restarting...'
              : `Restart Agent on Selected (${selectedHostIds.length})`}
          </button>
        </div>
      )}
    </div>
  );
};

export default HostTable;
