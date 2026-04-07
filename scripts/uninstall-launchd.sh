#!/bin/zsh

set -euo pipefail

LABEL="com.nafyoung.wenlv-news-digest"
PLIST_PATH="${HOME}/Library/LaunchAgents/${LABEL}.plist"
WRAPPER_DIR="${HOME}/.codex/launchd-wrappers/wenlv-news-digest"
USER_ID="$(id -u)"

launchctl bootout "gui/${USER_ID}" "${PLIST_PATH}" >/dev/null 2>&1 || true
rm -f "${PLIST_PATH}"
rm -rf "${WRAPPER_DIR}"

echo "launchd agent removed: ${PLIST_PATH}"
