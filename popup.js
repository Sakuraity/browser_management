let allWindows = [];
let searchQuery = '';

document.addEventListener('DOMContentLoaded', async () => {
  await loadTabs();
  await loadFreqPages();

  document.getElementById('openDashboardBtn').addEventListener('click', openDashboard);
  document.getElementById('closeDuplicatesBtn').addEventListener('click', closeDuplicates);
  document.getElementById('settingsBtn').addEventListener('click', openSettings);

  const searchInput = document.getElementById('popupSearch');
  searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value.trim().toLowerCase();
    renderTabs();
  });
  searchInput.focus();
});

async function loadTabs() {
  try {
    const response = await chrome.runtime.sendMessage({action: 'getAllTabs'});
    if (response) {
      allWindows = response;
    }
    renderTabs();
  } catch (e) {
    console.error('加载标签页失败:', e);
  }
}

function renderTabs() {
  const content = document.getElementById('content');
  content.innerHTML = '';

  let totalTabs = 0;
  const urlCount = new Map();

  allWindows.forEach(window => {
    window.tabs.forEach(tab => {
      if (tab.url && !tab.url.startsWith('chrome://')) {
        urlCount.set(tab.url, (urlCount.get(tab.url) || 0) + 1);
      }
      totalTabs++;
    });
  });

  document.getElementById('windowCount').textContent = `${allWindows.length} 个窗口`;
  document.getElementById('tabCount').textContent = `${totalTabs} 个标签页`;

  let duplicateCount = 0;
  urlCount.forEach((count, url) => {
    if (count > 1) {
      duplicateCount += count - 1;
    }
  });
  document.getElementById('duplicateCount').textContent = `${duplicateCount} 个重复`;

  const filteredWindows = allWindows.map((win, index) => {
    const filteredTabs = searchQuery
      ? win.tabs.filter(t => {
          const text = `${t.title || ''} ${t.url || ''}`.toLowerCase();
          return text.includes(searchQuery);
        })
      : win.tabs;
    return { ...win, displayNum: index + 1, filteredTabs };
  }).filter(win => win.filteredTabs.length > 0);

  if (filteredWindows.length === 0) {
    content.innerHTML = `
      <div class="empty-state" style="text-align:center;padding:40px 20px;color:#a8a3a0;">
        <div style="font-size:32px;margin-bottom:8px;opacity:0.5;">🔍</div>
        <div style="font-size:13px;">未找到匹配的标签页</div>
      </div>
    `;
    return;
  }

  filteredWindows.forEach((window) => {
    const windowGroup = document.createElement('div');
    windowGroup.className = 'window-group';

    const windowHeader = document.createElement('div');
    windowHeader.className = 'window-header';
    windowHeader.innerHTML = `
      <span>窗口 ${window.displayNum}</span>
      <span class="window-meta">
        ${window.focused ? '<span class="focused-badge"></span>当前 · ' : ''}
        ${window.filteredTabs.length} 个标签页
      </span>
    `;
    windowGroup.appendChild(windowHeader);

    const tabsByDomain = groupTabsByDomain(window.filteredTabs);

    Object.keys(tabsByDomain).forEach(domain => {
      const domainGroup = document.createElement('div');
      domainGroup.className = 'domain-group';

      const domainName = document.createElement('div');
      domainName.className = 'domain-name';
      domainName.textContent = domain;
      domainGroup.appendChild(domainName);

      tabsByDomain[domain].forEach(tab => {
        const tabItem = createTabItem(tab, urlCount.get(tab.url) > 1);
        domainGroup.appendChild(tabItem);
      });

      windowGroup.appendChild(domainGroup);
    });

    content.appendChild(windowGroup);
  });
}

function groupTabsByDomain(tabs) {
  const groups = {};

  tabs.forEach(tab => {
    let domain = '其他';
    if (tab.url && !tab.url.startsWith('chrome://')) {
      try {
        const url = new URL(tab.url);
        domain = url.hostname;
      } catch (e) {
        domain = '其他';
      }
    }

    if (!groups[domain]) {
      groups[domain] = [];
    }
    groups[domain].push(tab);
  });

  return groups;
}

