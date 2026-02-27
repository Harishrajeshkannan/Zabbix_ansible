#!/bin/bash
# Zabbix Installation Script Runner
# This script is called by the web application to run the installation

set -euo pipefail

# Check if all required parameters are provided
if [ $# -lt 5 ]; then
    echo "ERROR: Insufficient parameters"
    echo "Usage: $0 <version> <server_ip> <hostname> <server_port> <psk> [psk_identity]"
    exit 1
fi

# Get parameters
VERSION="$1"
SERVER_IP="$2"
HOSTNAME="$3"
SERVER_PORT="$4"
PSK="$5"
PSK_IDENTITY="${6:-$HOSTNAME}"

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_SCRIPT="$SCRIPT_DIR/install-zabbix-rhel.sh"

# Check if the installation script exists
if [ ! -f "$INSTALL_SCRIPT" ]; then
    echo "ERROR: Installation script not found: $INSTALL_SCRIPT"
    exit 1
fi

# Make sure the installation script is executable
chmod +x "$INSTALL_SCRIPT"

# Run the installation script with parameters
exec "$INSTALL_SCRIPT" "$VERSION" "$SERVER_IP" "$HOSTNAME" "$SERVER_PORT" "$PSK" "$PSK_IDENTITY"