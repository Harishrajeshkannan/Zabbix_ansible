#!/bin/bash
# Zabbix Agent 2 Installation Script for RHEL/CentOS/Rocky/AlmaLinux
# This script must be run with sudo/root privileges
# Usage: sudo ./install-zabbix-rhel.sh [VERSION] [SERVER_IP] [HOSTNAME] [SERVER_PORT] [PSK] [PSK_IDENTITY]
#
# Examples:
#   sudo ./install-zabbix-rhel.sh 7.0.5 192.168.1.100 myserver.example.com
#   sudo ./install-zabbix-rhel.sh 6.4.18 zabbix.company.com myserver 10051 "my-secret-psk" "myserver-psk"
#
# All parameters are required for automated installation

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Default values
DEFAULT_VERSION="7.0.5"
DEFAULT_SERVER_PORT="10051"
DEFAULT_LISTEN_PORT="10050"

# Create log file
LOG_FILE="/tmp/zabbix_install_$(date +%Y%m%d_%H%M%S).log"
exec > >(tee -a "$LOG_FILE") 2>&1

# Function to print colored output
print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_section() {
    echo -e "${CYAN}== $1 ==${NC}"
}

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to validate IP address
validate_ip() {
    local ip="$1"
    if [[ $ip =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]]; then
        return 0
    elif [[ $ip =~ ^[a-zA-Z0-9.-]+$ ]]; then
        # Allow hostnames/FQDNs
        return 0
    else
        return 1
    fi
}

# Function to test connectivity
test_connectivity() {
    local server="$1"
    local port="$2"
    
    print_info "Testing connectivity to $server:$port..."
    
    if timeout 10 bash -c "</dev/tcp/$server/$port"; then
        print_success "Successfully connected to $server:$port"
        return 0
    else
        print_warning "Cannot connect to $server:$port"
        print_warning "Please ensure the server is accessible and port $port is open"
        return 1
    fi
}

# Function to detect OS
detect_os() {
    if [ -f /etc/redhat-release ]; then
        RHEL_VERSION=$(rpm -E %{rhel} 2>/dev/null || echo "unknown")
        OS_NAME=$(cat /etc/redhat-release)
    elif [ -f /etc/os-release ]; then
        OS_NAME=$(grep PRETTY_NAME /etc/os-release | cut -d= -f2 | tr -d '"')
        RHEL_VERSION=$(rpm -E %{rhel} 2>/dev/null || echo "8")
    else
        print_error "Cannot detect RHEL-based operating system"
        exit 1
    fi
    
    print_info "Detected OS: $OS_NAME"
    print_info "RHEL Version: $RHEL_VERSION"
}

# Function to check prerequisites
check_prerequisites() {
    print_section "Checking Prerequisites"
    
    # Check if running on RHEL-based system
    if ! command_exists dnf && ! command_exists yum; then
        print_error "This script requires a RHEL-based system with yum or dnf"
        exit 1
    fi
    
    # Determine package manager
    PKG_MGR="yum"
    if command_exists dnf; then
        PKG_MGR="dnf"
    fi
    
    print_info "Using package manager: $PKG_MGR"
    
    # Running with elevated privileges
    print_success "Running with elevated privileges"
    
    # Check internet connectivity
    if ! ping -c 1 repo.zabbix.com >/dev/null 2>&1; then
        print_warning "Cannot reach repo.zabbix.com - installation may fail"
    else
        print_success "Internet connectivity verified"
    fi
}

# Function to install prerequisites
install_prerequisites() {
    print_section "Installing Prerequisites"
    
    print_info "Updating package cache..."
    $PKG_MGR update -y -q
    
    print_info "Installing required packages..."
    $PKG_MGR install -y wget curl rpm
}

