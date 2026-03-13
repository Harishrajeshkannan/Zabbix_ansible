# 🚀 Quick Reference - Passwordless Sudo Setup

## One-Command Setup

```bash
cd server && chmod +x setup-sudo.sh && ./setup-sudo.sh
```

This will:
1. ✅ Create `/etc/sudoers.d/zabbix-deployment`
2. ✅ Configure passwordless sudo for your user
3. ✅ Set correct permissions (0440)
4. ✅ Validate syntax
5. ✅ Test the configuration

---

## Manual Setup (Alternative)

If you prefer manual configuration:

### Step 1: Edit Sudoers
```bash
sudo visudo -f /etc/sudoers.d/zabbix-deployment
```

### Step 2: Add This Line
Replace `/path/to/` with your actual path:
```bash
yourusername ALL=(ALL) NOPASSWD: /path/to/server/install-zabbix-rhel.sh
```

### Step 3: Save and Test
```bash
sudo -l  # Should show your passwordless permission
```

---

## Verify It Works

```bash
# Should run without password prompt
sudo /path/to/server/install-zabbix-rhel.sh

# Should show "Insufficient arguments" error (expected)
```

---

## Common Issues

### "sudo: a password is required"
- Check if file exists: `ls -la /etc/sudoers.d/zabbix-deployment`
- Verify permissions: `sudo cat /etc/sudoers.d/zabbix-deployment`
- Check path matches exactly: `pwd` vs sudoers path

### "sudo: syntax error"
- Validate: `sudo visudo -c`
- Check file: `sudo cat /etc/sudoers.d/zabbix-deployment`

### "command not found"
- Make executable: `chmod +x install-zabbix-rhel.sh`
- Use absolute path in sudoers (not relative)

---

## Security Notes

✅ **SAFE:**
```bash
user ALL=(ALL) NOPASSWD: /specific/path/to/script.sh
```

❌ **DANGEROUS:**
```bash
user ALL=(ALL) NOPASSWD: ALL
```

Never use `NOPASSWD: ALL` in production!

---

## Remove Configuration

To undo the setup:
```bash
sudo rm /etc/sudoers.d/zabbix-deployment
```

---

**Full Documentation:** `SECURITY_SETUP.md`
