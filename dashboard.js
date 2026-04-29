let allWindows = [];
let searchQuery = '';
let currentLayout = 'grid';
let magazineIndex = 0;
let draggedTab = null;
let lastCommandPressTime = 0;
let settings = { enableDoubleCommand: true };
let urlCountMap = new Map();

const layoutLabels = {
  grid: '卡片网格',
  list: '紧凑列表',
  magazine: '杂志翻页'
};

document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  await loadTabs();
  await loadFreqPages();
  setupEventListeners();
  startAutoRefresh();
});

async function loadSettings() {
  try {
    const result = await chrome.storage.sync.get({ enableDoubleCommand: true, dashboardLayout: 'grid' });
    settings = { ...settings, ...result };
    currentLayout = result.dashboardLayout || 'grid';
    setLayout(currentLayout, false);
  } catch (e) { /* 使用默认 */ }
}

function setupEventListeners() {
  document.getElementById('refreshBtn').addEventListener('click', loadTabs);
  document.getElementById('closeDuplicatesBtn').addEventListener('click', closeDuplicateTabs);
  document.getElementById('settingsBtn').addEventListener('click', () => chrome.runtime.openOptionsPage());

  document.getElementById('clearFreqPagesBtn').addEventListener('click', async () => {
    if (confirm('确定要清除所有高频页面数据吗？')) {
      await chrome.runtime.sendMessage({ action: 'clearFreqPages' });
      await loadFreqPages();
      showToast('高频页面数据已清除', 'success');
    }
  });

  // 搜索
  const searchInput = document.getElementById('searchInput');
  searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value.trim().toLowerCase();
    magazineIndex = 0;
    renderWindows();
  });

  // 布局切换
  document.querySelectorAll('.layout-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const layout = btn.dataset.layout;
      setLayout(layout, true);
    });
  });

  // 杂志翻页
  document.getElementById('magazinePrev').addEventListener('click', () => {
    if (magazineIndex > 0) {
      magazineIndex--;
      renderWindows();
    }
  });
  document.getElementById('magazineNext').addEventListener('click', () => {
    const visibleCount = getVisibleWindows().length;
    if (magazineIndex < visibleCount - 1) {
      magazineIndex++;
      renderWindows();
    }
  });

  // 键盘快捷键
  document.addEventListener('keydown', handleKeyDown);
}

function handleKeyDown(e) {
  // Command+K 聚焦搜索
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    document.getElementById('searchInput').focus();
    return;
  }

  // 杂志模式左右翻页
  if (currentLayout === 'magazine') {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (magazineIndex > 0) {
        magazineIndex--;
        renderWindows();
      }
      return;
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      const visibleCount = getVisibleWindows().length;
      if (magazineIndex < visibleCount - 1) {
        magazineIndex++;
        renderWindows();
      }
      return;
    }
  }

  // 双击 Command 切换标签
  if (!settings.enableDoubleCommand) return;
  if (e.key !== 'Meta' && e.key !== 'Control') return;

  const now = Date.now();
  const diff = now - lastCommandPressTime;

  if (diff < 300 && diff > 50) {
    e.preventDefault();
    handleDoubleCommand();
  }
  lastCommandPressTime = now;
}

async function handleDoubleCommand() {
  const allTabs = [];
  allWindows.forEach(w => w.tabs.forEach(t => allTabs.push({ ...t, windowId: w.id })));
  const others = allTabs.filter(t => !t.active);

  if (others.length > 0) {
    const tab = others[Math.floor(Math.random() * others.length)];
    await switchToTab(tab.id, tab.windowId);
  } else {
    showToast('没有其他标签页', 'warning');
  }
}

function setLayout(layout, save) {
  currentLayout = layout;
  document.body.className = `layout-${layout}`;

  document.querySelectorAll('.layout-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.layout === layout);
  });

  document.getElementById('layoutLabel').textContent = layoutLabels[layout];
  document.getElementById('magazineNav').style.display = layout === 'magazine' ? 'flex' : 'none';

  if (save) {
    chrome.storage.sync.set({ dashboardLayout: layout }).catch(() => {});
  }

  magazineIndex = 0;
  renderWindows();
}

