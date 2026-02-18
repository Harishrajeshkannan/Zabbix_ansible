# Quick Start - Testing Zabbix API

## Quick Test with Your Existing Postman Setup

Since you already tested the API in Postman, here's how to quickly integrate it:

### 1. Copy Your API Details

From your Postman request, you need:
- **URL**: The Zabbix API endpoint (e.g., `https://your-server.com/api_jsonrpc.php`)
- **Token**: Your authentication token

### 2. Create `.env` File

Create a file named `.env` in the project root (same folder as `package.json`):

```env
VITE_ZABBIX_API_URL=https://your-zabbix-server.com/api_jsonrpc.php
VITE_ZABBIX_API_TOKEN=your_api_token_here
VITE_LATEST_AGENT_VERSION=7.0.0
```

**Example:**
```env
VITE_ZABBIX_API_URL=https://zabbix.company.com/api_jsonrpc.php
VITE_ZABBIX_API_TOKEN=abc123def456ghi789jkl012mno345pqr678stu901vwx234yz
VITE_LATEST_AGENT_VERSION=7.0.0
```

### 3. Enable Real API Mode

Open `src/App.jsx` and find this line near the top (around line 13):

```javascript
const USE_MOCK_DATA = false; // Change from true to false
```

Make sure it's set to `false`.

### 4. Start the Application

```bash
npm run dev
```

The app will automatically load data from your Zabbix server!

## Example Postman Requests

### Headers Required
```
Content-Type: application/json
Authorization: Bearer your_token_here
```

### Test Connection
```json
{
    "jsonrpc": "2.0",
    "method": "apiinfo.version",
    "params": {},
    "id": 1
}
```

### Get Host Groups
```json
{
    "jsonrpc": "2.0",
    "method": "hostgroup.get",
    "params": {
        "output": "extend"
    },
    "id": 1
}
```

### Get Hosts with Details
```json
{
    "jsonrpc": "2.0",
    "method": "host.get",
    "params": {
        "output": ["hostid", "host", "name", "status"],
        "selectGroups": ["groupid", "name"],
        "selectInterfaces": ["ip", "dns"],
        "selectInventory": ["os"]
    },
    "id": 1
}
```

### Get Agent Versions
```json
{
    "jsonrpc": "2.0",
    "method": "item.get",
    "params": {
        "output": ["itemid", "hostid", "lastvalue"],
        "search": {
            "key_": "agent.version"
        }
    },
    "id": 1
}
```

## Authentication Methods

### Using Bearer Token (Current Implementation)
The API token is sent in the Authorization header:
```
Authorization: Bearer your_token_here
```

Request body does not include auth field:
```json
{
    "jsonrpc": "2.0",
    "method": "host.get",
    "params": {},
    "id": 1
}
```

### Using Username/Password (Older Zabbix Versions)

If you're using an older Zabbix version without API tokens:

1. First, get a session token:
```json
{
    "jsonrpc": "2.0",
    "method": "user.login",
    "params": {
        "username": "your_username",
        "password": "your_password"
    },
    "id": 1
}
```

2. Update `src/services/zabbixApi.js` to handle login:

```javascript
// Add this method to the ZabbixApiService class
async login(username, password) {
  const result = await this.request('user.login', {
    username: username,
    password: password,
  });
  this.apiToken = result;
  return result;
}
```

3. Update config to use username/password:
```env
VITE_ZABBIX_USERNAME=Admin
VITE_ZABBIX_PASSWORD=zabbix
```

## Troubleshooting Common Issues

### Issue: "Cannot find module"
**Solution**: Make sure you installed dependencies:
```bash
npm install
```

### Issue: Environment variables not loading
**Solution**: 
1. Restart the dev server after creating `.env`
2. Make sure variables start with `VITE_`
3. Check the file is named exactly `.env` (not `.env.txt`)

### Issue: CORS Error
**Solution**: Use the development proxy in `vite.config.js`:

```javascript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'https://your-zabbix-server.com',
        changeOrigin: true,
        secure: false, // if using self-signed certificate
        rewrite: (path) => path.replace(/^\/api/, '/api_jsonrpc.php'),
      },
    },
  },
})
```

Then use `/api` as your API URL:
```env
VITE_ZABBIX_API_URL=/api
```

### Issue: "No Agent" status for all hosts
**Solution**: 
- Make sure the `agent.version` item exists in Zabbix
- Check if agents are actually installed and reporting
- Verify the item key is exactly `agent.version`

## Testing Without Real Zabbix Server

If you want to test the UI first before connecting to Zabbix:

1. Keep `USE_MOCK_DATA = true` in `src/App.jsx`
2. The app will use sample data from `src/data/mockData.js`
3. This is useful for:
   - UI development
   - Testing filters and search
   - Demonstrating to stakeholders

## Next Steps After Integration

Once you see your real Zabbix data:

1. ✅ Verify all hosts are showing correctly
2. ✅ Check host groups are populated
3. ✅ Confirm agent versions are displayed
4. ✅ Test all filters (search, host group, status)
5. 🔄 Implement actual install/update scripts (backend required)

## Need Help?

Check the detailed guide: `SETUP_GUIDE.md`

Common commands:
```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```
