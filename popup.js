document.addEventListener('DOMContentLoaded', init);

function init() {
  restoreSettings();
  document.getElementById('saveSettings').addEventListener('click', saveSettings);
}

function restoreSettings() {
  chrome.storage.sync.get(['notionKey', 'dbId'], (items) => {
    if (items.notionKey) document.getElementById('notionKey').value = items.notionKey;
    if (items.dbId) document.getElementById('dbId').value = items.dbId;
  });
}

function saveSettings() {
  const notionKey = document.getElementById('notionKey').value.trim();
  const dbId = document.getElementById('dbId').value.trim();

  chrome.storage.sync.set({ notionKey, dbId }, () => {
    showStatus('Settings saved successfully!', 'success');
  });
}

function showStatus(message, type) {
  const statusEl = document.getElementById('status');
  statusEl.textContent = message;
  statusEl.className = type;

  setTimeout(() => {
    statusEl.className = '';
    statusEl.textContent = '';
  }, 3000);
}
