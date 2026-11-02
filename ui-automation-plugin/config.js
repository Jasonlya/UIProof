/**
 * 插件配置文件
 * 统一管理服务器地址和其他配置项
 */

const APP_CONFIG = {
  // 服务器地址
  SERVER_URL: 'http://localhost:5001',
  
  // API路径前缀
  API_PREFIX: '/api',
  
  // 获取完整的API地址
  getApiUrl: function(endpoint) {
    return `${this.SERVER_URL}${this.API_PREFIX}${endpoint}`;
  }
};

// 如果是在浏览器环境中，将配置挂载到全局对象
if (typeof window !== 'undefined') {
  window.APP_CONFIG = APP_CONFIG;
}

// 如果是在模块环境中，导出配置
if (typeof module !== 'undefined' && module.exports) {
  module.exports = APP_CONFIG;
}

