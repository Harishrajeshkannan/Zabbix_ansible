import React from 'react';
import './FilterPanel.css';

const FilterPanel = ({ 
  hostGroups, 
  selectedHostGroup, 
  onHostGroupChange,
  searchTerm,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  totalHosts,
  filteredHosts
}) => {
  return (
    <div className="filter-panel">
      <div className="filter-section">
        <label htmlFor="search" className="filter-label">
          Search Hosts
        </label>
        <input
          id="search"
          type="text"
          className="filter-input"
          placeholder="Search by hostname..."
          value={searchTerm}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>

      <div className="filter-section">
        <label htmlFor="hostGroup" className="filter-label">
          Host Group
        </label>
        <select
          id="hostGroup"
          className="filter-select"
          value={selectedHostGroup}
          onChange={(e) => onHostGroupChange(e.target.value)}
        >
          <option value="">All Host Groups</option>
          {hostGroups.map((group) => (
            <option key={group} value={group}>
              {group}
            </option>
          ))}
        </select>
      </div>

      <div className="filter-section">
        <label htmlFor="status" className="filter-label">
          Agent Status
        </label>
        <select
          id="status"
          className="filter-select"
          value={statusFilter}
          onChange={(e) => onStatusFilterChange(e.target.value)}
        >
          <option value="">All Status</option>
          <option value="Up to Date">Up to Date</option>
          <option value="Outdated">Outdated</option>
          <option value="No Agent">No Agent</option>
        </select>
      </div>

      <div className="filter-results">
        <span className="results-text">
          Showing <strong>{filteredHosts}</strong> of <strong>{totalHosts}</strong> hosts
        </span>
      </div>
    </div>
  );
};

export default FilterPanel;
