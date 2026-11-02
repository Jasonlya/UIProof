#!/bin/bash

echo "🚀 设置插件热更新工具"
echo ""

# 检查是否已安装 Node.js
if ! command -v node &> /dev/null; then
    echo "❌ 未找到 Node.js，请先安装 Node.js"
    echo "   访问: https://nodejs.org/"
    exit 1
fi

echo "✅ Node.js 版本: $(node --version)"
echo ""

# 检查是否已安装 npm
if ! command -v npm &> /dev/null; then
    echo "❌ 未找到 npm，请先安装 npm"
    exit 1
fi

echo "✅ npm 版本: $(npm --version)"
echo ""

# 安装依赖
echo "📦 正在安装依赖..."
npm install

if [ $? -ne 0 ]; then
    echo "❌ 依赖安装失败"
    exit 1
fi

echo "✅ 依赖安装完成"
echo ""

# 检查扩展ID
if [ ! -f ".extension-id" ]; then
    echo "⚠️  未找到扩展ID文件"
    echo ""
    echo "📋 请按照以下步骤获取扩展ID："
    echo "   1. 打开 Chrome 浏览器"
    echo "   2. 访问 chrome://extensions/"
    echo "   3. 找到 'UI自动化插件' 扩展"
    echo "   4. 复制扩展ID（类似：abcdefghijklmnopqrstuvwxyz123456）"
    echo "   5. 运行以下命令保存ID："
    echo "      echo '你的扩展ID' > .extension-id"
    echo ""
    echo "💡 或者手动创建 .extension-id 文件并写入扩展ID"
    echo ""
else
    EXTENSION_ID=$(cat .extension-id | tr -d '\n' | tr -d ' ')
    if [ -z "$EXTENSION_ID" ]; then
        echo "⚠️  扩展ID文件为空"
        echo "   请编辑 .extension-id 文件并写入扩展ID"
    else
        echo "✅ 已找到扩展ID: $EXTENSION_ID"
    fi
    echo ""
fi

echo "🎉 设置完成！"
echo ""
echo "💡 使用方法："
echo "   npm run dev"
echo "   或"
echo "   node scripts/hot-reload/hot-reload-simple.js"
echo ""
echo "💡 修改插件文件后，工具会自动提示重新加载扩展"
echo ""

