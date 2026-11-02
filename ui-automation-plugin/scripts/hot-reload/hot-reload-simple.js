const chokidar = require('chokidar');
const path = require('path');
const fs = require('fs');

const PLUGIN_DIR = path.resolve(__dirname, '../..');
const EXTENSION_ID_FILE = path.join(PLUGIN_DIR, '.extension-id');

console.log('🚀 插件热更新工具');
console.log('📁 监听目录:', PLUGIN_DIR);
console.log('');

function getExtensionId() {
  if (fs.existsSync(EXTENSION_ID_FILE)) {
    return fs.readFileSync(EXTENSION_ID_FILE, 'utf8').trim();
  }
  return null;
}

function showReloadInstructions(extensionId) {
  console.log('═══════════════════════════════════════');
  console.log('🔄 检测到文件变化，请重新加载扩展');
  console.log('═══════════════════════════════════════');
  if (extensionId) {
    console.log('📦 扩展ID:', extensionId);
  }
  console.log('');
  console.log('💡 重新加载步骤：');
  console.log('   1. 打开 chrome://extensions/');
  console.log('   2. 找到 "UI自动化插件"');
  console.log('   3. 点击刷新按钮 🔄');
  console.log('');
  console.log('💡 或者使用快捷键：');
  console.log('   - 在扩展管理页面按 Ctrl+R (Windows/Linux)');
  console.log('   - 或 Cmd+R (Mac)');
  console.log('');
  console.log('💡 快速访问：');
  console.log('   chrome://extensions/?id=' + (extensionId || '你的扩展ID'));
  console.log('');
}

const extensionId = getExtensionId();

if (!extensionId) {
  console.log('⚠️  未找到扩展ID');
  console.log('');
  console.log('📋 请先设置扩展ID：');
  console.log('   1. 打开 chrome://extensions/');
  console.log('   2. 找到 "UI自动化插件" 扩展');
  console.log('   3. 复制扩展ID');
  console.log('   4. 运行命令：');
  console.log('      echo "你的扩展ID" > .extension-id');
  console.log('');
  console.log('💡 或者手动创建 .extension-id 文件并写入扩展ID');
  console.log('');
}

const watcher = chokidar.watch(PLUGIN_DIR, {
  ignored: [
    /(^|[\/\\])\../,
    /node_modules/,
    /\.extension-id$/,
    /\.git/,
    /package.*\.json$/,
    /hot-reload.*\.js$/,
    /README.*\.md$/,
    /\.log$/,
    /\.DS_Store$/
  ],
  persistent: true,
  ignoreInitial: true
});

let reloadTimer = null;

watcher
  .on('change', (filePath) => {
    const relativePath = path.relative(PLUGIN_DIR, filePath);
    const fileName = path.basename(filePath);
    
    console.log(`📝 [${new Date().toLocaleTimeString()}] 文件已修改: ${relativePath}`);
    
    if (reloadTimer) {
      clearTimeout(reloadTimer);
    }
    
    reloadTimer = setTimeout(() => {
      console.log('');
      showReloadInstructions(extensionId);
    }, 300);
  })
  .on('add', (filePath) => {
    const relativePath = path.relative(PLUGIN_DIR, filePath);
    console.log(`➕ [${new Date().toLocaleTimeString()}] 新文件: ${relativePath}`);
  })
  .on('unlink', (filePath) => {
    const relativePath = path.relative(PLUGIN_DIR, filePath);
    console.log(`🗑️  [${new Date().toLocaleTimeString()}] 文件已删除: ${relativePath}`);
  })
  .on('error', (error) => {
    console.error('❌ 监听错误:', error);
  });

console.log('✅ 文件监听已启动');
console.log('💡 修改任何插件文件后，将提示重新加载扩展');
console.log('💡 按 Ctrl+C 停止监听');
console.log('');

