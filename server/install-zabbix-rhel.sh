#!/bin/bash
# Zabbix Agent 2 Installation Script for RHEL/CentOS/Rocky/AlmaLinux
# This script must be run with sudo/root privileges
# Usage: sudo ./install-zabbix-rhel.sh [VERSION] [SERVER_IP] [HOSTNAME] [SERVER_PORT]
#
# Examples:
#   sudo ./install-zabbix-rhel.sh 7.0.5 192.168.1.100 myserver.example.com
#   sudo ./install-zabbix-rhel.sh 6.4.18 zabbix.company.com myserver 10051
#
# Version, Server IP, and Hostname are required. Server Port defaults to 10051.

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
# Touch file to ensure it exists before redirecting
touch "$LOG_FILE"
chmod 777 "$LOG_FILE"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Installation log started" >> "$LOG_FILE"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Log file: $LOG_FILE (permissions: 777)" >> "$LOG_FILE"
# Redirect all output to log file
exec > >(tee -a "$LOG_FILE") 2>&1

echo "[$(date '+%Y-%m-%d %H:%M:%S')] =========================================="
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Zabbix Agent Installation Started"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Log file: $LOG_FILE"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] =========================================="

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
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting prerequisites check..."
    
    # Check if running on RHEL-based system with DNF
    if ! command_exists dnf; then
        print_error "This script requires a RHEL-based system with DNF package manager"
        print_error "DNF is the standard package manager for RHEL 8+, CentOS 8+, Rocky Linux, and AlmaLinux"
        exit 1
    fi
    
    # Use DNF as package manager
    PKG_MGR="dnf"
    print_info "Using package manager: DNF"
    
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
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Installing prerequisites..."
    
    print_info "Updating package cache..."
    $PKG_MGR update -y
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Package cache updated"
    
    print_info "Installing required packages (wget, curl, rpm)..."
    $PKG_MGR install -y wget curl rpm
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Required packages installed"
}

# Function to add Zabbix repository
add_zabbix_repo() {
    local version="$1"
    
    print_section "Adding Zabbix Repository"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Configuring Zabbix repository for version $version..."
    
    # Extract major.minor version
    MAJOR_VERSION=$(echo "$version" | cut -d. -f1-2)
    
    # Determine if /stable/ path should be used (7.2+ versions use it, earlier don't)
    MAJOR_NUM=$(echo "$MAJOR_VERSION" | awk '{print $1}')
    if awk "BEGIN {exit !($MAJOR_NUM >= 7.2)}"; then
        STABLE_PATH="/stable"
        print_info "Version $MAJOR_NUM uses /stable/ repository path"
    else
        STABLE_PATH=""
        print_info "Version $MAJOR_NUM uses legacy repository path"
    fi
    
    # Build repository URL
    REPO_URL="https://repo.zabbix.com/zabbix/$MAJOR_VERSION${STABLE_PATH}/rhel/$RHEL_VERSION/x86_64/zabbix-release-$MAJOR_VERSION-1.el$RHEL_VERSION.noarch.rpm"
    
    print_info "Repository URL: $REPO_URL"
    
    # Check if repository is already installed
    if rpm -qa | grep -q "zabbix-release-$MAJOR_VERSION"; then
        print_info "Zabbix repository $MAJOR_VERSION already installed"
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Repository already present, skipping installation"
    else
        print_info "Installing Zabbix repository..."
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Downloading repository package from: $REPO_URL"
        if rpm -Uvh "$REPO_URL"; then
            echo "[$(date '+%Y-%m-%d %H:%M:%S')] Repository package installed successfully"
        else
            print_error "Failed to install Zabbix repository"
            print_error "Please check if version $version is available for RHEL $RHEL_VERSION"
            echo "[$(date '+%Y-%m-%d %H:%M:%S')] Repository installation FAILED"
            exit 1
        fi
    fi
    
    # Clean package cache
    print_info "Cleaning package cache..."
    $PKG_MGR clean all
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Package cache cleaned"
}

