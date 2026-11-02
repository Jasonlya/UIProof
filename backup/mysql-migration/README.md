# MySQL 迁移脚本备份

此目录仅用于归档，不是应用运行依赖。UIProof 当前固定使用 SQLite，无需安装或启动 MySQL。

## 归档文件

- `migrate_to_mysql_v2.py`：将 SQLite 中的用例和执行日志迁移到 MySQL
- `create_folders_table.py`：创建并初始化 MySQL `folders` 表
- `check_tables.py`：检查 MySQL 表结构
- `delete_folder_table.py`：清理历史遗留的 `folder` 表

## 使用前提

这些脚本仅用于历史数据迁移或排障。执行前请先备份 SQLite 和 MySQL 数据。

```bash
cd backup/mysql-migration
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env
set -a
source .env
set +a

python migrate_to_mysql_v2.py
```

`migrate_to_mysql_v2.py` 会先清空目标 MySQL 中的 `test_case` 和 `execution_log` 表，再导入 SQLite 数据，请勿在未确认目标库的情况下执行。

## SQLite 路径

默认读取仓库中的 `server/instance/automation_cases.db`，也可以通过 `SQLITE_DB_PATH` 指定其他文件：

```bash
export SQLITE_DB_PATH=/absolute/path/to/automation_cases.db
```
