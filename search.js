let allTabs = [];
let filteredTabs = [];
let selectedIndex = 0;
let searchTabId = null;
let searchWindowId = null;

document.addEventListener('DOMContentLoaded', async () => {
  const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (currentTab) {
    searchTabId = currentTab.id;
    searchWindowId = currentTab.windowId;
  }

  await loadTabs();
  renderResults();

  chrome.tabs.onCreated.addListener(() => refreshData());
  chrome.tabs.onRemoved.addListener(() => refreshData());
  chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
    if (changeInfo.url || changeInfo.title || changeInfo.status === 'complete') {
      refreshData();
    }
  });
  chrome.tabs.onMoved.addListener(() => refreshData());
  chrome.tabs.onAttached.addListener(() => refreshData());
  chrome.tabs.onDetached.addListener(() => refreshData());
  chrome.windows.onCreated.addListener(() => refreshData());
  chrome.windows.onRemoved.addListener(() => refreshData());

  const searchInput = document.getElementById('searchInput');
  searchInput.addEventListener('input', () => {
    filterTabs();
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

async function refreshData() {
  await loadTabs();
  filterTabs();
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

function renderResults() {
  const container = document.getElementById('results');

  if (filteredTabs.length === 0) {
    container.innerHTML = `
      <div class="empty-results">
        <div class="empty-results-icon">🔍</div>
        <div class="empty-results-text">未找到匹配的标签页</div>
      </div>`;
    return;
  }

  container.innerHTML = '';

  filteredTabs.forEach((tab, index) => {
    const item = document.createElement('div');
    item.className = `result-item ${index === selectedIndex ? 'selected' : ''}`;
    item.dataset.index = index;

    const faviconImg = document.createElement('img');
    faviconImg.className = 'result-favicon';
    faviconImg.src = tab.favIconUrl || 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"%3E%3Crect fill="%23555" width="16" height="16" rx="2"/%3E%3C/svg%3E';
    faviconImg.alt = '';

    const query = document.getElementById('searchInput').value.trim().toLowerCase();
    const titleHtml = query ? highlightMatch(tab.title, query) : escapeHtml(tab.title);
    const urlHtml = query ? highlightMatch(truncateUrl(tab.url), query) : escapeHtml(truncateUrl(tab.url));

    const resultInfo = document.createElement('div');
    resultInfo.className = 'result-info';
    resultInfo.innerHTML = `
      <div class="result-title">${titleHtml}</div>
      <div class="result-url">${urlHtml}</div>
    `;

    const domainSpan = document.createElement('span');
    domainSpan.className = 'result-domain';
    domainSpan.textContent = tab.domain;

    const windowSpan = document.createElement('span');
    windowSpan.className = 'result-window';
    windowSpan.textContent = `窗口${tab.windowIndex}`;

    const copyBtn = document.createElement('button');
    copyBtn.className = 'result-copy-btn';
    copyBtn.title = '复制链接';
    copyBtn.dataset.index = index;
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
      copyTabUrl(index);
    });
    item.addEventListener('click', (e) => switchToTab(index, e.altKey));
    item.addEventListener('mouseenter', () => {
      selectedIndex = index;
      updateSelection();
    });

    container.appendChild(item);
  });

  scrollToSelected();
}

function handleKeyDown(e) {
  if (e.key === 'Escape') {
    e.preventDefault();
    closeSearchTab();
    return;
  }

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (selectedIndex < filteredTabs.length - 1) {
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
    if (filteredTabs.length > 0) {
      switchToTab(selectedIndex, e.altKey);
    }
    return;
  }

  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'c') {
    e.preventDefault();
    if (filteredTabs.length > 0) {
      copyTabUrl(selectedIndex);
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
    item.classList.toggle('selected', index === selectedIndex);
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
      const targetTab = await chrome.tabs.get(tab.id);
      const isInGroup = typeof targetTab.groupId === 'number' && targetTab.groupId !== -1;
      const isPinned = targetTab.pinned;

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

async function copyTabUrl(index) {
  const tab = filteredTabs[index];
  if (!tab) return;

  try {
    await navigator.clipboard.writeText(tab.url);
    showToast('已复制链接');
  } catch (e) {
    const textarea = document.createElement('textarea');
    textarea.value = tab.url;
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
