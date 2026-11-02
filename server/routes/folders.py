from flask import Blueprint, request, jsonify, current_app
from datetime import datetime
from models.models import Folder, TestCase, db

bp = Blueprint('folders', __name__, url_prefix='/api')

@bp.route('/folders', methods=['GET'])
def get_folders():
    current_app.logger.info('📁 获取文件夹列表请求')
    
    folders = Folder.query.order_by(Folder.created_at.desc()).all()
    
    current_app.logger.info(f'📁 找到 {len(folders)} 个文件夹')
    
    return jsonify([{
        'id': folder.id,
        'folder_id': folder.folder_id,
        'name': folder.name,
        'parent_id': folder.parent_id,
        'created_at': folder.created_at.isoformat(),
        'updated_at': folder.updated_at.isoformat()
    } for folder in folders])

@bp.route('/folders', methods=['POST'])
def create_folder():
    current_app.logger.info('📁 创建文件夹请求')
    current_app.logger.info(f'请求体原始数据: {request.get_data(as_text=True)}')
    
    try:
        data = request.get_json(force=True)
    except Exception as e:
        current_app.logger.error(f'❌ JSON解析失败: {str(e)}')
        current_app.logger.error(f'请求体内容: {request.get_data(as_text=True)}')
        return jsonify({'error': f'JSON解析失败: {str(e)}'}), 400
    
    if not data:
        current_app.logger.warning('❌ 请求体为空')
        return jsonify({'error': '请求体不能为空'}), 400
    
    current_app.logger.info(f'解析后的数据: {data}')
    
    if 'name' not in data:
        current_app.logger.warning('❌ 缺少文件夹名称字段')
        return jsonify({'error': '缺少文件夹名称'}), 400
    
    folder_id = 'folder_' + str(int(datetime.now().timestamp() * 1000))
    
    folder = Folder(
        folder_id=folder_id,
        name=data['name'],
        parent_id=data.get('parent_id')
    )
    
    try:
        db.session.add(folder)
        db.session.commit()
        
        current_app.logger.info(f'✅ 文件夹创建成功: {data["name"]} (ID: {folder_id})')
        
        return jsonify({
            'message': '文件夹创建成功',
            'folder': {
                'id': folder.id,
                'folder_id': folder.folder_id,
                'name': folder.name,
                'parent_id': folder.parent_id,
                'created_at': folder.created_at.isoformat(),
                'updated_at': folder.updated_at.isoformat()
            }
        }), 201
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f'❌ 文件夹创建失败: {str(e)}')
        return jsonify({'error': '文件夹创建失败'}), 500

@bp.route('/folders/<folder_id>', methods=['PUT'])
def update_folder(folder_id):
    current_app.logger.info(f'📁 更新文件夹请求: {folder_id}')
    
    folder = Folder.query.filter_by(folder_id=folder_id).first()
    if not folder:
        return jsonify({'error': '文件夹不存在'}), 404
    
    data = request.get_json()
    if not data:
        return jsonify({'error': '缺少更新数据'}), 400
    
    try:
        if 'name' in data:
            folder.name = data['name']
        if 'parent_id' in data:
            folder.parent_id = data['parent_id']
        
        folder.updated_at = datetime.utcnow()
        db.session.commit()
        
        current_app.logger.info(f'✅ 文件夹更新成功: {folder.name}')
        
        return jsonify({
            'message': '文件夹更新成功',
            'folder': {
                'id': folder.id,
                'folder_id': folder.folder_id,
                'name': folder.name,
                'parent_id': folder.parent_id,
                'created_at': folder.created_at.isoformat(),
                'updated_at': folder.updated_at.isoformat()
            }
        })
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f'❌ 文件夹更新失败: {str(e)}')
        return jsonify({'error': '文件夹更新失败'}), 500

@bp.route('/folders/<folder_id>', methods=['DELETE'])
def delete_folder(folder_id):
    current_app.logger.info(f'📁 删除文件夹请求: {folder_id}')
    
    folder = Folder.query.filter_by(folder_id=folder_id).first()
    if not folder:
        return jsonify({'error': '文件夹不存在'}), 404
    
    try:
        deleted_folders_count = 0
        deleted_cases_count = 0
        
        # 递归删除所有子文件夹
        def delete_child_folders(parent_id):
            nonlocal deleted_folders_count, deleted_cases_count
            child_folders = Folder.query.filter_by(parent_id=parent_id).all()
            for child_folder in child_folders:
                # 先递归删除子文件夹的子文件夹和用例
                delete_child_folders(child_folder.folder_id)
                
                # 删除子文件夹内的所有用例
                child_cases = TestCase.query.filter_by(folder_id=child_folder.folder_id).all()
                for case in child_cases:
                    db.session.delete(case)
                    deleted_cases_count += 1
                    current_app.logger.info(f'🗑️ 删除用例: {case.name} (ID: {case.case_id})')
                
                # 删除子文件夹
                db.session.delete(child_folder)
                deleted_folders_count += 1
                current_app.logger.info(f'🗑️ 删除子文件夹: {child_folder.name} (ID: {child_folder.folder_id})')
        
        # 删除当前文件夹的所有子文件夹
        delete_child_folders(folder_id)
        
        # 删除当前文件夹内的所有用例
        cases_in_folder = TestCase.query.filter_by(folder_id=folder_id).all()
        for case in cases_in_folder:
            db.session.delete(case)
            deleted_cases_count += 1
            current_app.logger.info(f'🗑️ 删除用例: {case.name} (ID: {case.case_id})')
        
        # 删除当前文件夹
        folder_name = folder.name
        db.session.delete(folder)
        deleted_folders_count += 1
        
        db.session.commit()
        
        current_app.logger.info(f'✅ 文件夹删除成功: {folder_name}，共删除 {deleted_folders_count} 个文件夹，{deleted_cases_count} 个用例')
        
        return jsonify({
            'message': '文件夹删除成功',
            'deleted_folders': deleted_folders_count,
            'deleted_cases': deleted_cases_count
        })
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f'❌ 文件夹删除失败: {str(e)}')
        return jsonify({'error': f'文件夹删除失败: {str(e)}'}), 500

@bp.route('/folders/tree', methods=['GET'])
def get_folder_tree():
    current_app.logger.info('📁 获取文件夹树形结构请求')
    
    folders = Folder.query.order_by(Folder.created_at.desc()).all()
    
    folder_dict = {}
    root_folders = []
    
    for folder in folders:
        folder_dict[folder.folder_id] = {
            'id': folder.id,
            'folder_id': folder.folder_id,
            'name': folder.name,
            'parent_id': folder.parent_id,
            'created_at': folder.created_at.isoformat(),
            'updated_at': folder.updated_at.isoformat(),
            'children': []
        }
    
    for folder in folders:
        if folder.parent_id and folder.parent_id in folder_dict:
            folder_dict[folder.parent_id]['children'].append(folder_dict[folder.folder_id])
        else:
            root_folders.append(folder_dict[folder.folder_id])
    
    current_app.logger.info(f'📁 构建树形结构完成，根级文件夹: {len(root_folders)} 个')
    
    return jsonify({
        'folders': root_folders,
        'total': len(folders)
    })

