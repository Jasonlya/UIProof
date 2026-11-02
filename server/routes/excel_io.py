# server/routes/excel_io.py
"""Excel 导入导出路由 — 支持标准 Excel 用例模板"""
from flask import Blueprint, request, jsonify, send_file
from models.models import db, TestCase
import json
import logging
import os
import tempfile

logger = logging.getLogger(__name__)

bp = Blueprint('excel_io', __name__, url_prefix='/api/excel')


@bp.route('/import', methods=['POST'])
def import_excel():
    """导入 Excel 用例文件"""
    if 'file' not in request.files:
        return jsonify({"error": "请上传 Excel 文件"}), 400

    file = request.files['file']
    if not file.filename.endswith(('.xlsx', '.xls')):
        return jsonify({"error": "仅支持 .xlsx / .xls 格式"}), 400

    folder_id = request.form.get("folder_id")

    try:
        import pandas as pd

        # 读取 Excel
        df = pd.read_excel(file, sheet_name=0)

        # 尝试映射列名
        col_map = _detect_columns(df.columns.tolist())

        imported = []
        errors = []

        for idx, row in df.iterrows():
            try:
                name = _get_value(row, col_map, 'name') or f"导入用例 {idx+1}"
                steps_text = _get_value(row, col_map, 'steps') or ""
                expected = _get_value(row, col_map, 'expected') or ""
                priority = _get_value(row, col_map, 'priority') or "P1"
                setup = _get_value(row, col_map, 'setup') or ""

                # 将步骤文本转为步骤列表
                steps = _parse_steps_text(str(steps_text))
                setup_steps = _parse_steps_text(str(setup)) if setup else []

                case = TestCase(
                    name=name,
                    description=name,
                    expected=expected,
                    priority=priority,
                    folder_id=folder_id,
                    status="active",
                )
                case.set_steps(steps)
                if setup_steps:
                    case.set_setup_steps(setup_steps)

                db.session.add(case)
                imported.append({"name": name, "steps_count": len(steps)})
            except Exception as e:
                errors.append(f"第 {idx+1} 行: {str(e)}")

        db.session.commit()

        return jsonify({
            "imported": imported,
            "imported_count": len(imported),
            "errors": errors,
        })

    except Exception as e:
        logger.error(f"Excel 导入失败: {e}")
        return jsonify({"error": str(e)}), 500


@bp.route('/export/<case_id>')
def export_excel(case_id):
    """导出单条用例为 Excel"""
    case = TestCase.query.filter_by(case_id=case_id).first()
    if not case:
        return jsonify({"error": "用例不存在"}), 404

    return _export_cases_to_excel([case])


@bp.route('/export-batch', methods=['POST'])
def export_batch():
    """批量导出用例为 Excel"""
    data = request.get_json() or {}
    case_ids = data.get("case_ids", [])
    folder_id = data.get("folder_id")

    if folder_id:
        cases = TestCase.query.filter_by(folder_id=folder_id).all()
    elif case_ids:
        cases = TestCase.query.filter(TestCase.case_id.in_(case_ids)).all()
    else:
        return jsonify({"error": "请提供 case_ids 或 folder_id"}), 400

    return _export_cases_to_excel(cases)


def _export_cases_to_excel(cases):
    """将用例列表导出为 Excel 文件"""
    import pandas as pd

    rows = []
    for case in cases:
        steps = case.get_steps()
        # 将步骤转回文本格式
        if steps and isinstance(steps[0], dict):
            steps_text = "; ".join(
                f"{s.get('type','click')} {s.get('description','') or s.get('selector','')}"
                for s in steps
            )
        else:
            steps_text = "; ".join(str(s) for s in steps)

        setup_steps = case.get_setup_steps()
        setup_text = "; ".join(str(s) for s in setup_steps) if setup_steps else ""

        rows.append({
            "用例描述": case.name,
            "操作步骤": steps_text,
            "预期结果": case.expected or "",
            "优先级": case.priority,
            "前置条件": setup_text,
            "状态": case.status,
        })

    df = pd.DataFrame(rows)

    with tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False) as tmp:
        df.to_excel(tmp.name, index=False, sheet_name="测试用例")
        return send_file(
            tmp.name,
            as_attachment=True,
            download_name=f"test_cases_{len(cases)}.xlsx",
            mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        )


def _detect_columns(columns):
    """自动检测 Excel 列名映射"""
    col_map = {}
    name_keywords = ['用例描述', '用例名称', 'name', 'case_name', '标题']
    steps_keywords = ['操作步骤', 'steps', '步骤', '操作']
    expected_keywords = ['预期结果', 'expected', '预期', '期望']
    priority_keywords = ['优先级', 'priority']
    setup_keywords = ['前置条件', 'setup', '前置']

    for col in columns:
        col_lower = str(col).lower().strip()
        for kw in name_keywords:
            if kw in col_lower:
                col_map['name'] = col
                break
        for kw in steps_keywords:
            if kw in col_lower:
                col_map['steps'] = col
                break
        for kw in expected_keywords:
            if kw in col_lower:
                col_map['expected'] = col
                break
        for kw in priority_keywords:
            if kw in col_lower:
                col_map['priority'] = col
                break
        for kw in setup_keywords:
            if kw in col_lower:
                col_map['setup'] = col
                break

    return col_map


def _get_value(row, col_map, key):
    """从 DataFrame 行中获取映射列的值"""
    col = col_map.get(key)
    if col and col in row.index:
        val = row[col]
        if not (isinstance(val, float) != bool and val != val):  # NaN check
            return str(val)
    return None


def _parse_steps_text(text: str) -> list:
    """将文本步骤解析为列表

    支持格式:
    - 分号分隔: "打开 url; 点击 登录; 输入 用户名"
    - 编号列表: "1. 打开 url\n2. 点击 登录"
    - JSON 数组: [{"type":"click",...}]
    """
    text = text.strip()
    if not text:
        return []

    # 尝试 JSON 解析
    try:
        parsed = json.loads(text)
        if isinstance(parsed, list):
            return parsed
    except (json.JSONDecodeError, TypeError):
        pass

    # 分号分隔
    if ';' in text:
        return [s.strip() for s in text.split(';') if s.strip()]

    # 换行分隔（可能带编号）
    lines = text.split('\n')
    import re
    result = []
    for line in lines:
        line = re.sub(r'^\d+\.\s*', '', line.strip())
        if line:
            result.append(line)

    return result
