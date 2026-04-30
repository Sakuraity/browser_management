let allTabs = [];
let filteredTabs = [];
let historyItems = [];
let selectedIndex = 0;
let searchTabId = null;
let searchWindowId = null;

const HISTORY_MAX_RESULTS = 15;
const HISTORY_DAYS = 7;

document.addEventListener('DOMContentLoaded', async () => {
  const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (currentTab) {
    searchTabId = currentTab.id;
    searchWindowId = currentTab.windowId;
  }

  await loadTabs();
  renderResults();

  chrome.tabs.onCreated.addListener(() => refreshTabs());
  chrome.tabs.onRemoved.addListener(() => refreshTabs());
  chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
    if (changeInfo.url || changeInfo.title || changeInfo.status === 'complete') {
      refreshTabs();
    }
  });
  chrome.tabs.onMoved.addListener(() => refreshTabs());
  chrome.tabs.onAttached.addListener(() => refreshTabs());
  chrome.tabs.onDetached.addListener(() => refreshTabs());
  chrome.windows.onCreated.addListener(() => refreshTabs());
  chrome.windows.onRemoved.addListener(() => refreshTabs());

  const searchInput = document.getElementById('searchInput');
  searchInput.addEventListener('input', async () => {
    filterTabs();
    await searchHistory();
    selectedIndex = 0;
    renderResults();
  });

  searchInput.focus();

  document.addEventListener('keydown', handleKeyDown);
});

async function loadTabs() {
  const windows = await chrome.windows.getAll({ populate: true });
  allTabs = [];

  windows.forEach((win, winIndex) => {
    win.tabs.forEach(tab => {
      if (!tab.url) return;
      if (tab.url.startsWith('chrome://')) return;
      if (tab.url.startsWith('chrome-extension://')) return;
      if (tab.id === searchTabId) return;

      let domain = '';
      try {
        domain = new URL(tab.url).hostname;
      } catch (e) {
        domain = '其他';
      }

      allTabs.push({
        id: tab.id,
        windowId: tab.windowId,
        title: tab.title || tab.url,
        url: tab.url,
        domain: domain,
        favIconUrl: tab.favIconUrl,
        active: tab.active,
        windowFocused: win.focused,
        windowIndex: winIndex + 1
      });
    });
  });

  allTabs.sort((a, b) => {
    if (a.windowFocused && a.active) return -1;
    if (b.windowFocused && b.active) return 1;
    if (a.windowFocused) return -1;
    if (b.windowFocused) return 1;
    return 0;
  });

  filteredTabs = [...allTabs];
}

async function refreshTabs() {
  await loadTabs();
  filterTabs();
  selectedIndex = 0;
  renderResults();
}

function filterTabs() {
  const query = document.getElementById('searchInput').value.trim().toLowerCase();

  if (!query) {
    filteredTabs = [...allTabs];
    selectedIndex = 0;
    return;
  }

  const terms = query.split(/\s+/);

  filteredTabs = allTabs.filter(tab => {
    const searchText = `${tab.title} ${tab.url} ${tab.domain}`.toLowerCase();
    return terms.every(term => searchText.includes(term));
  });

  filteredTabs.sort((a, b) => {
    const aTitle = a.title.toLowerCase();
    const bTitle = b.title.toLowerCase();
    const aDomain = a.domain.toLowerCase();
    const bDomain = b.domain.toLowerCase();
    const aSearchText = `${aTitle} ${aDomain}`;
    const bSearchText = `${bTitle} ${bDomain}`;

    const aScore = computeMatchScore(aSearchText, terms);
    const bScore = computeMatchScore(bSearchText, terms);
    if (aScore !== bScore) return bScore - aScore;

    return 0;
  });

  selectedIndex = 0;
}

async function searchHistory() {
  const query = document.getElementById('searchInput').value.trim();

  if (!query) {
    historyItems = [];
    return;
  }

  if (typeof chrome.history === 'undefined' || !chrome.history.search) {
    historyItems = [];
    return;
  }

  try {
    const startTime = Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000;
    const terms = query.toLowerCase().split(/\s+/);
    const apiText = terms[0];

    const results = await chrome.history.search({
      text: apiText,
      startTime: startTime,
      maxResults: 200
    });

    const openTabUrls = new Set(filteredTabs.map(t => t.url));

    historyItems = results
      .filter(item => item.url && !item.url.startsWith('chrome://') && !item.url.startsWith('chrome-extension://'))
      .filter(item => !openTabUrls.has(item.url))
      .filter(item => {
        const searchText = `${item.title || ''} ${item.url}`.toLowerCase();
        return terms.every(term => searchText.includes(term));
      })
      .slice(0, HISTORY_MAX_RESULTS)
      .map(item => {
        let domain = '';
        try {
          domain = new URL(item.url).hostname;
        } catch (e) {
          domain = '其他';
        }
        return {
          title: item.title || item.url,
          url: item.url,
          domain: domain,
          lastVisitTime: item.lastVisitTime || 0,
          visitCount: item.visitCount || 0
        };
      });
  } catch (e) {
    historyItems = [];
  }
}