# Function to add Zabbix repository
add_zabbix_repo() {
    local version="$1"
    
    print_section "Adding Zabbix Repository"
    
    # Extract major.minor version
    MAJOR_VERSION=$(echo "$version" | cut -d. -f1-2)
    
    # Build repository URL
    REPO_URL="https://repo.zabbix.com/zabbix/$MAJOR_VERSION/stable/rhel/$RHEL_VERSION/x86_64/zabbix-release-$MAJOR_VERSION-1.el$RHEL_VERSION.noarch.rpm"
    
    print_info "Repository URL: $REPO_URL"
    
    # Check if repository is already installed
    if rpm -qa | grep -q "zabbix-release-$MAJOR_VERSION"; then
        print_info "Zabbix repository $MAJOR_VERSION already installed"
    else
        print_info "Installing Zabbix repository..."
        rpm -Uvh "$REPO_URL" || {
            print_error "Failed to install Zabbix repository"
            print_error "Please check if version $version is available for RHEL $RHEL_VERSION"
            exit 1
        }
    fi
    
    # Clean package cache
    print_info "Cleaning package cache..."
    $PKG_MGR clean all -q
}

# Function to install Zabbix Agent 2
install_zabbix_agent() {
    print_section "Installing Zabbix Agent 2"
    
    # Check if already installed
    if rpm -qa | grep -q zabbix-agent2; then
        INSTALLED_VERSION=$(rpm -qa | grep zabbix-agent2 | head -1)
        print_warning "Zabbix Agent 2 already installed: $INSTALLED_VERSION"
        print_info "Proceeding with reinstall/update..."
    fi
    
    print_info "Installing Zabbix Agent 2..."
    $PKG_MGR install -y zabbix-agent2
    
    print_success "Zabbix Agent 2 installed successfully"
}

# Function to configure Zabbix Agent 2
configure_zabbix_agent() {
    local server_ip="$1"
    local server_port="$2"
    local hostname="$3"
    local psk="$4"
    local psk_identity="$5"
    
    print_section "Configuring Zabbix Agent 2"
    
    # Backup original configuration
    if [ ! -f /etc/zabbix/zabbix_agent2.conf.backup ]; then
        print_info "Creating backup of original configuration..."
        cp /etc/zabbix/zabbix_agent2.conf /etc/zabbix/zabbix_agent2.conf.backup
    fi
    
    # Configure basic settings
    print_info "Configuring basic settings..."
    sed -i "s/^Server=.*/Server=$server_ip/" /etc/zabbix/zabbix_agent2.conf
    sed -i "s/^ServerActive=.*/ServerActive=$server_ip:$server_port/" /etc/zabbix/zabbix_agent2.conf
    sed -i "s/^Hostname=.*/Hostname=$hostname/" /etc/zabbix/zabbix_agent2.conf
    sed -i "s/^# ListenPort=.*/ListenPort=$DEFAULT_LISTEN_PORT/" /etc/zabbix/zabbix_agent2.conf
    
    # Configure PSK encryption if provided
    if [ -n "$psk" ] && [ "$psk" != "none" ]; then
        print_info "Configuring PSK encryption..."
        
        # Create PSK file
        echo "$psk" | tee /etc/zabbix/zabbix_agent2.psk >/dev/null
        chown zabbix:zabbix /etc/zabbix/zabbix_agent2.psk
        chmod 600 /etc/zabbix/zabbix_agent2.psk
        
        # Set PSK identity (use hostname if not specified)
        if [ -z "$psk_identity" ] || [ "$psk_identity" = "none" ]; then
            psk_identity="$hostname"
        fi
        
        # Update configuration for PSK
        sed -i 's/^# TLSConnect=.*/TLSConnect=psk/' /etc/zabbix/zabbix_agent2.conf
        sed -i 's/^# TLSAccept=.*/TLSAccept=psk/' /etc/zabbix/zabbix_agent2.conf
        sed -i "s/^# TLSPSKIdentity=.*/TLSPSKIdentity=$psk_identity/" /etc/zabbix/zabbix_agent2.conf
        sed -i 's|^# TLSPSKFile=.*|TLSPSKFile=/etc/zabbix/zabbix_agent2.psk|' /etc/zabbix/zabbix_agent2.conf
        
        print_success "PSK encryption configured (Identity: $psk_identity)"
    else
        print_info "PSK encryption not configured (plaintext communication)"
    fi
}

