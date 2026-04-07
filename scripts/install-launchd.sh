#!/bin/zsh

set -euo pipefail

PROJECT_DIR="/Users/nafyoung/Documents/Codex Project/文旅新闻总结"
LABEL="com.nafyoung.wenlv-news-digest"
PLIST_PATH="${HOME}/Library/LaunchAgents/${LABEL}.plist"
WRAPPER_DIR="${HOME}/.codex/launchd-wrappers/wenlv-news-digest"
WRAPPER_PATH="${WRAPPER_DIR}/run.sh"
ASCII_PROJECT_LINK="${WRAPPER_DIR}/project"
LOG_DIR="${PROJECT_DIR}/logs"
ENV_TEMPLATE="${PROJECT_DIR}/wenlv.launchd.env.example"
ENV_EXAMPLE_PATH="${HOME}/.config/wenlv-news-digest.env.example"
USER_ID="$(id -u)"

mkdir -p "${HOME}/Library/LaunchAgents" "${HOME}/.config" "${WRAPPER_DIR}" "${PROJECT_DIR}/logs"
ln -sfn "${PROJECT_DIR}" "${ASCII_PROJECT_LINK}"

cat > "${WRAPPER_PATH}" <<EOF
#!/bin/zsh
set -euo pipefail
PROJECT_DIR="${ASCII_PROJECT_LINK}"
ENV_FILE="${HOME}/.config/wenlv-news-digest.env"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

if [[ -f "\${ENV_FILE}" ]]; then
  set -a
  source "\${ENV_FILE}"
  set +a
elif [[ -f "${HOME}/.zshrc" ]]; then
  source "${HOME}/.zshrc"
fi

required_vars=(
  DEEPSEEK_API_KEY
  SMTP_HOST
  SMTP_PORT
  SMTP_USER
  SMTP_PASS
  MAIL_TO
)

missing_vars=()
for key in "\${required_vars[@]}"; do
  if [[ -z "\${(P)key:-}" ]]; then
    missing_vars+=("\${key}")
  fi
done

if (( \${#missing_vars[@]} > 0 )); then
  echo "Missing env vars: \${missing_vars[*]}" >&2
  echo "Put them in \${ENV_FILE} or ~/.zshrc before launchd runs." >&2
  exit 1
fi

NODE_BIN="\$(command -v node || true)"
if [[ -z "\${NODE_BIN}" ]]; then
  echo "node not found in PATH=\${PATH}" >&2
  exit 1
fi

cd "\${PROJECT_DIR}"
exec "\${NODE_BIN}" "\${PROJECT_DIR}/dist/cli.js" run-daily --once --headed --discovery-mode search-only
EOF

chmod +x "${WRAPPER_PATH}"

if [[ ! -f "${ENV_EXAMPLE_PATH}" ]]; then
  cp "${ENV_TEMPLATE}" "${ENV_EXAMPLE_PATH}"
fi

cat > "${PLIST_PATH}" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>${WRAPPER_PATH}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${WRAPPER_DIR}</string>
  <key>RunAtLoad</key>
  <false/>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>19</integer>
    <key>Minute</key>
    <integer>0</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>${LOG_DIR}/launchd.stdout.log</string>
  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/launchd.stderr.log</string>
</dict>
</plist>
EOF

launchctl bootout "gui/${USER_ID}" "${PLIST_PATH}" >/dev/null 2>&1 || true
launchctl bootstrap "gui/${USER_ID}" "${PLIST_PATH}"
launchctl enable "gui/${USER_ID}/${LABEL}"

echo "launchd agent installed: ${PLIST_PATH}"
echo "Daily schedule: 19:00 Asia/Shanghai"
echo "ASCII launchd wrapper: ${WRAPPER_PATH}"
echo "If env vars are not yet persisted, add them to ~/.config/wenlv-news-digest.env using ${ENV_EXAMPLE_PATH}."
