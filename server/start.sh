#!/bin/bash

# 服务端启动脚本
# 功能：启动Flask服务端，输出日志到文件

# 设置脚本目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# 设置日志文件路径
LOG_FILE="logs/app.log"
ERROR_LOG_FILE="logs/error.log"

# 创建日志目录
mkdir -p logs

# 激活虚拟环境
source venv/bin/activate

# 检查端口是否被占用
if lsof -Pi :5000 -sTCP:LISTEN -t >/dev/null ; then
    echo "端口5000已被占用，正在停止现有进程..."
    pkill -f "python3 app.py"
    sleep 2
fi

# 启动服务端并输出日志
echo "启动服务端..."
echo "日志文件: $LOG_FILE"
echo "错误日志: $ERROR_LOG_FILE"
echo "服务地址: http://localhost:5000"
echo "按 Ctrl+C 停止服务"
echo "----------------------------------------"

# 启动Flask应用，同时输出到控制台和日志文件
python3 app.py 2>&1 | tee -a "$LOG_FILE" 2> "$ERROR_LOG_FILE"
