/**
 * 文件夹管理模块
 * 负责文件夹的CRUD操作和树形结构管理
 */

class FolderManager {
  constructor() {
    this.folders = [];
    this.folderStructure = {};
    this.expandedFolders = new Set();
    this.SERVER_URL = window.APP_CONFIG?.SERVER_URL;
  }

  /**
   * 从API加载文件夹数据
   */
  async loadFoldersFromAPI() {
    try {
      // console.log('📁 从API加载文件夹数据...');
      // console.log('📁 API URL:', `${this.SERVER_URL}/api/folders`);
      this.setStatus('正在加载文件夹...', true);
      
      const response = await fetch(`${this.SERVER_URL}/api/folders`);
      // console.log('📁 API响应状态:', response.status);
      const data = await response.json();
      // console.log('📁 API响应数据:', data);
      
      if (response.ok) {
        this.folders = data;
        // console.log('📁 从API加载文件夹成功:', this.folders.length, '个文件夹');
        
        // 构建文件夹结构
        this.folderStructure = {};
        this.folders.forEach(folder => {
          this.folderStructure[folder.folder_id] = {
            name: folder.name,
            children: [],
            parentId: folder.parent_id
          };
        });
        
        // 构建父子关系
        this.folders.forEach(folder => {
          if (folder.parent_id && this.folderStructure[folder.parent_id]) {
            this.folderStructure[folder.parent_id].children.push(folder.folder_id);
          }
        });
        
        // console.log('📁 文件夹结构构建完成:', this.folderStructure);
        // console.log('📁 详细文件夹结构:');
        Object.keys(this.folderStructure).forEach(folderId => {
          const folder = this.folderStructure[folderId];
          // console.log(`  - ${folderId}: ${folder.name} (父: ${folder.parentId}, 子: [${folder.children.join(', ')}])`);
        });
        
        this.setStatus('文件夹加载成功', true);
      } else {
        console.error('❌ 加载文件夹失败:', data.error);
        this.setStatus(`加载文件夹失败: ${data.error}`, false);
        this.folders = [];
        this.folderStructure = {};
      }
    } catch (error) {
      console.error('❌ 加载文件夹请求失败:', error);
      this.setStatus(`加载文件夹失败: ${error.message}`, false);
      this.folders = [];
      this.folderStructure = {};
    }
  }

  /**
   * 创建文件夹
   */
  async createFolder(parentFolderId = null) {
    console.log('📁 创建文件夹函数被调用, 父文件夹ID:', parentFolderId);
    
    // 使用自定义输入弹窗
    if (this.uiUtils && typeof this.uiUtils.showInput === 'function') {
      this.uiUtils.showInput(
        '创建文件夹',
        '请输入文件夹名称',
        '',
        async (folderName) => {
          if (!folderName || folderName.trim() === '') {
            console.log('📁 文件夹名称为空，取消创建');
            return;
          }
          await this._performCreateFolder(folderName.trim(), parentFolderId);
        },
        () => {
          console.log('📁 用户取消创建');
        }
      );
    } else {
      // 降级到原生 prompt
      const folderName = prompt('请输入文件夹名称：');
      console.log('📁 用户输入的文件夹名称:', folderName);
      
      if (!folderName || folderName.trim() === '') {
        console.log('📁 文件夹名称为空，取消创建');
        return;
      }
      await this._performCreateFolder(folderName.trim(), parentFolderId);
    }
  }

