chrome.runtime.onInstalled.addListener(() => {
  console.log('浏览器多页面管理工具已安装');
  initializeFreqPages();
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'open-dashboard') {
    await openDashboard();
  } else if (command === 'close-duplicates') {
    const count = await closeDuplicateTabs();
    console.log(`已关闭 ${count} 个重复页面`);
  } else if (command === 'search-tabs') {
    await openSearchTabs();
  }
});

async function openSearchTabs() {
  const searchUrl = chrome.runtime.getURL('search.html');

  const existingTabs = await chrome.tabs.query({ url: searchUrl });

  if (existingTabs.length > 0) {
    await chrome.tabs.update(existingTabs[0].id, { active: true });
    await chrome.windows.update(existingTabs[0].windowId, { focused: true });
  } else {
    const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (currentTab) {
      await chrome.tabs.create({ url: searchUrl, index: currentTab.index + 1 });
    } else {
      await chrome.tabs.create({ url: searchUrl });
    }
  }
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

chrome.tabs.onCreated.addListener(async (tab) => {
  await checkDuplicateTabs(tab);
  await recordFreqPage(tab);
});

chrome.tabs.onUpdated.addListener(async (_tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    await checkDuplicateTabs(tab);
  }
  if (changeInfo.status === 'complete' && tab.url) {
    await updateFreqPageInfo(tab);
  }
});

async function checkDuplicateTabs(newTab) {
  if (!newTab.url || newTab.url.startsWith('chrome://') || newTab.url.startsWith('chrome-extension://')) {
    return;
  }

  const settings = await getSettings();
  if (!settings.enableDuplicateDetection) {
    return;
  }

  const allTabs = await chrome.tabs.query({});
  const duplicates = allTabs.filter(tab =>
    tab.id !== newTab.id && tab.url === newTab.url
  );

  if (duplicates.length > 0) {
    console.log('发现重复页面:', newTab.url);

    if (settings.duplicateAction === 'close') {
      await chrome.tabs.remove(newTab.id);
    } else if (settings.duplicateAction === 'notify') {
      console.log('提示用户处理重复页面');
    }
  }
}

async function getSettings() {
  const result = await chrome.storage.sync.get({
    enableDuplicateDetection: true,
    duplicateAction: 'notify',
    maxWindows: 3,
    enableDoubleCommand: true,
    enableFreqPages: true,
    freqPagesMaxDisplay: 10,
    freqPagesDecayFactor: 0.95,
    excludedDomains: ''
  });
  return result;
}

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === 'getAllTabs') {
    getAllTabsAndWindows().then(data => sendResponse(data));
    return true;
  } else if (request.action === 'closeTabs') {
    chrome.tabs.remove(request.tabIds).then(() => sendResponse({success: true}));
    return true;
  } else if (request.action === 'switchToTab') {
    chrome.tabs.update(request.tabId, {active: true}).then(() => {
      return chrome.windows.update(request.windowId, {focused: true});
    }).then(() => {
      sendResponse({success: true});
    }).catch(err => {
      console.error('switchToTab error:', err);
      sendResponse({success: false, error: err.message});
    });
    return true;
  } else if (request.action === 'closeDuplicates') {
    closeDuplicateTabs().then(count => sendResponse({count}));
    return true;
  } else if (request.action === 'getFreqPages') {
    getFreqPages(request.limit)
      .then(data => sendResponse(data))
      .catch(err => {
        console.error('getFreqPages error:', err);
        sendResponse([]);
      });
    return true;
  } else if (request.action === 'removeFreqPage') {
    removeFreqPage(request.url)
      .then(() => sendResponse({success: true}))
      .catch(err => {
        console.error('removeFreqPage error:', err);
        sendResponse({success: false});
      });
    return true;
  } else if (request.action === 'pinFreqPage') {
    pinFreqPage(request.url)
      .then(() => sendResponse({success: true}))
      .catch(err => {
        console.error('pinFreqPage error:', err);
        sendResponse({success: false});
      });
    return true;
  } else if (request.action === 'unpinFreqPage') {
    unpinFreqPage(request.url)
      .then(() => sendResponse({success: true}))
      .catch(err => {
        console.error('unpinFreqPage error:', err);
        sendResponse({success: false});
      });
    return true;
  } else if (request.action === 'openFreqPage') {
    openFreqPage(request.url)
      .then(result => sendResponse(result))
      .catch(err => {
        console.error('openFreqPage error:', err);
        sendResponse({success: false});
      });
    return true;
  } else if (request.action === 'clearFreqPages') {
    clearFreqPages()
      .then(() => sendResponse({success: true}))
      .catch(err => {
        console.error('clearFreqPages error:', err);
        sendResponse({success: false});
      });
    return true;
  }
  return false;
});

async function getAllTabsAndWindows() {
  const windows = await chrome.windows.getAll({populate: true});
  return windows;
}

async function closeDuplicateTabs() {
  const allTabs = await chrome.tabs.query({});
  const urlMap = new Map();
  const tabsToClose = [];

  for (const tab of allTabs) {
    if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) continue;

    if (urlMap.has(tab.url)) {
      tabsToClose.push(tab.id);
    } else {
      urlMap.set(tab.url, true);
    }
  }

  if (tabsToClose.length > 0) {
    await chrome.tabs.remove(tabsToClose);
  }

  return tabsToClose.length;
}

