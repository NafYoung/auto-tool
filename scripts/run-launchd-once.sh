#!/bin/zsh

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${HOME}/.config/wenlv-news-digest.env"
RUNTIME_ROOT="${HOME}/.codex/automation-runtimes/wenlv-news-digest"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
CONFIG_PATH="${PROJECT_DIR}/wenlv.config.json"

if [[ -f "${PROJECT_DIR}/wenlv.config.local.json" ]]; then
  CONFIG_PATH="${PROJECT_DIR}/wenlv.config.local.json"
fi

if [[ -f "${ENV_FILE}" ]]; then
  set -a
  source "${ENV_FILE}"
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
for key in "${required_vars[@]}"; do
  if [[ -z "${(P)key:-}" ]]; then
    missing_vars+=("${key}")
  fi
done

if (( ${#missing_vars[@]} > 0 )); then
  echo "Missing env vars: ${missing_vars[*]}" >&2
  echo "Put them in ${ENV_FILE} or ~/.zshrc before launchd runs." >&2
  exit 1
fi

REMOTE_PUSH_URL="$(git -C "${PROJECT_DIR}" remote get-url origin)"

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

export WENLV_RUNTIME_ROOT="${RUNTIME_ROOT}"
export WENLV_GIT_READ_URL="${REMOTE_READ_URL}"
export WENLV_GIT_PUSH_URL="${REMOTE_PUSH_URL}"
export WENLV_SHARED_BROWSER_PROFILE_PATH="${SHARED_BROWSER_PROFILE_PATH}"
export WENLV_SOURCE_CONFIG_PATH="${CONFIG_PATH}"

exec "${PROJECT_DIR}/scripts/run-local-fallback-runtime.sh"
