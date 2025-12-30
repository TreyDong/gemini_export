chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "extract_chat") {
        const config = request.config || {};
        extractChatDataAsync(config)
            .then(data => sendResponse({ success: true, data: data }))
            .catch(e => {
                console.error(e);
                sendResponse({ success: false, error: e.message });
            });
        return true; // Keep the message channel open for async response
    }
    return true;
});

// Helper: Convert DOM to Markdown
function domToMarkdownRobust(node) {
    if (!node) return '';

    // Handle text nodes
    if (node.nodeType === Node.TEXT_NODE) {
        return node.textContent;
    }

    // Handle element nodes
    if (node.nodeType === Node.ELEMENT_NODE) {
        const tagName = node.tagName.toLowerCase();

        // Table special handling
        if (tagName === 'table') {
            return tableToMarkdown(node);
        }

        // Skip logic
        const style = window.getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden') return '';
        if (['script', 'style', 'noscript', 'meta', 'link'].includes(tagName)) return '';

        // Pre/Code handling
        if (tagName === 'pre') {
            const codeEl = node.querySelector('code');
            const lang = codeEl ? (codeEl.className.match(/language-(\w+)/) || [])[1] || '' : '';
            // Use innerText for code content to preserve line breaks exactly
            const codeText = codeEl ? codeEl.innerText : node.innerText;
            return `\n\`\`\`${lang}\n${codeText}\n\`\`\`\n`;
        }

        // Traverse children
        let inner = '';
        for (const child of node.childNodes) {
            inner += domToMarkdownRobust(child);
        }

        switch (tagName) {
            case 'p': return `\n${inner.trim()}\n\n`;
            case 'div': return `${inner}`;
            case 'br': return '  \n';
            case 'strong':
            case 'b': return `**${inner}**`;
            case 'em':
            case 'i': return `*${inner}*`;
            case 'h1': return `\n# ${inner}\n`;
            case 'h2': return `\n## ${inner}\n`;
            case 'h3': return `\n### ${inner}\n`;
            case 'h4': return `\n#### ${inner}\n`;
            case 'h5': return `\n##### ${inner}\n`;
            case 'h6': return `\n###### ${inner}\n`;
            case 'ul': return `\n${inner}\n`;
            case 'ol': return `\n${inner}\n`;
            case 'li': return `- ${inner.trim()}\n`;
            case 'a': return `[${inner}](${node.getAttribute('href')})`;
            case 'img': return `![${node.getAttribute('alt') || 'image'}](${node.getAttribute('src')})`;
            case 'blockquote': return `\n> ${inner.trim().replace(/\n/g, '\n> ')}\n`;
            case 'code':
                if (node.closest('pre')) return inner;
                return `\`${inner}\``;
            case 'tr': return `| ${inner.replace(/\n\s*/g, '')} |\n`;
            case 'td':
            case 'th': return `${inner} | `;
            default: return inner;
        }
    }
    return '';
}

function tableToMarkdown(table) {
    let md = '\n';
    const rows = Array.from(table.querySelectorAll('tr'));

    rows.forEach((row, rowIndex) => {
        const cells = Array.from(row.querySelectorAll('th, td'));
        const rowContent = cells.map(cell => {
            return cell.innerText.replace(/\|/g, '\\|').replace(/\n/g, ' ').trim();
        }).join(' | ');

        md += `| ${rowContent} |\n`;

        if (rowIndex === 0 && row.querySelector('th')) {
            const separator = cells.map(() => '---').join(' | ');
            md += `| ${separator} |\n`;
        }
    });
    return md + '\n';
}

function waitForElement(parent, selector, timeout = 1000) {
    return new Promise((resolve) => {
        const existing = parent.querySelector(selector);
        if (existing) {
            resolve(existing);
            return;
        }
        const observer = new MutationObserver(() => {
            const el = parent.querySelector(selector);
            if (el) {
                observer.disconnect();
                resolve(el);
            }
        });
        observer.observe(parent, { childList: true, subtree: true });
        setTimeout(() => {
            observer.disconnect();
            resolve(parent.querySelector(selector));
        }, timeout);
    });
}

