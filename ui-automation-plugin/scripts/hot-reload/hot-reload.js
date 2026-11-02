const chokidar = require('chokidar');
const path = require('path');
const fs = require('fs');

const PLUGIN_DIR = path.resolve(__dirname, '../..');
const EXTENSION_ID_FILE = path.join(PLUGIN_DIR, '.extension-id');

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

function saveExtensionId(id) {
  fs.writeFileSync(EXTENSION_ID_FILE, id, 'utf8');
}

function findExtensionId() {
  const manifestPath = path.join(PLUGIN_DIR, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.error('❌ 找不到 manifest.json');
    return null;
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const manifestName = manifest.name || 'UI自动化插件';

  console.log('📋 请按照以下步骤获取扩展ID：');
  console.log('1. 打开 Chrome 浏览器');
  console.log('2. 访问 chrome://extensions/');
  console.log('3. 找到 "' + manifestName + '" 扩展');
  console.log('4. 复制扩展ID（类似：lnjphhnnalmnbhnjdkmolffppmimpojg）');
  console.log('5. 将ID保存到文件：' + EXTENSION_ID_FILE);
  console.log('\n或者运行以下命令自动获取：');
  console.log('  在扩展管理页面打开开发者工具，执行：');
  console.log('  chrome.management.getAll((extensions) => {');
  console.log('    const ext = extensions.find(e => e.name === "' + manifestName + '");');
  console.log('    console.log(ext.id);');
  console.log('  });');
  console.log('\n然后将ID写入文件：');
  console.log('  echo "你的扩展ID" > ' + EXTENSION_ID_FILE);

  return null;
}

function reloadExtension(extensionId) {
  if (!extensionId) {
    console.log('⚠️  未找到扩展ID，请先设置扩展ID');
    return;
  }

  const chromePath = process.platform === 'darwin' 
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : process.platform === 'win32'
    ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    : 'google-chrome';

  console.log('🔄 正在重新加载扩展...');
  
  const { exec } = require('child_process');
  
  if (process.platform === 'darwin') {
    exec(`osascript -e 'tell application "Google Chrome" to reload extension "${extensionId}"'`, (error) => {
      if (error) {
        console.log('⚠️  AppleScript 方式失败，尝试使用 Chrome Management API...');
        console.log('💡 提示：请在扩展管理页面手动点击刷新按钮，或使用下面的方法');
        console.log('   在扩展管理页面打开控制台，执行：');
        console.log(`   chrome.management.setEnabled("${extensionId}", false, () => {`);
        console.log(`     chrome.management.setEnabled("${extensionId}", true);`);
        console.log('   });');
      } else {
        console.log('✅ 扩展已重新加载');
      }
    });
  } else {
    console.log('💡 请手动在扩展管理页面点击刷新按钮');
    console.log('   或使用 Chrome Management API：');
    console.log('   在扩展管理页面打开控制台，执行：');
    console.log(`   chrome.management.setEnabled("${extensionId}", false, () => {`);
    console.log(`     chrome.management.setEnabled("${extensionId}", true);`);
    console.log('   });');
  }
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
      /hot-reload\.js$/,
      /\.log$/
    ],
    persistent: true,
    ignoreInitial: true
  });

  let reloadTimer = null;

  watcher
    .on('change', (filePath) => {
      const fileName = path.basename(filePath);
      console.log(`📝 文件已修改: ${fileName}`);
      
      if (reloadTimer) {
        clearTimeout(reloadTimer);
      }
      
      reloadTimer = setTimeout(() => {
        console.log('');
        reloadExtension(extensionId);
        console.log('');
      }, 500);
    })
    .on('error', (error) => {
      console.error('❌ 监听错误:', error);
    });

  console.log('✅ 文件监听已启动');
  console.log('💡 修改任何插件文件后，扩展将自动重新加载');
  console.log('💡 按 Ctrl+C 停止监听');
  console.log('');
}

function main() {
  extensionId = getExtensionId();
  
  if (!extensionId) {
    findExtensionId();
    console.log('\n💡 设置扩展ID后，重新运行此脚本即可开始热更新');
    return;
  }

  console.log('🚀 插件热更新工具启动');
  console.log('📦 扩展ID:', extensionId);
  console.log('');

  watchFiles();
}

if (require.main === module) {
  main();
}

module.exports = { watchFiles, reloadExtension };

