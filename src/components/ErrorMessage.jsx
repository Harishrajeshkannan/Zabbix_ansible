import React from 'react';
import './ErrorMessage.css';

const ErrorMessage = ({ error, onRetry }) => {
  return (
    <div className="error-container">
      <div className="error-icon">⚠️</div>
      <h2 className="error-title">Unable to Load Data</h2>
      <p className="error-message">
        {error?.message || 'An error occurred while fetching data from the Zabbix server.'}
      </p>
      <div className="error-details">
        <h3>Possible causes:</h3>
        <ul>
          <li>Zabbix API server is unreachable</li>
          <li>Invalid API token or URL configuration</li>
          <li>Network connectivity issues</li>
          <li>CORS policy restrictions</li>
        </ul>
      </div>
      {onRetry && (
        <button className="retry-button" onClick={onRetry}>
          Try Again
        </button>
      )}
      <p className="error-help">
        Check the browser console for more details or contact your system administrator.
      </p>
    </div>
  );
};

export default ErrorMessage;
