#!/usr/bin/env python3
"""
创建folders表并迁移现有文件夹数据
"""

import os

import pymysql
import json
from datetime import datetime

# MySQL连接配置
MYSQL_CONFIG = {
    'host': os.environ.get('MYSQL_HOST', 'localhost'),
    'port': int(os.environ.get('MYSQL_PORT', '3306')),
    'user': os.environ.get('MYSQL_USER', 'root'),
    'password': os.environ.get('MYSQL_PASSWORD', ''),
    'database': os.environ.get('MYSQL_DATABASE', 'pzy'),
    'charset': 'utf8mb4'
}

def create_folders_table(cursor):
    """创建folders表"""
    print("🔨 创建folders表...")
    
    create_table_sql = """
    CREATE TABLE IF NOT EXISTS folders (
        id INT AUTO_INCREMENT PRIMARY KEY,
        folder_id VARCHAR(100) NOT NULL UNIQUE,
        name VARCHAR(200) NOT NULL,
        parent_id VARCHAR(100) NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_parent_id (parent_id),
        INDEX idx_folder_id (folder_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    """
    
    cursor.execute(create_table_sql)
    print("✅ folders表创建完成")

def migrate_existing_folders(cursor):
    """迁移现有的文件夹数据"""
    print("📋 开始迁移现有文件夹数据...")
    
    # 从数据库中的test_case表获取所有唯一的folder_id
    cursor.execute("""
        SELECT DISTINCT folder_id 
        FROM test_case 
        WHERE folder_id IS NOT NULL AND folder_id != ''
    """)
    
    existing_folder_ids = cursor.fetchall()
    print(f"📊 找到 {len(existing_folder_ids)} 个现有文件夹ID")
    
    migrated_count = 0
    for (folder_id,) in existing_folder_ids:
        try:
            # 检查文件夹是否已存在
            cursor.execute("SELECT COUNT(*) FROM folders WHERE folder_id = %s", (folder_id,))
            exists = cursor.fetchone()[0]
            
            if exists == 0:
                # 创建文件夹记录
                insert_sql = """
                INSERT INTO folders (folder_id, name, parent_id, created_at)
                VALUES (%s, %s, %s, %s)
                """
                
                # 从folder_id中提取名称（如果可能）
                folder_name = folder_id.replace('folder_', '文件夹_')
                
                cursor.execute(insert_sql, (
                    folder_id,
                    folder_name,
                    None,  # 暂时设为根级文件夹
                    datetime.now()
                ))
                
                migrated_count += 1
                print(f"✅ 迁移文件夹: {folder_id} -> {folder_name}")
            else:
                print(f"⚠️ 文件夹已存在: {folder_id}")
                
        except Exception as e:
            print(f"❌ 迁移文件夹失败: {folder_id} - {str(e)}")
    
    print(f"✅ 成功迁移 {migrated_count} 个文件夹")

def create_sample_folders(cursor):
    """创建一些示例文件夹"""
    print("📁 创建示例文件夹...")
    
    sample_folders = [
        {
            'folder_id': 'folder_root_001',
            'name': '根级文件夹1',
            'parent_id': None
        },
        {
            'folder_id': 'folder_root_002', 
            'name': '根级文件夹2',
            'parent_id': None
        },
        {
            'folder_id': 'folder_sub_001',
            'name': '子文件夹1',
            'parent_id': 'folder_root_001'
        },
        {
            'folder_id': 'folder_sub_002',
            'name': '子文件夹2', 
            'parent_id': 'folder_root_001'
        },
        {
            'folder_id': 'folder_deep_001',
            'name': '深层文件夹',
            'parent_id': 'folder_sub_001'
        }
    ]
    
    insert_sql = """
    INSERT INTO folders (folder_id, name, parent_id, created_at)
    VALUES (%s, %s, %s, %s)
    ON DUPLICATE KEY UPDATE name = VALUES(name), parent_id = VALUES(parent_id)
    """
    
    created_count = 0
    for folder in sample_folders:
        try:
            cursor.execute(insert_sql, (
                folder['folder_id'],
                folder['name'],
                folder['parent_id'],
                datetime.now()
            ))
            created_count += 1
            print(f"✅ 创建文件夹: {folder['name']} (ID: {folder['folder_id']})")
        except Exception as e:
            print(f"❌ 创建文件夹失败: {folder['name']} - {str(e)}")
    
    print(f"✅ 成功创建 {created_count} 个示例文件夹")

def verify_folders_table(cursor):
    """验证folders表"""
    print("🔍 验证folders表...")
    
    # 查询所有文件夹
    cursor.execute("""
        SELECT folder_id, name, parent_id, created_at 
        FROM folders 
        ORDER BY created_at DESC
    """)
    
    folders = cursor.fetchall()
    print(f"📊 folders表中共有 {len(folders)} 个文件夹:")
    
    for folder_id, name, parent_id, created_at in folders:
        parent_info = f" -> 父文件夹: {parent_id}" if parent_id else " (根级文件夹)"
        print(f"  - {name} (ID: {folder_id}){parent_info}")
    
    # 查询文件夹层级结构
    print("\n🌳 文件夹层级结构:")
    cursor.execute("""
        SELECT f1.name as parent_name, f2.name as child_name
        FROM folders f1
        JOIN folders f2 ON f1.folder_id = f2.parent_id
        ORDER BY f1.name, f2.name
    """)
    
    hierarchies = cursor.fetchall()
    if hierarchies:
        for parent_name, child_name in hierarchies:
            print(f"  - {parent_name} -> {child_name}")
    else:
        print("  - 暂无层级关系")

def main():
    """主函数"""
    print("🚀 开始创建folders表并迁移数据")
    print("=" * 50)
    
    try:
        # 连接数据库
        print("🔌 连接MySQL数据库...")
        conn = pymysql.connect(**MYSQL_CONFIG)
        cursor = conn.cursor()
        print("✅ 数据库连接成功")
        
        # 创建folders表
        create_folders_table(cursor)
        
        # 迁移现有文件夹数据
        migrate_existing_folders(cursor)
        
        # 创建示例文件夹
        create_sample_folders(cursor)
        
        # 提交更改
        conn.commit()
        
        # 验证结果
        verify_folders_table(cursor)
        
        print("=" * 50)
        print("🎉 folders表创建和数据迁移完成！")
        print("💡 现在文件夹数据将存储在MySQL数据库中")
        
    except Exception as e:
        print(f"❌ 操作失败: {str(e)}")
        return False
    finally:
        if 'conn' in locals():
            conn.close()
    
    return True

if __name__ == '__main__':
    main()