# Function to validate configuration
validate_configuration() {
    print_section "Validating Configuration"
    
    print_info "Testing configuration syntax..."
    if su -s /bin/bash zabbix -c 'zabbix_agent2 -t zabbix.agent.ping'; then
        print_success "Configuration validation passed"
    else
        print_error "Configuration validation failed"
        print_error "Please check the configuration file: /etc/zabbix/zabbix_agent2.conf"
        exit 1
    fi
}

# Function to start and enable service
start_zabbix_service() {
    print_section "Starting Zabbix Agent 2 Service"
    
    # Enable service
    print_info "Enabling Zabbix Agent 2 service..."
    systemctl enable zabbix-agent2
    
    # Start/restart service
    print_info "Starting Zabbix Agent 2 service..."
    systemctl restart zabbix-agent2
    
    # Wait for service to start
    sleep 3
    
    # Check service status
    if systemctl is-active --quiet zabbix-agent2; then
        print_success "Zabbix Agent 2 service is running"
        
        # Show detailed status
        echo ""
        systemctl status zabbix-agent2 --no-pager -l
    else
        print_error "Zabbix Agent 2 service failed to start"
        
        # Show error details
        echo ""
        print_error "Service status:"
        systemctl status zabbix-agent2 --no-pager -l
        
        print_error "Recent logs:"
        journalctl -u zabbix-agent2 --no-pager -n 20
        
        exit 1
    fi
}

# Function to configure firewall
configure_firewall() {
    print_section "Configuring Firewall"
    
    if systemctl is-active --quiet firewalld; then
        print_info "Configuring firewalld..."
        
        # Add Zabbix agent port
        firewall-cmd --permanent --add-port=$DEFAULT_LISTEN_PORT/tcp
        firewall-cmd --reload
        
        print_success "Firewall configured to allow Zabbix agent port $DEFAULT_LISTEN_PORT"
    elif systemctl is-enabled --quiet iptables 2>/dev/null; then
        print_warning "iptables detected but automatic configuration not implemented"
        print_info "Please manually allow port $DEFAULT_LISTEN_PORT/tcp in your iptables rules"
    else
        print_info "No active firewall detected or firewall management not needed"
    fi
}

# Function to display installation summary
show_summary() {
    local version="$1"
    local server_ip="$2"
    local server_port="$3"
    local hostname="$4"
    local psk="$5"
    
    print_section "Installation Summary"
    
    echo ""
    echo "🎉 Zabbix Agent 2 $version has been successfully installed and configured!"
    echo ""
    echo "Configuration Details:"
    echo "  • Hostname: $hostname"
    echo "  • Zabbix Server: $server_ip:$server_port"
    echo "  • Listen Port: $DEFAULT_LISTEN_PORT"
    echo "  • Encryption: $([ -n "$psk" ] && [ "$psk" != "none" ] && echo "PSK enabled" || echo "None (plaintext)")"
    echo "  • Service: zabbix-agent2 (enabled and running)"
    echo ""
    echo "File Locations:"
    echo "  • Configuration: /etc/zabbix/zabbix_agent2.conf"
    echo "  • Backup: /etc/zabbix/zabbix_agent2.conf.backup"
    echo "  • Log File: $LOG_FILE"
    if [ -n "$psk" ] && [ "$psk" != "none" ]; then
        echo "  • PSK File: /etc/zabbix/zabbix_agent2.psk"
    fi
    echo ""
    echo "Useful Commands:"
    echo "  • Check status: systemctl status zabbix-agent2"
    echo "  • View logs: journalctl -u zabbix-agent2 -f"
    echo "  • Test config: su -s /bin/bash zabbix -c 'zabbix_agent2 -t zabbix.agent.ping'"
    echo "  • Restart service: systemctl restart zabbix-agent2"
    echo ""
    
    # Test connectivity if server is reachable
    if test_connectivity "$server_ip" "$server_port"; then
        echo "✅ The Zabbix server should now be able to connect to this agent."
    else
        echo "⚠️  Please verify network connectivity to the Zabbix server."
    fi
    
    echo ""
    print_success "Installation completed successfully!"
}

