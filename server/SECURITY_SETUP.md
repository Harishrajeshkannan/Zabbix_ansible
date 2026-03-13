# Security Setup for Zabbix Deployment Portal

## ⚠️ IMPORTANT: Passwordless Sudo Configuration

This application requires **passwordless sudo** for the installation script. This is standard practice in DevOps automation.

### Why Passwordless Sudo?

✅ **Security**: No passwords transmitted over HTTP  
✅ **Industry Standard**: Used in Ansible, Chef, Puppet  
✅ **Audit Trail**: All actions logged via sudo logs  
✅ **Restricted Access**: Only specific script can run elevated  

❌ **NOT using**: `NOPASSWD: ALL` (dangerous)  
✅ **Using**: Path-restricted passwordless sudo  

---

## Setup Instructions

### 1. Create Sudoers Configuration

Create a dedicated sudoers file:

```bash
sudo visudo -f /etc/sudoers.d/zabbix-deployment
```

### 2. Add Restricted Permission

Replace `nodeuser` with the user running the Node.js backend:

```bash
# Allow Node.js backend user to run installation script without password
nodeuser ALL=(ALL) NOPASSWD: /path/to/server/install-zabbix-rhel.sh
```

**Example for user `harish`:**

```bash
harish ALL=(ALL) NOPASSWD: /home/harish/zabbix-portal/server/install-zabbix-rhel.sh
```

### 3. Set Correct Permissions

```bash
sudo chmod 0440 /etc/sudoers.d/zabbix-deployment
sudo chown root:root /etc/sudoers.d/zabbix-deployment
```

### 4. Verify Configuration

Test without password prompt:

```bash
sudo /path/to/server/install-zabbix-rhel.sh --help
```

Should run immediately without asking for password.

---

## Security Best Practices

### ✅ DO

- Use path-restricted `NOPASSWD` only for specific script
- Run backend as dedicated service user (not root)
- Use absolute paths in sudoers
- Audit `/var/log/secure` for sudo usage
- Restrict file permissions on installation script

### ❌ DO NOT

- Use `NOPASSWD: ALL` (gives unrestricted root access)
- Run Node.js backend as root
- Expose API to public internet without authentication
- Log sensitive data (PSK keys, etc.)

---

## Troubleshooting

### "sudo: a password is required"

Check sudoers configuration:

```bash
sudo visudo -c  # Check syntax
sudo -l -U nodeuser  # List sudo permissions
```

### Permission Denied

Ensure script is executable:

```bash
chmod +x /path/to/install-zabbix-rhel.sh
```

### SELinux Issues

If SELinux is enforcing:

```bash
sudo chcon -t bin_t /path/to/install-zabbix-rhel.sh
```

---

## Production Deployment Checklist

- [ ] Passwordless sudo configured for installation script only
- [ ] Backend runs as dedicated service user (not root)
- [ ] Installation script has restrictive permissions (755)
- [ ] Sudoers file has correct permissions (440)
- [ ] Audit logging enabled for sudo commands
- [ ] API endpoint has authentication (if exposed)
- [ ] HTTPS enabled for production frontend
- [ ] Input validation enabled on all endpoints
- [ ] Installation logs rotated and monitored

---

## Alternative: Using Systemd Service

For even better security, wrap the installation in a systemd service that the backend can trigger.

Example:

```ini
[Unit]
Description=Zabbix Agent Installation Service

[Service]
Type=oneshot
ExecStart=/path/to/install-zabbix-rhel.sh %i
User=root

[Install]
WantedBy=multi-user.target
```

Then backend only needs:

```bash
sudo systemctl start zabbix-install@7.0.5
```

---

## Questions?

Read: https://wiki.archlinux.org/title/Sudo  
Read: https://www.sudo.ws/docs/man/sudoers.man/

**Remember**: Security through restricted permissions, not obscurity.
