import React from 'react';
import './HostTable.css';

const HostTable = ({ hosts, onInstall, onUpdate }) => {
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
    if (host.status === 'No Agent') {
      return (
        <button 
          className="action-btn action-install"
          onClick={() => onInstall(host)}
        >
          Install
        </button>
      );
    } else if (host.status === 'Outdated') {
      return (
        <button 
          className="action-btn action-update"
          onClick={() => onUpdate(host)}
        >
          Update
        </button>
      );
    } else {
      return (
        <span className="action-none">No Action Required</span>
      );
    }
  };

  return (
    <div className="table-container">
      <table className="host-table">
        <thead>
          <tr>
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
              <td colSpan="7" className="no-data">
                No hosts found matching the current filters
              </td>
            </tr>
          ) : (
            hosts.map((host) => (
              <tr key={host.id}>
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
    </div>
  );
};

export default HostTable;