function createTabItem(tab, isDuplicate) {
  const tabItem = document.createElement('div');
  tabItem.className = 'tab-item';

  const favicon = document.createElement('img');
  favicon.className = 'tab-favicon';
  favicon.src = tab.favIconUrl || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect fill="%23ccc" width="16" height="16" rx="2"/></svg>';

  const title = document.createElement('span');
  title.className = 'tab-title';
  title.textContent = tab.title || tab.url || '新标签页';

  tabItem.appendChild(favicon);
  tabItem.appendChild(title);

  if (isDuplicate) {
    const badge = document.createElement('span');
    badge.className = 'duplicate-badge';
    badge.textContent = '重复';
    tabItem.appendChild(badge);
  }

  const closeBtn = document.createElement('button');
  closeBtn.className = 'tab-close';
  closeBtn.textContent = '关闭';
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    chrome.tabs.remove(tab.id);
    loadTabs();
  });
  tabItem.appendChild(closeBtn);

  tabItem.addEventListener('click', () => {
    chrome.runtime.sendMessage({
      action: 'switchToTab',
      tabId: tab.id,
      windowId: tab.windowId
    });
  });

  return tabItem;
}

async function closeDuplicates() {
  try {
    const response = await chrome.runtime.sendMessage({action: 'closeDuplicates'});
    if (response && response.count > 0) {
      document.getElementById('duplicateCount').textContent = '0 个重复';
    }
    await loadTabs();
  } catch (e) {
    console.error('关闭重复页面失败:', e);
  }
}

function openSettings() {
  chrome.runtime.openOptionsPage();
}

async function openDashboard() {
  const dashboardUrl = chrome.runtime.getURL('dashboard.html');

  const existingTabs = await chrome.tabs.query({ url: dashboardUrl });

  if (existingTabs.length > 0) {
    await chrome.tabs.update(existingTabs[0].id, { active: true });
    await chrome.windows.update(existingTabs[0].windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: dashboardUrl });
  }
}

async function loadFreqPages() {
  try {
    const pages = await chrome.runtime.sendMessage({ action: 'getFreqPages', limit: 8 });
    if (!pages || pages.length === 0) {
      document.getElementById('freqPagesSection').style.display = 'none';
      return;
    }

    const section = document.getElementById('freqPagesSection');
    const list = document.getElementById('freqPagesList');
    section.style.display = 'block';
    list.innerHTML = '';

    pages.forEach(page => {
      const item = document.createElement('div');
      item.className = 'freq-page-item';
      if (page.pinned) item.classList.add('pinned');

      const favicon = document.createElement('img');
      favicon.className = 'freq-page-favicon';
      favicon.src = page.favIconUrl || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect fill="%23ccc" width="16" height="16" rx="2"/></svg>';

      const title = document.createElement('span');
      title.className = 'freq-page-title';
      title.textContent = page.title || page.url;
      title.title = page.url;

      const count = document.createElement('span');
      count.className = 'freq-page-count';
      count.textContent = `${page.count}次`;

      item.appendChild(favicon);
      item.appendChild(title);
      item.appendChild(count);

      item.addEventListener('click', (e) => {
        if (e.altKey) {
          chrome.tabs.create({ url: page.url });
        } else {
          chrome.runtime.sendMessage({ action: 'openFreqPage', url: page.url });
        }
      });

      item.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showFreqPageMenu(e, page);
      });

      list.appendChild(item);
    });
  } catch (e) {
    console.error('加载高频页面失败:', e);
  }
}

function showFreqPageMenu(e, page) {
  const existing = document.querySelector('.freq-context-menu');
  if (existing) existing.remove();

  const menu = document.createElement('div');
  menu.className = 'freq-context-menu';
  menu.style.left = e.clientX + 'px';
  menu.style.top = e.clientY + 'px';

  const pinLabel = page.pinned ? '取消置顶' : '置顶';
  const pinAction = page.pinned ? 'unpin' : 'pin';

  menu.innerHTML = `
    <div class="freq-menu-item" data-action="${pinAction}">${pinLabel}</div>
    <div class="freq-menu-item" data-action="remove">移除</div>
    <div class="freq-menu-item" data-action="copy">复制URL</div>
  `;

  document.body.appendChild(menu);

  const closeMenu = () => menu.remove();
  menu.querySelector(`[data-action="${pinAction}"]`).addEventListener('click', async () => {
    const action = page.pinned ? 'unpinFreqPage' : 'pinFreqPage';
    await chrome.runtime.sendMessage({ action, url: page.url });
    await loadFreqPages();
    closeMenu();
  });
  menu.querySelector('[data-action="remove"]').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ action: 'removeFreqPage', url: page.url });
    await loadFreqPages();
    closeMenu();
  });
  menu.querySelector('[data-action="copy"]').addEventListener('click', () => {
    navigator.clipboard.writeText(page.url);
    closeMenu();
  });

  setTimeout(() => {
    document.addEventListener('click', closeMenu, { once: true });
  }, 10);
}
