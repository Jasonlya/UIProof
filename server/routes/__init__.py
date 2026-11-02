from flask import Blueprint


def register_routes(app):
    from . import health, cases, folders, ai_heal
    from . import execution, recording, ai_service, excel_io

    app.register_blueprint(health.bp)
    app.register_blueprint(cases.bp)
    app.register_blueprint(folders.bp)
    app.register_blueprint(ai_heal.bp)

    # 新增路由
    app.register_blueprint(execution.bp)
    app.register_blueprint(recording.bp)
    app.register_blueprint(ai_service.bp)
    app.register_blueprint(excel_io.bp)
