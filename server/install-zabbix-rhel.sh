#!/bin/sh
# Zabbix Agent 2 Installation Script for RHEL/CentOS/Rocky/AlmaLinux
# This script must be run with sudo/root privileges
# Usage: sudo ./install-zabbix-rhel.sh [VERSION] [SERVER_IP] [HOSTNAME] [SERVER_PORT]
#
# Examples:
#   sudo ./install-zabbix-rhel.sh 7.0.5 192.168.1.100 myserver.example.com
#   sudo ./install-zabbix-rhel.sh 6.4.18 zabbix.company.com myserver 10051
#
# Version, Server IP, and Hostname are required. Server Port defaults to 10051.

set -eu

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

# Helper function for dual logging (stdout + file)
log_output() {
    echo "$1"
    echo "$1" >> "$LOG_FILE"
}

log_output "[$(date '+%Y-%m-%d %H:%M:%S')] =========================================="
log_output "[$(date '+%Y-%m-%d %H:%M:%S')] Zabbix Agent Installation Started"
log_output "[$(date '+%Y-%m-%d %H:%M:%S')] Log file: $LOG_FILE"
log_output "[$(date '+%Y-%m-%d %H:%M:%S')] =========================================="

# Function to print colored output
print_info() {
    printf "${BLUE}[INFO]${NC} %s\n" "$1"
    printf "[INFO] %s\n" "$1" >> "$LOG_FILE"
}

print_success() {
    printf "${GREEN}[SUCCESS]${NC} %s\n" "$1"
    printf "[SUCCESS] %s\n" "$1" >> "$LOG_FILE"
}

print_warning() {
    printf "${YELLOW}[WARNING]${NC} %s\n" "$1"
    printf "[WARNING] %s\n" "$1" >> "$LOG_FILE"
}

print_error() {
    printf "${RED}[ERROR]${NC} %s\n" "$1"
    printf "[ERROR] %s\n" "$1" >> "$LOG_FILE"
}

print_section() {
    printf "${CYAN}== %s ==${NC}\n" "$1"
    printf "== %s ==\n" "$1" >> "$LOG_FILE"
}

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to validate IP address
validate_ip() {
    local ip="$1"
    # Basic validation - check if it contains only valid characters
    case "$ip" in
        *[!0-9.]*)
            # Contains non-numeric/dot chars, might be hostname - allow alphanumeric, dots, hyphens
            case "$ip" in
                *[!a-zA-Z0-9.-]*) return 1 ;;
                *) return 0 ;;
            esac
            ;;
        *)
            # Numeric/dots only - basic IP format check
            return 0
            ;;
    esac
}

# Function to test connectivity
test_connectivity() {
    local server="$1"
    local port="$2"
    
    print_info "Testing connectivity to $server:$port..."
    
    # Use nc (netcat) if available, otherwise skip test
    if command_exists nc; then
        if timeout 10 nc -z -w 5 "$server" "$port" 2>/dev/null; then
            print_success "Successfully connected to $server:$port"
            return 0
        else
            print_warning "Cannot connect to $server:$port"
            print_warning "Please ensure the server is accessible and port $port is open"
            return 1
        fi
    else
        print_warning "nc (netcat) not available, skipping connectivity test"
        return 0
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
    
    # Skip full system upgrade to avoid disk space issues
    # print_info "Updating package cache..."
    # $PKG_MGR update -y
    # echo "[$(date '+%Y-%m-%d %H:%M:%S')] Package cache updated"
    
    print_info "Installing required packages (wget, curl, rpm)..."
    $PKG_MGR install -y wget --no-check-certificate curl rpm
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Required packages installed"
}

