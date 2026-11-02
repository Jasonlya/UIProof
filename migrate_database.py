#!/usr/bin/env python3
"""
数据库迁移脚本 - 添加folder_id字段
"""

import sqlite3
import os
import sys

def migrate_database():
    """执行数据库迁移"""
    db_path = 'server/instance/automation_cases.db'
    
    if not os.path.exists(db_path):
        print(f"❌ 数据库文件不存在: {db_path}")
        return False
    
    try:
        # 连接数据库
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        # 检查folder_id字段是否已存在
        cursor.execute("PRAGMA table_info(test_case)")
        columns = [column[1] for column in cursor.fetchall()]
        
        if 'folder_id' in columns:
            print("✅ folder_id字段已存在，无需迁移")
            return True
        
        print("🔄 开始添加folder_id字段...")
        
        # 添加folder_id字段
        cursor.execute("ALTER TABLE test_case ADD COLUMN folder_id VARCHAR(100)")
        
        # 提交更改
        conn.commit()
        
        print("✅ folder_id字段添加成功")
        
        # 验证字段是否添加成功
        cursor.execute("PRAGMA table_info(test_case)")
        columns = [column[1] for column in cursor.fetchall()]
        
        if 'folder_id' in columns:
            print("✅ 验证成功: folder_id字段已添加")
            return True
        else:
            print("❌ 验证失败: folder_id字段未找到")
            return False
            
    except Exception as e:
        print(f"❌ 迁移失败: {e}")
        return False
    finally:
        if 'conn' in locals():
            conn.close()

if __name__ == "__main__":
    print("🚀 开始数据库迁移...")
    success = migrate_database()
    
    if success:
        print("🎉 数据库迁移完成！")
        sys.exit(0)
    else:
        print("💥 数据库迁移失败！")
        sys.exit(1)
