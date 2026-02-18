import React from 'react';
import { Server, CheckCircle, AlertTriangle, XCircle } from 'lucide-react';
import './StatsBar.css';

const StatsBar = ({ hosts }) => {
  const stats = {
    total: hosts.length,
    upToDate: hosts.filter(h => h.status === 'Up to Date').length,
    outdated: hosts.filter(h => h.status === 'Outdated').length,
    noAgent: hosts.filter(h => h.status === 'No Agent').length,
  };

  return (
    <div className="stats-bar">
      <div className="stat-card stat-total">
        <div className="stat-icon">
          <Server size={24} />
        </div>
        <div className="stat-content">
          <div className="stat-label">Total Hosts</div>
          <div className="stat-value">{stats.total}</div>
        </div>
      </div>

      <div className="stat-card stat-success">
        <div className="stat-icon">
          <CheckCircle size={24} />
        </div>
        <div className="stat-content">
          <div className="stat-label">Up to Date</div>
          <div className="stat-value">{stats.upToDate}</div>
        </div>
      </div>

      <div className="stat-card stat-warning">
        <div className="stat-icon">
          <AlertTriangle size={24} />
        </div>
        <div className="stat-content">
          <div className="stat-label">Outdated</div>
          <div className="stat-value">{stats.outdated}</div>
        </div>
      </div>

      <div className="stat-card stat-error">
        <div className="stat-icon">
          <XCircle size={24} />
        </div>
        <div className="stat-content">
          <div className="stat-label">No Agent</div>
          <div className="stat-value">{stats.noAgent}</div>
        </div>
      </div>
    </div>
  );
};

export default StatsBar;
