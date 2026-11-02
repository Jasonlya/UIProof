# 文件夹管理 API - Postman 调试文档

## 📋 基础信息

- **服务器地址**: `http://localhost:5001`
- **API 前缀**: `/api`
- **Content-Type**: `application/json`
- **CORS**: 已启用，支持跨域请求

---

## 📁 文件夹管理接口

### 1. 创建文件夹

**请求信息：**
- **方法**: `POST`
- **URL**: `http://localhost:5001/api/folders`
- **Headers**:
  ```
  Content-Type: application/json
  ```
- **Body** (JSON):
  ```json
  {
    "name": "测试文件夹",
    "parent_id": null
  }
  ```

**参数说明：**
- `name` (必填): 文件夹名称，字符串类型
- `parent_id` (可选): 父文件夹ID，字符串类型，如果为根目录则传 `null` 或不传

**请求示例：**

**示例1：创建根目录文件夹**
```json
{
  "name": "我的文件夹"
}
```

**示例2：创建子文件夹**
```json
{
  "name": "子文件夹",
  "parent_id": "folder_1234567890123"
}
```

**成功响应** (201 Created):
```json
{
  "message": "文件夹创建成功",
  "folder": {
    "id": 1,
    "folder_id": "folder_1234567890123",
    "name": "测试文件夹",
    "parent_id": null,
    "created_at": "2024-01-01T12:00:00.000000",
    "updated_at": "2024-01-01T12:00:00.000000"
  }
}
```

**错误响应** (400 Bad Request):
```json
{
  "error": "缺少文件夹名称"
}
```

**错误响应** (400 Bad Request - JSON解析失败):
```json
{
  "error": "JSON解析失败: unexpected end of json input"
}
```

---

### 2. 获取文件夹列表

**请求信息：**
- **方法**: `GET`
- **URL**: `http://localhost:5001/api/folders`
- **Headers**: 无

**成功响应** (200 OK):
```json
[
  {
    "id": 1,
    "folder_id": "folder_1234567890123",
    "name": "测试文件夹",
    "parent_id": null,
    "created_at": "2024-01-01T12:00:00.000000",
    "updated_at": "2024-01-01T12:00:00.000000"
  }
]
```

---

### 3. 获取文件夹树形结构

**请求信息：**
- **方法**: `GET`
- **URL**: `http://localhost:5001/api/folders/tree`
- **Headers**: 无

**成功响应** (200 OK):
```json
{
  "folders": [
    {
      "id": 1,
      "folder_id": "folder_1234567890123",
      "name": "根文件夹",
      "parent_id": null,
      "created_at": "2024-01-01T12:00:00.000000",
      "updated_at": "2024-01-01T12:00:00.000000",
      "children": [
        {
          "id": 2,
          "folder_id": "folder_1234567890124",
          "name": "子文件夹",
          "parent_id": "folder_1234567890123",
          "created_at": "2024-01-01T12:00:00.000000",
          "updated_at": "2024-01-01T12:00:00.000000",
          "children": []
        }
      ]
    }
  ],
  "total": 2
}
```

---

### 4. 更新文件夹

**请求信息：**
- **方法**: `PUT`
- **URL**: `http://localhost:5001/api/folders/{folder_id}`
- **Headers**:
  ```
  Content-Type: application/json
  ```
- **Body** (JSON):
  ```json
  {
    "name": "新文件夹名称",
    "parent_id": "folder_1234567890123"
  }
  ```

**参数说明：**
- `folder_id` (路径参数): 文件夹ID，例如 `folder_1234567890123`
- `name` (可选): 新文件夹名称
- `parent_id` (可选): 新的父文件夹ID

**成功响应** (200 OK):
```json
{
  "message": "文件夹更新成功",
  "folder": {
    "id": 1,
    "folder_id": "folder_1234567890123",
    "name": "新文件夹名称",
    "parent_id": null,
    "created_at": "2024-01-01T12:00:00.000000",
    "updated_at": "2024-01-01T12:01:00.000000"
  }
}
```

**错误响应** (404 Not Found):
```json
{
  "error": "文件夹不存在"
}
```

---

### 5. 删除文件夹

**请求信息：**
- **方法**: `DELETE`
- **URL**: `http://localhost:5001/api/folders/{folder_id}`
- **Headers**: 无

**参数说明：**
- `folder_id` (路径参数): 文件夹ID，例如 `folder_1234567890123`

**成功响应** (200 OK):
```json
{
  "message": "文件夹删除成功"
}
```

**错误响应** (400 Bad Request - 包含子文件夹):
```json
{
  "error": "文件夹包含子文件夹，无法删除"
}
```

**错误响应** (400 Bad Request - 包含用例):
```json
{
  "error": "文件夹包含 5 个用例，无法删除"
}
```

**错误响应** (404 Not Found):
```json
{
  "error": "文件夹不存在"
}
```

---

## 🔧 Postman 配置步骤

### 1. 创建环境变量（可选）

在 Postman 中创建环境，设置变量：
- `base_url`: `http://localhost:5001`
- `api_prefix`: `/api`

