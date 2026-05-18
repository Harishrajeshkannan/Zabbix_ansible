import React from 'react';
import { Home, FileText, FolderOpen } from 'lucide-react';
import './Header.css';

const Header = ({ onRefresh, loading, lastUpdated, onNavigate, currentView }) => {
  return (
    <header className="header">
      <div className="header-content">
        <div className="header-left">
          <div className="header-titles">
            <h1 className="header-title">Zabbix Agent Management 2</h1>
          </div>
        </div>
        <div className="header-right">
          <div className="header-nav">
            <div className="nav-toggle">
              <button 
                className={`nav-toggle-btn ${currentView === 'dashboard' ? 'active' : ''}`}
                onClick={() => onNavigate('dashboard')}
              >
                <Home size={18} />
                <span>Dashboard</span>
              </button>
              <button 
                className={`nav-toggle-btn ${currentView === 'logs' ? 'active' : ''}`}
                onClick={() => onNavigate('logs')}
              >
                <FileText size={18} />
                <span>Logs</span>
              </button>
              <button
                className={`nav-toggle-btn ${currentView === 'files' ? 'active' : ''}`}
                onClick={() => onNavigate('files')}
              >
                <FolderOpen size={18} />
                <span>Remote Files</span>
              </button>
              <div
                className={`nav-toggle-slider ${
                  currentView === 'dashboard' ? 'slide-0' : currentView === 'logs' ? 'slide-1' : 'slide-2'
                }`}
              ></div>
            </div>
          </div>
          {lastUpdated && (
            <div className="header-info">
              <span className="info-label">Last Updated</span>
              <span className="info-value">{lastUpdated.toLocaleTimeString()}</span>
            </div>
          )}
          <button 
            onClick={onRefresh} 
            className="header-refresh-button" 
            disabled={loading}
            title="Refresh data from Zabbix server"
          >
            <span className="refresh-icon">{loading ? '⟳' : '↻'}</span>
            <span className="refresh-text">{loading ? 'Refreshing...' : 'Refresh'}</span>
          </button>
        </div>
      </div>
    </header>
  );
};

export default Header;
