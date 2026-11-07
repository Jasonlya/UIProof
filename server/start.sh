#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PORT="${PORT:-5001}"
LOG_DIR="$SCRIPT_DIR/logs"
PID_DIR="$SCRIPT_DIR/.run"
PID_FILE="$PID_DIR/server.pid"

mkdir -p "$LOG_DIR" "$PID_DIR"

if [[ -f "$PID_FILE" ]]; then
  EXISTING_PID="$(cat "$PID_FILE")"
  if kill -0 "$EXISTING_PID" 2>/dev/null; then
    echo "服务端已在运行 (PID $EXISTING_PID): http://localhost:$PORT"
    exit 0
  fi
  rm -f "$PID_FILE"
fi

if lsof -Pi ":$PORT" -sTCP:LISTEN -t >/dev/null 2>&1; then
  echo "端口 $PORT 已被占用，请先释放端口或设置 PORT 环境变量"
  exit 1
fi

if [[ -f "$SCRIPT_DIR/venv/bin/activate" ]]; then
  # shellcheck disable=SC1091
  source "$SCRIPT_DIR/venv/bin/activate"
fi

echo "启动服务端..."
echo "日志文件: $LOG_DIR/app.log"
echo "服务地址: http://localhost:$PORT"

PORT="$PORT" nohup python3 app.py >>"$LOG_DIR/app.log" 2>&1 &
SERVER_PID=$!
echo "$SERVER_PID" >"$PID_FILE"

sleep 1
if kill -0 "$SERVER_PID" 2>/dev/null; then
  echo "服务端已启动 (PID $SERVER_PID)"
else
  rm -f "$PID_FILE"
  echo "启动失败，最近日志："
  tail -n 30 "$LOG_DIR/app.log" || true
  exit 1
fi