# Function to install Zabbix Agent 2
install_zabbix_agent() {
    local version="$1"
    
    print_section "Installing Zabbix Agent 2"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting Zabbix Agent 2 installation..."
    
    # Check if already installed
    if rpm -qa | grep -q zabbix-agent2; then
        INSTALLED_VERSION=$(rpm -qa | grep zabbix-agent2 | head -1)
        print_warning "Zabbix Agent 2 already installed: $INSTALLED_VERSION"
        print_info "Proceeding with reinstall/update..."
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Existing version: $INSTALLED_VERSION"
    fi
    
    print_info "Installing Zabbix Agent 2 version ${version}..."
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Requested version: ${version}"
    
    # Check if RPM file was pre-downloaded
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    DOWNLOADS_DIR="${SCRIPT_DIR}/downloads"
    
    # Look for downloaded RPM matching the version
    DOWNLOADED_RPM=""
    if [ -d "$DOWNLOADS_DIR" ]; then
        DOWNLOADED_RPM=$(find "$DOWNLOADS_DIR" -name "zabbix-agent2-${version}*.rpm" -type f 2>/dev/null | head -1)
    fi
    
    # Install from downloaded RPM if available, otherwise use repository
    if [ -n "$DOWNLOADED_RPM" ] && [ -f "$DOWNLOADED_RPM" ]; then
        print_info "Found pre-downloaded package: $(basename "$DOWNLOADED_RPM")"
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Package path: $DOWNLOADED_RPM"
        
        # Make RPM package executable
        print_info "Setting executable permissions on RPM package..."
        chmod +x "$DOWNLOADED_RPM"
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] RPM package permissions set to executable"
        
        print_info "Installing from local file..."
        
        if rpm -Uvh "$DOWNLOADED_RPM"; then
            print_success "Zabbix Agent 2 installed from downloaded package"
            echo "[$(date '+%Y-%m-%d %H:%M:%S')] Installation from local RPM successful"
            return 0
        else
            print_warning "Failed to install from downloaded package, falling back to repository..."
            echo "[$(date '+%Y-%m-%d %H:%M:%S')] Local RPM installation failed, trying repository"
        fi
    fi
    
    # Fall back to repository installation  
    print_info "Installing from Zabbix repository..."
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Attempting repository installation with DNF"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Available repositories:"
    dnf repolist 2>/dev/null | grep -i zabbix || echo "No Zabbix repositories found"
    
    # Try exact version match first
    print_info "Trying exact version match: zabbix-agent2-${version}"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Command: dnf install -y zabbix-agent2-${version}"
    if $PKG_MGR install -y "zabbix-agent2-${version}"; then
        print_success "Zabbix Agent 2 version ${version} installed successfully"
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Exact version match installation successful"
    else
        # Try with wildcard for release variants (release1, release2, etc.)
        print_info "Trying with version wildcard: zabbix-agent2-${version}*"
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Attempting wildcard match"
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Command: dnf install -y zabbix-agent2-${version}*"
        if $PKG_MGR install -y zabbix-agent2-${version}*; then
            print_success "Zabbix Agent 2 installed successfully"
            echo "[$(date '+%Y-%m-%d %H:%M:%S')] Wildcard version installation successful"
        else
            # Last resort: install latest available
            print_warning "Specific version not available, installing latest from repository..."
            echo "[$(date '+%Y-%m-%d %H:%M:%S')] Attempting latest available version"
            echo "[$(date '+%Y-%m-%d %H:%M:%S')] Command: dnf install -y zabbix-agent2"
            if $PKG_MGR install -y zabbix-agent2; then
                INSTALLED_VERSION=$(rpm -qa | grep zabbix-agent2 | head -1)
                print_warning "Installed: $INSTALLED_VERSION (may differ from requested $version)"
                echo "[$(date '+%Y-%m-%d %H:%M:%S')] Latest version installation successful: $INSTALLED_VERSION"
            else
                print_error "Failed to install Zabbix Agent 2"
                echo "[$(date '+%Y-%m-%d %H:%M:%S')] All installation attempts failed"
                exit 1
            fi
        fi
    fi
}