function getTotalItemCount() {
  return filteredTabs.length + historyItems.length;
}

function getItemByGlobalIndex(index) {
  if (index < filteredTabs.length) {
    return { type: 'tab', data: filteredTabs[index], localIndex: index };
  }
  const historyIndex = index - filteredTabs.length;
  if (historyIndex < historyItems.length) {
    return { type: 'history', data: historyItems[historyIndex], localIndex: historyIndex };
  }
  return null;
}

function renderResults() {
  const container = document.getElementById('results');
  const query = document.getElementById('searchInput').value.trim().toLowerCase();
  const hasQuery = query.length > 0;
  const totalItems = filteredTabs.length + historyItems.length;

  container.innerHTML = '';

  if (totalItems === 0) {
    const emptyDiv = document.createElement('div');
    emptyDiv.className = 'empty-results';

    const emptyIcon = document.createElement('div');
    emptyIcon.className = 'empty-results-icon';
    emptyIcon.textContent = '🔍';

    const emptyText = document.createElement('div');
    emptyText.className = 'empty-results-text';
    emptyText.textContent = hasQuery ? '未找到匹配的结果' : '未找到匹配的标签页';

    emptyDiv.appendChild(emptyIcon);
    emptyDiv.appendChild(emptyText);
    container.appendChild(emptyDiv);
    return;
  }

  if (filteredTabs.length > 0) {
    if (hasQuery) {
      const header = document.createElement('div');
      header.className = 'section-header';
      header.textContent = '已打开';
      container.appendChild(header);
    }

    filteredTabs.forEach((tab, index) => {
      const globalIndex = index;
      const item = createTabResultItem(tab, globalIndex, query);
      container.appendChild(item);
    });
  }

  if (hasQuery && historyItems.length > 0) {
    const header = document.createElement('div');
    header.className = 'section-header';
    header.textContent = '历史记录';
    container.appendChild(header);

    historyItems.forEach((histItem, index) => {
      const globalIndex = filteredTabs.length + index;
      const item = createHistoryResultItem(histItem, globalIndex, query);
      container.appendChild(item);
    });
  }

  scrollToSelected();
}