# Function to add Zabbix repository
add_zabbix_repo() {
    local version="$1"
    
    print_section "Downloading Zabbix Agent Package"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Preparing to download Zabbix Agent 2 version $version..."
    
    # Extract major.minor version (e.g., 7.4 from 7.4.7)
    MAJOR_VERSION=$(echo "$version" | cut -d. -f1-2)
    
    # Build agent package URL
    # Format: https://repo.zabbix.com/zabbix/7.4/stable/rhel/8/x86_64/zabbix-agent2-7.4.7-release1.el8.x86_64.rpm
    AGENT_URL="https://repo.zabbix.com/zabbix/$MAJOR_VERSION/stable/rhel/$RHEL_VERSION/x86_64/zabbix-agent2-$version-release1.el$RHEL_VERSION.x86_64.rpm"
    
    print_info "Agent package URL: $AGENT_URL"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Download URL: $AGENT_URL"
    
    # Create temporary download directory
    TEMP_DIR="/tmp/zabbix_agent_download_$$"
    mkdir -p "$TEMP_DIR"
    sudo chmod 777 "$TEMP_DIR"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Created temp directory: $TEMP_DIR with 777 permissions"
    
    # Keep a persistent copy of downloaded RPMs for troubleshooting/reuse
    PERSISTENT_RPM_DIR="/tmp/zabbix_agent_rpms"
    mkdir -p "$PERSISTENT_RPM_DIR"
    sudo chmod 777 "$PERSISTENT_RPM_DIR"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Persistent RPM directory: $PERSISTENT_RPM_DIR (777 permissions)"

    AGENT_RPM="$TEMP_DIR/zabbix-agent2-$version-release1.el$RHEL_VERSION.x86_64.rpm"
    PERSISTENT_AGENT_RPM="$PERSISTENT_RPM_DIR/zabbix-agent2-$version-release1.el$RHEL_VERSION.x86_64.rpm"
    
    print_info "Downloading agent package..."
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Downloading to: $AGENT_RPM"
    
    if curl -f -L -o "$AGENT_RPM" "$AGENT_URL"; then
        sudo chmod 777 "$AGENT_RPM"

        # Save a durable copy so RPM remains on remote server after temp cleanup
        cp -f "$AGENT_RPM" "$PERSISTENT_AGENT_RPM"
        sudo chmod 777 "$PERSISTENT_AGENT_RPM"

        print_success "Agent package downloaded successfully"
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Download completed: $(ls -lh "$AGENT_RPM" | awk '{print $5}')"
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] File permissions set to 777"
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Persistent copy saved at: $PERSISTENT_AGENT_RPM"
        
        # Check if any version of zabbix-agent2 is already installed
        if rpm -q zabbix-agent2 >/dev/null 2>&1; then
            INSTALLED_VERSION=$(rpm -q zabbix-agent2)
            print_info "Zabbix Agent 2 is already installed: $INSTALLED_VERSION"
            echo "[$(date '+%Y-%m-%d %H:%M:%S')] Installed version: $INSTALLED_VERSION"
            
            # Check if it's the exact version requested
            if rpm -q "zabbix-agent2-$version-release1.el$RHEL_VERSION" >/dev/null 2>&1; then
                print_info "Requested version $version is already installed, skipping installation"
                echo "[$(date '+%Y-%m-%d %H:%M:%S')] Package version matches, skipping installation"
                sudo rm -rf "$TEMP_DIR"
                return 0
            else
                print_info "Different version detected, upgrading/downgrading..."
                echo "[$(date '+%Y-%m-%d %H:%M:%S')] Replacing $INSTALLED_VERSION with $version"
                RPM_FLAGS="--oldpackage --replacepkgs"
            fi
        else
            print_info "No existing installation found"
            echo "[$(date '+%Y-%m-%d %H:%M:%S')] Fresh installation"
            RPM_FLAGS=""
        fi
        
        print_info "Installing Zabbix Agent 2..."
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Installing from: $AGENT_RPM"
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] RPM flags: $RPM_FLAGS"
        
        if rpm -Uvh $RPM_FLAGS "$AGENT_RPM"; then
            print_success "Zabbix Agent 2 installed successfully"
            echo "[$(date '+%Y-%m-%d %H:%M:%S')] Installation completed"
            sudo rm -rf "$TEMP_DIR"
            return 0
        else
            print_error "Failed to install Zabbix Agent 2 package"
            echo "[$(date '+%Y-%m-%d %H:%M:%S')] Installation FAILED"
            sudo rm -rf "$TEMP_DIR"
            exit 1
        fi
    else
        print_error "Failed to download Zabbix Agent 2 package"
        print_error "URL: $AGENT_URL"
        print_error "Please check if version $version is available for RHEL $RHEL_VERSION"
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Download FAILED"
        sudo rm -rf "$TEMP_DIR"
        exit 1
    fi
}