async function initializeFreqPages() {
  const result = await chrome.storage.local.get('freqPagesData');
  if (!result.freqPagesData) {
    await chrome.storage.local.set({ freqPagesData: [] });
  }
}

async function recordFreqPage(tab) {
  if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url === 'about:blank') {
    return;
  }

  const settings = await getSettings();
  if (!settings.enableFreqPages) return;

  if (settings.excludedDomains) {
    const excluded = settings.excludedDomains.split(',').map(d => d.trim().toLowerCase()).filter(Boolean);
    if (excluded.some(d => tab.url.toLowerCase().includes(d))) return;
  }

  const result = await chrome.storage.local.get('freqPagesData');
  let data = result.freqPagesData || [];

  data = applyDecayInMemory(data);

  const existing = data.find(item => item.url === tab.url);
  if (existing) {
    existing.count += 1;
    existing.lastVisitedAt = Date.now();
    if (tab.title) existing.title = tab.title;
    if (tab.favIconUrl) existing.favIconUrl = tab.favIconUrl;
  } else {
    data.push({
      url: tab.url,
      title: tab.title || tab.url,
      favIconUrl: tab.favIconUrl || '',
      count: 1,
      lastVisitedAt: Date.now(),
      pinned: false
    });
  }

  data.sort((a, b) => {
    if (a.pinned !== b.pinned) return b.pinned ? 1 : -1;
    return b.count - a.count;
  });

  const trimmed = data.slice(0, 100);
  await chrome.storage.local.set({ freqPagesData: trimmed });
}

async function updateFreqPageInfo(tab) {
  if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) return;

  const result = await chrome.storage.local.get('freqPagesData');
  const data = result.freqPagesData || [];

  const existing = data.find(item => item.url === tab.url);
  if (existing) {
    if (tab.title) existing.title = tab.title;
    if (tab.favIconUrl) existing.favIconUrl = tab.favIconUrl;
    await chrome.storage.local.set({ freqPagesData: data });
  }
}

async function applyDecay() {
  const settings = await getSettings();
  const result = await chrome.storage.local.get('freqPagesData');
  let data = result.freqPagesData || [];

  data = applyDecayInMemory(data, settings.freqPagesDecayFactor);

  data.sort((a, b) => {
    if (a.pinned !== b.pinned) return b.pinned ? 1 : -1;
    return b.count - a.count;
  });

  await chrome.storage.local.set({ freqPagesData: data.slice(0, 100) });
}

function applyDecayInMemory(data, decayFactorOverride) {
  const decayFactor = decayFactorOverride || 0.95;
  const now = Date.now();

  for (const item of data) {
    if (item.pinned) continue;

    const hoursSinceLastVisit = (now - (item.lastVisitedAt || 0)) / (1000 * 60 * 60);
    if (hoursSinceLastVisit > 24) {
      const daysSinceLastVisit = hoursSinceLastVisit / 24;
      const decayRounds = Math.floor(daysSinceLastVisit);
      for (let i = 0; i < Math.min(decayRounds, 30); i++) {
        item.count = item.count * decayFactor;
      }
    }
  }

  return data.filter(item => item.pinned || item.count >= 0.5);
}

async function getFreqPages(limit = 10) {
  const settings = await getSettings();
  if (!settings.enableFreqPages) return [];

  await applyDecay();

  const result = await chrome.storage.local.get('freqPagesData');
  const data = result.freqPagesData || [];

  const maxDisplay = limit || settings.freqPagesMaxDisplay || 10;
  return data.slice(0, maxDisplay).map(item => ({
    ...item,
    count: Math.round(item.count)
  }));
}

async function removeFreqPage(url) {
  const result = await chrome.storage.local.get('freqPagesData');
  const data = result.freqPagesData || [];
  const filtered = data.filter(item => item.url !== url);
  await chrome.storage.local.set({ freqPagesData: filtered });
}

async function pinFreqPage(url) {
  const result = await chrome.storage.local.get('freqPagesData');
  const data = result.freqPagesData || [];
  const item = data.find(i => i.url === url);
  if (item) {
    item.pinned = true;
    data.sort((a, b) => {
      if (a.pinned !== b.pinned) return b.pinned ? 1 : -1;
      return b.count - a.count;
    });
    await chrome.storage.local.set({ freqPagesData: data });
  }
}

async function unpinFreqPage(url) {
  const result = await chrome.storage.local.get('freqPagesData');
  const data = result.freqPagesData || [];
  const item = data.find(i => i.url === url);
  if (item) {
    item.pinned = false;
    data.sort((a, b) => {
      if (a.pinned !== b.pinned) return b.pinned ? 1 : -1;
      return b.count - a.count;
    });
    await chrome.storage.local.set({ freqPagesData: data });
  }
}

async function openFreqPage(url) {
  const allTabs = await chrome.tabs.query({});
  const existingTab = allTabs.find(t => t.url === url);

  if (existingTab) {
    await chrome.tabs.update(existingTab.id, { active: true });
    await chrome.windows.update(existingTab.windowId, { focused: true });
    return { success: true, switched: true };
  } else {
    await chrome.tabs.create({ url: url });
    return { success: true, switched: false };
  }
}

async function clearFreqPages() {
  await chrome.storage.local.set({ freqPagesData: [] });
}
