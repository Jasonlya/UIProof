from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
import uuid
import json

db = SQLAlchemy()


class TestCase(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    case_id = db.Column(db.String(36), unique=True, nullable=False, default=lambda: str(uuid.uuid4()))
    name = db.Column(db.String(200), nullable=False)
    description = db.Column(db.Text)
    category = db.Column(db.String(100))
    tags = db.Column(db.String(500))
    steps = db.Column(db.Text)  # JSON 字符串，存储步骤数据
    expected = db.Column(db.Text)  # 预期结果（AI 断言用）
    priority = db.Column(db.String(10), default='P1')
    status = db.Column(db.String(20), default='active')
    folder_id = db.Column(db.String(100), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    execution_count = db.Column(db.Integer, default=0)
    last_executed = db.Column(db.DateTime)
    success_rate = db.Column(db.Float, default=0.0)

    # 新增：用于 AI 执行的配置
    setup_steps = db.Column(db.Text)  # JSON 字符串，前置条件步骤
    base_url = db.Column(db.String(500))  # 用例专属起始 URL

    def get_steps(self) -> list:
        """解析 steps JSON 为列表"""
        if not self.steps:
            return []
        try:
            return json.loads(self.steps)
        except (json.JSONDecodeError, TypeError):
            # 兼容旧格式：分号分隔的文本
            return [s.strip() for s in self.steps.split(';') if s.strip()]

    def set_steps(self, steps_list: list):
        """将步骤列表存为 JSON"""
        self.steps = json.dumps(steps_list, ensure_ascii=False)

    def get_setup_steps(self) -> list:
        """解析 setup_steps JSON"""
        if not self.setup_steps:
            return []
        try:
            return json.loads(self.setup_steps)
        except (json.JSONDecodeError, TypeError):
            return [s.strip() for s in self.setup_steps.split(';') if s.strip()]

    def set_setup_steps(self, steps_list: list):
        self.setup_steps = json.dumps(steps_list, ensure_ascii=False)

    def to_execution_dict(self) -> dict:
        """转换为 Pipeline 执行所需的字典格式"""
        return {
            "id": self.case_id,
            "name": self.name,
            "steps": self.get_steps(),
            "expected": self.expected or "",
            "priority": self.priority,
            "setup_steps": self.get_setup_steps(),
            "base_url": self.base_url,
        }


class Folder(db.Model):
    __tablename__ = 'folders'
    id = db.Column(db.Integer, primary_key=True)
    folder_id = db.Column(db.String(100), unique=True, nullable=False)
    name = db.Column(db.String(200), nullable=False)
    parent_id = db.Column(db.String(100), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class ExecutionLog(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    case_id = db.Column(db.String(36), nullable=False)
    status = db.Column(db.String(20), nullable=False)
    start_time = db.Column(db.DateTime, default=datetime.utcnow)
    end_time = db.Column(db.DateTime)
    error_message = db.Column(db.Text)
    execution_data = db.Column(db.Text)

    # 新增字段
    task_id = db.Column(db.String(64))  # 异步执行任务 ID
    steps_result = db.Column(db.Text)  # 每步执行结果 JSON
    llm_usage = db.Column(db.Text)  # LLM token 用量 JSON
    config_snapshot = db.Column(db.Text)  # 执行时的配置快照 JSON
    video_path = db.Column(db.String(500))  # 录屏文件路径
    final_result = db.Column(db.String(20))  # pass/fail/error/uncertain

    def get_steps_result(self) -> list:
        if not self.steps_result:
            return []
        try:
            return json.loads(self.steps_result)
        except (json.JSONDecodeError, TypeError):
            return []

    def set_steps_result(self, results: list):
        self.steps_result = json.dumps(results, ensure_ascii=False)

    def get_llm_usage(self) -> list:
        if not self.llm_usage:
            return []
        try:
            return json.loads(self.llm_usage)
        except (json.JSONDecodeError, TypeError):
            return []

    def set_llm_usage(self, usages: list):
        # LLMUsage 对象转 dict
        data = []
        for u in usages:
            if hasattr(u, '__dict__'):
                data.append({k: v for k, v in vars(u).items()})
            elif isinstance(u, dict):
                data.append(u)
        self.llm_usage = json.dumps(data, ensure_ascii=False)


class StepSnapshot(db.Model):
    """步骤截图 — 录制和执行时的截图存储"""
    id = db.Column(db.Integer, primary_key=True)
    snapshot_id = db.Column(db.String(64), unique=True, nullable=False, default=lambda: str(uuid.uuid4())[:16])
    case_id = db.Column(db.String(36))
    execution_id = db.Column(db.String(64), nullable=True)  # ExecutionLog.task_id
    step_index = db.Column(db.Integer)
    phase = db.Column(db.String(16))  # 'record' | 'execute' | 'assert'
    screenshot_path = db.Column(db.String(256))
    ai_description = db.Column(db.Text)  # Vision Agent 生成的元素描述
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
