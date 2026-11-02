# 服务端管理脚本

## 脚本说明

### 1. 启动服务端
```bash
./start.sh
```
- 启动Flask服务端
- 自动激活虚拟环境
- 日志输出到 `logs/app.log`
- 错误日志输出到 `logs/error.log`
- 同时显示在控制台

### 2. 停止服务端
```bash
./stop.sh
```
- 停止所有Flask服务端进程
- 释放端口5000

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
- **错误日志**: `logs/error.log` - 包含错误信息
- **日志轮转**: 每个日志文件最大10KB，保留10个备份文件

## 实时查看日志

```bash
# 实时查看应用日志
tail -f logs/app.log

# 实时查看错误日志
tail -f logs/error.log

# 查看所有日志
tail -f logs/*.log
```

## 服务地址

- **健康检查**: http://localhost:5000/api/health
- **用例列表**: http://localhost:5000/api/cases
- **创建用例**: POST http://localhost:5000/api/cases

## 故障排除

### 端口被占用
```bash
# 查看端口占用
lsof -i :5000

# 强制停止占用进程
sudo lsof -ti:5000 | xargs kill -9
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