  async _performCreateFolder(folderName, parentFolderId) {
    try {
      this.setStatus('正在创建文件夹...', true);
      
      const response = await fetch(`${this.SERVER_URL}/api/folders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: folderName.trim(),
          parent_id: parentFolderId
        })
      });
      
      let data;
      const responseText = await response.text();
      
      try {
        if (responseText) {
          data = JSON.parse(responseText);
        } else {
          throw new Error('响应体为空');
        }
      } catch (error) {
        console.error('❌ JSON解析失败:', error);
        console.error('响应内容:', responseText);
        console.error('响应状态:', response.status);
        console.error('响应头:', Object.fromEntries(response.headers.entries()));
        this.setStatus(`文件夹创建失败: JSON解析错误 - ${error.message}`, false);
        return;
      }
      
      if (response.ok) {
        console.log('📁 文件夹创建成功:', data.folder);
        
        await this.loadFoldersFromAPI();
        
        console.log('📁 准备重新渲染树形结构...');
        console.log('📁 当前casesList:', this.casesList);
        this.renderTreeView();
        
        this.setStatus(`文件夹"${folderName}"创建成功`, true);
        console.log('📁 文件夹创建完成');
      } else {
        console.error('❌ 文件夹创建失败:', data.error || data.message || '未知错误');
        this.setStatus(`文件夹创建失败: ${data.error || data.message || '未知错误'}`, false);
      }
    } catch (error) {
      console.error('❌ 文件夹创建请求失败:', error);
      this.setStatus(`文件夹创建失败: ${error.message}`, false);
    }
  }

  /**
   * 删除文件夹
   */
  async deleteFolder(folderId) {
    console.log('📁 删除文件夹函数被调用, 文件夹ID:', folderId);
    
    const folder = this.folders.find(f => f.folder_id === folderId);
    if (!folder) {
      console.log('📁 文件夹不存在');
      return;
    }
    
    // 使用自定义确认弹窗
    if (this.uiUtils && typeof this.uiUtils.showConfirm === 'function') {
      this.uiUtils.showConfirm(
        `确定要删除文件夹"${folder.name}"吗？`,
        async () => {
          await this._performDeleteFolder(folderId);
        },
        () => {
          console.log('📁 用户取消删除');
        }
      );
    } else {
      // 降级到原生 confirm
      if (!confirm(`确定要删除文件夹"${folder.name}"吗？`)) {
        console.log('📁 用户取消删除');
        return;
      }
      await this._performDeleteFolder(folderId);
    }
  }

  async _performDeleteFolder(folderId) {
    try {
      this.setStatus('正在删除文件夹...', true);
      
      const response = await fetch(`${this.SERVER_URL}/api/folders/${folderId}`, {
        method: 'DELETE'
      });
      
      const data = await response.json();
      
      if (response.ok) {
        console.log('📁 文件夹删除成功:', data.message);
        
        // 重新加载文件夹数据
        await this.loadFoldersFromAPI();
        
        // 重新渲染树形结构
        this.renderTreeView();
        
        this.setStatus('文件夹已删除', true);
      } else {
        console.error('❌ 文件夹删除失败:', data.error);
        this.setStatus(`文件夹删除失败: ${data.error}`, false);
      }
    } catch (error) {
      console.error('❌ 文件夹删除请求失败:', error);
      this.setStatus(`文件夹删除失败: ${error.message}`, false);
    }
  }

  /**
   * 编辑文件夹
   */
  async editFolder(folderId) {
    // console.log('📁 编辑文件夹函数被调用, 文件夹ID:', folderId);
    
    const folder = this.folders.find(f => f.folder_id === folderId);
    if (!folder) {
      console.log('📁 文件夹不存在');
      return;
    }
    
    // 使用自定义输入弹窗
    if (this.uiUtils && typeof this.uiUtils.showInput === 'function') {
      this.uiUtils.showInput(
        '编辑文件夹',
        '请输入新的文件夹名称',
        folder.name,
        async (newName) => {
          if (!newName || newName.trim() === '' || newName.trim() === folder.name) {
            console.log('📁 文件夹名称未更改');
            return;
          }
          await this._performEditFolder(folderId, newName.trim());
        },
        () => {
          console.log('📁 用户取消编辑');
        }
      );
    } else {
      // 降级到原生 prompt
      const newName = prompt('请输入新的文件夹名称：', folder.name);
      if (!newName || newName.trim() === '' || newName.trim() === folder.name) {
        console.log('📁 文件夹名称未更改');
        return;
      }
      await this._performEditFolder(folderId, newName.trim());
    }
  }

  async _performEditFolder(folderId, newName) {
    
    try {
      this.setStatus('正在更新文件夹...', true);
      
      const response = await fetch(`${this.SERVER_URL}/api/folders/${folderId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: newName.trim()
        })
      });
      
