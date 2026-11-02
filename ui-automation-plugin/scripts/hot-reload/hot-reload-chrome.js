const chokidar = require('chokidar');
const path = require('path');
const fs = require('fs');
const http = require('http');

const PLUGIN_DIR = path.resolve(__dirname, '../..');
const EXTENSION_ID_FILE = path.join(PLUGIN_DIR, '.extension-id');
const HOT_RELOAD_PORT = 9999;

let extensionId = null;

function getExtensionId() {
  if (fs.existsSync(EXTENSION_ID_FILE)) {
    const id = fs.readFileSync(EXTENSION_ID_FILE, 'utf8').trim();
    if (id) {
      return id;
    }
  }
  return null;
}

function createHotReloadServer() {
  const server = http.createServer((req, res) => {
    if (req.url === '/reload' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, message: '重新加载请求已发送' }));
      
      console.log('🔄 收到重新加载请求');
      triggerReload();
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });

  server.listen(HOT_RELOAD_PORT, () => {
    console.log(`🌐 热更新服务器已启动: http://localhost:${HOT_RELOAD_PORT}`);
    console.log('💡 扩展可以通过此服务器接收重新加载指令');
  });

  return server;
}

function triggerReload() {
  if (!extensionId) {
    console.log('⚠️  未找到扩展ID');
    return;
  }

  console.log('🔄 触发扩展重新加载...');
  console.log('💡 请在扩展管理页面手动点击刷新按钮');
  console.log(`   或访问 chrome://extensions/ 找到扩展ID: ${extensionId}`);
}

function watchFiles() {
  console.log('👀 开始监听文件变化...');
  console.log('📁 监听目录:', PLUGIN_DIR);
  console.log('');

  const watcher = chokidar.watch(PLUGIN_DIR, {
    ignored: [
      /(^|[\/\\])\../,
      /node_modules/,
      /\.extension-id$/,
      /\.git/,
      /package\.json$/,
      /hot-reload.*\.js$/,
      /\.log$/
    ],
    persistent: true,
    ignoreInitial: true
  });

  let reloadTimer = null;

  watcher
    .on('change', (filePath) => {
      const fileName = path.basename(filePath);
      const relativePath = path.relative(PLUGIN_DIR, filePath);
      console.log(`📝 文件已修改: ${relativePath}`);
      
      if (reloadTimer) {
        clearTimeout(reloadTimer);
      }
      
      reloadTimer = setTimeout(() => {
        console.log('');
        triggerReload();
        console.log('');
      }, 500);
    })
    .on('error', (error) => {
      console.error('❌ 监听错误:', error);
    });

  console.log('✅ 文件监听已启动');
  console.log('💡 修改任何插件文件后，将提示重新加载扩展');
  console.log('💡 按 Ctrl+C 停止监听');
  console.log('');
}

function main() {
  extensionId = getExtensionId();
  
  if (!extensionId) {
    console.log('⚠️  未找到扩展ID');
    console.log('💡 请将扩展ID保存到文件:', EXTENSION_ID_FILE);
    console.log('   例如: echo "abcdefghijklmnopqrstuvwxyz123456" > .extension-id');
    console.log('');
  } else {
    console.log('📦 扩展ID:', extensionId);
  }

  console.log('🚀 插件热更新工具启动');
  console.log('');

  createHotReloadServer();
  watchFiles();
}

if (require.main === module) {
  main();
}

module.exports = { watchFiles, triggerReload };

