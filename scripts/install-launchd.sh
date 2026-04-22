#!/bin/zsh

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.nafyoung.wenlv-news-digest"
PLIST_PATH="${HOME}/Library/LaunchAgents/${LABEL}.plist"
WRAPPER_DIR="${HOME}/.codex/launchd-wrappers/wenlv-news-digest"
WRAPPER_PATH="${WRAPPER_DIR}/run.sh"
WRAPPER_RUNNER_PATH="${WRAPPER_DIR}/runtime-run.sh"
RUNTIME_ROOT="${HOME}/.codex/automation-runtimes/wenlv-news-digest"
LOG_DIR="${PROJECT_DIR}/logs"
ENV_TEMPLATE="${PROJECT_DIR}/wenlv.launchd.env.example"
ENV_EXAMPLE_PATH="${HOME}/.config/wenlv-news-digest.env.example"
USER_ID="$(id -u)"
REMOTE_PUSH_URL="$(git -C "${PROJECT_DIR}" remote get-url origin)"
CONFIG_PATH="${PROJECT_DIR}/wenlv.config.json"

if [[ -f "${PROJECT_DIR}/wenlv.config.local.json" ]]; then
  CONFIG_PATH="${PROJECT_DIR}/wenlv.config.local.json"
fi

if [[ "${REMOTE_PUSH_URL}" == git@github.com:* ]]; then
  REMOTE_READ_URL="https://github.com/${REMOTE_PUSH_URL#git@github.com:}"
elif [[ "${REMOTE_PUSH_URL}" == https://github.com/* ]]; then
  REMOTE_READ_URL="${REMOTE_PUSH_URL}"
else
  echo "Unsupported origin remote for automation runtime: ${REMOTE_PUSH_URL}" >&2
  exit 1
fi

SHARED_BROWSER_PROFILE_PATH="$(
  node --input-type=module - "${CONFIG_PATH}" <<'EOF'
import { readFileSync } from "node:fs";
import path from "node:path";

const [, , configPath] = process.argv;
const config = JSON.parse(readFileSync(configPath, "utf8"));
const inputPath = config.browserProfilePath ?? "./data/browser-profile";
console.log(path.isAbsolute(inputPath) ? inputPath : path.resolve(path.dirname(configPath), inputPath));
EOF
)"

mkdir -p "${HOME}/Library/LaunchAgents" "${HOME}/.config" "${WRAPPER_DIR}" "${PROJECT_DIR}/logs"
cp "${PROJECT_DIR}/scripts/run-local-fallback-runtime.sh" "${WRAPPER_RUNNER_PATH}"
chmod +x "${WRAPPER_RUNNER_PATH}"

cat > "${WRAPPER_PATH}" <<EOF
#!/bin/zsh
set -euo pipefail
ENV_FILE="${HOME}/.config/wenlv-news-digest.env"
export WENLV_RUNTIME_ROOT="${RUNTIME_ROOT}"
export WENLV_GIT_READ_URL="${REMOTE_READ_URL}"
export WENLV_GIT_PUSH_URL="${REMOTE_PUSH_URL}"
export WENLV_SHARED_BROWSER_PROFILE_PATH="${SHARED_BROWSER_PROFILE_PATH}"
export WENLV_SOURCE_CONFIG_PATH="${CONFIG_PATH}"
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

exec "${WRAPPER_RUNNER_PATH}"
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
    <integer>20</integer>
    <key>Minute</key>
    <integer>30</integer>
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
echo "Daily schedule: 20:30 Asia/Shanghai"
echo "ASCII launchd wrapper: ${WRAPPER_PATH}"
echo "Automation runtime root: ${RUNTIME_ROOT}"
echo "If env vars are not yet persisted, add them to ~/.config/wenlv-news-digest.env using ${ENV_EXAMPLE_PATH}."
