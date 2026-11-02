#!/bin/bash

# 日志查看脚本
# 功能：查看服务端日志

LOG_FILE="logs/app.log"
ERROR_LOG_FILE="logs/error.log"

# 检查日志文件是否存在
if [ ! -f "$LOG_FILE" ]; then
    echo "日志文件不存在: $LOG_FILE"
    echo "请先启动服务端"
    exit 1
fi

echo "=== 服务端日志 ==="
echo "日志文件: $LOG_FILE"
echo "错误日志: $ERROR_LOG_FILE"
echo "----------------------------------------"

# 显示最后50行日志
echo "最近50行日志:"
tail -n 50 "$LOG_FILE"

echo ""
echo "----------------------------------------"
echo "实时查看日志: tail -f $LOG_FILE"
echo "查看错误日志: cat $ERROR_LOG_FILE"
