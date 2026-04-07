#!/bin/zsh

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${HOME}/.config/wenlv-news-digest.env"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

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

cd "${PROJECT_DIR}"
NODE_BIN="$(command -v node || true)"

if [[ -z "${NODE_BIN}" ]]; then
  echo "node not found in PATH=${PATH}" >&2
  exit 1
fi

exec "${NODE_BIN}" dist/cli.js run-daily --once --headed --discovery-mode search-only