async function extractChatDataAsync(config) {
    let title = document.title;
    const sidebarSelected = document.querySelector('.conversation-title, .mat-mdc-list-item.selected .mdc-list-item__primary-text, [data-test-id="conversation-title"]');
    const mainH1 = document.querySelector('main h1, h1.conversation-title');

    if (sidebarSelected && sidebarSelected.innerText) {
        title = sidebarSelected.innerText;
    } else if (mainH1 && mainH1.innerText) {
        title = mainH1.innerText;
    }

    title = title.replace(/ - Google$/, '').replace(/^Gemini$/, 'Gemini Chat').trim();
    if (!title) title = "Gemini Chat Export";

    const messages = [];
    const includeThinking = config && config.includeThinking;
    const allElements = document.querySelectorAll('user-query, model-response');
    const expandedElements = [];

    // Iterate through all elements
    for (const el of allElements) {
        let role = '';
        let content = '';
        let thinking = '';

        if (el.tagName.toLowerCase() === 'user-query') {
            role = 'user';
            const contentEl = el.querySelector('.query-content') || el.querySelector('div[class*="content"]');
            content = contentEl ? domToMarkdownRobust(contentEl) : el.innerText;
        } else if (el.tagName.toLowerCase() === 'model-response') {
            role = 'model';

            // --- 1. Extract Thinking ---
            if (includeThinking) {
                // Find potential thinking container
                const modelThoughts = el.querySelector('model-thoughts, [data-test-id="model-thoughts"], .model-thoughts, thought-view, .thoughts-container');

                if (modelThoughts) {
                    // Check if content (.markdown) is already visible
                    let visibleMarkdowns = modelThoughts.querySelectorAll('.markdown');
                    let wasExpanded = visibleMarkdowns.length > 0;

                    if (!wasExpanded) {
                        // Not visible, look for expand button
                        const expandBtn = modelThoughts.querySelector('[data-test-id="thoughts-header-button"], .thoughts-header-button, button[aria-expanded="false"]');
                        if (expandBtn) {
                            expandBtn.click();
                            // Wait for at least one .markdown element to appear per subagent findings
                            const found = await waitForElement(modelThoughts, '.markdown', 2000);
                            if (found) {
                                // Re-query for ALL markdown elements as there are multiple
                                visibleMarkdowns = modelThoughts.querySelectorAll('.markdown');
                                if (!wasExpanded) expandedElements.push(expandBtn); // Track to re-collapse
                            }
                        }
                    }

                    if (visibleMarkdowns.length > 0) {
                        // Join all thinking parts (Gemini splits stages into separate markdowns)
                        const parts = Array.from(visibleMarkdowns).map(md => domToMarkdownRobust(md).trim());
                        thinking = parts.join('\n\n');

                        // Cleanup repeated headers
                        thinking = thinking.replace(/^(Show thinking|Hide thinking|Thinking:?)/i, '').trim();
                    } else {
                        // Fallback: If no .markdown found, try .thoughts-content or full text
                        // This handles cases where structure might differ
                        const contentDiv = modelThoughts.querySelector('.thoughts-content');
                        if (contentDiv) {
                            thinking = domToMarkdownRobust(contentDiv).trim();
                        } else {
                            // Last resort, might include "Show thinking" text but better than nothing
                            thinking = domToMarkdownRobust(modelThoughts).trim();
                        }
                        thinking = thinking.replace(/^(Show thinking|Hide thinking|Thinking:?)/i, '').trim();
                    }
                }
            }

            // --- 2. Extract Main Content ---
            const allMarkdowns = Array.from(el.querySelectorAll('.markdown'));
            // Filter out markdowns inside model-thoughts
            const contentMarkdowns = allMarkdowns.filter(mdNode => {
                return !mdNode.closest('model-thoughts, [data-test-id="model-thoughts"], thought-view, .thoughts-container, .model-thoughts');
            });

            if (contentMarkdowns.length > 0) {
                content = contentMarkdowns.map(md => domToMarkdownRobust(md)).join('\n\n');
            } else {
                // Fallback attempt (less likely to be needed now)
                const clone = el.cloneNode(true);
                const thoughtsInClone = clone.querySelectorAll('model-thoughts, .model-thoughts, [data-test-id="model-thoughts"], thought-view, .thoughts-container');
                thoughtsInClone.forEach(t => t.remove());
                content = domToMarkdownRobust(clone);
            }
        }

        content = content.trim();
        thinking = thinking.trim();
        if (content || thinking) {
            messages.push({ role, content, thinking });
        }
    }

    // Collapse elements that we expanded
    for (const btn of expandedElements) {
        try { if (document.body.contains(btn)) btn.click(); } catch (e) { }
    }

    return {
        title: title,
        messages: messages,
        url: window.location.href,
        date: new Date().toISOString()
    };
}

// --- UI Logic ---

function showModal(title, message, confirmText, confirmUrl) {
    const modal = document.getElementById('gemini-export-modal');
    if (!modal) return;

    document.getElementById('gemini-export-title').innerText = title;
    document.getElementById('gemini-export-message').innerText = message;

    const confirmBtn = document.getElementById('gemini-export-confirm');
    const closeBtn = document.getElementById('gemini-export-close');

    if (confirmText && confirmUrl) {
        confirmBtn.style.display = 'inline-block';
        confirmBtn.innerText = confirmText;
        confirmBtn.onclick = () => window.open(confirmUrl, '_blank');
    } else {
        confirmBtn.style.display = 'none';
    }

    closeBtn.onclick = () => {
        modal.style.display = 'none';
    };

    modal.style.display = 'flex';
}

