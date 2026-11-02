#!/bin/bash

# 服务端重启脚本
# 功能：停止并重新启动Flask服务端

echo "重启服务端..."

# 停止服务端
./stop.sh

# 等待2秒
sleep 2

# 启动服务端
./start.sh
