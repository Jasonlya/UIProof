#!/usr/bin/env python3
"""
简化的数据库迁移脚本：从SQLite迁移到MySQL
"""

import sqlite3
import os

import pymysql
from datetime import datetime

# SQLite数据库路径
SQLITE_DB_PATH = 'instance/automation_cases.db'

# MySQL连接配置
MYSQL_CONFIG = {
    'host': os.environ.get('MYSQL_HOST', 'localhost'),
    'port': int(os.environ.get('MYSQL_PORT', '3306')),
    'user': os.environ.get('MYSQL_USER', 'root'),
    'password': os.environ.get('MYSQL_PASSWORD', ''),
    'database': os.environ.get('MYSQL_DATABASE', 'pzy'),
    'charset': 'utf8mb4'
}

def connect_sqlite():
    """连接SQLite数据库"""
    return sqlite3.connect(SQLITE_DB_PATH)

def connect_mysql():
    """连接MySQL数据库"""
    return pymysql.connect(**MYSQL_CONFIG)

def create_mysql_tables(cursor):
    """在MySQL中创建表"""
    print("🔨 创建MySQL表结构...")
    
    # 创建test_case表
    create_test_case_table = """
    CREATE TABLE IF NOT EXISTS test_case (
        id INT AUTO_INCREMENT PRIMARY KEY,
        case_id VARCHAR(36) NOT NULL UNIQUE,
        name VARCHAR(200) NOT NULL,
        description TEXT,
        category VARCHAR(100),
        tags VARCHAR(500),
        steps TEXT,
        status VARCHAR(20) DEFAULT 'active',
        folder_id VARCHAR(100),
        created_at DATETIME,
        updated_at DATETIME,
        execution_count INT DEFAULT 0,
        last_executed DATETIME,
        success_rate FLOAT DEFAULT 0.0
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    """
    
    # 创建execution_log表
    create_execution_log_table = """
    CREATE TABLE IF NOT EXISTS execution_log (
        id INT AUTO_INCREMENT PRIMARY KEY,
        case_id VARCHAR(36) NOT NULL,
        status VARCHAR(20) NOT NULL,
        start_time DATETIME,
        end_time DATETIME,
        error_message TEXT,
        execution_data TEXT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    """
    
    cursor.execute(create_test_case_table)
    cursor.execute(create_execution_log_table)
    print("✅ MySQL表结构创建完成")

def migrate_test_cases(sqlite_conn, mysql_conn):
    """迁移测试用例数据"""
    print("📋 开始迁移测试用例数据...")
    
    sqlite_cursor = sqlite_conn.cursor()
    mysql_cursor = mysql_conn.cursor()
    
    # 从SQLite读取数据
    sqlite_cursor.execute("SELECT * FROM test_case")
    test_cases = sqlite_cursor.fetchall()
    
    print(f"📊 找到 {len(test_cases)} 个测试用例")
    
    migrated_count = 0
    for case in test_cases:
        try:
            # 构建插入SQL，使用STR_TO_DATE处理日期
            insert_sql = """
            INSERT INTO test_case (
                case_id, name, description, category, tags, steps, status, 
                folder_id, created_at, updated_at, execution_count, 
                last_executed, success_rate
            ) VALUES (
                %s, %s, %s, %s, %s, %s, %s, %s, 
                STR_TO_DATE(%s, '%%Y-%%m-%%d %%H:%%i:%%s.%%f'),
                STR_TO_DATE(%s, '%%Y-%%m-%%d %%H:%%i:%%s.%%f'),
                %s, 
                STR_TO_DATE(%s, '%%Y-%%m-%%d %%H:%%i:%%s.%%f'),
                %s
            )
            """
            
            # 准备数据
            case_data = [
                case[1],  # case_id
                case[2],  # name
                case[3],  # description
                case[4],  # category
                case[5],  # tags
                case[6],  # steps
                case[7],  # status
                case[13], # folder_id
                case[8],  # created_at
                case[9],  # updated_at
                case[10], # execution_count
                case[11], # last_executed
                case[12]  # success_rate
            ]
            
            mysql_cursor.execute(insert_sql, case_data)
            migrated_count += 1
            print(f"✅ 迁移用例: {case[2]} (ID: {case[1]})")
        except Exception as e:
            print(f"❌ 迁移用例失败: {case[2]} - {str(e)}")
            # 打印详细错误信息
            print(f"   数据: {case_data}")
    
    mysql_conn.commit()
    print(f"✅ 成功迁移 {migrated_count} 个测试用例")

