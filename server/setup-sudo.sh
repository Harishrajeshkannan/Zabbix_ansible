#!/bin/bash
# Quick setup script for passwordless sudo configuration
# Run this on your RHEL server to configure passwordless sudo for Zabbix installation

set -euo pipefail

echo "=========================================="
echo "  Zabbix Portal - Sudo Setup Script"
echo "=========================================="
echo ""

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_SCRIPT="$SCRIPT_DIR/install-zabbix-rhel.sh"

# Detect current user
CURRENT_USER=$(whoami)
if [ "$CURRENT_USER" = "root" ]; then
    echo "❌ ERROR: Do not run this script as root"
    echo "Run as the user that will execute the Node.js backend"
    exit 1
fi

echo "Current user: $CURRENT_USER"
echo "Installation script: $INSTALL_SCRIPT"
echo ""

# Verify installation script exists
if [ ! -f "$INSTALL_SCRIPT" ]; then
    echo "❌ ERROR: Installation script not found: $INSTALL_SCRIPT"
    exit 1
fi

echo "✓ Installation script found"
echo ""

# Create sudoers configuration
SUDOERS_FILE="/etc/sudoers.d/zabbix-deployment"
SUDOERS_CONTENT="# Zabbix Deployment Portal - Passwordless sudo for installation
# Created: $(date)
# User: $CURRENT_USER
# 
# This allows the Node.js backend to run the installation script
# without password prompts. Path is restricted for security.

$CURRENT_USER ALL=(ALL) NOPASSWD: $INSTALL_SCRIPT
"

echo "Creating sudoers configuration..."
echo ""
echo "Configuration to be added:"
echo "---"
echo "$SUDOERS_CONTENT"
echo "---"
echo ""

read -p "Proceed with configuration? (y/N): " confirm
if [[ ! $confirm =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 0
fi

# Write sudoers file (requires sudo)
echo "$SUDOERS_CONTENT" | sudo tee "$SUDOERS_FILE" >/dev/null

# Set correct permissions
sudo chmod 0440 "$SUDOERS_FILE"
sudo chown root:root "$SUDOERS_FILE"

echo "✓ Sudoers file created: $SUDOERS_FILE"

# Validate syntax
echo ""
echo "Validating sudoers syntax..."
if sudo visudo -c -f "$SUDOERS_FILE" >/dev/null 2>&1; then
    echo "✓ Sudoers syntax is valid"
else
    echo "❌ ERROR: Sudoers syntax error detected!"
    echo "Removing invalid configuration..."
    sudo rm -f "$SUDOERS_FILE"
    exit 1
fi

# Make installation script executable
chmod +x "$INSTALL_SCRIPT"
echo "✓ Installation script is executable"

# Test passwordless sudo
echo ""
echo "Testing passwordless sudo..."
if sudo -n "$INSTALL_SCRIPT" 2>&1 | grep -q "Insufficient arguments"; then
    echo "✓ Passwordless sudo is working!"
else
    echo "⚠  Test failed - passwordless sudo may not be configured correctly"
    echo "Try running: sudo $INSTALL_SCRIPT --help"
fi

echo ""
echo "=========================================="
echo "  Setup Complete!"
echo "=========================================="
echo ""
echo "Next steps:"
echo "1. Verify setup: sudo -l"
echo "2. Start your Node.js backend: npm run server"
echo "3. Test installation via the web interface"
echo ""
echo "Security notes:"
echo "• Only $INSTALL_SCRIPT can run with passwordless sudo"
echo "• All sudo actions are logged to /var/log/secure"
echo "• To remove: sudo rm $SUDOERS_FILE"
echo ""