### 2. 创建请求集合

创建名为 "文件夹管理 API" 的集合，包含以下请求：

#### 请求1：创建文件夹（根目录）
- Method: `POST`
- URL: `{{base_url}}{{api_prefix}}/folders`
- Headers:
  - `Content-Type`: `application/json`
- Body (raw JSON):
  ```json
  {
    "name": "测试文件夹"
  }
  ```

#### 请求2：创建子文件夹
- Method: `POST`
- URL: `{{base_url}}{{api_prefix}}/folders`
- Headers:
  - `Content-Type`: `application/json`
- Body (raw JSON):
  ```json
  {
    "name": "子文件夹",
    "parent_id": "folder_1234567890123"
  }
  ```
  > 注意：将 `parent_id` 替换为实际存在的文件夹ID

#### 请求3：获取文件夹列表
- Method: `GET`
- URL: `{{base_url}}{{api_prefix}}/folders`

#### 请求4：获取文件夹树
- Method: `GET`
- URL: `{{base_url}}{{api_prefix}}/folders/tree`

#### 请求5：更新文件夹
- Method: `PUT`
- URL: `{{base_url}}{{api_prefix}}/folders/{folder_id}`
- Headers:
  - `Content-Type`: `application/json`
- Body (raw JSON):
  ```json
  {
    "name": "新名称"
  }
  ```
  > 注意：将 URL 中的 `{folder_id}` 替换为实际文件夹ID

#### 请求6：删除文件夹
- Method: `DELETE`
- URL: `{{base_url}}{{api_prefix}}/folders/{folder_id}`
  > 注意：将 URL 中的 `{folder_id}` 替换为实际文件夹ID

---

## 🐛 常见问题排查

### 1. JSON 解析错误

**错误信息**: `unexpected end of json input`

**原因**:
- 请求体为空
- JSON 格式不正确
- Content-Type 未设置或设置错误

**解决方案**:
1. 确认 Body 选择了 `raw` 和 `JSON` 格式
2. 确认 Headers 中设置了 `Content-Type: application/json`
3. 检查 JSON 格式是否正确（使用 JSON 验证工具）

### 2. 连接失败

**错误信息**: `Could not get any response`

**原因**:
- 服务器未启动
- 端口不正确
- 防火墙阻止

**解决方案**:
1. 确认服务器已启动：`cd server && python app.py`
2. 确认端口为 5001
3. 检查服务器日志：`tail -f server/logs/app.log`

### 3. CORS 错误

**错误信息**: `CORS policy` 相关错误

**解决方案**:
- 服务器已启用 CORS，如果仍有问题，检查服务器配置

---

## 📝 测试流程建议

1. **健康检查**
   - 先测试 `GET http://localhost:5001/api/health` 确认服务正常

2. **创建根文件夹**
   - 创建几个根目录文件夹，获取 `folder_id`

3. **创建子文件夹**
   - 使用步骤2获取的 `folder_id` 作为 `parent_id` 创建子文件夹

4. **获取列表和树**
   - 测试获取文件夹列表和树形结构

5. **更新和删除**
   - 测试更新文件夹名称
   - 测试删除文件夹（注意：有子文件夹或用例的文件夹无法删除）

---

## 📊 响应字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | Integer | 数据库主键ID |
| `folder_id` | String | 文件夹唯一标识符，格式：`folder_时间戳` |
| `name` | String | 文件夹名称 |
| `parent_id` | String/null | 父文件夹ID，根目录为 `null` |
| `created_at` | String | 创建时间，ISO 8601 格式 |
| `updated_at` | String | 更新时间，ISO 8601 格式 |

---

## 🔍 调试技巧

### 查看服务器日志

```bash
# 实时查看日志
tail -f server/logs/app.log

# 查看最近50行
tail -n 50 server/logs/app.log
```

### 使用 curl 测试

```bash
# 创建文件夹
curl -X POST http://localhost:5001/api/folders \
  -H "Content-Type: application/json" \
  -d '{"name":"测试文件夹"}'

# 获取文件夹列表
curl http://localhost:5001/api/folders

# 获取文件夹树
curl http://localhost:5001/api/folders/tree
```

---

## ✅ 快速测试用例

### 测试用例1：创建根文件夹
```json
POST http://localhost:5001/api/folders
Content-Type: application/json

{
  "name": "工作文件夹"
}
```

### 测试用例2：创建子文件夹
```json
POST http://localhost:5001/api/folders
Content-Type: application/json

{
  "name": "项目A",
  "parent_id": "folder_1234567890123"
}
```

### 测试用例3：错误测试 - 缺少名称
```json
POST http://localhost:5001/api/folders
Content-Type: application/json

{
  "parent_id": "folder_1234567890123"
}
```
预期响应：`{"error": "缺少文件夹名称"}`

### 测试用例4：错误测试 - 空请求体
```json
POST http://localhost:5001/api/folders
Content-Type: application/json

{}
```
预期响应：`{"error": "缺少文件夹名称"}`

---

**最后更新**: 2024-01-01