# Main function
main() {
    echo "==========================================="
    echo "   Zabbix Agent 2 Installation Script"
    echo "   for RHEL/CentOS/Rocky/AlmaLinux"
    echo "==========================================="
    echo ""
    
    # Detect operating system
    detect_os
    
    # Parse command line arguments (automated mode only)
    if [ $# -lt 2 ]; then
        print_error "Insufficient arguments for automated installation"
        echo "Usage: sudo $0 [VERSION] [SERVER_IP] [HOSTNAME] [SERVER_PORT] [PSK] [PSK_IDENTITY]"
        echo ""
        echo "Examples:"
        echo "  sudo $0 7.0.5 192.168.1.100 myserver.example.com"
        echo "  sudo $0 6.4.18 zabbix.company.com myserver 10051 \"my-secret-psk\" \"myserver-psk\""
        exit 1
    fi
    
    # Command line arguments
    VERSION="${1:-$DEFAULT_VERSION}"
    SERVER_IP="${2:-}"
    HOSTNAME="${3:-$(hostname -f 2>/dev/null || hostname)}"
    SERVER_PORT="${4:-$DEFAULT_SERVER_PORT}"
    PSK="${5:-}"
    PSK_IDENTITY="${6:-$HOSTNAME}"
    
    if [ -z "$SERVER_IP" ]; then
        print_error "Server IP is required"
        echo "Usage: sudo $0 [VERSION] [SERVER_IP] [HOSTNAME] [SERVER_PORT] [PSK] [PSK_IDENTITY]"
        exit 1
    fi
    
    if ! validate_ip "$SERVER_IP"; then
        print_error "Invalid server IP or hostname: $SERVER_IP"
        exit 1
    fi
    
    # Normalize PSK values
    if [ "$PSK" = "none" ] || [ -z "$PSK" ]; then
        PSK=""
        PSK_IDENTITY=""
    fi
    
    # Display configuration
    echo ""
    print_section "Installation Configuration"
    echo "Version: $VERSION"
    echo "Server: $SERVER_IP:$SERVER_PORT"
    echo "Hostname: $HOSTNAME"
    echo "PSK Encryption: $([ -n "$PSK" ] && echo "Enabled" || echo "Disabled")"
    if [ -n "$PSK" ]; then
        echo "PSK Identity: $PSK_IDENTITY"
    fi
    echo "Log File: $LOG_FILE"
    echo ""
    
    print_info "Proceeding with installation..."
    
    # Run installation steps
    check_prerequisites
    install_prerequisites
    add_zabbix_repo "$VERSION"
    install_zabbix_agent
    configure_zabbix_agent "$SERVER_IP" "$SERVER_PORT" "$HOSTNAME" "$PSK" "$PSK_IDENTITY"
    validate_configuration
    start_zabbix_service
    configure_firewall
    
    # Show summary
    show_summary "$VERSION" "$SERVER_IP" "$SERVER_PORT" "$HOSTNAME" "$PSK"
}

# Error handling
trap 'print_error "Script interrupted"; exit 1' INT TERM

# Check if running with elevated privileges
if [ "$EUID" -ne 0 ]; then
    print_error "This script must be run with sudo or as root"
    echo "Usage: sudo $0 [VERSION] [SERVER_IP] [HOSTNAME] [SERVER_PORT] [PSK] [PSK_IDENTITY]"
    exit 1
fi

# Run main function
main "$@"

exit 0