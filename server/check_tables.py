#!/usr/bin/env python3
"""
检查数据库中的表结构
"""

import os

import pymysql

# MySQL连接配置
MYSQL_CONFIG = {
    'host': os.environ.get('MYSQL_HOST', 'localhost'),
    'port': int(os.environ.get('MYSQL_PORT', '3306')),
    'user': os.environ.get('MYSQL_USER', 'root'),
    'password': os.environ.get('MYSQL_PASSWORD', ''),
    'database': os.environ.get('MYSQL_DATABASE', 'pzy'),
    'charset': 'utf8mb4'
}

def check_tables():
    """检查数据库中的表"""
    try:
        conn = pymysql.connect(**MYSQL_CONFIG)
        cursor = conn.cursor()
        
        print("🔍 检查数据库中的表...")
        print("=" * 50)
        
        # 查看所有表
        cursor.execute("SHOW TABLES;")
        tables = cursor.fetchall()
        
        print("📊 数据库中的表:")
        for table in tables:
            print(f"  - {table[0]}")
        
        # 检查是否有folder和folders两个表
        table_names = [table[0] for table in tables]
        
        if 'folder' in table_names and 'folders' in table_names:
            print("\n⚠️ 发现问题：同时存在folder和folders两个表")
            
            # 检查两个表的结构
            print("\n📋 folder表结构:")
            cursor.execute("DESCRIBE folder;")
            folder_structure = cursor.fetchall()
            for field in folder_structure:
                print(f"  - {field[0]} ({field[1]})")
            
            print("\n📋 folders表结构:")
            cursor.execute("DESCRIBE folders;")
            folders_structure = cursor.fetchall()
            for field in folders_structure:
                print(f"  - {field[0]} ({field[1]})")
            
            # 检查两个表的数据
            cursor.execute("SELECT COUNT(*) FROM folder;")
            folder_count = cursor.fetchone()[0]
            print(f"\n📊 folder表数据量: {folder_count}")
            
            cursor.execute("SELECT COUNT(*) FROM folders;")
            folders_count = cursor.fetchone()[0]
            print(f"📊 folders表数据量: {folders_count}")
            
        elif 'folder' in table_names:
            print("\n✅ 只有folder表")
        elif 'folders' in table_names:
            print("\n✅ 只有folders表")
        else:
            print("\n❌ 没有找到folder相关的表")
        
        print("\n💡 建议:")
        print("1. Flask-SQLAlchemy默认会将类名转换为复数形式")
        print("2. Folder类会创建名为'folder'的表（单数）")
        print("3. 但我们的API和脚本使用的是'folders'表（复数）")
        print("4. 需要统一表名")
        
    except Exception as e:
        print(f"❌ 检查失败: {str(e)}")
    finally:
        if 'conn' in locals():
            conn.close()

if __name__ == '__main__':
    check_tables()