# Function to configure Zabbix Agent 2
configure_zabbix_agent() {
    local server_ip="$1"
    local server_port="$2"
    local hostname="$3"
    
    print_section "Configuring Zabbix Agent 2"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting configuration..."
    
    # Backup original configuration
    if [ ! -f /etc/zabbix/zabbix_agent2.conf.backup ]; then
        print_info "Creating backup of original configuration..."
        cp /etc/zabbix/zabbix_agent2.conf /etc/zabbix/zabbix_agent2.conf.backup
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Configuration backup created"
    fi
    
    # Configure basic settings
    print_info "Configuring basic settings..."
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Server: $server_ip | Port: $server_port | Hostname: $hostname"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Modifying configuration file: /etc/zabbix/zabbix_agent2.conf"
    sed -i "s/^Server=.*/Server=$server_ip/" /etc/zabbix/zabbix_agent2.conf
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Set Server=$server_ip"
    sed -i "s/^ServerActive=.*/ServerActive=$server_ip:$server_port/" /etc/zabbix/zabbix_agent2.conf
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Set ServerActive=$server_ip:$server_port"
    sed -i "s/^Hostname=.*/Hostname=$hostname/" /etc/zabbix/zabbix_agent2.conf
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Set Hostname=$hostname"
    sed -i "s/^# ListenPort=.*/ListenPort=$DEFAULT_LISTEN_PORT/" /etc/zabbix/zabbix_agent2.conf
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Set ListenPort=$DEFAULT_LISTEN_PORT"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Basic configuration applied"
    
    print_info "Using unencrypted connection (no PSK)"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Configuration uses plaintext communication"
    
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Configuration completed successfully"
}

# Function to validate configuration
validate_configuration() {
    print_section "Validating Configuration"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Running configuration validation..."
    
    print_info "Testing configuration syntax..."
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Running: zabbix_agent2 -t zabbix.agent.ping"
    if su -s /bin/bash zabbix -c 'zabbix_agent2 -t zabbix.agent.ping'; then
        print_success "Configuration validation passed"
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Configuration validated successfully"
    else
        print_error "Configuration validation failed"
        print_error "Please check the configuration file: /etc/zabbix/zabbix_agent2.conf"
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Configuration validation FAILED"
        exit 1
    fi
}

# Function to start and enable service
start_zabbix_service() {
    print_section "Starting Zabbix Agent 2 Service"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Configuring service..."
    
    # Enable service
    print_info "Enabling Zabbix Agent 2 service..."
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Command: systemctl enable zabbix-agent2"
    systemctl enable zabbix-agent2
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Service enabled for auto-start on boot"
    
    # Start/restart service
    print_info "Starting Zabbix Agent 2 service..."
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Command: systemctl restart zabbix-agent2"
    systemctl restart zabbix-agent2
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Service restart command issued"
    
    # Wait for service to start
    sleep 3
    
    # Check service status
    if systemctl is-active --quiet zabbix-agent2; then
        print_success "Zabbix Agent 2 service is running"
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Service status: ACTIVE"
        
        # Show detailed status
        echo ""
        systemctl status zabbix-agent2 --no-pager -l
    else
        print_error "Zabbix Agent 2 service failed to start"
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Service status: FAILED"
        
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
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Checking firewall configuration..."
    
    if systemctl is-active --quiet firewalld; then
        print_info "Configuring firewalld..."
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Adding firewall rule for port $DEFAULT_LISTEN_PORT/tcp"
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Command: firewall-cmd --permanent --add-port=$DEFAULT_LISTEN_PORT/tcp"
        
        # Add Zabbix agent port
        firewall-cmd --permanent --add-port=$DEFAULT_LISTEN_PORT/tcp
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Reloading firewall..."
        firewall-cmd --reload
        
        print_success "Firewall configured to allow Zabbix agent port $DEFAULT_LISTEN_PORT"
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Firewall rule added and reloaded"
    elif systemctl is-enabled --quiet iptables 2>/dev/null; then
        print_warning "iptables detected but automatic configuration not implemented"
        print_info "Please manually allow port $DEFAULT_LISTEN_PORT/tcp in your iptables rules"
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] iptables detected - manual configuration required"
    else
        print_info "No active firewall detected or firewall management not needed"
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] No firewall configuration needed"
    fi
}

