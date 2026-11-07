from flask import Blueprint, request, jsonify, current_app
from datetime import datetime
import json
from models.models import TestCase, ExecutionLog, db
from services.step_schema import StepValidationError, dump_steps, normalize_steps

bp = Blueprint('cases', __name__, url_prefix='/api')

@bp.route('/cases', methods=['GET'])
def get_cases():
    current_app.logger.info('=' * 50)
    current_app.logger.info('📋 获取用例列表请求')
    current_app.logger.info(f'请求方法: {request.method}')
    current_app.logger.info(f'请求URL: {request.url}')
    current_app.logger.info(f'请求参数: {dict(request.args)}')
    current_app.logger.info(f'请求头: {dict(request.headers)}')
    current_app.logger.info(f'客户端IP: {request.remote_addr}')
    current_app.logger.info(f'用户代理: {request.headers.get("User-Agent", "未知")}')
    
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 10, type=int)
    category = request.args.get('category', '')
    status = request.args.get('status', '')
    search = request.args.get('search', '')
    sort_by = request.args.get('sort_by', 'created_at')
    sort_order = request.args.get('sort_order', 'desc')
    
    current_app.logger.info(f'解析参数 - 页码: {page}, 每页: {per_page}, 分类: {category}, 状态: {status}, 搜索: {search}, 排序: {sort_by} {sort_order}')
    
    query = TestCase.query
    
    if category:
        query = query.filter_by(category=category)
        current_app.logger.info(f'应用分类过滤: {category}')
    
    if status:
        query = query.filter_by(status=status)
        current_app.logger.info(f'应用状态过滤: {status}')
    
    if search:
        query = query.filter(TestCase.name.contains(search))
        current_app.logger.info(f'应用搜索过滤: {search}')
    
    if sort_by == 'name':
        order_column = TestCase.name
    elif sort_by == 'updated_at':
        order_column = TestCase.updated_at
    elif sort_by == 'execution_count':
        order_column = TestCase.execution_count
    else:
        order_column = TestCase.created_at
    
    if sort_order == 'asc':
        query = query.order_by(order_column.asc())
    else:
        query = query.order_by(order_column.desc())
    
    current_app.logger.info(f'应用排序: {sort_by} {sort_order}')
    
    cases = query.paginate(
        page=page, per_page=per_page, error_out=False
    )
    
    current_app.logger.info(f'查询结果 - 总数: {cases.total}, 当前页: {cases.page}, 总页数: {cases.pages}')
    current_app.logger.info(f'返回 {len(cases.items)} 个用例')
    
    for i, case in enumerate(cases.items):
        current_app.logger.info(f'用例 {i+1}: ID={case.case_id}, 名称={case.name}, 分类={case.category}, 步骤数={len(case.steps) if case.steps else 0}')
    
    response_data = {
        'cases': [{
            'id': case.id,
            'case_id': case.case_id,
            'name': case.name,
            'description': case.description,
            'category': case.category,
            'tags': case.tags,
            'status': case.status,
            'folder_id': case.folder_id,
            'created_at': case.created_at.isoformat(),
            'updated_at': case.updated_at.isoformat(),
            'execution_count': case.execution_count,
            'last_executed': case.last_executed.isoformat() if case.last_executed else None,
            'success_rate': case.success_rate
        } for case in cases.items],
        'total': cases.total,
        'pages': cases.pages,
        'current_page': page
    }
    
    current_app.logger.info('📤 响应数据:')
    current_app.logger.info(f'状态码: 200')
    current_app.logger.info(f'响应体大小: {len(str(response_data))} 字符')
    current_app.logger.info(f'用例数量: {len(response_data["cases"])}')
    current_app.logger.info(f'分页信息: 第{response_data["current_page"]}页/共{response_data["pages"]}页, 总计{response_data["total"]}条')
    
    for i, case_data in enumerate(response_data['cases']):
        current_app.logger.info(f'用例 {i+1}: {case_data["name"]} (分类: {case_data["category"]})')
    
    current_app.logger.info('=' * 50)
    
    return jsonify(response_data)