# Function to verify Zabbix Agent 2 installation
install_zabbix_agent() {
    local version="$1"
    
    print_section "Verifying Zabbix Agent 2 Installation"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Verifying Zabbix Agent 2 installation..."
    
    # Give RPM database a moment to update
    sleep 1
    
    # Check if agent package is installed using rpm -q
    if rpm -q zabbix-agent2 >/dev/null 2>&1; then
        INSTALLED_VERSION=$(rpm -q zabbix-agent2)
        print_success "Zabbix Agent 2 is installed: $INSTALLED_VERSION"
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Installed version: $INSTALLED_VERSION"
        
        # Verify the binary exists
        if [ -f /usr/sbin/zabbix_agent2 ]; then
            print_success "Zabbix Agent 2 binary found: /usr/sbin/zabbix_agent2"
            echo "[$(date '+%Y-%m-%d %H:%M:%S')] Binary verified at /usr/sbin/zabbix_agent2"
        else
            print_error "Zabbix Agent 2 binary not found at /usr/sbin/zabbix_agent2"
            exit 1
        fi
    else
        print_error "Zabbix Agent 2 package not found in RPM database"
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Checking all zabbix packages:"
        rpm -qa | grep zabbix || echo "No zabbix packages found"
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Installation verification FAILED"
        exit 1
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
        sudo cp /etc/zabbix/zabbix_agent2.conf /etc/zabbix/zabbix_agent2.conf.backup
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Configuration backup created"
    fi
    
    # Configure basic settings
    print_info "Configuring minimal settings..."
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Server: $server_ip | Port: $server_port | Hostname: $hostname"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Modifying configuration file: /etc/zabbix/zabbix_agent2.conf"
    sudo sed -i "s/^Server=.*/Server=$server_ip/" /etc/zabbix/zabbix_agent2.conf
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Set Server=$server_ip"
    sudo sed -i "s/^ServerActive=.*/ServerActive=$server_ip:$server_port/" /etc/zabbix/zabbix_agent2.conf
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Set ServerActive=$server_ip:$server_port"
    sudo sed -i "s/^Hostname=.*/Hostname=$hostname/" /etc/zabbix/zabbix_agent2.conf
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Set Hostname=$hostname"
    sudo sed -i "s/^# ListenPort=.*/ListenPort=$DEFAULT_LISTEN_PORT/" /etc/zabbix/zabbix_agent2.conf
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Set ListenPort=$DEFAULT_LISTEN_PORT"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Minimal configuration applied"
    
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
    if sudo su -s /bin/bash zabbix -c 'zabbix_agent2 -t zabbix.agent.ping'; then
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
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Command: sudo systemctl enable zabbix-agent2"
    sudo systemctl enable zabbix-agent2
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Service enabled for auto-start on boot"
    
    # Start/restart service
    print_info "Starting Zabbix Agent 2 service..."
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Command: sudo systemctl restart zabbix-agent2"
    sudo systemctl restart zabbix-agent2
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Service restart command issued"
    
    # Wait for service to start
    sleep 3
    
    # Check service status
    if sudo systemctl is-active --quiet zabbix-agent2; then
        print_success "Zabbix Agent 2 service is running"
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Service status: ACTIVE"
        
        # Show detailed status
        echo ""
        sudo systemctl status zabbix-agent2 --no-pager -l
    else
        print_error "Zabbix Agent 2 service failed to start"
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Service status: FAILED"
        
        # Show error details
        echo ""
        print_error "Service status:"
        sudo systemctl status zabbix-agent2 --no-pager -l
        
        print_error "Recent logs:"
        sudo journalctl -u zabbix-agent2 --no-pager -n 20
        
        exit 1
    fi
}

# Function to configure firewall
configure_firewall() {
    print_section "Firewall Configuration"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Skipping firewall configuration..."
    print_info "Firewall port configuration skipped (port $DEFAULT_LISTEN_PORT/tcp)"
    print_info "Note: Zabbix server must be able to reach this agent on port $DEFAULT_LISTEN_PORT"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Firewall configuration skipped as per configuration"
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
    echo " Zabbix Agent 2 $version has been successfully installed and configured!"
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
    
    # Debug: Show received arguments (safe for set -u)
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] DEBUG: Number of arguments received: $#"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] DEBUG: Argument 1 (VERSION): '${1:-<not provided>}'"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] DEBUG: Argument 2 (SERVER_IP): '${2:-<not provided>}'"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] DEBUG: Argument 3 (HOSTNAME): '${3:-<not provided>}'"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] DEBUG: Argument 4 (SERVER_PORT): '${4:-<not provided>}'"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] DEBUG: All arguments: ${@:-<none>}"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] DEBUG: Script called as: $0"
    echo ""
    
    # Parse command line arguments (automated mode only)
    if [ $# -lt 2 ]; then
        print_error "Insufficient arguments for automated installation"
        echo "Received $# arguments: ${@:-<none>}"
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