def migrate_execution_logs(sqlite_conn, mysql_conn):
    """迁移执行日志数据"""
    print("📋 开始迁移执行日志数据...")
    
    sqlite_cursor = sqlite_conn.cursor()
    mysql_cursor = mysql_conn.cursor()
    
    # 从SQLite读取数据
    sqlite_cursor.execute("SELECT * FROM execution_log")
    execution_logs = sqlite_cursor.fetchall()
    
    print(f"📊 找到 {len(execution_logs)} 条执行日志")
    
    # 插入到MySQL
    insert_sql = """
    INSERT INTO execution_log (
        case_id, status, start_time, end_time, error_message, execution_data
    ) VALUES (
        %s, %s, 
        STR_TO_DATE(%s, '%%Y-%%m-%%d %%H:%%i:%%s.%%f'),
        STR_TO_DATE(%s, '%%Y-%%m-%%d %%H:%%i:%%s.%%f'),
        %s, %s
    )
    """
    
    migrated_count = 0
    for log in execution_logs:
        try:
            log_data = [
                log[1],  # case_id
                log[2],  # status
                log[3],  # start_time
                log[4],  # end_time
                log[5],  # error_message
                log[6]   # execution_data
            ]
            mysql_cursor.execute(insert_sql, log_data)
            migrated_count += 1
            print(f"✅ 迁移日志: {log[1]} - {log[2]}")
        except Exception as e:
            print(f"❌ 迁移日志失败: {log[1]} - {str(e)}")
    
    mysql_conn.commit()
    print(f"✅ 成功迁移 {migrated_count} 条执行日志")

def verify_migration(mysql_conn):
    """验证迁移结果"""
    print("🔍 验证迁移结果...")
    
    cursor = mysql_conn.cursor()
    
    # 检查test_case表
    cursor.execute("SELECT COUNT(*) FROM test_case")
    test_case_count = cursor.fetchone()[0]
    print(f"📊 MySQL test_case表: {test_case_count} 条记录")
    
    # 检查execution_log表
    cursor.execute("SELECT COUNT(*) FROM execution_log")
    execution_log_count = cursor.fetchone()[0]
    print(f"📊 MySQL execution_log表: {execution_log_count} 条记录")
    
    # 显示一些示例数据
    cursor.execute("SELECT case_id, name, category, folder_id FROM test_case LIMIT 5")
    sample_cases = cursor.fetchall()
    print("📋 示例数据:")
    for case in sample_cases:
        print(f"  - {case[1]} ({case[2]}) - 文件夹: {case[3] or '根目录'}")

def main():
    """主函数"""
    print("🚀 开始数据库迁移：SQLite -> MySQL")
    print("=" * 50)
    
    try:
        # 连接数据库
        print("🔌 连接数据库...")
        sqlite_conn = connect_sqlite()
        mysql_conn = connect_mysql()
        print("✅ 数据库连接成功")
        
        # 创建MySQL表结构
        mysql_cursor = mysql_conn.cursor()
        create_mysql_tables(mysql_cursor)
        
        # 清空现有数据（如果需要重新迁移）
        mysql_cursor.execute("DELETE FROM test_case")
        mysql_cursor.execute("DELETE FROM execution_log")
        mysql_conn.commit()
        print("🗑️ 清空现有MySQL数据")
        
        # 迁移数据
        migrate_test_cases(sqlite_conn, mysql_conn)
        migrate_execution_logs(sqlite_conn, mysql_conn)
        
        # 验证迁移结果
        verify_migration(mysql_conn)
        
        print("=" * 50)
        print("🎉 数据库迁移完成！")
        print("💡 现在可以启动Flask应用使用MySQL数据库了")
        
    except Exception as e:
        print(f"❌ 迁移失败: {str(e)}")
        return False
    finally:
        # 关闭连接
        if 'sqlite_conn' in locals():
            sqlite_conn.close()
        if 'mysql_conn' in locals():
            mysql_conn.close()
    
    return True

if __name__ == '__main__':
    main()
