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

async function saveSettings() {
  const notionKey = document.getElementById('notionKey').value.trim();
  const dbId = document.getElementById('dbId').value.trim();
  const saveBtn = document.getElementById('saveSettings');

  if (!notionKey || !dbId) {
    showStatus('Please fill in both fields.', 'error');
    return;
  }

  // Disable button and show loading state
  saveBtn.disabled = true;
  saveBtn.textContent = 'Validating...';
  showStatus('Testing Notion connection...', 'info');

  try {
    // Validate by fetching database info
    const response = await fetch(`https://api.notion.com/v1/databases/${dbId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${notionKey}`,
        'Notion-Version': '2022-06-28'
      }
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMsg = errorData.message || `HTTP ${response.status}`;

      if (response.status === 401) {
        throw new Error('Invalid API Key. Please check your Notion integration token.');
      } else if (response.status === 404) {
        throw new Error('Database not found. Please verify the Database ID and ensure it\'s shared with your integration.');
      } else {
        throw new Error(`Notion API error: ${errorMsg}`);
      }
    }

    const dbInfo = await response.json();
    const dbTitle = dbInfo.title?.[0]?.plain_text || 'Untitled';

    // Validation successful, save settings
    chrome.storage.sync.set({ notionKey, dbId }, () => {
      showStatus(`✅ Connected to "${dbTitle}"`, 'success');
    });

  } catch (error) {
    showStatus(`❌ ${error.message}`, 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save Settings';
  }
}

function showStatus(message, type) {
  const statusEl = document.getElementById('status');
  statusEl.textContent = message;
  statusEl.className = type;

  if (type === 'success') {
    setTimeout(() => {
      statusEl.className = '';
      statusEl.textContent = '';
    }, 5000);
  }
}