# Function to display installation summary
show_summary() {
    local version="$1"
    local server_ip="$2"
    local server_port="$3"
    local hostname="$4"
    
    print_section "Installation Summary"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Generating installation summary..."
    
    echo ""
    echo "🎉 Zabbix Agent 2 $version has been successfully installed and configured!"
    echo ""
    echo "Configuration Details:"
    echo "  • Hostname: $hostname"
    echo "  • Zabbix Server: $server_ip:$server_port"
    echo "  • Listen Port: $DEFAULT_LISTEN_PORT"
    echo "  • Encryption: None (plaintext)"
    echo "  • Service: zabbix-agent2 (enabled and running)"
    echo ""
    echo "File Locations:"
    echo "  • Configuration: /etc/zabbix/zabbix_agent2.conf"
    echo "  • Backup: /etc/zabbix/zabbix_agent2.conf.backup"
    echo "  • Log File: $LOG_FILE"
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
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ========== ALL STEPS COMPLETED ==========
"
}

# Main function
main() {
    echo "==========================================="
    echo "   Zabbix Agent 2 Installation Script"
    echo "   for RHEL/CentOS/Rocky/AlmaLinux"
    echo "==========================================="
    echo ""
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Script started"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Log file: $LOG_FILE"
    echo ""
    
    # Detect operating system
    detect_os
    
    # Parse command line arguments (automated mode only)
    if [ $# -lt 2 ]; then
        print_error "Insufficient arguments for automated installation"
        echo "Usage: sudo $0 [VERSION] [SERVER_IP] [HOSTNAME] [SERVER_PORT]"
        echo ""
        echo "Examples:"
        echo "  sudo $0 7.0.5 192.168.1.100 myserver.example.com"
        echo "  sudo $0 6.4.18 zabbix.company.com myserver 10051"
        exit 1
    fi
    
    # Command line arguments
    VERSION="${1:-$DEFAULT_VERSION}"
    SERVER_IP="${2:-}"
    HOSTNAME="${3:-$(hostname -f 2>/dev/null || hostname)}"
    SERVER_PORT="${4:-$DEFAULT_SERVER_PORT}"
    
    if [ -z "$SERVER_IP" ]; then
        print_error "Server IP is required"
        echo "Usage: sudo $0 [VERSION] [SERVER_IP] [HOSTNAME] [SERVER_PORT]"
        exit 1
    fi
    
    if ! validate_ip "$SERVER_IP"; then
        print_error "Invalid server IP or hostname: $SERVER_IP"
        exit 1
    fi
    
    # Display configuration
    echo ""
    print_section "Installation Configuration"
    echo "Version: $VERSION"
    echo "Server: $SERVER_IP:$SERVER_PORT"
    echo "Hostname: $HOSTNAME"
    echo "Encryption: Disabled (plaintext)"
    echo "Log File: $LOG_FILE"
    echo ""
    
    print_info "Proceeding with installation..."
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ========== INSTALLATION STARTED =========="
    
    # Run installation steps
    check_prerequisites
    install_prerequisites
    add_zabbix_repo "$VERSION"
    install_zabbix_agent "$VERSION"
    configure_zabbix_agent "$SERVER_IP" "$SERVER_PORT" "$HOSTNAME"
    validate_configuration
    start_zabbix_service
    configure_firewall
    
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ========== INSTALLATION COMPLETED =========="
    
    # Show summary
    show_summary "$VERSION" "$SERVER_IP" "$SERVER_PORT" "$HOSTNAME"
    
    # Show log file location
    echo ""
    print_success "Installation log saved to: $LOG_FILE"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Log file location: $LOG_FILE (permissions: 777)"
}

# Error handling
trap 'print_error "Script interrupted"; exit 1' INT TERM

# Check if running with elevated privileges
if [ "$EUID" -ne 0 ]; then
    print_error "This script must be run with sudo or as root"
    echo "Usage: sudo $0 [VERSION] [SERVER_IP] [HOSTNAME] [SERVER_PORT]"
    exit 1
fi

# Run main function
main "$@"

exit 0