# Security Setup for Zabbix Deployment Portal

## Authentication & Credentials Management

This application uses **Ansible for remote host management**. Credentials are managed securely via environment variables and Ansible's connection mechanisms.

### Security Approach

✅ **SSH-based Authentication**: Supports both password and key-based auth  
✅ **Environment-based Secrets**: Credentials stored in `.env` (not in code)  
✅ **Ansible Privilege Escalation**: Uses `become: true` with sudo  
✅ **No Hardcoded Passwords**: All credentials externalized  
✅ **Audit Trail**: Ansible logs all execution and configuration changes  

---

## Setup Instructions

### 1. Configure Environment Variables

Create a `.env` file in the application root with authentication credentials:

```bash
# SSH Connection Settings
ANSIBLE_SSH_USER=your_remote_user
ANSIBLE_SSH_PASSWORD=your_password
ANSIBLE_SSH_PORT=22
# OR use key-based auth:
ANSIBLE_SSH_PRIVATE_KEY_FILE=/path/to/private/key

# Ansible Privilege Escalation
ANSIBLE_BECOME_PASSWORD=sudo_password_if_needed
```

### 2. Prepare Remote Hosts

Ensure target hosts have:
- SSH access enabled with the configured user
- Sudo privileges (for agent installation)
- Network connectivity to the Ansible controller

### 3. Set File Permissions (Linux/macOS)

```bash
chmod 600 .env
chmod 600 /path/to/private/key
```

### 4. Test Ansible Connectivity

```bash
ansible all -i "target_host," -m ping
```

---

## Security Best Practices

- Store `.env` files outside version control (add to `.gitignore`)
- Rotate SSH keys and passwords regularly
- Use SSH keys instead of passwords when possible
- Restrict `.env` file permissions to the application user only
- Review Ansible logs regularly for unauthorized access attempts

---

## Troubleshooting

### "ERROR! couldn't resolve module/action 'service_facts'"

Ensure Ansible version is 2.5+:
```bash
ansible --version
```

### Connection timeout to target host

Check network connectivity and firewall rules:
```bash
ansible all -i "target_host," -m ping
```

### "Permission denied (publickey,password)"

Verify SSH credentials in `.env`:
```bash
ssh -v -u ${ANSIBLE_SSH_USER} target_host
```

### "fatal: [target]: UNREACHABLE!"

Check target host SSH service is running:
```bash
# On target host:
sudo systemctl status sshd
```

---

## Production Deployment Checklist

- [x] Credentials stored in environment variables (not hardcoded)
- [x] Backend runs as dedicated service user (not root)
- [ ] SSH keys configured for key-based authentication
- [ ] Target hosts have SSH enabled and accessible
- [ ] Ansible controller has `ansible-playbook` installed
- [ ] API endpoint has authentication layer (if exposed)
- [ ] HTTPS enabled for production frontend
- [ ] Input validation enabled on all endpoints
- [ ] Installation logs monitored for errors
- [ ] Ansible operations audited and logged

---

## References

- [Ansible Documentation](https://docs.ansible.com/)
- [Ansible SSH Connection](https://docs.ansible.com/ansible/latest/inventory/connection_details.html)
- [SSH Key-Based Authentication](https://wiki.archlinux.org/title/SSH_keys)
