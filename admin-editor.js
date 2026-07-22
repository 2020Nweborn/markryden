(() => {
  'use strict';

  const EDITABLE_SELECTOR = '.section-title, .card-title, .card-stat, .card-stats span, .hero-title, .hero-stats span, .pocket-name, .pocket-desc, .detail-title, .detail-desc, .info-table td, .notes-text, .img-copy';
  const API_URL = 'https://api.github.com/repos/2020Nweborn/markryden/contents/admin-data.json';
  const DANGEROUS_NAMES = new Set(['__proto__', 'prototype', 'constructor']);
  const DEFAULT_DATA = {
    version: 1,
    accounts: [
      { username: 'admin', password: '2046', role: 'super' },
      { username: 'editor', password: '2046', role: 'editor' }
    ],
    pages: {},
    history: []
  };

  const pageName = document.body.dataset.editorPage || decodeURIComponent(location.pathname.split('/').pop() || '');
  const sections = Array.from(document.querySelectorAll('.section'));
  const originalModules = sections.map(readModule);
  let data = clone(DEFAULT_DATA);
  let adminDataValid = false;
  let currentUser = null;
  let activeEdit = null;
  let memoryToken = '';
  let toastTimer = 0;

  init();

  async function init() {
    data = await loadData();
    applyPageOverride(data.pages[pageName]);
    renderControls();
  }

  async function loadData() {
    try {
      const response = await fetch(`./admin-data.json?ts=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('load');
      const loaded = normalizeData(await response.json());
      adminDataValid = true;
      return loaded;
    } catch (_) {
      adminDataValid = false;
      return { version: 1, accounts: [], pages: {}, history: [] };
    }
  }

  function normalizeData(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : null;
    const normalized = source ? {
      version: Number.isFinite(source.version) ? source.version : 1,
      accounts: Array.isArray(source.accounts) ? source.accounts.filter(validStoredAccount).map(account => ({
        username: String(account.username),
        password: String(account.password),
        role: String(account.role)
      })) : [],
      pages: source.pages && typeof source.pages === 'object' && !Array.isArray(source.pages) ? source.pages : {},
      history: Array.isArray(source.history) ? source.history.filter(record => record && typeof record === 'object' && !Array.isArray(record)).slice(-500) : []
    } : null;
    if (!validateAdminData(normalized)) throw new Error('管理数据无效。');
    return normalized;
  }

  function validateAdminData(value) {
    if (!value || typeof value !== 'object' || !Array.isArray(value.accounts) || !value.accounts.length) return false;
    if (!value.pages || typeof value.pages !== 'object' || Array.isArray(value.pages) || !Array.isArray(value.history)) return false;
    const usernames = new Set();
    for (const account of value.accounts) {
      if (!validStoredAccount(account) || (account.role !== 'super' && account.role !== 'editor') || usernames.has(account.username)) return false;
      usernames.add(account.username);
    }
    const admin = value.accounts.find(account => account.username === 'admin');
    return Boolean(admin && admin.role === 'super');
  }

  function validStoredAccount(account) {
    return account && typeof account === 'object' && typeof account.username === 'string' && account.username && !DANGEROUS_NAMES.has(account.username) && typeof account.password === 'string' && account.password;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function moduleNodes(section) {
    return Array.from(section.querySelectorAll(EDITABLE_SELECTOR));
  }

  function readModule(section) {
    return { nodes: moduleNodes(section).map(node => node.textContent || '') };
  }

  function writeModule(section, moduleData) {
    if (!moduleData || !Array.isArray(moduleData.nodes)) return;
    const nodes = moduleNodes(section);
    moduleData.nodes.forEach((text, index) => {
      if (nodes[index] && typeof text === 'string') nodes[index].textContent = text;
    });
  }

  function applyPageOverride(pageData) {
    if (!pageData || !Array.isArray(pageData.modules)) return;
    pageData.modules.forEach((moduleData, index) => {
      if (sections[index]) writeModule(sections[index], moduleData);
    });
  }

  function renderControls() {
    document.getElementById('ae-login-pill')?.remove();
    document.getElementById('ae-admin-bar')?.remove();
    document.querySelectorAll('.ae-section-button').forEach(button => button.remove());
    sections.forEach(section => section.classList.remove('ae-managed'));

    if (!currentUser) {
      const login = make('button', { id: 'ae-login-pill', type: 'button', text: adminDataValid ? '登录' : '管理数据加载失败' });
      login.disabled = !adminDataValid;
      login.title = adminDataValid ? '' : '管理数据加载失败，请刷新后重试';
      if (adminDataValid) login.addEventListener('click', openLogin);
      document.body.appendChild(login);
      if (!adminDataValid) toast('管理数据加载失败，请刷新后重试', true);
      return;
    }

    sections.forEach((section, index) => {
      section.classList.add('ae-managed');
      const button = make('button', { className: 'ae-section-button', type: 'button', text: '编辑' });
      button.dataset.moduleIndex = String(index);
      button.addEventListener('click', () => toggleModule(index));
      section.appendChild(button);
    });

    const bar = make('div', { id: 'ae-admin-bar' });
    bar.appendChild(make('span', { id: 'ae-admin-name', text: `${currentUser.username} · ${currentUser.role === 'super' ? '主管理员' : '管理员'}` }));
    bar.appendChild(actionButton('恢复原始版本', restoreOriginalPage));
    if (currentUser.role === 'super') {
      bar.appendChild(actionButton('修改记录', openHistory));
      bar.appendChild(actionButton('账号管理', openAccounts));
    }
    bar.appendChild(actionButton('退出登录', logout));
    document.body.appendChild(bar);
  }

  function actionButton(text, handler) {
    const button = make('button', { className: 'ae-button', type: 'button', text });
    button.addEventListener('click', handler);
    return button;
  }

  async function openLogin() {
    if (!adminDataValid) return toast('管理数据加载失败，请刷新后重试', true);
    const dialog = createDialog('管理员登录');
    const username = field('账号', 'text', '请输入账号');
    const password = field('密码', 'password', '请输入密码');
    const error = make('div', { className: 'ae-error' });
    const login = make('button', { className: 'ae-primary', type: 'submit', text: '登录' });
    const form = make('form');
    form.append(username.wrap, password.wrap, error, actions(cancelButton(dialog), login));
    form.addEventListener('submit', event => {
      event.preventDefault();
      const account = data.accounts.find(item => item.username === username.input.value && item.password === password.input.value);
      if (!account) {
        error.textContent = '账号或密码错误。';
        return;
      }
      currentUser = { username: account.username, role: account.role };
      closeDialog(dialog);
      renderControls();
    });
    dialog.shell.appendChild(form);
    showDialog(dialog.element);
    username.input.focus();
  }

  async function toggleModule(index) {
    if (!currentUser) return;
    if (activeEdit && activeEdit.index !== index) {
      const changed = moduleChanged(activeEdit.index, activeEdit.before);
      if (changed && !(await confirmBox('切换编辑模块', '当前模块有未确认修改。继续将回滚这些修改，是否继续？'))) return;
      cancelActiveEdit();
    }
    if (activeEdit && activeEdit.index === index) {
      await publishModule(index);
      return;
    }
    startEdit(index);
  }

  function startEdit(index) {
    const section = sections[index];
    const nodes = moduleNodes(section);
    const before = readModule(section);
    activeEdit = { index, before, remoteBaseline: clone(before) };
    nodes.forEach(node => {
      node.classList.add('ae-editable');
      node.setAttribute('contenteditable', 'true');
      node.setAttribute('spellcheck', 'true');
      node.addEventListener('paste', plainTextPaste);
    });
    section.querySelector('.ae-section-button').textContent = '确认';
    nodes[0]?.focus();
  }

  function plainTextPaste(event) {
    event.preventDefault();
    const text = event.clipboardData?.getData('text/plain') || '';
    if (document.queryCommandSupported?.('insertText')) document.execCommand('insertText', false, text);
    else {
      const selection = window.getSelection();
      if (!selection?.rangeCount) return;
      selection.deleteFromDocument();
      selection.getRangeAt(0).insertNode(document.createTextNode(text));
      selection.collapseToEnd();
    }
  }

  function stopEdit() {
    if (!activeEdit) return;
    const section = sections[activeEdit.index];
    moduleNodes(section).forEach(node => {
      node.classList.remove('ae-editable');
      node.removeAttribute('contenteditable');
      node.removeAttribute('spellcheck');
      node.removeEventListener('paste', plainTextPaste);
    });
    const button = section.querySelector('.ae-section-button');
    if (button) button.textContent = '编辑';
    activeEdit = null;
  }

  function cancelActiveEdit() {
    if (!activeEdit) return;
    writeModule(sections[activeEdit.index], activeEdit.before);
    stopEdit();
  }

  function moduleChanged(index, before) {
    return !sameModule(readModule(sections[index]), before);
  }

  function sameModule(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  function getEffectiveModule(source, index) {
    const override = source.pages?.[pageName]?.modules?.[index];
    return override && Array.isArray(override.nodes) ? clone(override) : clone(originalModules[index]);
  }

  async function publishModule(index) {
    if (!activeEdit || activeEdit.index !== index) return;
    const before = activeEdit.before;
    const remoteBaseline = activeEdit.remoteBaseline;
    const after = readModule(sections[index]);
    if (JSON.stringify(before) === JSON.stringify(after)) {
      stopEdit();
      return;
    }
    const title = sectionTitle(index, after);
    const historyEntry = historyRecord({
      action: '编辑模块',
      moduleIndex: index,
      moduleTitle: title,
      before: summarize(before),
      after: summarize(after)
    });
    setModuleBusy(index, true);
    try {
      const merged = await publishChange(
        remote => {
          const latestModule = getEffectiveModule(remote, index);
          if (!sameModule(latestModule, remoteBaseline)) {
            throw new Error('发布冲突：该模块已被其他人更新，当前编辑内容已保留，请刷新页面核对后重试。');
          }
          if (!remote.pages[pageName] || typeof remote.pages[pageName] !== 'object') remote.pages[pageName] = { modules: [] };
          if (!Array.isArray(remote.pages[pageName].modules)) remote.pages[pageName].modules = [];
          remote.pages[pageName].modules[index] = after;
          appendHistory(remote, historyEntry);
        },
        `更新 ${pageName} 第 ${index + 1} 个模块`
      );
      data = merged;
      stopEdit();
      toast('已发布，GitHub Pages 更新后所有访客可见');
    } catch (error) {
      toast(error.message, true);
    } finally {
      setModuleBusy(index, false);
    }
  }

  function setModuleBusy(index, busy) {
    const button = sections[index]?.querySelector('.ae-section-button');
    if (!button) return;
    button.disabled = busy;
    button.textContent = busy ? '发布中…' : (activeEdit?.index === index ? '确认' : '编辑');
  }

  async function restoreOriginalPage() {
    if (!currentUser) return;
    if (!(await confirmBox('恢复原始版本', `将删除 ${pageName} 的所有线上覆盖并恢复静态 HTML 原始正文，是否继续？`))) return;
    const historyEntry = historyRecord({
      action: '恢复原始版本',
      moduleIndex: null,
      moduleTitle: '整页',
      before: summarizePage(),
      after: '静态 HTML 原始正文'
    });
    try {
      const merged = await publishChange(remote => {
        delete remote.pages[pageName];
        appendHistory(remote, historyEntry);
      }, `恢复 ${pageName} 原始版本`);
      data = merged;
      if (activeEdit) stopEdit();
      originalModules.forEach((moduleData, index) => writeModule(sections[index], moduleData));
      toast('已发布，GitHub Pages 更新后所有访客可见');
    } catch (error) {
      toast(error.message, true);
    }
  }

  async function logout() {
    if (!currentUser) return;
    if (activeEdit && moduleChanged(activeEdit.index, activeEdit.before)) {
      if (!(await confirmBox('退出登录', '存在未确认修改。退出后将回滚这些内容，是否继续？'))) return;
    }
    cancelActiveEdit();
    currentUser = null;
    memoryToken = '';
    renderControls();
  }

  function historyRecord({ action, moduleIndex, moduleTitle, before, after }) {
    return {
      account: currentUser?.username || '',
      time: new Date().toISOString(),
      page: pageName,
      moduleIndex: moduleIndex === null ? null : moduleIndex + 1,
      moduleTitle,
      action,
      before,
      after
    };
  }

  function appendHistory(remote, entry) {
    if (!Array.isArray(remote.history)) remote.history = [];
    remote.history.push(entry);
    remote.history = remote.history.slice(-500);
  }

  function sectionTitle(index, moduleData) {
    const section = sections[index];
    const titleNode = section.querySelector('.section-title');
    if (!titleNode) return `模块 ${index + 1}`;
    const nodes = moduleNodes(section);
    const titleIndex = nodes.indexOf(titleNode);
    return String(moduleData.nodes[titleIndex] || titleNode.textContent || `模块 ${index + 1}`).trim();
  }

  function summarize(moduleData) {
    return moduleData.nodes.map(text => String(text).trim()).filter(Boolean).join(' ｜ ').slice(0, 240);
  }

  function summarizePage() {
    return sections.map((section, index) => `${index + 1}.${section.querySelector('.section-title')?.textContent.trim() || '未命名模块'}`).join('；').slice(0, 240);
  }

  function isSuper() {
    if (currentUser?.role === 'super' && currentUser.username === 'admin') return true;
    toast('仅主管理员可执行此操作。', true);
    return false;
  }

  function openHistory() {
    if (!isSuper()) return;
    const dialog = createDialog('修改记录', true);
    const pageSize = 10;
    let currentPage = 1;
    let keyword = '';
    const allRecords = data.history.slice().reverse();
    const searchWrap = make('label', { className: 'ae-history-search' });
    const searchInput = make('input', { type: 'search', placeholder: '搜索账号、页面、模块、时间或修改内容', autocomplete: 'off' });
    const resultInfo = make('div', { className: 'ae-history-result' });
    const list = make('div', { className: 'ae-history-list' });
    const pager = make('div', { className: 'ae-history-pager' });
    searchWrap.append(make('span', { text: '搜索修改记录' }), searchInput);

    function searchableText(record) {
      return [
        record.account,
        record.time,
        formatTime(record.time),
        record.page,
        record.moduleIndex,
        record.moduleTitle,
        record.action,
        record.before,
        record.after
      ].map(value => String(value ?? '')).join(' ').toLocaleLowerCase('zh-CN');
    }

    function renderHistoryPage() {
      const normalizedKeyword = keyword.trim().toLocaleLowerCase('zh-CN');
      const filtered = normalizedKeyword
        ? allRecords.filter(record => searchableText(record).includes(normalizedKeyword))
        : allRecords;
      const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
      currentPage = Math.min(Math.max(1, currentPage), pageCount);
      const start = (currentPage - 1) * pageSize;
      const pageRecords = filtered.slice(start, start + pageSize);
      list.replaceChildren();
      pager.replaceChildren();
      resultInfo.textContent = normalizedKeyword
        ? `找到 ${filtered.length} 条记录，共 ${allRecords.length} 条`
        : `共 ${allRecords.length} 条记录`;

      if (!pageRecords.length) {
        list.appendChild(make('p', { className: 'ae-history-empty', text: allRecords.length ? '没有找到匹配的修改记录。' : '暂无修改记录。' }));
      }

      pageRecords.forEach(record => {
        const item = make('div', { className: 'ae-history-item' });
        const head = make('div', { className: 'ae-history-head' });
        head.append(
          make('span', { text: `${record.account || '未知账号'} · ${record.page || '未知页面'}` }),
          make('span', { text: formatTime(record.time) })
        );
        const moduleText = record.moduleIndex ? `模块 ${record.moduleIndex} / ${record.moduleTitle || '未命名'}` : (record.moduleTitle || '整页');
        item.append(
          head,
          make('div', { className: 'ae-history-main', text: `${record.action || '修改'} · ${moduleText}` }),
          make('div', { className: 'ae-history-summary', text: `修改前：${record.before || '无'}` }),
          make('div', { className: 'ae-history-summary', text: `修改后：${record.after || '无'}` })
        );
        list.appendChild(item);
      });

      const previous = make('button', { type: 'button', text: '上一页' });
      const next = make('button', { type: 'button', text: '下一页' });
      previous.disabled = currentPage <= 1 || !filtered.length;
      next.disabled = currentPage >= pageCount || !filtered.length;
      previous.addEventListener('click', () => {
        currentPage -= 1;
        renderHistoryPage();
        list.scrollIntoView({ block: 'nearest' });
      });
      next.addEventListener('click', () => {
        currentPage += 1;
        renderHistoryPage();
        list.scrollIntoView({ block: 'nearest' });
      });
      const rangeText = filtered.length ? `${start + 1}–${Math.min(start + pageSize, filtered.length)} / ${filtered.length}` : '0 / 0';
      pager.append(previous, make('span', { text: `第 ${currentPage} / ${pageCount} 页 · ${rangeText}` }), next);
    }

    searchInput.addEventListener('input', () => {
      keyword = searchInput.value;
      currentPage = 1;
      renderHistoryPage();
    });
    dialog.shell.append(searchWrap, resultInfo, list, pager, actions(cancelButton(dialog, '关闭')));
    renderHistoryPage();
    showDialog(dialog.element);
    searchInput.focus();
  }

  function openAccounts() {
    if (!isSuper()) return;
    renderAccountsDialog();
  }

  function renderAccountsDialog(existingDialog) {
    if (!isSuper()) return;
    if (existingDialog) closeDialog(existingDialog);
    const dialog = createDialog('账号管理', true);
    dialog.shell.appendChild(make('p', { className: 'ae-dialog-text', text: '主管理员可查看全部明文账号密码、修改密码，并创建或删除普通账号。' }));
    const list = make('div', { className: 'ae-account-list' });
    data.accounts.forEach(account => {
      const row = make('div', { className: 'ae-account-row' });
      const userWrap = make('div');
      userWrap.append(make('div', { text: account.username }), make('div', { className: 'ae-account-meta', text: account.role === 'super' ? '主管理员' : '普通管理员' }));
      const password = field('明文密码', 'text');
      password.input.value = account.password;
      const save = make('button', { type: 'button', text: '修改密码' });
      save.addEventListener('click', () => changePassword(account.username, password.input.value, dialog, save));
      row.append(userWrap, password.wrap, save);
      if (account.username !== 'admin') {
        const remove = make('button', { type: 'button', text: '删除' });
        remove.addEventListener('click', () => deleteAccount(account.username, dialog, remove));
        row.appendChild(remove);
      } else row.appendChild(make('span', { className: 'ae-account-meta', text: '不可删除' }));
      list.appendChild(row);
    });

    const createTitle = make('div', { className: 'ae-dialog-title', text: '创建普通账号' });
    createTitle.style.marginTop = '22px';
    createTitle.style.fontSize = '15px';
    const newUser = field('账号', 'text', '账号不能包含空格');
    const newPassword = field('密码', 'text', '密码不能为空');
    const error = make('div', { className: 'ae-error' });
    const create = make('button', { className: 'ae-primary', type: 'button', text: '创建账号' });
    create.addEventListener('click', async () => {
      error.textContent = validateCredentials(newUser.input.value, newPassword.input.value, true);
      if (error.textContent) return;
      if (data.accounts.some(item => item.username === newUser.input.value)) {
        error.textContent = '账号已存在。';
        return;
      }
      create.disabled = true;
      try {
        const entry = historyRecord({ action: '创建账号', moduleIndex: null, moduleTitle: '账号管理', before: '无', after: `创建普通账号 ${newUser.input.value}` });
        const merged = await publishChange(remote => {
          if (remote.accounts.some(item => item.username === newUser.input.value)) throw new Error('账号已存在，请刷新后重试。');
          remote.accounts.push({ username: newUser.input.value, password: newPassword.input.value, role: 'editor' });
          appendHistory(remote, entry);
        }, `创建管理员账号 ${newUser.input.value}`);
        data = merged;
        toast('账号已发布。');
        renderAccountsDialog(dialog);
      } catch (publishError) {
        error.textContent = publishError.message;
      } finally { create.disabled = false; }
    });
    dialog.shell.append(list, createTitle, newUser.wrap, newPassword.wrap, error, actions(cancelButton(dialog, '关闭'), create));
    showDialog(dialog.element);
  }

  async function changePassword(username, password, dialog, button) {
    if (!isSuper()) return;
    const validation = validateCredentials(username, password, false);
    if (validation) return toast(validation, true);
    button.disabled = true;
    try {
      const oldAccount = data.accounts.find(item => item.username === username);
      if (!oldAccount || oldAccount.password === password) {
        toast(oldAccount ? '密码没有变化。' : '账号不存在。', !oldAccount);
        return;
      }
      const entry = historyRecord({ action: '修改账号密码', moduleIndex: null, moduleTitle: '账号管理', before: `${username} 的原密码`, after: `${username} 的新密码` });
      const merged = await publishChange(remote => {
        const account = remote.accounts.find(item => item.username === username);
        if (!account) throw new Error('账号不存在，请刷新后重试。');
        account.password = password;
        appendHistory(remote, entry);
      }, `修改管理员账号 ${username} 密码`);
      data = merged;
      toast('密码已发布。');
      renderAccountsDialog(dialog);
    } catch (error) {
      toast(error.message, true);
    } finally { button.disabled = false; }
  }

  async function deleteAccount(username, dialog, button) {
    if (!isSuper()) return;
    if (username === 'admin') return toast('admin 账号不可删除。', true);
    if (!(await confirmBox('删除账号', `确定删除普通账号“${username}”吗？`))) return;
    button.disabled = true;
    try {
      const entry = historyRecord({ action: '删除账号', moduleIndex: null, moduleTitle: '账号管理', before: `普通账号 ${username}`, after: '已删除' });
      const merged = await publishChange(remote => {
        const index = remote.accounts.findIndex(item => item.username === username && item.role !== 'super');
        if (index < 0) throw new Error('普通账号不存在，请刷新后重试。');
        remote.accounts.splice(index, 1);
        appendHistory(remote, entry);
      }, `删除管理员账号 ${username}`);
      data = merged;
      toast('账号已删除并发布。');
      renderAccountsDialog(dialog);
    } catch (error) {
      toast(error.message, true);
    } finally { button.disabled = false; }
  }

  function validateCredentials(username, password, validateUsername) {
    if (validateUsername && (!username || !username.trim())) return '账号不能为空。';
    if (!password || !password.trim()) return '密码不能为空。';
    if (validateUsername && /\s/.test(username)) return '账号不能包含空格或其他空白字符。';
    if (validateUsername && DANGEROUS_NAMES.has(username)) return '该账号名称不可使用。';
    return '';
  }

  async function publishChange(mutator, commitMessage) {
    const token = await getPublishToken();
    try {
      const remoteFile = await getRemoteFile(token);
      const remote = normalizeData(remoteFile.data);
      mutator(remote);
      if (!validateAdminData(remote)) throw new Error('管理数据无效：必须保留 role 为 super 的 admin 主管理员，已阻止发布。');
      const response = await fetch(API_URL, {
        method: 'PUT',
        headers: githubHeaders(token),
        body: JSON.stringify({
          message: commitMessage,
          content: encodeBase64(`${JSON.stringify(remote, null, 2)}\n`),
          sha: remoteFile.sha,
          branch: 'main'
        })
      });
      if (!response.ok) throw await githubError(response);
      return remote;
    } catch (error) {
      if (error.authFailure) clearToken();
      if (error instanceof Error && /[\u3400-\u9fff]/.test(error.message)) throw error;
      throw new Error('发布失败：网络连接或远程数据异常，请检查后重试。');
    }
  }

  async function getRemoteFile(token) {
    const response = await fetch(`${API_URL}?ref=main&ts=${Date.now()}`, {
      headers: githubHeaders(token),
      cache: 'no-store'
    });
    if (!response.ok) throw await githubError(response);
    const payload = await response.json();
    return { sha: payload.sha, data: JSON.parse(decodeBase64(payload.content.replace(/\s/g, ''))) };
  }

  function githubHeaders(token) {
    return {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28'
    };
  }

  async function githubError(response) {
    const status = response.status;
    let apiMessage = '';
    try {
      const payload = await response.json();
      apiMessage = typeof payload.message === 'string' ? payload.message : '';
    } catch (_) {}
    const normalizedMessage = apiMessage.toLowerCase();
    const credentialFailure = (status === 401 || status === 403) && /(bad credentials|requires authentication|resource not accessible|permission|forbidden|insufficient)/i.test(apiMessage);
    const rateLimited = (status === 403 || status === 429) && /(rate limit|api rate limit|secondary rate)/i.test(normalizedMessage);
    const error = new Error(`发布失败（HTTP ${status}）${apiMessage ? `：${apiMessage}` : ''}，请稍后重试。`);
    if (rateLimited) {
      error.message = '发布失败：GitHub API 频率限制，请稍后重试。';
    } else if (credentialFailure) {
      error.message = '发布失败：密钥无效或 Contents 权限不足。请重新输入 Fine-grained PAT。';
      error.authFailure = true;
    } else if (status === 401 || status === 403) {
      error.message = `发布失败：GitHub 拒绝请求${apiMessage ? `（${apiMessage}）` : ''}，请稍后重试。`;
    } else if (status === 409) error.message = '发布冲突，请刷新页面后重试。';
    else if (status === 404) error.message = '发布失败：未找到 admin-data.json 或无权访问仓库。';
    else if (status === 422) error.message = '发布失败：远程文件状态已变化，请刷新后重试。';
    return error;
  }

  async function getPublishToken() {
    if (memoryToken) return memoryToken;
    const token = await tokenDialog();
    if (!token) throw new Error('已取消发布授权，修改内容仍保留，可再次确认重试。');
    memoryToken = token;
    return token;
  }

  function clearToken() {
    memoryToken = '';
  }

  function tokenDialog() {
    return new Promise(resolve => {
      const dialog = createDialog('发布授权');
      dialog.element.querySelector('.ae-dialog-close').remove();
      dialog.shell.appendChild(make('p', { className: 'ae-dialog-text', text: '请输入对 2020Nweborn/markryden 具有 Contents 读写权限的 GitHub Fine-grained PAT。密钥不会写入页面、数据文件或修改记录。' }));
      const token = field('GitHub Fine-grained PAT', 'password', 'github_pat_…');
      const error = make('div', { className: 'ae-error' });
      const cancel = make('button', { type: 'button', text: '取消' });
      const confirm = make('button', { className: 'ae-primary', type: 'button', text: '授权并发布' });
      let settled = false;
      const finish = value => {
        if (settled) return;
        settled = true;
        closeDialog(dialog);
        resolve(value);
      };
      cancel.addEventListener('click', () => finish(null));
      confirm.addEventListener('click', () => {
        const value = token.input.value.trim();
        if (!value) {
          error.textContent = '请输入 GitHub Fine-grained PAT。';
          return;
        }
        finish(value);
      });
      dialog.element.addEventListener('cancel', event => { event.preventDefault(); finish(null); });
      dialog.shell.append(token.wrap, error, actions(cancel, confirm));
      showDialog(dialog.element);
      token.input.focus();
    });
  }

  function encodeBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    bytes.forEach(byte => { binary += String.fromCharCode(byte); });
    return btoa(binary);
  }

  function decodeBase64(value) {
    const binary = atob(value);
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  function confirmBox(title, message) {
    return new Promise(resolve => {
      const dialog = createDialog(title);
      dialog.element.querySelector('.ae-dialog-close').remove();
      dialog.shell.appendChild(make('p', { className: 'ae-dialog-text', text: message }));
      const cancel = make('button', { type: 'button', text: '取消' });
      const confirm = make('button', { className: 'ae-primary', type: 'button', text: '确认' });
      let settled = false;
      const finish = value => {
        if (settled) return;
        settled = true;
        closeDialog(dialog);
        resolve(value);
      };
      cancel.addEventListener('click', () => finish(false));
      confirm.addEventListener('click', () => finish(true));
      dialog.element.addEventListener('cancel', event => { event.preventDefault(); finish(false); });
      dialog.shell.appendChild(actions(cancel, confirm));
      showDialog(dialog.element);
      confirm.focus();
    });
  }

  function createDialog(title, wide = false) {
    const element = make('dialog', { className: `ae-dialog${wide ? ' ae-wide' : ''}` });
    const shell = make('div', { className: 'ae-dialog-shell' });
    const header = make('div', { className: 'ae-dialog-header' });
    const close = make('button', { className: 'ae-dialog-close', type: 'button', text: '×', 'aria-label': '关闭' });
    header.append(make('div', { className: 'ae-dialog-title', text: title }), close);
    shell.appendChild(header);
    element.appendChild(shell);
    document.body.appendChild(element);
    const result = { element, shell };
    close.addEventListener('click', () => closeDialog(result));
    return result;
  }

  function showDialog(dialog) {
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else {
      dialog.setAttribute('open', '');
      const backdrop = make('div', { className: 'ae-dialog-backdrop' });
      dialog.before(backdrop);
    }
  }

  function closeDialog(dialog) {
    const element = dialog.element || dialog;
    if (element.open && typeof element.close === 'function') element.close();
    element.previousElementSibling?.classList.contains('ae-dialog-backdrop') && element.previousElementSibling.remove();
    element.remove();
  }

  function cancelButton(dialog, text = '取消') {
    const button = make('button', { type: 'button', text });
    button.addEventListener('click', () => closeDialog(dialog));
    return button;
  }

  function actions(...buttons) {
    const wrap = make('div', { className: 'ae-dialog-actions' });
    wrap.append(...buttons);
    return wrap;
  }

  function field(label, type, placeholder = '') {
    const wrap = make('label', { className: 'ae-field' });
    const input = make('input', { type, placeholder, autocomplete: 'off' });
    wrap.append(make('span', { text: label }), input);
    return { wrap, input };
  }

  function make(tag, attributes = {}) {
    const element = document.createElement(tag);
    Object.entries(attributes).forEach(([key, value]) => {
      if (key === 'text') element.textContent = value;
      else if (key === 'className') element.className = value;
      else if (key in element) element[key] = value;
      else element.setAttribute(key, value);
    });
    return element;
  }

  function formatTime(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value || '') : date.toLocaleString('zh-CN', { hour12: false });
  }

  function toast(message, isError = false) {
    clearTimeout(toastTimer);
    document.getElementById('ae-toast')?.remove();
    const element = make('div', { id: 'ae-toast', className: isError ? 'ae-toast-error' : '', text: message });
    document.body.appendChild(element);
    toastTimer = window.setTimeout(() => element.remove(), 5200);
  }
})();
