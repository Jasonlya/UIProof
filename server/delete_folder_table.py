#!/usr/bin/env python3
"""
删除多余的folder表，保留folders表
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

def delete_folder_table():
    """删除folder表"""
    try:
        conn = pymysql.connect(**MYSQL_CONFIG)
        cursor = conn.cursor()
        
        print("🗑️ 开始删除多余的folder表...")
        print("=" * 50)
        
        # 检查folder表是否存在
        cursor.execute("SHOW TABLES LIKE 'folder';")
        folder_exists = cursor.fetchone()
        
        if folder_exists:
            print("📋 找到folder表，准备删除...")
            
            # 检查folder表中的数据
            cursor.execute("SELECT COUNT(*) FROM folder;")
            folder_count = cursor.fetchone()[0]
            print(f"📊 folder表中有 {folder_count} 条数据")
            
            if folder_count > 0:
                # 显示folder表中的数据
                cursor.execute("SELECT folder_id, name FROM folder;")
                folder_data = cursor.fetchall()
                print("📋 folder表中的数据:")
                for folder_id, name in folder_data:
                    print(f"  - {name} (ID: {folder_id})")
                
                # 检查这些数据是否在folders表中已存在
                print("\n🔍 检查数据是否在folders表中已存在...")
                for folder_id, name in folder_data:
                    cursor.execute("SELECT COUNT(*) FROM folders WHERE folder_id = %s", (folder_id,))
                    exists = cursor.fetchone()[0]
                    if exists > 0:
                        print(f"  ✅ {name} (ID: {folder_id}) 在folders表中已存在")
                    else:
                        print(f"  ⚠️ {name} (ID: {folder_id}) 在folders表中不存在")
            
            # 删除folder表
            cursor.execute("DROP TABLE folder;")
            print("✅ folder表删除成功")
            
        else:
            print("ℹ️ folder表不存在，无需删除")
        
        # 验证folders表
        cursor.execute("SELECT COUNT(*) FROM folders;")
        folders_count = cursor.fetchone()[0]
        print(f"\n📊 folders表中有 {folders_count} 条数据")
        
        if folders_count > 0:
            cursor.execute("SELECT folder_id, name FROM folders LIMIT 5;")
            folders_data = cursor.fetchall()
            print("📋 folders表中的数据（前5条）:")
            for folder_id, name in folders_data:
                print(f"  - {name} (ID: {folder_id})")
        
        print("\n" + "=" * 50)
        print("🎉 表清理完成！")
        print("💡 现在只使用folders表存储文件夹数据")
        
    except Exception as e:
        print(f"❌ 操作失败: {str(e)}")
        return False
    finally:
        if 'conn' in locals():
            conn.close()
    
    return True

if __name__ == '__main__':
    delete_folder_table()
