# 服务端管理脚本

## 脚本说明

### 1. 启动服务端
```bash
./start.sh
```
- 启动Flask服务端
- 自动激活虚拟环境
- 日志输出到 `logs/app.log`
- 将 PID 写入 `.run/server.pid`
- 通过 `PORT` 环境变量覆盖默认端口 5001

### 2. 停止服务端
```bash
./stop.sh
```
- 按 `.run/server.pid` 停止对应进程
- 释放端口 5001（或 `PORT` 指定端口）

### 3. 重启服务端
```bash
./restart.sh
```
- 先停止服务端，再重新启动
- 等同于执行 `./stop.sh && ./start.sh`

### 4. 查看日志
```bash
./logs.sh
```
- 显示最近50行日志
- 提供实时查看日志的命令

## 日志文件

- **应用日志**: `logs/app.log` - 包含所有请求和操作日志
- **日志轮转**: 每个日志文件最大10KB，保留10个备份文件

## 实时查看日志

```bash
# 实时查看应用日志
tail -f logs/app.log

# 查看所有日志
tail -f logs/*.log
```

## 服务地址

- **健康检查**: http://localhost:5001/api/health
- **用例列表**: http://localhost:5001/api/cases
- **创建用例**: POST http://localhost:5001/api/cases

## 故障排除

### 端口被占用
```bash
# 查看端口占用
lsof -i :5001

# 强制停止占用进程
sudo lsof -ti:5001 | xargs kill -9
```

### 虚拟环境问题
```bash
# 重新创建虚拟环境
rm -rf venv
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 权限问题
```bash
# 给脚本添加执行权限
chmod +x *.sh
```