function createTabResultItem(tab, globalIndex, query) {
  const item = document.createElement('div');
  item.className = `result-item ${globalIndex === selectedIndex ? 'selected' : ''}`;
  item.dataset.index = globalIndex;

  const faviconImg = document.createElement('img');
  faviconImg.className = 'result-favicon';
  faviconImg.src = tab.favIconUrl || 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"%3E%3Crect fill="%23555" width="16" height="16" rx="2"/%3E%3C/svg%3E';
  faviconImg.alt = '';

  const resultInfo = document.createElement('div');
  resultInfo.className = 'result-info';

  const titleDiv = document.createElement('div');
  titleDiv.className = 'result-title';
  if (query) {
    titleDiv.innerHTML = highlightMatch(tab.title, query);
  } else {
    titleDiv.textContent = tab.title;
  }

  const urlDiv = document.createElement('div');
  urlDiv.className = 'result-url';
  if (query) {
    urlDiv.innerHTML = highlightMatch(truncateUrl(tab.url), query);
  } else {
    urlDiv.textContent = truncateUrl(tab.url);
  }

  resultInfo.appendChild(titleDiv);
  resultInfo.appendChild(urlDiv);

  const domainSpan = document.createElement('span');
  domainSpan.className = 'result-domain';
  domainSpan.textContent = tab.domain;

  const windowSpan = document.createElement('span');
  windowSpan.className = 'result-window';
  windowSpan.textContent = `窗口${tab.windowIndex}`;

  const copyBtn = document.createElement('button');
  copyBtn.className = 'result-copy-btn';
  copyBtn.title = '复制链接';
  copyBtn.dataset.index = globalIndex;
  copyBtn.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <rect x="5" y="5" width="9" height="9" rx="1.5" stroke="currentColor" stroke-width="1.3"/>
      <path d="M3 11V3a1.5 1.5 0 011.5-1.5H11" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
    </svg>
  `;

  item.appendChild(faviconImg);
  item.appendChild(resultInfo);
  item.appendChild(domainSpan);
  item.appendChild(windowSpan);
  item.appendChild(copyBtn);

  copyBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    copyTabUrl(globalIndex);
  });
  item.addEventListener('click', (e) => switchToTab(globalIndex, e.altKey));
  item.addEventListener('mouseenter', () => {
    selectedIndex = globalIndex;
    updateSelection();
  });

  return item;
}

function createHistoryResultItem(histItem, globalIndex, query) {
  const item = document.createElement('div');
  item.className = `result-item result-item-history ${globalIndex === selectedIndex ? 'selected' : ''}`;
  item.dataset.index = globalIndex;

  const faviconImg = document.createElement('img');
  faviconImg.className = 'result-favicon';
  faviconImg.src = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(histItem.domain)}&sz=32`;
  faviconImg.alt = '';
  faviconImg.onerror = function() {
    this.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"%3E%3Crect fill="%23555" width="16" height="16" rx="2"/%3E%3C/svg%3E';
  };

  const resultInfo = document.createElement('div');
  resultInfo.className = 'result-info';

  const titleDiv = document.createElement('div');
  titleDiv.className = 'result-title';
  if (query) {
    titleDiv.innerHTML = highlightMatch(histItem.title, query);
  } else {
    titleDiv.textContent = histItem.title;
  }

  const urlDiv = document.createElement('div');
  urlDiv.className = 'result-url';
  if (query) {
    urlDiv.innerHTML = highlightMatch(truncateUrl(histItem.url), query);
  } else {
    urlDiv.textContent = truncateUrl(histItem.url);
  }

  resultInfo.appendChild(titleDiv);
  resultInfo.appendChild(urlDiv);

  const domainSpan = document.createElement('span');
  domainSpan.className = 'result-domain';
  domainSpan.textContent = histItem.domain;

  const timeSpan = document.createElement('span');
  timeSpan.className = 'result-history-time';
  timeSpan.textContent = formatRelativeTime(histItem.lastVisitTime);

  const copyBtn = document.createElement('button');
  copyBtn.className = 'result-copy-btn';
  copyBtn.title = '复制链接';
  copyBtn.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <rect x="5" y="5" width="9" height="9" rx="1.5" stroke="currentColor" stroke-width="1.3"/>
      <path d="M3 11V3a1.5 1.5 0 011.5-1.5H11" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
    </svg>
  `;

  item.appendChild(faviconImg);
  item.appendChild(resultInfo);
  item.appendChild(domainSpan);
  item.appendChild(timeSpan);
  item.appendChild(copyBtn);

  copyBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    copyUrl(histItem.url);
  });
  item.addEventListener('click', (e) => openHistoryItem(histItem, e.altKey));
  item.addEventListener('mouseenter', () => {
    selectedIndex = globalIndex;
    updateSelection();
  });

  return item;
}

function formatRelativeTime(timestamp) {
  if (!timestamp) return '';
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}天前`;
  if (hours > 0) return `${hours}小时前`;
  if (minutes > 0) return `${minutes}分钟前`;
  return '刚刚';
}

function handleKeyDown(e) {
  const totalItems = getTotalItemCount();

  if (e.key === 'Escape') {
    e.preventDefault();
    closeSearchTab();
    return;
  }

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (selectedIndex < totalItems - 1) {
      selectedIndex++;
      updateSelection();
    }
    return;
  }

  if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (selectedIndex > 0) {
      selectedIndex--;
      updateSelection();
    }
    return;
  }

  if (e.key === 'Enter') {
    e.preventDefault();
    if (totalItems > 0) {
      const itemInfo = getItemByGlobalIndex(selectedIndex);
      if (itemInfo) {
        if (itemInfo.type === 'tab') {
          switchToTab(selectedIndex, e.altKey);
        } else {
          openHistoryItem(itemInfo.data, e.altKey);
        }
      }
    }
    return;
  }

  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'c') {
    e.preventDefault();
    if (totalItems > 0) {
      const itemInfo = getItemByGlobalIndex(selectedIndex);
      if (itemInfo) {
        if (itemInfo.type === 'tab') {
          copyTabUrl(selectedIndex);
        } else {
          copyUrl(itemInfo.data.url);
        }
      }
    }
    return;
  }

  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    document.getElementById('searchInput').focus();
    document.getElementById('searchInput').select();
    return;
  }
}

