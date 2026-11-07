#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$SCRIPT_DIR/.run/server.pid"
PORT="${PORT:-5001}"

if [[ ! -f "$PID_FILE" ]]; then
  echo "没有找到 $PID_FILE"
  if lsof -Pi ":$PORT" -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo "端口 $PORT 仍被其他进程占用，请手动处理"
  fi
  exit 0
fi

SERVER_PID="$(cat "$PID_FILE")"
if ! kill -0 "$SERVER_PID" 2>/dev/null; then
  echo "进程 $SERVER_PID 已不存在，清理 PID 文件"
  rm -f "$PID_FILE"
  exit 0
fi

echo "停止服务端 (PID $SERVER_PID)..."
kill "$SERVER_PID"
for _ in {1..20}; do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    break
  fi
  sleep 0.25
done

if kill -0 "$SERVER_PID" 2>/dev/null; then
  echo "进程未退出，执行强制停止"
  kill -9 "$SERVER_PID" 2>/dev/null || true
fi

rm -f "$PID_FILE"
echo "服务端已停止"
