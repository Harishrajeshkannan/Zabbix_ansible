#!/bin/bash
set -euo pipefail

REAL_USER=${SUDO_USER:-$(whoami)}
REPO_URL="https://github.com/Harishrajeshkannan/Zabbix_ansible.git"
BRANCH="${BRANCH:-remote-files}"

WORK_DIR="/home/pamadministrator/ZabbixBuild"
BACKUP_DIR="/usr/ZabbixBuild_Backup"
ENV_SOURCE="/usr/ZabbixBuild_Backup/env/.env"

DEPLOY_BASE="/usr/share/zabbix/ui"
DEPLOY_DIR="${DEPLOY_BASE}/zabbixagentinstallation"
OLD_DIR="${DEPLOY_BASE}/zabbixagentinstallation_old"

DATE=$(date +%d%B%Y)

echo "========== STARTING DEPLOYMENT =========="
echo "Branch: ${BRANCH}"
echo "Workspace: ${WORK_DIR}"
echo "Deploy dir: ${DEPLOY_DIR}"

mkdir -p "${BACKUP_DIR}/${DATE}"
if [ -d "${WORK_DIR}" ]; then
  cp -r "${WORK_DIR}"/* "${BACKUP_DIR}/${DATE}/" 2>/dev/null || true
fi

if [ -d "${WORK_DIR}/.git" ]; then
  chown -R "${REAL_USER}:${REAL_USER}" "${WORK_DIR}"
  sudo -u "${REAL_USER}" git -C "${WORK_DIR}" fetch --all --prune
  sudo -u "${REAL_USER}" git -C "${WORK_DIR}" checkout -f "${BRANCH}"
  sudo -u "${REAL_USER}" git -C "${WORK_DIR}" reset --hard "origin/${BRANCH}"
  sudo -u "${REAL_USER}" git -C "${WORK_DIR}" clean -fd
else
  rm -rf "${WORK_DIR}"
  mkdir -p "${WORK_DIR}"
  chown -R "${REAL_USER}:${REAL_USER}" "${WORK_DIR}"
  sudo -u "${REAL_USER}" git clone -b "${BRANCH}" "${REPO_URL}" "${WORK_DIR}"
fi

chown -R "${REAL_USER}:${REAL_USER}" "${WORK_DIR}"
chmod -R 750 "${WORK_DIR}"

if [ -f "${ENV_SOURCE}" ]; then
  cp "${ENV_SOURCE}" "${WORK_DIR}/.env"
  chown "${REAL_USER}:${REAL_USER}" "${WORK_DIR}/.env"
  chmod 640 "${WORK_DIR}/.env"
else
  echo ".env file not found!"
  exit 1
fi

cd "${WORK_DIR}"

sudo -u "${REAL_USER}" npm ci
sudo -u "${REAL_USER}" npm run build

DEPLOY_COMMIT=$(sudo -u "${REAL_USER}" git -C "${WORK_DIR}" rev-parse --short HEAD || echo "unknown")
echo "Built commit: ${DEPLOY_COMMIT}"

if [ -d "${WORK_DIR}/dist" ]; then
  BUILD_OUTPUT="${WORK_DIR}/dist"
elif [ -d "${WORK_DIR}/build" ]; then
  BUILD_OUTPUT="${WORK_DIR}/build"
else
  echo "Build output not found!"
  exit 1
fi

sudo rm -rf "${OLD_DIR}"
if [ -d "${DEPLOY_DIR}" ]; then
  sudo mv "${DEPLOY_DIR}" "${OLD_DIR}"
fi

sudo mkdir -p "${DEPLOY_DIR}"

if command -v rsync >/dev/null 2>&1; then
  sudo rsync -a --delete "${BUILD_OUTPUT}/" "${DEPLOY_DIR}/"
else
  sudo rm -rf "${DEPLOY_DIR:?}"/*
  sudo cp -r "${BUILD_OUTPUT}"/* "${DEPLOY_DIR}/"
fi

sudo chown -R apache:apache "${DEPLOY_DIR}"
sudo find "${DEPLOY_DIR}" -type d -exec chmod 755 {} \;
sudo find "${DEPLOY_DIR}" -type f -exec chmod 644 {} \;

if command -v restorecon >/dev/null 2>&1; then
  sudo restorecon -Rv "${DEPLOY_DIR}" || true
fi

sudo systemctl restart httpd.service || sudo systemctl reload httpd.service || true

echo "Deployed commit: ${DEPLOY_COMMIT}"
echo "========== DEPLOYMENT SUCCESSFUL =========="