@bp.route('/cases', methods=['POST'])
def create_case():
    current_app.logger.info('=' * 50)
    current_app.logger.info('➕ 创建用例请求')
    current_app.logger.info(f'请求方法: {request.method}')
    current_app.logger.info(f'请求URL: {request.url}')
    current_app.logger.info(f'请求头: {dict(request.headers)}')
    current_app.logger.info(f'客户端IP: {request.remote_addr}')
    current_app.logger.info(f'用户代理: {request.headers.get("User-Agent", "未知")}')
    
    data = request.get_json()
    current_app.logger.info(f'请求体: {data}')
    current_app.logger.info(f'请求体大小: {len(str(data)) if data else 0} 字符')
    
    if not data or not data.get('name'):
        current_app.logger.warning('❌ 创建用例失败: 用例名称不能为空')
        current_app.logger.warning('=' * 50)
        return jsonify({'error': '用例名称不能为空'}), 400
    
    current_app.logger.info(f'✅ 验证通过 - 名称: {data.get("name")}, 描述: {data.get("description", "无")}, 分类: {data.get("category", "默认")}, 标签: {data.get("tags", "无")}')
    
    try:
        normalized_steps = normalize_steps(data.get('steps', '[]'))
    except StepValidationError as exc:
        current_app.logger.warning(f'步骤数据校验失败: {exc}')
        return jsonify({'error': str(exc)}), 400

    current_app.logger.info(f'步骤数据校验通过 - 步骤数: {len(normalized_steps)}')
    
    case = TestCase(
        name=data['name'],
        description=data.get('description', ''),
        category=data.get('category', 'default'),
        tags=data.get('tags', ''),
        steps=dump_steps(normalized_steps),
        folder_id=data.get('folder_id', None)
    )
    
    db.session.add(case)
    db.session.commit()
    
    current_app.logger.info(f'✅ 用例创建成功 - ID: {case.case_id}, 名称: {case.name}')
    current_app.logger.info(f'数据库ID: {case.id}')
    current_app.logger.info(f'创建时间: {case.created_at}')
    current_app.logger.info(f'步骤数据: {case.steps}')
    
    response_data = {
        'message': '用例创建成功',
        'steps_count': len(normalized_steps),
        'case': {
            'id': case.id,
            'case_id': case.case_id,
            'name': case.name,
            'description': case.description,
            'category': case.category,
            'tags': case.tags,
            'steps': case.steps,
            'steps_count': len(normalized_steps),
            'status': case.status,
            'created_at': case.created_at.isoformat()
        }
    }
    
    current_app.logger.info('📤 响应数据:')
    current_app.logger.info(f'状态码: 201')
    current_app.logger.info(f'响应体: {response_data}')
    current_app.logger.info('=' * 50)
    
    return jsonify(response_data), 201

@bp.route('/cases/<case_id>', methods=['GET'])
def get_case(case_id):
    current_app.logger.info('=' * 50)
    current_app.logger.info('📋 获取单个用例详情')
    current_app.logger.info(f'请求方法: {request.method}')
    current_app.logger.info(f'请求URL: {request.url}')
    current_app.logger.info(f'用例ID: {case_id}')
    current_app.logger.info(f'请求头: {dict(request.headers)}')
    current_app.logger.info(f'客户端IP: {request.remote_addr}')
    current_app.logger.info(f'用户代理: {request.headers.get("User-Agent", "未知")}')
    
    case = TestCase.query.filter_by(case_id=case_id).first()
    
    if not case:
        current_app.logger.warning(f'❌ 用例不存在: {case_id}')
        current_app.logger.warning('=' * 50)
        return jsonify({'error': '用例不存在'}), 404
    
    current_app.logger.info(f'✅ 找到用例: {case.name}')
    current_app.logger.info(f'用例步骤数据长度: {len(case.steps) if case.steps else 0} 字符')
    
    response_data = {
        'id': case.id,
        'case_id': case.case_id,
        'name': case.name,
        'description': case.description,
        'category': case.category,
        'tags': case.tags,
        'steps': case.steps,
        'status': case.status,
        'folder_id': case.folder_id,
        'created_at': case.created_at.isoformat(),
        'updated_at': case.updated_at.isoformat(),
        'execution_count': case.execution_count,
        'last_executed': case.last_executed.isoformat() if case.last_executed else None,
        'success_rate': case.success_rate
    }
    
    current_app.logger.info('📤 响应数据:')
    current_app.logger.info(f'状态码: 200')
    current_app.logger.info(f'响应体大小: {len(str(response_data))} 字符')
    current_app.logger.info(f'步骤数据长度: {len(case.steps) if case.steps else 0} 字符')
    current_app.logger.info('=' * 50)
    
    return jsonify(response_data)

