document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  
  document.getElementById('saveBtn').addEventListener('click', saveSettings);
  document.getElementById('resetBtn').addEventListener('click', resetSettings);
});

async function loadSettings() {
  const settings = await getSettings();
  
  document.getElementById('enableDuplicateDetection').checked = settings.enableDuplicateDetection;
  document.getElementById('duplicateAction').value = settings.duplicateAction;
  document.getElementById('maxWindows').value = settings.maxWindows;
  document.getElementById('enableDoubleCommand').checked = settings.enableDoubleCommand;
  document.getElementById('enableFreqPages').checked = settings.enableFreqPages;
  document.getElementById('freqPagesMaxDisplay').value = settings.freqPagesMaxDisplay;
  document.getElementById('freqPagesDecayFactor').value = settings.freqPagesDecayFactor;
  document.getElementById('excludedDomains').value = settings.excludedDomains;
}

async function saveSettings() {
  const settings = {
    enableDuplicateDetection: document.getElementById('enableDuplicateDetection').checked,
    duplicateAction: document.getElementById('duplicateAction').value,
    maxWindows: parseInt(document.getElementById('maxWindows').value),
    enableDoubleCommand: document.getElementById('enableDoubleCommand').checked,
    enableFreqPages: document.getElementById('enableFreqPages').checked,
    freqPagesMaxDisplay: parseInt(document.getElementById('freqPagesMaxDisplay').value),
    freqPagesDecayFactor: parseFloat(document.getElementById('freqPagesDecayFactor').value),
    excludedDomains: document.getElementById('excludedDomains').value
  };
  
  await chrome.storage.sync.set(settings);
  
  showStatus('设置已保存！');
}

async function resetSettings() {
  const defaultSettings = {
    enableDuplicateDetection: true,
    duplicateAction: 'notify',
    maxWindows: 3,
    enableDoubleCommand: true,
    enableFreqPages: true,
    freqPagesMaxDisplay: 10,
    freqPagesDecayFactor: 0.95,
    excludedDomains: ''
  };

  await chrome.storage.sync.set(defaultSettings);
  await loadSettings();

  showStatus('已重置为默认设置！');
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

function showStatus(message) {
  const status = document.getElementById('status');
  status.textContent = message;
  status.className = 'status success';
  
  setTimeout(() => {
    status.className = 'status';
  }, 2000);
}
