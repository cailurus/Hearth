#!/bin/bash
#
# Reset Hearth Admin Password
# Usage: ./scripts/reset-admin-password.sh [new_password]
#
# If no password is provided, you will be prompted to enter one.
# The password must be at least 4 characters.
#

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Default paths
DB_PATH="${HEARTH_DATA_DIR:-$PROJECT_ROOT/data}/hearth.db"
USERNAME="${HEARTH_ADMIN_USER:-admin}"

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Hearth Admin Password Reset${NC}"
echo "================================"
echo ""

# Check if database exists
if [ ! -f "$DB_PATH" ]; then
    echo -e "${RED}Error: Database not found at $DB_PATH${NC}"
    echo "Make sure Hearth has been started at least once to create the database."
    exit 1
fi

# Get password
if [ -n "$1" ]; then
    NEW_PASSWORD="$1"
else
    echo -n "Enter new password for '$USERNAME': "
    read -s NEW_PASSWORD
    echo ""
    
    if [ -z "$NEW_PASSWORD" ]; then
        echo -e "${RED}Error: Password cannot be empty${NC}"
        exit 1
    fi
    
    echo -n "Confirm new password: "
    read -s CONFIRM_PASSWORD
    echo ""
    
    if [ "$NEW_PASSWORD" != "$CONFIRM_PASSWORD" ]; then
        echo -e "${RED}Error: Passwords do not match${NC}"
        exit 1
    fi
fi

# Check password length
if [ ${#NEW_PASSWORD} -lt 4 ]; then
    echo -e "${RED}Error: Password must be at least 4 characters${NC}"
    exit 1
fi

# Run the reset command
echo ""
echo "Resetting password for user '$USERNAME'..."

cd "$PROJECT_ROOT"

# Try using the Go tool if available
if command -v go &> /dev/null; then
    go run ./cmd/reset-password/main.go -db "$DB_PATH" -user "$USERNAME" -password "$NEW_PASSWORD"
else
    echo -e "${RED}Error: Go is not installed. Please install Go or run the reset-password tool manually.${NC}"
    echo ""
    echo "Alternatively, you can reset the password directly with SQLite:"
    echo ""
    echo "  sqlite3 $DB_PATH"
    echo "  UPDATE users SET password_hash = '<bcrypt_hash>' WHERE username = '$USERNAME';"
    echo ""
    exit 1
fi

echo ""
echo -e "${GREEN}Password reset successfully!${NC}"
echo "You can now log in with the new password."