@bp.route('/cases/<case_id>', methods=['PUT'])
def update_case(case_id):
    current_app.logger.info('=' * 50)
    current_app.logger.info('🔄 更新用例请求')
    current_app.logger.info(f'请求方法: {request.method}')
    current_app.logger.info(f'请求URL: {request.url}')
    current_app.logger.info(f'用例ID: {case_id}')
    current_app.logger.info(f'请求头: {dict(request.headers)}')
    current_app.logger.info(f'客户端IP: {request.remote_addr}')
    current_app.logger.info(f'用户代理: {request.headers.get("User-Agent", "未知")}')
    
    case = TestCase.query.filter_by(case_id=case_id).first()
    
    if not case:
        current_app.logger.warning(f'❌ 用例不存在: {case_id}')
        current_app.logger.warning('=' * 50)
        return jsonify({'error': '用例不存在'}), 404
    
    current_app.logger.info(f'✅ 找到用例: {case.name}')
    
    data = request.get_json()
    current_app.logger.info(f'请求体: {data}')
    current_app.logger.info(f'请求体大小: {len(str(data)) if data else 0} 字符')
    if not isinstance(data, dict):
        return jsonify({'error': '请求体必须是 JSON 对象'}), 400

    normalized_steps = None
    if 'steps' in data:
        try:
            normalized_steps = normalize_steps(data.get('steps'))
        except StepValidationError as exc:
            current_app.logger.warning(f'步骤数据校验失败: {exc}')
            return jsonify({'error': str(exc)}), 400
    
    if 'name' in data:
        case.name = data['name']
    if 'description' in data:
        case.description = data['description']
    if 'category' in data:
        case.category = data['category']
    if 'tags' in data:
        case.tags = data['tags']
    if 'steps' in data:
        case.steps = dump_steps(normalized_steps or [])
    if 'status' in data:
        case.status = data['status']
    if 'folder_id' in data:
        case.folder_id = data['folder_id']
    
    case.updated_at = datetime.utcnow()
    db.session.commit()
    
    current_app.logger.info(f'✅ 用例更新成功 - ID: {case.case_id}, 名称: {case.name}')
    current_app.logger.info(f'更新后步骤数据: {case.steps}')
    
    response_data = {
        'message': '用例更新成功',
        'steps_count': len(normalized_steps) if normalized_steps is not None else len(case.get_steps())
    }
    current_app.logger.info('📤 响应数据:')
    current_app.logger.info(f'状态码: 200')
    current_app.logger.info(f'响应体: {response_data}')
    current_app.logger.info('=' * 50)
    
    return jsonify(response_data)

@bp.route('/cases/<case_id>', methods=['DELETE'])
def delete_case(case_id):
    case = TestCase.query.filter_by(case_id=case_id).first()
    
    if not case:
        return jsonify({'error': '用例不存在'}), 404
    
    db.session.delete(case)
    db.session.commit()
    
    return jsonify({'message': '用例删除成功'})

@bp.route('/cases/<case_id>/execute', methods=['POST'])
def execute_case(case_id):
    return jsonify({
        'error': 'deprecated',
        'message': 'Use POST /api/runs to create a run and POST /api/runs/<run_id>/finish to finish it.'
    }), 410

@bp.route('/cases/<case_id>/executions', methods=['GET'])
def get_case_executions(case_id):
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 10, type=int)
    
    executions = ExecutionLog.query.filter_by(
        case_id=case_id
    ).order_by(ExecutionLog.start_time.desc()).paginate(
        page=page, per_page=per_page, error_out=False
    )

    def normalized_status(status):
        return 'passed' if status in ('success', 'completed') else status
    
    return jsonify({
        'executions': [{
            'id': exec.id,
            'run_id': exec.run_id,
            'status': normalized_status(exec.status),
            'executor': exec.executor,
            'perf_mode': exec.perf_mode,
            'steps_total': exec.steps_total or 0,
            'steps_passed': exec.steps_passed or 0,
            'steps_failed': exec.steps_failed or 0,
            'start_time': exec.start_time.isoformat() if exec.start_time else None,
            'end_time': exec.end_time.isoformat() if exec.end_time else None,
            'error_message': exec.error_message,
            'execution_data': exec.execution_data
        } for exec in executions.items],
        'total': executions.total,
        'pages': executions.pages,
        'current_page': page
    })

@bp.route('/categories', methods=['GET'])
def get_categories():
    categories = db.session.query(TestCase.category).distinct().all()

    return jsonify([cat[0] for cat in categories if cat[0]])


@bp.route('/cases/<case_id>/heal-step', methods=['PATCH'])
def heal_step(case_id):
    """
    AI 自愈成功后，将修复后的选择器写回指定步骤。

    请求体:
    {
        "stepIndex":         0,           // 步骤下标（0-based）
        "selector":          "新选择器",
        "selectorFallbacks": [...]        // 可选，同步更新 fallback
    }
    """
    case = TestCase.query.filter_by(case_id=case_id).first()
    if not case:
        return jsonify({'error': '用例不存在'}), 404

    data = request.get_json(silent=True) or {}
    step_index = data.get('stepIndex')
    new_selector = data.get('selector', '')
    new_fallbacks = data.get('selectorFallbacks')

    if step_index is None or not new_selector:
        return jsonify({'error': '缺少 stepIndex 或 selector'}), 400

    try:
        steps = json.loads(case.steps) if isinstance(case.steps, str) else (case.steps or [])
    except Exception:
        return jsonify({'error': '步骤数据解析失败'}), 500

    if not (0 <= step_index < len(steps)):
        return jsonify({'error': f'stepIndex {step_index} 超出范围'}), 400

    old_selector = steps[step_index].get('selector', '')
    steps[step_index]['selector'] = new_selector
    if new_fallbacks is not None:
        steps[step_index]['selectorFallbacks'] = new_fallbacks

    case.steps = json.dumps(steps, ensure_ascii=False)
    case.updated_at = datetime.utcnow()
    db.session.commit()

    current_app.logger.info(
        f"[AI自愈] 用例 {case_id} 步骤[{step_index}] 选择器更新: {old_selector!r} → {new_selector!r}"
    )

    return jsonify({'ok': True, 'message': '选择器已更新', 'stepIndex': step_index, 'selector': new_selector})