function getVisibleWindows() {
  if (!searchQuery) return allWindows;
  return allWindows.filter(win => {
    return win.tabs.some(t => {
      const text = `${t.title || ''} ${t.url || ''}`.toLowerCase();
      return text.includes(searchQuery);
    });
  });
}

function startAutoRefresh() {
  loadTabs();
  chrome.tabs.onCreated.addListener(() => loadTabs());
  chrome.tabs.onRemoved.addListener(() => loadTabs());
  chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
    if (changeInfo.url || changeInfo.title || changeInfo.status === 'complete') {
      loadTabs();
    }
  });
  chrome.tabs.onMoved.addListener(() => loadTabs());
  chrome.tabs.onAttached.addListener(() => loadTabs());
  chrome.tabs.onDetached.addListener(() => loadTabs());
  chrome.windows.onCreated.addListener(() => loadTabs());
  chrome.windows.onRemoved.addListener(() => loadTabs());
}

async function loadTabs() {
  try {
    allWindows = await chrome.windows.getAll({ populate: true });
    updateStats();
    renderWindows();
  } catch (e) {
    showToast('加载失败，请刷新', 'error');
  }
}

function updateStats() {
  let totalTabs = 0;
  urlCountMap = new Map();

  allWindows.forEach(w => {
    w.tabs.forEach(t => {
      totalTabs++;
      if (t.url && !t.url.startsWith('chrome://')) {
        urlCountMap.set(t.url, (urlCountMap.get(t.url) || 0) + 1);
      }
    });
  });

  let dupes = 0;
  urlCountMap.forEach((c) => { if (c > 1) dupes += c - 1; });

  document.getElementById('windowCount').textContent = `${allWindows.length} 个窗口`;
  document.getElementById('tabCount').textContent = `${totalTabs} 个标签页`;
  document.getElementById('duplicateCount').textContent = `${dupes} 个重复`;
}

