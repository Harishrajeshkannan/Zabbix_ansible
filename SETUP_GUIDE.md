# Zabbix API Integration Setup Guide

This guide will help you configure the application to connect to your Zabbix server and load real data.

## Prerequisites

1. Zabbix Server (version 5.0 or higher recommended)
2. Zabbix API access
3. API Token (or username/password for older versions)

## Step 1: Generate Zabbix API Token

### For Zabbix 5.4+:

1. Log in to your Zabbix web interface
2. Navigate to **Administration → API tokens**
3. Click **Create API token**
4. Fill in the details:
   - **Name**: "Deployment Portal" (or any name you prefer)
   - **User**: Select a user with appropriate permissions
   - **Expires at**: Set expiration date (optional)
5. Click **Add**
6. **Important**: Copy the generated token immediately (it won't be shown again)

### Required Permissions:

The user associated with the API token needs at least the following permissions:
- Read access to Hosts
- Read access to Host Groups
- Read access to Items (to check agent versions)

## Step 2: Configure the Application

### Option A: Using Environment Variables (Recommended)

1. Create a `.env` file in the project root:
   ```bash
   cp .env.example .env
   ```

2. Edit the `.env` file and add your configuration:
   ```env
   VITE_ZABBIX_API_URL=https://your-zabbix-server.com/api_jsonrpc.php
   VITE_ZABBIX_API_TOKEN=your_generated_api_token_here
   VITE_LATEST_AGENT_VERSION=7.0.0
   ```

3. **Important**: Add `.env` to `.gitignore` to avoid committing sensitive data:
   ```bash
   echo ".env" >> .gitignore
   ```

### Option B: Direct Configuration (Not Recommended for Production)

Edit `src/config/zabbixConfig.js` and update the values:

```javascript
export const ZABBIX_CONFIG = {
  apiUrl: 'https://your-zabbix-server.com/api_jsonrpc.php',
  apiToken: 'your_api_token_here',
  latestAgentVersion: '7.0.0',
};
```

## Step 3: Enable Real API Mode

In `src/App.jsx`, change the constant at the top:

```javascript
// Change this line:
const USE_MOCK_DATA = false; // Set to false to use real Zabbix API
```

## Step 4: Configure CORS (if needed)

If your Zabbix server is on a different domain, you may need to configure CORS.

### Method 1: Zabbix Server Configuration

Add to your Apache/Nginx configuration:

**Apache** (`.htaccess` or virtual host):
```apache
Header set Access-Control-Allow-Origin "*"
Header set Access-Control-Allow-Methods "POST, GET, OPTIONS"
Header set Access-Control-Allow-Headers "Content-Type, Authorization"
```

**Nginx**:
```nginx
add_header 'Access-Control-Allow-Origin' '*';
add_header 'Access-Control-Allow-Methods' 'POST, GET, OPTIONS';
add_header 'Access-Control-Allow-Headers' 'Content-Type, Authorization';
```

### Method 2: Use Proxy (Development)

Update `vite.config.js` to proxy API requests:

```javascript
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'https://your-zabbix-server.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '/api_jsonrpc.php'),
      },
    },
  },
});
```

Then update your API URL in `.env`:
```env
VITE_ZABBIX_API_URL=/api
```

## Step 5: Test Connection

1. Start the development server:
   ```bash
   npm run dev
   ```

2. Open the browser console (F12)

3. You should see:
   ```
   Fetching data from Zabbix API...
   Connected to Zabbix API version: X.X.X
   ```

4. If successful, the application will display your real Zabbix hosts

## Troubleshooting

### Error: "Zabbix API Token is not configured"

- Make sure your `.env` file exists and has the correct variable names
- Restart the dev server after creating/modifying `.env`
- Check that variable names start with `VITE_`

### Error: "Failed to connect to Zabbix API"

- Verify the API URL is correct
- Check that the Zabbix server is accessible from your network
- Ensure the API endpoint path is `/api_jsonrpc.php`

### Error: "Zabbix API error: Session terminated"

- Your API token may have expired
- Generate a new token in Zabbix
- Update the token in your `.env` file

### CORS Errors

- See "Configure CORS" section above
- For development, use the proxy method
- For production, configure proper CORS on the Zabbix server

### No Agent Versions Showing

The application looks for items with key `agent.version`. Make sure:
- Zabbix agent is properly configured on hosts
- The item `agent.version` exists and is active
- The item has collected at least one value

You can verify this in Zabbix:
1. Go to **Monitoring → Latest data**
2. Select a host
3. Search for "agent.version"

## API Methods Used

The application uses the following Zabbix API methods:

1. **apiinfo.version** - Test connection
2. **hostgroup.get** - Get all host groups
3. **host.get** - Get all hosts with interfaces and inventory
4. **item.get** - Get agent version items

## Data Refresh

- **Initial Load**: On page load
- **Auto-Refresh**: Every 5 minutes (configurable in App.jsx)
- **Manual Refresh**: Click the "🔄 Refresh Data" button

## Security Best Practices

1. ✅ **Never commit API tokens** to version control
2. ✅ **Use environment variables** for sensitive data
3. ✅ **Set token expiration** dates in Zabbix
4. ✅ **Use HTTPS** for production deployments
5. ✅ **Limit API token permissions** to read-only
6. ✅ **Regularly rotate tokens** for better security

## Performance Optimization

For large Zabbix installations (>1000 hosts):

1. Implement pagination in the API calls
2. Add debouncing to search/filter operations
3. Use React.memo for component optimization
4. Consider implementing virtual scrolling for the table

## Next Steps

Once the API integration is working:

1. Implement actual install/update functionality (requires backend service)
2. Add user authentication
3. Implement role-based access control
4. Add deployment logging and history
5. Set up monitoring and alerting for failed deployments

## Support

If you encounter issues:
1. Check the browser console for detailed error messages
2. Verify Zabbix server logs
3. Test API calls using Postman or curl
4. Contact your Zabbix administrator for server-side issues
