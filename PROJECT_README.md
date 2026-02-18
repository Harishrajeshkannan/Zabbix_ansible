# Zabbix Agent Management Portal

A modern web portal for managing Zabbix agents across your infrastructure. This React-based application provides a centralized interface to monitor, install, and update Zabbix agents on your hosts.

## Features

### 🎯 Core Functionality
- **Host Management**: View all hosts with comprehensive details
- **Agent Monitoring**: Track current and latest agent versions
- **Status Tracking**: Monitor agent status (Up to Date, Outdated, No Agent)
- **Action Management**: Install new agents or update existing ones

### 🔍 Filtering & Search
- **Search**: Find hosts by hostname or IP address
- **Host Group Filter**: Filter hosts by their assigned host groups
- **Status Filter**: Filter by agent status
- **Real-time Results**: See filtered results count instantly

### 📊 Dashboard
- **Statistics Overview**: Quick view of total, up-to-date, outdated, and missing agents
- **Visual Status Indicators**: Color-coded badges for easy status identification
- **Responsive Layout**: Works seamlessly on desktop, tablet, and mobile devices

### 🎨 Professional UI
- Clean, modern interface following organizational standards
- Intuitive table layout with sortable columns
- Color-coded status badges (Green: Up to Date, Yellow: Outdated, Red: No Agent)
- Hover effects and smooth transitions
- Fully responsive design

## Technology Stack

- **React 19.2** - UI framework
- **Vite** - Build tool and dev server
- **CSS3** - Modern styling with flexbox and grid
- **Component-based Architecture** - Modular and maintainable code

## Project Structure

```
src/
├── components/
│   ├── Header.jsx           # App header with branding
│   ├── Header.css
│   ├── StatsBar.jsx         # Statistics dashboard
│   ├── StatsBar.css
│   ├── FilterPanel.jsx      # Search and filter controls
│   ├── FilterPanel.css
│   ├── HostTable.jsx        # Main data table
│   └── HostTable.css
├── data/
│   └── mockData.js          # Sample data (replace with API calls)
├── App.jsx                  # Main application component
├── App.css
├── index.css                # Global styles
└── main.jsx                 # Application entry point
```

## Getting Started

### Prerequisites
- Node.js 16+ installed
- npm or yarn package manager

### Installation

1. Install dependencies:
```bash
npm install
```

2. Start the development server:
```bash
npm run dev
```

3. Open your browser to `http://localhost:5173`

### Building for Production

```bash
npm run build
```

The built files will be in the `dist/` directory.

## Component Overview

### Header
- Displays application branding
- Shows last updated timestamp
- Professional gradient background

### StatsBar
- Real-time statistics of host statuses
- Four key metrics: Total Hosts, Up to Date, Outdated, No Agent
- Color-coded cards with icons

### FilterPanel
- Search input for hostname/IP filtering
- Host Group dropdown selector
- Agent Status dropdown filter
- Live results counter

### HostTable
- Comprehensive host information display
- Columns: Hostname, Host Group, OS, Current Version, Latest Version, Status, Actions
- Action buttons (Install/Update) based on agent status
- Responsive table with horizontal scroll on mobile

## Data Structure

Each host object contains:
```javascript
{
  id: number,
  hostname: string,
  ip: string,
  hostGroup: string,
  os: string,
  currentVersion: string | null,
  latestVersion: string,
  status: 'Up to Date' | 'Outdated' | 'No Agent'
}
```

## Backend Integration

Currently using mock data from `src/data/mockData.js`. To integrate with a real Zabbix API:

1. Replace mock data imports in `App.jsx`
2. Implement API service in `src/services/api.js`
3. Use React Query or similar for data fetching
4. Add loading states and error handling
5. Implement real install/update functionality

Example API service structure:
```javascript
// src/services/api.js
export const fetchHosts = async () => {
  const response = await fetch('/api/hosts');
  return response.json();
};

export const installAgent = async (hostId) => {
  // Implementation
};

export const updateAgent = async (hostId) => {
  // Implementation
};
```

## Customization

### Branding
Update the header title and colors in `src/components/Header.jsx` and `Header.css`

### Theme Colors
Modify CSS variables and colors in:
- `src/index.css` - Global theme
- Component-specific CSS files for individual styling

### Mock Data
Edit `src/data/mockData.js` to add/modify sample hosts

## React Best Practices Used

✅ **Functional Components** with Hooks  
✅ **Component Composition** for reusability  
✅ **Prop Types** for component interfaces  
✅ **useMemo** for performance optimization  
✅ **Single Responsibility** - each component has one purpose  
✅ **Controlled Components** for form inputs  
✅ **Descriptive Naming** for clarity  
✅ **CSS Modules Pattern** with scoped styles  
✅ **Responsive Design** mobile-first approach  

## Future Enhancements

- [ ] Real Zabbix API integration
- [ ] User authentication
- [ ] Bulk operations (install/update multiple hosts)
- [ ] Export data to CSV/PDF
- [ ] Advanced filtering and sorting
- [ ] Host group management
- [ ] Deployment history and logs
- [ ] Real-time notifications
- [ ] Dark mode support

## License

This project is proprietary software for organizational use.

## Support

For issues or questions, please contact your IT department or the development team.