function renderWindows() {
  const container = document.getElementById('windowsContainer');
  container.innerHTML = '';

  const visibleWindows = getVisibleWindows();

  if (visibleWindows.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🔍</div>
        <div class="empty-state-text">未找到匹配的标签页</div>
      </div>`;
    updateMagazineNav(0, 0);
    return;
  }

  // 杂志模式：只渲染当前窗口
  if (currentLayout === 'magazine') {
    magazineIndex = Math.min(magazineIndex, visibleWindows.length - 1);
    const win = visibleWindows[magazineIndex];
    const section = createWindowSection(win, magazineIndex + 1);
    section.classList.add('magazine-active');
    container.appendChild(section);
    updateMagazineNav(magazineIndex + 1, visibleWindows.length);
    return;
  }

  // 网格/列表模式：渲染所有窗口
  visibleWindows.forEach((win, index) => {
    const section = createWindowSection(win, index + 1);
    container.appendChild(section);
  });
  updateMagazineNav(0, 0);
}

function updateMagazineNav(current, total) {
  document.getElementById('magazineCurrent').textContent = total > 0 ? current : 0;
  document.getElementById('magazineTotal').textContent = total;
  document.getElementById('magazinePrev').disabled = current <= 1 || total === 0;
  document.getElementById('magazineNext').disabled = current >= total || total === 0;
}

function createWindowSection(win, displayNum) {
  const section = document.createElement('section');
  section.className = 'window-section';
  section.dataset.windowId = win.id;

  const filtered = filterTabs(win.tabs);

  // 窗口头部
  const header = document.createElement('div');
  header.className = 'window-header';
  header.innerHTML = `
    <div class="window-header-left">
      <span class="window-number">${displayNum}</span>
      <span class="window-meta">
        ${win.focused ? '<span class="focused-badge"></span>当前窗口 · ' : ''}
        ${filtered.length} 个标签页
      </span>
    </div>
    <div class="window-actions">
      <button class="window-action" data-action="close-others" data-id="${win.id}">关闭其他窗口</button>
      <button class="window-action" data-action="close-window" data-id="${win.id}">关闭此窗口</button>
    </div>
  `;
  section.appendChild(header);

  // 标签页网格
  const grid = document.createElement('div');
  grid.className = 'tabs-grid';

  filtered.forEach(tab => {
    grid.appendChild(createTabCard(tab, win.id, win.focused));
  });

  section.appendChild(grid);

  // 事件绑定
  header.querySelector('[data-action="close-window"]').addEventListener('click', () => closeWindow(win.id));
  header.querySelector('[data-action="close-others"]').addEventListener('click', () => closeOtherWindows(win.id));

  // 拖拽：拖入窗口
  section.addEventListener('dragover', (e) => {
    e.preventDefault();
    section.classList.add('drag-over');
  });
  section.addEventListener('dragleave', () => section.classList.remove('drag-over'));
  section.addEventListener('drop', async (e) => {
    e.preventDefault();
    section.classList.remove('drag-over');
    if (draggedTab && draggedTab.windowId !== win.id) {
      await moveTabToWindow(draggedTab, win.id);
      draggedTab = null;
    }
  });

  return section;
}

function createTabCard(tab, windowId, windowFocused) {
  const isDup = checkIsDuplicate(tab);
  const isActive = tab.active;

  const card = document.createElement('div');
  card.className = `tab-card ${isActive ? 'active-tab' : ''} ${isDup ? 'duplicate-tab' : ''}`;
  card.draggable = true;

  const faviconImg = document.createElement('img');
  faviconImg.className = 'tab-favicon';
  faviconImg.src = tab.favIconUrl || 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"%3E%3Crect fill="%23ccc" width="16" height="16" rx="2"/%3E%3C/svg%3E';
  faviconImg.alt = '';

  const titleSpan = document.createElement('span');
  titleSpan.className = 'tab-title';
  titleSpan.title = tab.title || '新标签页';
  titleSpan.textContent = tab.title || '新标签页';

  const cardHeader = document.createElement('div');
  cardHeader.className = 'tab-card-header';
  cardHeader.appendChild(faviconImg);
  cardHeader.appendChild(titleSpan);

  let badgesDiv = null;
  if (isActive || isDup) {
    badgesDiv = document.createElement('div');
    badgesDiv.className = 'tab-badges';
    if (isActive) {
      const badge = document.createElement('span');
      badge.className = 'badge badge-current';
      badge.textContent = '当前';
      badgesDiv.appendChild(badge);
    }
    if (isDup) {
      const badge = document.createElement('span');
      badge.className = 'badge badge-duplicate';
      badge.textContent = '重复';
      badgesDiv.appendChild(badge);
    }
  }

  const urlDiv = document.createElement('div');
  urlDiv.className = 'tab-url';
  urlDiv.title = tab.url || '';
  urlDiv.textContent = tab.url || '';

  const footerDiv = document.createElement('div');
  footerDiv.className = 'tab-card-footer';
  const switchBtn = document.createElement('button');
  switchBtn.className = 'tab-btn primary';
  switchBtn.dataset.action = 'switch';
  switchBtn.textContent = '切换';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'tab-btn';
  closeBtn.dataset.action = 'close';
  closeBtn.textContent = '关闭';
  footerDiv.appendChild(switchBtn);
  footerDiv.appendChild(closeBtn);

  card.appendChild(cardHeader);
  if (badgesDiv) card.appendChild(badgesDiv);
  card.appendChild(urlDiv);
  card.appendChild(footerDiv);

  // 点击切换
  card.addEventListener('click', (e) => {
    if (!e.target.closest('.tab-btn')) {
      switchToTab(tab.id, windowId);
    }
  });

  switchBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    switchToTab(tab.id, windowId);
  });

  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closeTab(tab.id);
  });

  // 拖拽
  card.addEventListener('dragstart', (e) => {
    draggedTab = { ...tab, windowId };
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });

  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
  });

  card.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (draggedTab && draggedTab.id !== tab.id) {
      card.classList.add('drag-over');
    }
  });

  card.addEventListener('dragleave', () => card.classList.remove('drag-over'));

  card.addEventListener('drop', async (e) => {
    e.preventDefault();
    card.classList.remove('drag-over');
    if (draggedTab && draggedTab.id !== tab.id) {
      if (draggedTab.windowId === windowId) {
        await moveTabWithinWindow(draggedTab.id, tab.index);
      } else {
        await moveTabToWindow(draggedTab, windowId, tab.index);
      }
      draggedTab = null;
    }
  });

  return card;
}

function filterTabs(tabs) {
  if (!searchQuery) return tabs;
  return tabs.filter(t => {
    const text = `${t.title || ''} ${t.url || ''}`.toLowerCase();
    return text.includes(searchQuery);
  });
}

function checkIsDuplicate(tab) {
  if (!tab.url || tab.url.startsWith('chrome://')) return false;
  return (urlCountMap.get(tab.url) || 0) > 1;
}

async function switchToTab(tabId, windowId) {
  try {
    await chrome.tabs.update(tabId, { active: true });
    await chrome.windows.update(windowId, { focused: true });
    showToast('已切换', 'success');
  } catch (e) {
    showToast('切换失败', 'error');
  }
}

async function closeTab(tabId) {
  try {
    await chrome.tabs.remove(tabId);
    await loadTabs();
    showToast('已关闭', 'success');
  } catch (e) {
    showToast('关闭失败', 'error');
  }
}

async function closeWindow(windowId) {
  try {
    await chrome.windows.remove(windowId);
    await loadTabs();
    showToast('窗口已关闭', 'success');
  } catch (e) {
    showToast('操作失败', 'error');
  }
}

async function closeOtherWindows(keepId) {
  try {
    const dashboardUrl = chrome.runtime.getURL('dashboard.html');
    const dashboardTab = await chrome.tabs.query({ url: dashboardUrl });
    const dashboardWindowId = dashboardTab.length > 0 ? dashboardTab[0].windowId : null;

    const others = allWindows.filter(w => w.id !== keepId && w.id !== dashboardWindowId);
    for (const w of others) await chrome.windows.remove(w.id);
    await loadTabs();
    showToast(`已关闭 ${others.length} 个窗口`, 'success');
  } catch (e) {
    showToast('操作失败', 'error');
  }
}

async function closeDuplicateTabs() {
  try {
    const urlMap = new Map();
    const toClose = [];

    allWindows.forEach(w => {
      w.tabs.forEach(t => {
        if (!t.url || t.url.startsWith('chrome://')) return;
        if (urlMap.has(t.url)) {
          toClose.push(t.id);
        } else {
          urlMap.set(t.url, t.id);
        }
      });
    });

    if (toClose.length === 0) {
      showToast('没有重复页面', 'warning');
      return;
    }

    await chrome.tabs.remove(toClose);
    await loadTabs();
    showToast(`已关闭 ${toClose.length} 个重复页面`, 'success');
  } catch (e) {
    showToast('操作失败', 'error');
  }
}

async function moveTabToWindow(tab, targetWindowId, index = -1) {
  try {
    const opts = { windowId: targetWindowId };
    if (index >= 0) opts.index = index;
    await chrome.tabs.move(tab.id, opts);
    await loadTabs();
    showToast('已移动', 'success');
  } catch (e) {
    showToast('移动失败', 'error');
  }
}

async function moveTabWithinWindow(tabId, targetIndex) {
  try {
    await chrome.tabs.move(tabId, { index: targetIndex });
    await loadTabs();
    showToast('已调整顺序', 'success');
  } catch (e) {
    showToast('调整失败', 'error');
  }
}

function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast show ${type}`;
  setTimeout(() => { toast.className = 'toast'; }, 2000);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function loadFreqPages() {
  try {
    const pages = await chrome.runtime.sendMessage({ action: 'getFreqPages', limit: 20 });
    renderFreqPages(pages || []);
  } catch (e) {
    console.error('加载高频页面失败:', e);
    renderFreqPages([]);
  }
}

function renderFreqPages(pages) {
  const container = document.getElementById('freqPagesBody');

  if (!pages || pages.length === 0) {
    container.innerHTML = '<div class="freq-pages-empty">暂无高频页面数据</div>';
    return;
  }

  const maxCount = pages[0]?.count || 1;

  container.innerHTML = '';
  const list = document.createElement('div');
  list.className = 'freq-pages-grid';

  pages.forEach((page, index) => {
    const item = document.createElement('div');
    item.className = `freq-page-card ${page.pinned ? 'pinned' : ''}`;

    const faviconImg = document.createElement('img');
    faviconImg.className = 'freq-page-card-favicon';
    faviconImg.src = page.favIconUrl || 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"%3E%3Crect fill="%23ccc" width="16" height="16" rx="2"/%3E%3C/svg%3E';
    faviconImg.alt = '';

    const barWidth = Math.max(Math.round((page.count / maxCount) * 100), 8);

    const cardInfo = document.createElement('div');
    cardInfo.className = 'freq-page-card-info';
    cardInfo.innerHTML = `
      <div class="freq-page-card-title" title="${escapeHtml(page.title)}">${escapeHtml(page.title)}</div>
      <div class="freq-page-card-url" title="${escapeHtml(page.url)}">${escapeHtml(page.url)}</div>
    `;

    const cardHeader = document.createElement('div');
    cardHeader.className = 'freq-page-card-header';
    cardHeader.appendChild(faviconImg);
    cardHeader.appendChild(cardInfo);

    const barWrapper = document.createElement('div');
    barWrapper.className = 'freq-page-card-bar-wrapper';
    const bar = document.createElement('div');
    bar.className = 'freq-page-card-bar';
    bar.style.width = `${barWidth}%`;
    barWrapper.appendChild(bar);

    const cardFooter = document.createElement('div');
    cardFooter.className = 'freq-page-card-footer';

    const countSpan = document.createElement('span');
    countSpan.className = 'freq-page-card-count';
    countSpan.textContent = `${page.count} 次访问`;
    cardFooter.appendChild(countSpan);

    if (page.pinned) {
      const pinSpan = document.createElement('span');
      pinSpan.className = 'freq-page-card-pin';
      pinSpan.textContent = '已置顶';
      cardFooter.appendChild(pinSpan);
    }

    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'freq-page-card-actions';
    const pinBtn = document.createElement('button');
    pinBtn.className = 'freq-page-card-btn';
    pinBtn.dataset.action = 'pin';
    pinBtn.textContent = page.pinned ? '取消置顶' : '置顶';
    const removeBtn = document.createElement('button');
    removeBtn.className = 'freq-page-card-btn';
    removeBtn.dataset.action = 'remove';
    removeBtn.textContent = '移除';
    const openBtn = document.createElement('button');
    openBtn.className = 'freq-page-card-btn primary';
    openBtn.dataset.action = 'open';
    openBtn.textContent = '打开';
    actionsDiv.appendChild(pinBtn);
    actionsDiv.appendChild(removeBtn);
    actionsDiv.appendChild(openBtn);
    cardFooter.appendChild(actionsDiv);

    item.appendChild(cardHeader);
    item.appendChild(barWrapper);
    item.appendChild(cardFooter);

    openBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const result = await chrome.runtime.sendMessage({ action: 'openFreqPage', url: page.url });
      if (result && result.switched) {
        showToast('已切换到已打开的标签页', 'success');
      }
    });

    pinBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const action = page.pinned ? 'unpinFreqPage' : 'pinFreqPage';
      await chrome.runtime.sendMessage({ action, url: page.url });
      await loadFreqPages();
    });

    removeBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await chrome.runtime.sendMessage({ action: 'removeFreqPage', url: page.url });
      await loadFreqPages();
      showToast('已移除', 'success');
    });

    item.addEventListener('click', async () => {
      const result = await chrome.runtime.sendMessage({ action: 'openFreqPage', url: page.url });
      if (result && result.switched) {
        showToast('已切换到已打开的标签页', 'success');
      }
    });

    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });

    list.appendChild(item);
  });

  container.appendChild(list);
}
