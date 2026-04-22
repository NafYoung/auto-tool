#!/bin/zsh

set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

required_env=(
  DEEPSEEK_API_KEY
  SMTP_HOST
  SMTP_PORT
  SMTP_USER
  SMTP_PASS
  MAIL_TO
  WENLV_RUNTIME_ROOT
  WENLV_GIT_READ_URL
  WENLV_GIT_PUSH_URL
  WENLV_SHARED_BROWSER_PROFILE_PATH
  WENLV_SOURCE_CONFIG_PATH
)

missing_env=()
for key in "${required_env[@]}"; do
  if [[ -z "${(P)key:-}" ]]; then
    missing_env+=("${key}")
  fi
done

if (( ${#missing_env[@]} > 0 )); then
  echo "Missing env vars: ${missing_env[*]}" >&2
  exit 1
fi

RUNTIME_ROOT="${WENLV_RUNTIME_ROOT}"
RUNTIME_REPO_DIR="${RUNTIME_ROOT}/repo"
RUNTIME_CONFIG_PATH="${RUNTIME_ROOT}/wenlv.runtime.config.json"
LOCK_HASH_PATH="${RUNTIME_ROOT}/package-lock.sha256"

mkdir -p "${RUNTIME_ROOT}"

ensure_runtime_repo() {
  if [[ ! -d "${RUNTIME_REPO_DIR}/.git" ]]; then
    git clone "${WENLV_GIT_READ_URL}" "${RUNTIME_REPO_DIR}"
  fi

  git -C "${RUNTIME_REPO_DIR}" remote set-url origin "${WENLV_GIT_READ_URL}"
  git -C "${RUNTIME_REPO_DIR}" remote set-url --push origin "${WENLV_GIT_PUSH_URL}"
  git -C "${RUNTIME_REPO_DIR}" fetch origin main

  if git -C "${RUNTIME_REPO_DIR}" show-ref --verify --quiet "refs/heads/main"; then
    git -C "${RUNTIME_REPO_DIR}" checkout main >/dev/null 2>&1
  else
    git -C "${RUNTIME_REPO_DIR}" checkout -b main --track origin/main >/dev/null 2>&1
  fi

  if [[ -n "$(git -C "${RUNTIME_REPO_DIR}" status --porcelain)" ]]; then
    echo "Runtime repo has local changes; skip pre-run pull to preserve local state." >&2
    return
  fi

  if ! git -C "${RUNTIME_REPO_DIR}" pull --ff-only origin main; then
    echo "Warning: unable to sync canonical state from origin/main; continue with local runtime clone." >&2
  fi
}

ensure_runtime_dependencies() {
  local current_hash=""
  current_hash="$(shasum -a 256 "${RUNTIME_REPO_DIR}/package-lock.json" | awk '{print $1}')"
  local stored_hash=""

  if [[ -f "${LOCK_HASH_PATH}" ]]; then
    stored_hash="$(<"${LOCK_HASH_PATH}")"
  fi

  if [[ ! -d "${RUNTIME_REPO_DIR}/node_modules" || "${current_hash}" != "${stored_hash}" ]]; then
    (
      cd "${RUNTIME_REPO_DIR}"
      npm ci
    )
    printf '%s\n' "${current_hash}" > "${LOCK_HASH_PATH}"
  fi
}

write_runtime_config() {
  node --input-type=module - "${WENLV_SOURCE_CONFIG_PATH}" "${RUNTIME_CONFIG_PATH}" "${WENLV_SHARED_BROWSER_PROFILE_PATH}" "${RUNTIME_REPO_DIR}" <<'EOF'
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const [, , sourceConfigPath, runtimeConfigPath, sharedBrowserProfilePath, runtimeRepoDir] = process.argv;
const config = JSON.parse(await readFile(sourceConfigPath, "utf8"));
config.browserProfilePath = sharedBrowserProfilePath;
config.dataDir = path.join(runtimeRepoDir, "data");
config.reportDir = path.join(runtimeRepoDir, "reports");
await writeFile(runtimeConfigPath, JSON.stringify(config, null, 2), "utf8");
EOF
}

persist_runtime_state() {
  (
    cd "${RUNTIME_REPO_DIR}"
    git config user.name "local-fallback[bot]"
    git config user.email "local-fallback@noreply.local"
    if ! git pull --rebase --autostash origin main; then
      echo "Warning: unable to rebase runtime state before push; continue with local commit." >&2
    fi
    git add -f data/state.json
    if ls reports/*.md >/dev/null 2>&1; then
      git add -f reports/*.md
    fi
    if git diff --cached --quiet; then
      echo "No canonical state changes to push."
      exit 0
    fi
    git commit -m "chore: update digest state from local fallback"
    if ! git push origin HEAD:main; then
      echo "Warning: local fallback sent the digest, but failed to push canonical state back to origin." >&2
    fi
  )
}

ensure_runtime_repo
ensure_runtime_dependencies
write_runtime_config

(
  cd "${RUNTIME_REPO_DIR}"
  npx tsx src/cli.ts run-daily --once --headed --discovery-mode search-only --delivery-origin local --config "${RUNTIME_CONFIG_PATH}"
)

persist_runtime_state