function updateSelection() {
  const items = document.querySelectorAll('.result-item');
  items.forEach((item, index) => {
    const globalIndex = parseInt(item.dataset.index, 10);
    item.classList.toggle('selected', globalIndex === selectedIndex);
  });
  scrollToSelected();
}

function scrollToSelected() {
  const selected = document.querySelector('.result-item.selected');
  if (selected) {
    selected.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

async function switchToTab(index, forceSwitch = false) {
  const tab = filteredTabs[index];
  if (!tab) return;

  try {
    if (tab.windowId === searchWindowId || forceSwitch) {
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
      closeSearchTab();
    } else {
      let targetTab;
      try {
        targetTab = await chrome.tabs.get(tab.id);
      } catch (e) {
        console.warn('目标标签页已不存在:', tab.url);
        await chrome.tabs.create({ url: tab.url, windowId: searchWindowId, active: true });
        closeSearchTab();
        return;
      }

      const isInGroup = typeof targetTab.groupId === 'number' && targetTab.groupId !== -1;
      const isPinned = !!targetTab.pinned;

      if (isInGroup || isPinned) {
        await chrome.tabs.create({ url: tab.url, windowId: searchWindowId, active: true });
        closeSearchTab();
      } else {
        const sameWindowTabs = await chrome.tabs.query({ windowId: searchWindowId });
        const existingTab = sameWindowTabs.find(t => t.url === tab.url && t.id !== searchTabId);

        if (existingTab) {
          await chrome.tabs.update(existingTab.id, { active: true });
          await chrome.tabs.remove(tab.id);
          closeSearchTab();
        } else {
          await chrome.tabs.move(tab.id, { windowId: searchWindowId, index: -1 });
          await chrome.tabs.update(tab.id, { active: true });
          closeSearchTab();
        }
      }
    }
  } catch (e) {
    console.error('切换标签页失败:', e);
    try {
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
      closeSearchTab();
    } catch (e2) {
      console.error('降级切换也失败:', e2);
    }
  }
}

async function openHistoryItem(histItem, forceSwitch = false) {
  try {
    const allCurrentTabs = await chrome.tabs.query({ windowId: searchWindowId });
    const existingTab = allCurrentTabs.find(t => t.url === histItem.url && t.id !== searchTabId);

    if (existingTab) {
      await chrome.tabs.update(existingTab.id, { active: true });
      closeSearchTab();
    } else {
      await chrome.tabs.create({ url: histItem.url, windowId: searchWindowId, active: true });
      closeSearchTab();
    }
  } catch (e) {
    console.error('打开历史记录页面失败:', e);
    try {
      await chrome.tabs.create({ url: histItem.url });
      closeSearchTab();
    } catch (e2) {
      console.error('降级打开也失败:', e2);
    }
  }
}

async function copyTabUrl(index) {
  const tab = filteredTabs[index];
  if (!tab) return;
  await copyUrl(tab.url);
}

async function copyUrl(url) {
  try {
    await navigator.clipboard.writeText(url);
    showToast('已复制链接');
  } catch (e) {
    const textarea = document.createElement('textarea');
    textarea.value = url;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    showToast('已复制链接');
  }
}

function showToast(message) {
  const existing = document.querySelector('.copy-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'copy-toast';
  toast.textContent = message;
  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.add('show');
  });

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 1500);
}

function closeSearchTab() {
  if (searchTabId) {
    const id = searchTabId;
    searchTabId = null;
    chrome.tabs.remove(id);
  }
}

function highlightMatch(text, query) {
  if (!query) return escapeHtml(text);

  const escaped = escapeHtml(text);
  const escapedQuery = escapeHtml(query);

  const regex = new RegExp(`(${escapedQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return escaped.replace(regex, '<span class="highlight">$1</span>');
}

function truncateUrl(url) {
  try {
    const u = new URL(url);
    let result = u.hostname + u.pathname;
    if (result.length > 60) {
      result = result.substring(0, 57) + '...';
    }
    return result;
  } catch (e) {
    return url;
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function computeMatchScore(text, terms) {
  let score = 0;
  for (const term of terms) {
    if (text.startsWith(term)) {
      score += 3;
    } else if (text.includes(term)) {
      score += 1;
    }
  }
  return score;
}