      const data = await response.json();
      
      if (response.ok) {
        console.log('📁 文件夹更新成功:', data.folder);
        
        // 重新加载文件夹数据
        await this.loadFoldersFromAPI();
        
        // 重新渲染树形结构
        this.renderTreeView();
        
        this.setStatus(`文件夹已重命名为"${newName}"`, true);
      } else {
        console.error('❌ 文件夹更新失败:', data.error);
        this.setStatus(`文件夹更新失败: ${data.error}`, false);
      }
    } catch (error) {
      console.error('❌ 文件夹更新请求失败:', error);
      this.setStatus(`文件夹更新失败: ${error.message}`, false);
    }
  }

  /**
   * 展开/收起文件夹
   */
  toggleFolder(folderId) {
    if (this.expandedFolders.has(folderId)) {
      this.expandedFolders.delete(folderId);
    } else {
      this.expandedFolders.add(folderId);
    }
    
    // 保存展开状态
    this.saveExpandedState();
    
    // 重新渲染树形结构
    this.renderTreeView();
  }

  /**
   * 展开所有文件夹
   */
  expandAllFolders() {
    this.folders.forEach(folder => {
      this.expandedFolders.add(folder.folder_id);
    });
    this.saveExpandedState();
    this.renderTreeView();
  }

  /**
   * 收起所有文件夹
   */
  collapseAllFolders() {
    this.expandedFolders.clear();
    this.saveExpandedState();
    this.renderTreeView();
  }

  /**
   * 保存展开状态
   */
  saveExpandedState() {
    try {
      localStorage.setItem('ui-automation-expanded-folders', JSON.stringify([...this.expandedFolders]));
    } catch (error) {
      console.warn('⚠️ 保存展开状态失败:', error);
    }
  }

  /**
   * 加载展开状态
   */
  loadExpandedState() {
    try {
      const saved = localStorage.getItem('ui-automation-expanded-folders');
      if (saved) {
        this.expandedFolders = new Set(JSON.parse(saved));
      }
    } catch (error) {
      console.warn('⚠️ 加载展开状态失败:', error);
      this.expandedFolders = new Set();
    }
  }

  /**
   * 渲染树形视图
   */
  renderTreeView() {
    console.log('🌳 开始渲染树形视图...');
    // console.log('🌳 当前用例数量:', this.casesList ? this.casesList.length : 0);
    // console.log('🌳 当前文件夹数量:', this.folders.length);
    // console.log('🌳 文件夹列表:', this.folders);
    // console.log('🌳 文件夹结构:', this.folderStructure);
    
    const casesListEl = document.querySelector('#casesList');
    if (!casesListEl) {
      console.warn('⚠️ 找不到casesList元素');
      return;
    }
    
    if ((!this.casesList || this.casesList.length === 0) && this.folders.length === 0) {
      console.log('🌳 没有用例和文件夹，显示空状态');
      casesListEl.innerHTML = `
        <div class="empty-state">
          <p><i class="fas fa-file-alt"></i> 暂无用例，点击"新增用例"开始创建</p>
        </div>
      `;
      return;
    }
    
    // 渲染完成后，更新所有文件夹的checkbox状态
    const renderComplete = () => {
      setTimeout(() => {
        // 从最深层开始更新，确保子文件夹状态先更新
        const updateFolderState = (folderId) => {
          const childFolderIds = this.folderStructure[folderId]?.children || [];
          childFolderIds.forEach(childFolderId => {
            updateFolderState(childFolderId);
          });
          this.updateFolderCheckboxState(folderId);
        };
        
        // 更新所有根文件夹及其子文件夹
        const rootFolders = this.folders.filter(f => !f.parent_id);
        rootFolders.forEach(folder => {
          updateFolderState(folder.folder_id);
        });
      }, 50);
    };
    
    let html = '';
    
    // 根据folder_id组织用例
    const casesByFolder = {};
    const rootCases = [];
    
    if (this.casesList) {
      this.casesList.forEach(caseItem => {
        if (caseItem.folder_id) {
          if (!casesByFolder[caseItem.folder_id]) {
            casesByFolder[caseItem.folder_id] = [];
          }
          casesByFolder[caseItem.folder_id].push(caseItem);
        } else {
          rootCases.push(caseItem);
        }
      });
    }
    
    // console.log('🌳 用例分组结果:', {
    //   rootCases: rootCases.length,
    //   casesByFolderCount: Object.keys(casesByFolder).length,
    //   casesByFolder
    // });
    
    // 调试：检查文件夹ID匹配
    // console.log('🔍 文件夹ID匹配检查:');
    // console.log('🔍 前端文件夹列表:', this.folders.map(f => ({ folder_id: f.folder_id, name: f.name })));
    // console.log('🔍 用例folder_id列表:', Object.keys(casesByFolder));
    if (this.casesList) {
      console.log('🔍 用例详情:', this.casesList.map(c => ({ id: c.case_id, name: c.name, folder_id: c.folder_id })));
    }
    
    // 检查哪些folder_id没有对应的文件夹，如果不存在就创建虚拟文件夹
    Object.keys(casesByFolder).forEach(folderId => {
      let folder = this.folders.find(f => f.folder_id === folderId);
      if (!folder) {
        console.warn(`⚠️ 用例引用的文件夹ID "${folderId}" 在前端文件夹列表中不存在，创建虚拟文件夹`);
        
        // 创建虚拟文件夹
        const virtualFolder = {
          folder_id: folderId,
          name: `文件夹 ${folderId.split('_')[1]}`,
          parent_id: null,
          created_at: new Date().toISOString()
        };
        
        this.folders.push(virtualFolder);
        this.folderStructure[folderId] = {
          name: virtualFolder.name,
          children: [],
          parentId: null
        };
        
        console.log('📁 创建虚拟文件夹:', virtualFolder);
      }
    });
    
    // 调试：显示最终的文件夹列表
    // console.log('🔍 最终文件夹列表:', this.folders.map(f => ({ folder_id: f.folder_id, name: f.name })));
    // console.log('🔍 最终文件夹结构:', Object.keys(this.folderStructure));
    
    // 渲染根目录用例（没有folder_id的用例）
    if (rootCases.length > 0) {
      html += this.renderCasesList(rootCases);
    }
    
    // 渲染文件夹（只渲染根级文件夹）
    const rootFolders = this.folders.filter(folder => !folder.parent_id);
    rootFolders.forEach(folder => {
      html += this.renderFolderNodeWithCases(folder, 0, casesByFolder[folder.folder_id] || [], casesByFolder);
    });
    
    casesListEl.innerHTML = html;
    
    // 渲染完成后，更新所有文件夹的checkbox状态
    renderComplete();
    console.log('🌳 树形视图渲染完成');
    
    // 绑定事件监听器
    setTimeout(() => {
      this.bindCaseItemEvents();
    }, 100);
  }

  /**
   * 渲染文件夹节点（递归）
   */
  renderFolderNodeWithCases(folder, level = 0, folderCases = [], casesByFolder = {}) {
    const isExpanded = this.expandedFolders.has(folder.folder_id);
    const children = this.folderStructure[folder.folder_id]?.children || [];
    
    // console.log(`🌳 渲染文件夹: ${folder.name} (ID: ${folder.folder_id}, 展开: ${isExpanded}, 子文件夹: [${children.join(', ')}])`);
    
    // 获取子文件夹
    const childFolders = children
      .filter(childId => this.folders.find(f => f.folder_id === childId))
      .map(childId => this.folders.find(f => f.folder_id === childId));
    
    // console.log(`🌳 找到子文件夹: ${childFolders.map(f => f.name).join(', ')}`);
    
    // 只统计用例数量，不统计子文件夹
    const caseCount = folderCases.length;
    
    // 扁平式列表：只显示当前文件夹，用缩进表示层级
    // 注意：checkbox的indeterminate状态需要在渲染后通过JavaScript设置，不能通过HTML属性设置
    let html = `
      <div class="flat-item folder" data-folder-id="${folder.folder_id}" style="margin-left: ${level * 8}px">
        <div class="flat-header" data-folder-id="${folder.folder_id}">
          <div class="flat-select">
            <input type="checkbox" class="folder-checkbox" data-folder-id="${folder.folder_id}">
          </div>
          <div class="flat-icon"><i class="fas fa-folder${isExpanded ? '-open' : ''}"></i></div>
          <div class="flat-main-info">
            <div class="flat-name">${folder.name}</div>
            <div class="flat-badge count">${caseCount}</div>
          </div>
          <div class="flat-actions">
            <button class="btn-create" data-folder-id="${folder.folder_id}" title="新建子文件夹"><i class="fas fa-folder-plus"></i></button>
            <button class="btn-create-case" data-folder-id="${folder.folder_id}" title="新建用例"><i class="fas fa-file-circle-plus"></i></button>
            <button class="btn-edit" data-folder-id="${folder.folder_id}" title="编辑文件夹"><i class="fas fa-edit"></i></button>
          </div>
        </div>
      </div>
    `;
    
    // 如果展开，扁平化显示子项
    if (isExpanded) {
      // 渲染子文件夹（扁平化）
      childFolders.forEach(childFolder => {
        // 获取子文件夹的用例
        const childFolderCases = casesByFolder[childFolder.folder_id] || [];
        // 递归调用时传递 casesByFolder，确保三级及更深层级的用例能正确加载
        html += this.renderFolderNodeWithCases(childFolder, level + 1, childFolderCases, casesByFolder);
      });
      
      // 渲染用例（扁平化）
      folderCases.forEach(caseItem => {
        html += this.renderFlatCaseItem(caseItem, level + 1);
      });
    }
    
    return html;
  }

  /**
   * 渲染扁平化用例项
   */
  renderFlatCaseItem(caseItem, level = 0) {
    // level=0 表示根目录的用例，level=1 表示当前文件夹的用例，level>1 表示子文件夹的用例
    const isRootCase = level === 0;
    const isSubFolderCase = level > 1;
    const indentClass = isRootCase ? 'case-root' : (isSubFolderCase ? 'case-subfolder' : 'case-direct');
    // 统一使用与文件夹相同的缩进值，确保同级对齐
    const indentStyle = level > 0 ? `margin-left: ${level * 8}px` : '';
    
    return `
      <div class="flat-item case ${indentClass}" data-case-id="${caseItem.case_id}" data-level="${level}" style="${indentStyle}">
        <div class="flat-header">
          <div class="flat-select">
            <input type="checkbox" class="case-checkbox" data-case-id="${caseItem.case_id}" ${caseItem.status !== 'active' ? 'disabled' : ''}>
          </div>
          <div class="flat-icon"><i class="fas fa-file-code"></i></div>
          <div class="flat-main-info">
            <div class="flat-name">${caseItem.name}</div>
            ${caseItem.status === 'active' ? '' : `<div class=\"flat-badge status\">${caseItem.status}</div>`}
          </div>
          <div class="flat-actions">
            <button class="btn-edit" data-case-id="${caseItem.case_id}" title="编辑用例"><i class="fas fa-edit"></i></button>
            <button class="btn-move" data-case-id="${caseItem.case_id}" title="移动用例"><i class="fas fa-arrow-right"></i></button>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * 渲染用例列表
   */
  renderCasesList(cases) {
    return cases.map(caseItem => this.renderFlatCaseItem(caseItem, 0)).join('');
  }

  /**
   * 绑定用例项事件
   */
  bindCaseItemEvents() {
    // 调用全局的事件绑定函数
    // console.log('🔗 绑定用例项事件...');
    if (typeof bindCaseItemEvents === 'function') {
      bindCaseItemEvents();
    } else {
      console.warn('⚠️ bindCaseItemEvents 函数未定义');
    }
  }

  /**
   * 设置状态信息（需要外部实现）
   */
  setStatus(message, isSuccess) {
    // 这个方法需要由外部提供实现
    console.log(`📊 状态: ${message} (${isSuccess ? '成功' : '失败'})`);
  }

  /**
   * 设置用例列表（由外部设置）
   */
  setCasesList(casesList) {
    this.casesList = casesList;
  }

  /**
   * 递归选中文件夹及其所有子文件夹和用例
   */
  selectFolderAndChildren(folderId, isChecked) {
    console.log(`📁 ${isChecked ? '选中' : '取消选中'}文件夹及其子项:`, folderId);
    
    if (isChecked) {
      // 选中模式：先展开，再渲染，最后选中
      // 1. 展开所有子文件夹
      this.expandFolderAndChildren(folderId);
      
      // 2. 收集所有需要选中的文件夹ID和用例ID
      const folderIdsToSelect = this.getAllChildFolderIds(folderId);
      folderIdsToSelect.push(folderId); // 包括当前文件夹
      
      const caseIdsToSelect = [];
      if (this.casesList) {
        folderIdsToSelect.forEach(fId => {
          const folderCases = this.casesList.filter(c => c.folder_id === fId);
          folderCases.forEach(c => caseIdsToSelect.push(c.case_id));
        });
      }
      
      // 3. 保存展开状态并重新渲染
      this.saveExpandedState();
      this.renderTreeView();
      
      // 4. 渲染完成后，选中所有收集到的文件夹和用例
      setTimeout(() => {
        folderIdsToSelect.forEach(fId => {
          const folderCheckbox = document.querySelector(`.folder-checkbox[data-folder-id="${fId}"]`);
          if (folderCheckbox) {
            folderCheckbox.checked = true;
            folderCheckbox.indeterminate = false;
          }
        });
        
        caseIdsToSelect.forEach(caseId => {
          const caseCheckbox = document.querySelector(`.case-checkbox[data-case-id="${caseId}"]`);
          if (caseCheckbox && !caseCheckbox.disabled) {
            caseCheckbox.checked = true;
            if (this.caseManager) {
              this.caseManager.selectedCases.add(caseId);
            }
          }
        });
        
        // 更新所有父文件夹的状态
        this.updateParentFoldersState(folderId);
        
        // 更新批量按钮状态
        if (this.caseManager && typeof this.caseManager.updateBatchButtons === 'function') {
          this.caseManager.updateBatchButtons();
        }
      }, 100);
    } else {
      // 取消选中模式：直接取消选中（不需要重新渲染）
      const folderIdsToUnselect = this.getAllChildFolderIds(folderId);
      folderIdsToUnselect.push(folderId);
      
      folderIdsToUnselect.forEach(fId => {
        const folderCheckbox = document.querySelector(`.folder-checkbox[data-folder-id="${fId}"]`);
        if (folderCheckbox) {
          folderCheckbox.checked = false;
          folderCheckbox.indeterminate = false;
        }
      });
      
      if (this.casesList) {
        folderIdsToUnselect.forEach(fId => {
          const folderCases = this.casesList.filter(c => c.folder_id === fId);
          folderCases.forEach(caseItem => {
            const caseCheckbox = document.querySelector(`.case-checkbox[data-case-id="${caseItem.case_id}"]`);
            if (caseCheckbox && !caseCheckbox.disabled) {
              caseCheckbox.checked = false;
              if (this.caseManager) {
                this.caseManager.selectedCases.delete(caseItem.case_id);
              }
            }
          });
        });
      }
      
      // 更新所有父文件夹的状态
      this.updateParentFoldersState(folderId);
      
      // 更新批量按钮状态
      if (this.caseManager && typeof this.caseManager.updateBatchButtons === 'function') {
        this.caseManager.updateBatchButtons();
      }
    }
  }

  /**
   * 获取所有子文件夹ID（递归）
   */
  getAllChildFolderIds(folderId) {
    const result = [];
    const childFolderIds = this.folderStructure[folderId]?.children || [];
    childFolderIds.forEach(childFolderId => {
      result.push(childFolderId);
      // 递归获取子文件夹的子文件夹
      result.push(...this.getAllChildFolderIds(childFolderId));
    });
    return result;
  }

  /**
   * 获取文件夹的选中状态
   * @returns 'all' - 全部选中, 'partial' - 部分选中, 'none' - 未选中
   */
  getFolderSelectionState(folderId) {
    // 获取所有子文件夹ID（包括子文件夹的子文件夹）
    const allChildFolderIds = this.getAllChildFolderIds(folderId);
    
    // 检查子文件夹的选中状态（递归检查，考虑indeterminate状态）
    let checkedChildFolders = 0;
    let partialChildFolders = 0;
    let totalChildFolders = allChildFolderIds.length;
    
    allChildFolderIds.forEach(childFolderId => {
      const checkbox = document.querySelector(`.folder-checkbox[data-folder-id="${childFolderId}"]`);
      if (checkbox) {
        if (checkbox.checked) {
          checkedChildFolders++;
        } else if (checkbox.indeterminate) {
          partialChildFolders++;
        }
      }
    });
    
    // 检查当前文件夹内的用例选中状态
    let checkedCases = 0;
    let totalCases = 0;
    if (this.casesList) {
      const folderCases = this.casesList.filter(c => c.folder_id === folderId);
      totalCases = folderCases.length;
      folderCases.forEach(caseItem => {
        const caseCheckbox = document.querySelector(`.case-checkbox[data-case-id="${caseItem.case_id}"]`);
        if (caseCheckbox && !caseCheckbox.disabled && caseCheckbox.checked) {
          checkedCases++;
        }
      });
    }
    
    // 计算总选中数
    const totalItems = totalChildFolders + totalCases;
    const checkedItems = checkedChildFolders + checkedCases;
    
    if (totalItems === 0) {
      // 没有子项，检查当前文件夹checkbox状态
      const currentCheckbox = document.querySelector(`.folder-checkbox[data-folder-id="${folderId}"]`);
      return currentCheckbox && currentCheckbox.checked ? 'all' : 'none';
    }
    
    // 如果有部分选中的子文件夹，或者选中数在0和总数之间，则为部分选中
    if (partialChildFolders > 0 || (checkedItems > 0 && checkedItems < totalItems)) {
      return 'partial';
    } else if (checkedItems === 0) {
      return 'none';
    } else if (checkedItems === totalItems) {
      return 'all';
    } else {
      return 'partial';
    }
  }

  /**
   * 更新文件夹checkbox的indeterminate状态
   */
  updateFolderCheckboxState(folderId) {
    const checkbox = document.querySelector(`.folder-checkbox[data-folder-id="${folderId}"]`);
    if (!checkbox) return;
    
    const state = this.getFolderSelectionState(folderId);
    checkbox.checked = state === 'all';
    checkbox.indeterminate = state === 'partial';
  }

  /**
   * 递归更新父文件夹的状态
   */
  updateParentFoldersState(folderId) {
    const folder = this.folders.find(f => f.folder_id === folderId);
    if (!folder || !folder.parent_id) return;
    
    // 更新父文件夹状态
    this.updateFolderCheckboxState(folder.parent_id);
    
    // 递归更新更上层的父文件夹
    this.updateParentFoldersState(folder.parent_id);
  }

  /**
   * 递归展开文件夹及其所有子文件夹
   */
  expandFolderAndChildren(folderId) {
    this.expandedFolders.add(folderId);
    const childFolderIds = this.folderStructure[folderId]?.children || [];
    childFolderIds.forEach(childFolderId => {
      this.expandFolderAndChildren(childFolderId);
    });
  }

  /**
   * 设置caseManager引用
   */
  setCaseManager(caseManager) {
    this.caseManager = caseManager;
  }
}

// 导出模块
// ES6 模块导出
export { FolderManager };

// 兼容性导出（保持向后兼容）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = FolderManager;
} else {
  window.FolderManager = FolderManager;
}
