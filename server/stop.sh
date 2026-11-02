#!/bin/bash

# 服务端停止脚本
# 功能：停止Flask服务端进程

echo "正在停止服务端..."

# 查找并停止python3 app.py进程
PIDS=$(pgrep -f "python3 app.py")
if [ -n "$PIDS" ]; then
    echo "找到服务端进程: $PIDS"
    pkill -f "python3 app.py"
    sleep 2
    
    # 检查是否还有进程在运行
    REMAINING=$(pgrep -f "python3 app.py")
    if [ -n "$REMAINING" ]; then
        echo "强制停止进程..."
        pkill -9 -f "python3 app.py"
    fi
    
    echo "服务端已停止"
else
    echo "没有找到运行中的服务端进程"
fi

# 检查端口是否释放
if lsof -Pi :5000 -sTCP:LISTEN -t >/dev/null ; then
    echo "警告: 端口5000仍被占用"
else
    echo "端口5000已释放"
fi