function injectExportUI() {
    if (document.getElementById('gemini-export-fab')) return;

    // 1. Inject Style
    const css = document.createElement('style');
    css.textContent = `
        #gemini-export-fab {
            position: fixed; bottom: 24px; right: 24px; z-index: 99999;
            font-family: 'Google Sans', sans-serif;
        }
        #gemini-export-fab .fab-btn {
            background: linear-gradient(135deg, #4285f4, #1a73e8); color: white; border: none;
            border-radius: 28px; padding: 12px 24px; font-size: 14px; font-weight: 500;
            box-shadow: 0 4px 12px rgba(26,115,232,0.4); cursor: pointer; display: flex; align-items: center; gap: 8px;
            transition: all 0.2s ease;
        }
        #gemini-export-fab .fab-btn:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(26,115,232,0.5); }
        #gemini-export-fab .menu {
            position: absolute; bottom: calc(100% + 12px); right: 0; background: white;
            border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.15); padding: 8px 0; min-width: 200px;
            display: none; opacity: 0; transform: translateY(10px); transition: all 0.2s ease;
        }
        #gemini-export-fab .menu.visible { display: block; opacity: 1; transform: translateY(0); }
        #gemini-export-fab .menu-item {
            padding: 12px 16px; cursor: pointer; display: flex; align-items: center; gap: 12px;
            color: #333; font-size: 14px; transition: background 0.15s;
        }
        #gemini-export-fab .menu-item:hover { background: #f1f5f9; }
        #gemini-export-fab .menu-item.checkbox-item { background: #f8fafc; border-bottom: 1px solid #e2e8f0; }
        #gemini-export-fab .menu-item input[type="checkbox"] { width: 18px; height: 18px; accent-color: #4285f4; }
        #gemini-export-fab .menu-item svg { width: 20px; height: 20px; color: #64748b; }
    `;
    document.head.appendChild(css);

    // 2. Inject FAB
    const fab = document.createElement('div');
    fab.id = 'gemini-export-fab';
    fab.innerHTML = `
        <div class="menu">
            <label class="menu-item checkbox-item">
                <input type="checkbox" id="export-thinking-toggle" checked>
                <span>Include Thinking</span>
            </label>
            <div class="menu-item" data-action="notion">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                <span>Save to Notion</span>
            </div>
            <div class="menu-item" data-action="markdown">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                <span>Save as Markdown</span>
            </div>
            <div class="menu-item" data-action="pdf">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
                <span>Print to PDF</span>
            </div>
            <div class="menu-divider" style="height:1px; background:#e2e8f0; margin:8px 0;"></div>
            <div class="menu-item" data-action="exportAll" style="color:#1a73e8; font-weight:500;">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                <span>Export All Chats</span>
            </div>
        </div>
        <button class="fab-btn">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            <span>Export</span>
        </button>
    `;
    document.body.appendChild(fab);

    // 3. Inject Modal
    const modalDiv = document.createElement('div');
    modalDiv.innerHTML = `
        <div id="gemini-export-modal" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); z-index:100002; justify-content:center; align-items:center;">
            <div style="background:white; padding:24px; border-radius:12px; max-width:400px; width:90%; box-shadow:0 10px 25px rgba(0,0,0,0.2); text-align:center; font-family: 'Google Sans', sans-serif;">
                <h3 id="gemini-export-title" style="margin-top:0; margin-bottom:12px; color:#1f1f1f; font-size:18px;"></h3>
                <p id="gemini-export-message" style="margin:0 0 20px 0; color:#555; font-size:14px; line-height:1.5;"></p>
                <div style="display:flex; justify-content:center; gap:12px;">
                    <button id="gemini-export-close" style="padding:8px 20px; border:1px solid #dadce0; background:white; color:#3c4043; border-radius:6px; cursor:pointer; font-weight:500;">Close</button>
                    <button id="gemini-export-confirm" style="padding:8px 20px; border:none; background:#1a73e8; color:white; border-radius:6px; cursor:pointer; font-weight:500;">Action</button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modalDiv);

    // Event Listeners
    const fabBtn = fab.querySelector('.fab-btn');
    const menu = fab.querySelector('.menu');
    const thinkingToggle = fab.querySelector('#export-thinking-toggle');

    chrome.storage.sync.get(['includeThinking'], (res) => {
        thinkingToggle.checked = res.includeThinking !== false;
    });

    thinkingToggle.addEventListener('change', (e) => {
        chrome.storage.sync.set({ includeThinking: e.target.checked });
    });

    fabBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.classList.toggle('visible');
    });

    document.addEventListener('click', (e) => {
        if (!fab.contains(e.target)) {
            menu.classList.remove('visible');
        }
    });

    fab.querySelectorAll('.menu-item[data-action]').forEach(item => {
        item.addEventListener('click', () => {
            const action = item.dataset.action;
            menu.classList.remove('visible');
            performExport(action);
        });
    });
}

function performExport(action) {
    const includeThinking = document.getElementById('export-thinking-toggle').checked;

    // Show loading state could be nice here, but keeping it simple for now

    chrome.storage.sync.get(['notionKey', 'dbId'], (config) => {
        extractChatDataAsync({ includeThinking }).then(data => {
            if (action === 'notion') {
                if (!config.notionKey || !config.dbId) {
                    showModal('Configuration Required', 'Please configure your Notion API Key and Database ID in the extension settings first.', null, null);
                    return;
                }

                // Show "Processing" modal? Or just wait.
                // Let's rely on final success/fail modal.

                chrome.runtime.sendMessage({
                    action: "save_to_notion",
                    data: data,
                    config: { ...config, includeThinking }
                }, (response) => {
                    if (response && response.success) {
                        showModal(
                            'Saved to Notion!',
                            'Your chat has been successfully exported to your Notion database.',
                            'View Page',
                            response.pageUrl
                        );
                    } else {
                        showModal(
                            'Export Failed',
                            'Error: ' + (response?.error || 'Unknown error'),
                            null, null
                        );
                    }
                });
            } else if (action === 'markdown') {
                downloadMarkdown(data);
            } else if (action === 'pdf') {
                printToPDF(data);
            } else if (action === 'exportAll') {
                startBatchExport(config, includeThinking);
            }
        });
    });
}

async function downloadMarkdown(data) {
    const dateObj = new Date(data.date);
    const dateStr = dateObj.toLocaleDateString() + ' ' + dateObj.toLocaleTimeString();

    let md = `# ${data.title}\n\n`;
    md += `**Exported:** ${dateStr}\n\n`;
    md += `**Link:** ${data.url}\n\n`;

    data.messages.forEach(msg => {
        if (msg.role === 'user') {
            md += `## Prompt\n\n${msg.content}\n\n`;
        } else {
            md += `## Gemini\n\n`;
            if (msg.thinking) {
                md += `<details>\n<summary>Thinking</summary>\n\n${msg.thinking}\n\n</details>\n\n`;
            }
            md += `${msg.content}\n\n`;
        }
        md += `---\n\n`;
    });

    // Keep unicode chars, only remove filesystem illegal characters
    const safeTitle = data.title
        .replace(/[\/\\:*?"<>|]/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 100);
    const filename = `Gemini-${safeTitle}.md`;

    // Method 1: Use modern File System Access API (most reliable)
    if ('showSaveFilePicker' in window) {
        try {
            const handle = await window.showSaveFilePicker({
                suggestedName: filename,
                types: [{
                    description: 'Markdown files',
                    accept: { 'text/markdown': ['.md'] }
                }]
            });
            const writable = await handle.createWritable();
            await writable.write(md);
            await writable.close();
            console.log('✅ File saved via File System Access API');
            return;
        } catch (e) {
            if (e.name === 'AbortError') {
                console.log('User cancelled save dialog');
                return;
            }
            console.warn('File System Access API failed, trying fallback:', e);
        }
    }

    // Method 2: Fallback to traditional anchor download with File object
    try {
        const file = new File([md], filename, { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(file);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);

        // Use requestAnimationFrame to ensure DOM update
        requestAnimationFrame(() => {
            a.click();
            console.log('✅ Download triggered via File object');

            // Delayed cleanup
            setTimeout(() => {
                if (document.body.contains(a)) {
                    document.body.removeChild(a);
                }
                URL.revokeObjectURL(url);
            }, 10000);
        });
    } catch (e) {
        console.error('File download failed:', e);
        showModal('Download Failed', 'Could not download the file. Error: ' + e.message, null, null);
    }
}

function printToPDF(data) {
    const win = window.open('', '_blank');
    if (!win) {
        showModal('Popups Blocked', 'Please allow popups to generate PDF.', null, null);
        return;
    }
    const html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>${data.title}</title>
    <style>
        body { font-family: -apple-system, sans-serif; max-width: 800px; margin: 0 auto; padding: 40px 20px; line-height: 1.6; }
        h1 { color: #1a1a1a; border-bottom: 2px solid #4285f4; padding-bottom: 10px; }
        .meta { color: #666; font-size: 14px; margin-bottom: 30px; }
        .message { margin-bottom: 24px; }
        .role { font-weight: 600; color: #333; margin-bottom: 8px; }
        .user .role { color: #1a73e8; }
        .model .role { color: #d93025; }
        .content { white-space: pre-wrap; }
        .thinking { background: #f8f9fa; padding: 12px; margin-top: 8px; border-left: 3px solid #4285f4; font-style: italic; }
        hr { border: none; border-top: 1px solid #e0e0e0; margin: 20px 0; }
        pre { background: #f1f3f4; padding: 12px; border-radius: 8px; overflow-x: auto; }
    </style>
</head>
<body>
    <h1>${data.title}</h1>
    <div class="meta">
        <p><strong>Exported:</strong> ${data.date}</p>
        <p><strong>Link:</strong> <a href="${data.url}">${data.url}</a></p>
    </div>
    ${data.messages.map(msg => `
        <div class="message ${msg.role}">
            <div class="role">${msg.role === 'user' ? 'User' : 'Gemini'}</div>
            <div class="content">${escapeHtml(msg.content).replace(/\n/g, '<br>')}</div>
            ${msg.thinking ? `<div class="thinking"><strong>Thinking:</strong><br>${escapeHtml(msg.thinking).replace(/\n/g, '<br>')}</div>` : ''}
        </div>
        <hr>
    `).join('')}
    <script>window.onload = () => window.print();</script>
</body>
</html>`;
    win.document.write(html);
    win.document.close();
}

function escapeHtml(text) {
    if (!text) return '';
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// --- Batch Export Functions ---

// Inject batch export progress modal
function injectBatchExportUI() {
    if (document.getElementById('batch-export-modal')) return;

    const modalHtml = `
        <div id="batch-export-modal" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); z-index:100001; justify-content:center; align-items:center; font-family:'Google Sans',sans-serif;">
            <div style="background:white; padding:28px; border-radius:16px; max-width:500px; width:90%; max-height:80vh; box-shadow:0 20px 40px rgba(0,0,0,0.25); display:flex; flex-direction:column;">
                <h3 id="batch-export-title" style="margin:0 0 16px 0; color:#1a1a1a; font-size:18px; display:flex; align-items:center; gap:10px;">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#1a73e8" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    Batch Export Chats
                </h3>
                
                <!-- Selection View (shown first) -->
                <div id="batch-selection-view">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                        <p style="color:#555; margin:0; font-size:14px;" id="batch-selection-count">Scanning chats...</p>
                        <div style="display:flex; gap:8px;">
                            <button id="batch-select-all" style="padding:4px 10px; border:1px solid #dadce0; background:white; color:#1a73e8; border-radius:4px; cursor:pointer; font-size:12px;">Select All</button>
                            <button id="batch-select-none" style="padding:4px 10px; border:1px solid #dadce0; background:white; color:#666; border-radius:4px; cursor:pointer; font-size:12px;">Deselect All</button>
                        </div>
                    </div>
                    <div id="batch-conversation-list" style="max-height:300px; overflow-y:auto; border:1px solid #e2e8f0; border-radius:8px; margin-bottom:16px;">
                        <div style="padding:20px; text-align:center; color:#888;">Loading...</div>
                    </div>
                    <p style="color:#555; margin:0 0 12px 0; font-size:14px;">Select export format:</p>
                    <div style="display:flex; gap:12px;">
                        <button class="batch-format-btn" data-format="markdown" style="flex:1; padding:12px; border:2px solid #e2e8f0; border-radius:12px; background:white; cursor:pointer; transition:all 0.2s;">
                            <div style="font-size:20px; margin-bottom:4px;">📝</div>
                            <div style="font-weight:500; color:#333; font-size:13px;">Markdown ZIP</div>
                        </button>
                        <button class="batch-format-btn" data-format="notion" style="flex:1; padding:12px; border:2px solid #e2e8f0; border-radius:12px; background:white; cursor:pointer; transition:all 0.2s;">
                            <div style="font-size:20px; margin-bottom:4px;">📓</div>
                            <div style="font-weight:500; color:#333; font-size:13px;">Notion</div>
                        </button>
                    </div>
                </div>
                
                <!-- Progress View (hidden initially) -->
                <div id="batch-progress-view" style="display:none;">
                    <div id="batch-progress-text" style="color:#555; font-size:14px; margin-bottom:12px;">Scanning chat list...</div>
                    <div style="background:#e2e8f0; border-radius:8px; height:8px; overflow:hidden; margin-bottom:8px;">
                        <div id="batch-progress-bar" style="background:linear-gradient(90deg, #4285f4, #1a73e8); height:100%; width:0%; transition:width 0.3s ease;"></div>
                    </div>
                    <div id="batch-progress-detail" style="font-size:12px; color:#888;"></div>
                </div>
                
                <!-- Result View (hidden initially) -->
                <div id="batch-result-view" style="display:none;">
                    <div id="batch-result-text" style="color:#333; font-size:14px; line-height:1.6;"></div>
                </div>
                
                <div style="display:flex; justify-content:flex-end; gap:12px; margin-top:20px;">
                    <button id="batch-cancel-btn" style="padding:10px 20px; border:1px solid #dadce0; background:white; color:#3c4043; border-radius:8px; cursor:pointer; font-weight:500;">Cancel</button>
                    <button id="batch-close-btn" style="display:none; padding:10px 20px; border:none; background:#1a73e8; color:white; border-radius:8px; cursor:pointer; font-weight:500;">Done</button>
                </div>
            </div>
        </div>
    `;

    const div = document.createElement('div');
    div.innerHTML = modalHtml;
    document.body.appendChild(div.firstElementChild);

    // Add hover effect for format buttons and checkbox styles
    const style = document.createElement('style');
    style.textContent = `
        .batch-format-btn:hover { border-color:#1a73e8 !important; background:#f8fafc !important; }
        .batch-format-btn.selected { border-color:#1a73e8 !important; background:#e8f0fe !important; }
        .batch-conv-item { display:flex; align-items:center; padding:10px 12px; border-bottom:1px solid #f0f0f0; cursor:pointer; transition:background 0.15s; }
        .batch-conv-item:hover { background:#f8fafc; }
        .batch-conv-item:last-child { border-bottom:none; }
        .batch-conv-checkbox { width:18px; height:18px; margin-right:10px; accent-color:#1a73e8; cursor:pointer; }
        .batch-conv-title { flex:1; font-size:13px; color:#333; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    `;
    document.head.appendChild(style);
}

// Scan sidebar for all conversation links
async function scanAllConversations() {
    const conversations = [];

    // First, check if sidebar is expanded - if not, expand it
    let convElements = document.querySelectorAll('div.conversation');

    if (convElements.length === 0) {
        // Sidebar might be collapsed, try to expand it
        const menuBtn = document.querySelector('button[aria-label="Main menu"], button[aria-label="主菜单"]');
        if (menuBtn) {
            menuBtn.click();
            // Wait for sidebar to expand
            await new Promise(r => setTimeout(r, 800));
            convElements = document.querySelectorAll('div.conversation');
        }
    }

    // Still no conversations? Try alternative selectors
    if (convElements.length === 0) {
        convElements = document.querySelectorAll('[data-test-id="conversation"], .conversation-item');
    }

    // Auto-scroll sidebar to load all conversations
    // Find the sidebar scroller (the one containing conversations, not the chat history)
    const allScrollers = Array.from(document.querySelectorAll('infinite-scroller'));
    const scrollContainer = allScrollers.find(s => s.querySelector('.conversation')) ||
        document.querySelector('infinite-scroller:not(.chat-history)') ||
        document.querySelector('.conversations-container');

    if (scrollContainer && convElements.length > 0) {
        let previousCount = 0;
        let currentCount = convElements.length;
        let stableCount = 0; // Count how many times the count stayed the same
        const maxScrollAttempts = 30;
        let scrollAttempts = 0;

        while (stableCount < 3 && scrollAttempts < maxScrollAttempts) {
            previousCount = currentCount;

            // Aggressive scroll pattern: scroll down, jog up, scroll down again
            scrollContainer.scrollTop = scrollContainer.scrollHeight;
            await new Promise(r => setTimeout(r, 300));

            // Small jog up to trigger loading observers
            scrollContainer.scrollTop -= 50;
            await new Promise(r => setTimeout(r, 200));

            // Back to bottom
            scrollContainer.scrollTop = scrollContainer.scrollHeight;
            await new Promise(r => setTimeout(r, 800));

            // Get updated count
            convElements = document.querySelectorAll('div.conversation');
            currentCount = convElements.length;
            scrollAttempts++;

            if (currentCount === previousCount) {
                stableCount++;
            } else {
                stableCount = 0; // Reset if count changed
            }
        }

        // Scroll back to top
        scrollContainer.scrollTop = 0;
        await new Promise(r => setTimeout(r, 300));

        // Re-query all elements after scrolling
        convElements = document.querySelectorAll('div.conversation');
    }

    for (const conv of convElements) {
        try {
            // Get title from conversation-title element
            const titleEl = conv.querySelector('.conversation-title, .title');
            let title = titleEl?.innerText?.trim() || conv.innerText?.split('\n')[0]?.trim() || 'Untitled';
            title = title.substring(0, 100);

            // Extract conversation ID from jslog attribute
            // Format: ["c_xxxxx", null, 0] where xxxxx is the ID
            let id = null;
            const jslog = conv.getAttribute('jslog');
            if (jslog) {
                const match = jslog.match(/\["c_([a-f0-9]+)"/i);
                if (match) {
                    id = match[1];
                }
            }

            // Fallback: try to get from data attributes or other sources
            if (!id) {
                id = conv.getAttribute('data-conversation-id') ||
                    conv.getAttribute('data-id') ||
                    `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            }

            const url = `https://gemini.google.com/app/${id}`;

            // Avoid duplicates
            if (!conversations.find(c => c.id === id)) {
                conversations.push({ id, title, url, element: conv });
            }
        } catch (e) {
            console.warn('Error parsing conversation:', e);
        }
    }

    return conversations;
}

// Generate Markdown content from chat data
function generateMarkdownFromData(data) {
    const dateObj = new Date(data.date);
    const dateStr = dateObj.toLocaleDateString() + ' ' + dateObj.toLocaleTimeString();

    let md = `# ${data.title}\n\n`;
    md += `**Exported:** ${dateStr}\n\n`;
    md += `**Link:** ${data.url}\n\n`;

    data.messages.forEach(msg => {
        if (msg.role === 'user') {
            md += `## Prompt\n\n${msg.content}\n\n`;
        } else {
            md += `## Gemini\n\n`;
            if (msg.thinking) {
                md += `<details>\n<summary>Thinking</summary>\n\n${msg.thinking}\n\n</details>\n\n`;
            }
            md += `${msg.content}\n\n`;
        }
        md += `---\n\n`;
    });

    return md;
}

// Create ZIP and download in page context (with DOM APIs available)
async function createAndDownloadZip(files) {
    const zip = new JSZip();
    const dateStr = new Date().toISOString().split('T')[0];

    files.forEach((file, index) => {
        const safeTitle = file.title
            .replace(/[\/\\:*?"<>|]/g, '_')
            .replace(/\s+/g, ' ')
            .trim()
            .substring(0, 80);

        const filename = `${String(index + 1).padStart(3, '0')}-Gemini-${safeTitle}.md`;
        zip.file(filename, file.content);
    });

    const blob = await zip.generateAsync({ type: 'blob' });
    const zipFilename = `Gemini-Export-${dateStr}.zip`;

    // Try modern File System Access API first
    if ('showSaveFilePicker' in window) {
        try {
            const handle = await window.showSaveFilePicker({
                suggestedName: zipFilename,
                types: [{
                    description: 'ZIP Archive',
                    accept: { 'application/zip': ['.zip'] }
                }]
            });
            const writable = await handle.createWritable();
            await writable.write(blob);
            await writable.close();
            console.log('✅ ZIP saved via File System Access API');
            return;
        } catch (e) {
            if (e.name === 'AbortError') {
                throw new Error('User cancelled save');
            }
            console.warn('File System Access API failed, trying fallback:', e);
        }
    }

    // Fallback: use anchor download
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = zipFilename;
    a.style.display = 'none';
    document.body.appendChild(a);

    requestAnimationFrame(() => {
        a.click();
        setTimeout(() => {
            if (document.body.contains(a)) {
                document.body.removeChild(a);
            }
            URL.revokeObjectURL(url);
        }, 1000);
    });
}

// Start batch export process
async function startBatchExport(config, includeThinking) {
    injectBatchExportUI();

    const modal = document.getElementById('batch-export-modal');
    const selectionView = document.getElementById('batch-selection-view');
    const progressView = document.getElementById('batch-progress-view');
    const resultView = document.getElementById('batch-result-view');
    const cancelBtn = document.getElementById('batch-cancel-btn');
    const closeBtn = document.getElementById('batch-close-btn');
    const convList = document.getElementById('batch-conversation-list');
    const selectionCount = document.getElementById('batch-selection-count');
    const selectAllBtn = document.getElementById('batch-select-all');
    const selectNoneBtn = document.getElementById('batch-select-none');

    let cancelled = false;
    let allConversations = [];

    // Reset UI
    selectionView.style.display = 'block';
    progressView.style.display = 'none';
    resultView.style.display = 'none';
    cancelBtn.style.display = 'block';
    cancelBtn.textContent = 'Cancel';
    closeBtn.style.display = 'none';
    convList.innerHTML = '<div style="padding:20px; text-align:center; color:#888;">Scanning chat list...</div>';
    modal.style.display = 'flex';

    // Scan conversations first
    allConversations = await scanAllConversations();

    if (allConversations.length === 0) {
        convList.innerHTML = '<div style="padding:20px; text-align:center; color:#ef4444;">No chats found. Please ensure the sidebar is expanded.</div>';
        selectionCount.textContent = 'No chats found';
        return;
    }

    // Render conversation list with checkboxes
    function renderConversationList() {
        convList.innerHTML = allConversations.map((conv, index) => `
            <label class="batch-conv-item">
                <input type="checkbox" class="batch-conv-checkbox" data-index="${index}" checked>
                <span class="batch-conv-title">${escapeHtml(conv.title)}</span>
            </label>
        `).join('');
        updateSelectionCount();
    }

    function updateSelectionCount() {
        const checked = convList.querySelectorAll('.batch-conv-checkbox:checked').length;
        selectionCount.textContent = `Selected ${checked} / ${allConversations.length} chats`;
    }

    function getSelectedConversations() {
        const selected = [];
        convList.querySelectorAll('.batch-conv-checkbox:checked').forEach(cb => {
            const index = parseInt(cb.dataset.index);
            selected.push(allConversations[index]);
        });
        return selected;
    }

    renderConversationList();

    // Selection event handlers
    convList.addEventListener('change', updateSelectionCount);

    selectAllBtn.onclick = () => {
        convList.querySelectorAll('.batch-conv-checkbox').forEach(cb => cb.checked = true);
        updateSelectionCount();
    };

    selectNoneBtn.onclick = () => {
        convList.querySelectorAll('.batch-conv-checkbox').forEach(cb => cb.checked = false);
        updateSelectionCount();
    };

    // Format selection handlers
    const formatBtns = modal.querySelectorAll('.batch-format-btn');
    formatBtns.forEach(btn => {
        btn.onclick = () => {
            const format = btn.dataset.format;
            const selectedConvs = getSelectedConversations();

            if (selectedConvs.length === 0) {
                showModal('Notice', 'Please select at least one chat to export.', null, null);
                return;
            }

            // Check Notion config
            if (format === 'notion' && (!config.notionKey || !config.dbId)) {
                modal.style.display = 'none';
                showModal('Configuration Required', 'Please configure your Notion API Key and Database ID in the extension settings first.', null, null);
                return;
            }

            formatBtns.forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');

            // Start export with selected conversations
            startExportProcess(format, selectedConvs);
        };
    });

    cancelBtn.onclick = () => {
        cancelled = true;
        modal.style.display = 'none';
    };

    closeBtn.onclick = () => {
        modal.style.display = 'none';
    };

    async function startExportProcess(format, conversations) {
        selectionView.style.display = 'none';
        progressView.style.display = 'block';

        const progressText = document.getElementById('batch-progress-text');
        const progressBar = document.getElementById('batch-progress-bar');
        const progressDetail = document.getElementById('batch-progress-detail');

        progressText.textContent = `Exporting ${conversations.length} chats...`;
        progressBar.style.width = '0%';

        const results = [];
        const exportedData = [];

        for (let i = 0; i < conversations.length; i++) {
            if (cancelled) break;

            const conv = conversations[i];
            const progress = ((i + 1) / conversations.length * 100).toFixed(0);

            progressBar.style.width = `${progress}%`;
            progressText.textContent = `Exporting ${i + 1}/${conversations.length}`;
            progressDetail.textContent = conv.title;

            try {
                // Click on the conversation element to navigate (SPA style, no page refresh)
                if (conv.element) {
                    conv.element.click();

                    // Wait for content to load
                    await new Promise(r => setTimeout(r, 1500));

                    // Extract data from the current page
                    const chatData = await extractChatDataAsync({ includeThinking: config.includeThinking });

                    if (format === 'notion') {
                        // Send to background for Notion save
                        const result = await new Promise((resolve) => {
                            chrome.runtime.sendMessage({
                                action: 'save_to_notion',
                                data: chatData,
                                config: config
                            }, resolve);
                        });

                        if (result && result.success) {
                            results.push({ ...conv, success: true });
                        } else {
                            results.push({ ...conv, success: false, error: result?.error || 'Notion save failed' });
                        }
                    } else if (format === 'markdown') {
                        // Collect markdown data
                        const markdown = generateMarkdownFromData(chatData);
                        results.push({ ...conv, success: true });
                        exportedData.push({
                            title: chatData.title || conv.title,
                            content: markdown
                        });
                    }
                } else {
                    results.push({ ...conv, success: false, error: 'Element not found' });
                }
            } catch (e) {
                console.error('Export error for', conv.title, e);
                results.push({ ...conv, success: false, error: e.message });
            }

            // Small delay between exports
            await new Promise(r => setTimeout(r, 300));
        }

        // Show results
        progressView.style.display = 'none';
        resultView.style.display = 'block';
        cancelBtn.style.display = 'none';
        closeBtn.style.display = 'block';

        const successCount = results.filter(r => r.success).length;
        const failCount = results.filter(r => !r.success).length;

        let resultHtml = `<div style="color:#22c55e; font-weight:500; margin-bottom:8px;">✅ Success: ${successCount} chats</div>`;
        if (failCount > 0) {
            resultHtml += `<div style="color:#ef4444; margin-bottom:8px;">❌ Failed: ${failCount} chats</div>`;
        }

        if (format === 'markdown' && exportedData.length > 0) {
            resultHtml += `<div style="margin-top:12px; padding:12px; background:#f0fdf4; border-radius:8px; font-size:13px;">
                Generating ZIP file...
            </div>`;

            document.getElementById('batch-result-text').innerHTML = resultHtml;

            // Create ZIP locally (JSZip loaded as content script)
            try {
                await createAndDownloadZip(exportedData);
                document.getElementById('batch-result-text').innerHTML = resultHtml.replace(
                    'Generating ZIP file...',
                    '✅ ZIP file saved'
                );
            } catch (e) {
                document.getElementById('batch-result-text').innerHTML = resultHtml.replace(
                    'Generating ZIP file...',
                    '❌ ZIP generation failed: ' + e.message
                );
            }
        } else {
            document.getElementById('batch-result-text').innerHTML = resultHtml;
        }
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectExportUI);
} else {
    injectExportUI();
}
setInterval(injectExportUI, 2000);
