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
        <div id="gemini-export-modal" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); z-index:100000; justify-content:center; align-items:center;">
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
            }
        });
    });
}

function downloadMarkdown(data) {
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

    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeTitle = data.title.replace(/[^a-z0-9\u4e00-\u9fa5]/gi, '_').substring(0, 50);
    a.download = `Gemini-${safeTitle}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectExportUI);
} else {
    injectExportUI();
}
setInterval(injectExportUI, 2000);
