#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_FILE="$SCRIPT_DIR/logs/app.log"

if [[ ! -f "$LOG_FILE" ]]; then
  echo "日志文件不存在: $LOG_FILE"
  echo "请先运行 ./start.sh"
  exit 1
fi

echo "=== 服务端日志: $LOG_FILE ==="
tail -n 50 "$LOG_FILE"
