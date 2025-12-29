chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "save_to_notion") {
        saveToNotion(request.data, request.config)
            .then((pageUrl) => sendResponse({ success: true, pageUrl: pageUrl }))
            .catch(err => sendResponse({ success: false, error: err.toString() }));
        return true; // async response
    }
});

const NOTION_VERSION = '2022-06-28'; // Latest stable version

async function saveToNotion(data, config) {
    // Step 1: Get database schema to find the title property name
    const titlePropertyName = await getTitlePropertyName(config);

    // Add metadata blocks at the beginning (simple text format)
    const metaBlocks = [
        {
            object: 'block',
            type: 'paragraph',
            paragraph: {
                rich_text: [
                    { type: 'text', text: { content: 'Exported: ' }, annotations: { bold: true } },
                    { type: 'text', text: { content: new Date(data.date).toLocaleString() } }
                ]
            }
        },
        {
            object: 'block',
            type: 'paragraph',
            paragraph: {
                rich_text: [
                    { type: 'text', text: { content: 'Link: ' }, annotations: { bold: true } },
                    { type: 'text', text: { content: data.url, link: { url: data.url } } }
                ]
            }
        }
    ];

    const allBlocks = [...metaBlocks, ...convertMessagesToBlocks(data.messages)];

    // Notion API limits: max 100 children per request
    const BATCH_SIZE = 100;
    const firstBatch = allBlocks.slice(0, BATCH_SIZE);
    const remainingBlocks = allBlocks.slice(BATCH_SIZE);

    // Step 2: Create the page using the correct title property name
    const properties = {};
    const pageTitle = `Gemini-${data.title || "Chat Export"}`;
    properties[titlePropertyName] = {
        title: [{ text: { content: pageTitle } }]
    };

    const createResponse = await fetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${config.notionKey}`,
            'Notion-Version': NOTION_VERSION,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            parent: { database_id: config.dbId },
            properties: properties,
            children: firstBatch
        })
    });

    if (!createResponse.ok) {
        const errText = await createResponse.text();
        throw new Error(`Notion API Error: ${createResponse.status} - ${errText}`);
    }

    const pageData = await createResponse.json();
    const pageId = pageData.id;

    // Step 3: Append remaining blocks in batches
    for (let i = 0; i < remainingBlocks.length; i += BATCH_SIZE) {
        const batch = remainingBlocks.slice(i, i + BATCH_SIZE);

        const appendResponse = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${config.notionKey}`,
                'Notion-Version': NOTION_VERSION,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ children: batch })
        });

        if (!appendResponse.ok) {
            const errText = await appendResponse.text();
            throw new Error(`Notion Append Error: ${appendResponse.status} - ${errText}`);
        }

        // Small delay to avoid rate limiting
        if (i + BATCH_SIZE < remainingBlocks.length) {
            await new Promise(resolve => setTimeout(resolve, 300));
        }
    }

    // Return the page URL so user can view it
    return pageData.url;
}

async function getTitlePropertyName(config) {
    // Query the database to find the title property
    const response = await fetch(`https://api.notion.com/v1/databases/${config.dbId}`, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${config.notionKey}`,
            'Notion-Version': NOTION_VERSION
        }
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Failed to fetch database schema: ${response.status} - ${errText}`);
    }

    const dbData = await response.json();
    const properties = dbData.properties;

    // Find the property with type "title"
    for (const [propName, propConfig] of Object.entries(properties)) {
        if (propConfig.type === 'title') {
            return propName;
        }
    }

    throw new Error('No title property found in the database. Please check your database configuration.');
}

/**
 * Parse inline Markdown formatting to Notion rich_text array
 * Supports: **bold**, *italic*, `code`, [link](url)
 */
function parseInlineMarkdown(text) {
    const richText = [];

    // Regex patterns for inline formatting
    // Order matters: bold before italic since ** contains *
    const patterns = [
        { regex: /\*\*(.+?)\*\*/g, type: 'bold' },
        { regex: /\*(.+?)\*/g, type: 'italic' },
        { regex: /_(.+?)_/g, type: 'italic' },
        { regex: /`([^`]+)`/g, type: 'code' },
        { regex: /\[([^\]]+)\]\(([^)]+)\)/g, type: 'link' }
    ];

    // Track processed positions
    let processed = [];

    // Find all matches
    patterns.forEach(pattern => {
        let match;
        const regex = new RegExp(pattern.regex.source, 'g');
        while ((match = regex.exec(text)) !== null) {
            processed.push({
                start: match.index,
                end: match.index + match[0].length,
                content: pattern.type === 'link' ? match[1] : match[1],
                url: pattern.type === 'link' ? match[2] : null,
                type: pattern.type,
                original: match[0]
            });
        }
    });

    // Sort by position and remove overlapping matches (keep earlier ones)
    processed.sort((a, b) => a.start - b.start);
    const filtered = [];
    let lastEnd = 0;
    for (const item of processed) {
        if (item.start >= lastEnd) {
            filtered.push(item);
            lastEnd = item.end;
        }
    }

    // Build rich_text array
    let pos = 0;
    for (const item of filtered) {
        // Add plain text before this match
        if (item.start > pos) {
            const plainText = text.slice(pos, item.start);
            if (plainText) {
                richText.push({ type: 'text', text: { content: plainText } });
            }
        }

        // Add formatted text
        const annotations = {};
        if (item.type === 'bold') annotations.bold = true;
        if (item.type === 'italic') annotations.italic = true;
        if (item.type === 'code') annotations.code = true;

        const textObj = { content: item.content };
        if (item.type === 'link' && item.url) {
            textObj.link = { url: item.url };
        }

        const richTextItem = { type: 'text', text: textObj };
        if (Object.keys(annotations).length > 0) {
            richTextItem.annotations = annotations;
        }
        richText.push(richTextItem);

        pos = item.end;
    }

    // Add remaining plain text
    if (pos < text.length) {
        const remaining = text.slice(pos);
        if (remaining) {
            richText.push({ type: 'text', text: { content: remaining } });
        }
    }

    // If no formatting found, return simple text
    if (richText.length === 0) {
        return [{ type: 'text', text: { content: text } }];
    }

    return richText;
}

/**
 * Split rich_text array into chunks that fit Notion's 2000 char limit
 */
function splitRichText(richTextArray, maxLen = 2000) {
    const chunks = [];
    let currentChunk = [];
    let currentLen = 0;

    for (const item of richTextArray) {
        const content = item.text.content;

        if (currentLen + content.length <= maxLen) {
            currentChunk.push(item);
            currentLen += content.length;
        } else {
            // Need to split this item
            let remaining = content;
            while (remaining.length > 0) {
                const spaceLeft = maxLen - currentLen;
                if (spaceLeft <= 0) {
                    chunks.push(currentChunk);
                    currentChunk = [];
                    currentLen = 0;
                    continue;
                }

                const part = remaining.slice(0, spaceLeft);
                remaining = remaining.slice(spaceLeft);

                const newItem = { ...item, text: { ...item.text, content: part } };
                currentChunk.push(newItem);
                currentLen += part.length;

                if (remaining.length > 0) {
                    chunks.push(currentChunk);
                    currentChunk = [];
                    currentLen = 0;
                }
            }
        }
    }

    if (currentChunk.length > 0) {
        chunks.push(currentChunk);
    }

    return chunks.length > 0 ? chunks : [[{ type: 'text', text: { content: '' } }]];
}

/**
 * Convert Markdown content to Notion blocks
 * Supports: headers, code blocks, lists, paragraphs with inline formatting
 */
function markdownToNotionBlocks(content) {
    const blocks = [];
    const lines = content.split('\n');

    let inCodeBlock = false;
    let codeBlockLang = '';
    let codeBlockContent = [];

    // Buffers for merging consecutive lines
    let inQuoteBlock = false;
    let quoteBlockContent = [];

    let listItems = [];
    let listType = null; // 'bulleted' or 'numbered'

    const flushList = () => {
        if (listItems.length > 0) {
            listItems.forEach(item => {
                const itemRichText = parseInlineMarkdown(item);
                const chunks = splitRichText(itemRichText);

                blocks.push({
                    object: 'block',
                    type: listType === 'numbered' ? 'numbered_list_item' : 'bulleted_list_item',
                    [listType === 'numbered' ? 'numbered_list_item' : 'bulleted_list_item']: {
                        rich_text: chunks[0] // First chunk
                    }
                });

                // Spill over extra text to paragraphs
                for (let k = 1; k < chunks.length; k++) {
                    blocks.push({
                        object: 'block',
                        type: 'paragraph',
                        paragraph: { rich_text: chunks[k] }
                    });
                }
            });
            listItems = [];
            listType = null;
        }
    };

    const flushQuote = () => {
        if (inQuoteBlock && quoteBlockContent.length > 0) {
            // Join lines with newline
            const fullQuoteText = quoteBlockContent.join('\n');
            const richText = parseInlineMarkdown(fullQuoteText);
            const chunks = splitRichText(richText);

            chunks.forEach(chunk => {
                blocks.push({
                    object: 'block',
                    type: 'quote',
                    quote: {
                        rich_text: chunk
                    }
                });
            });

            quoteBlockContent = [];
            inQuoteBlock = false;
        }
    };

    const flushAll = () => {
        flushList();
        flushQuote();
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // --- Code Blocks ---
        if (line.startsWith('```')) {
            flushAll();
            if (!inCodeBlock) {
                inCodeBlock = true;
                codeBlockLang = line.slice(3).trim() || 'plain text';
                codeBlockContent = [];
            } else {
                // End code block
                const codeText = codeBlockContent.join('\n');
                const codeChunks = codeText.match(/.{1,2000}/gs) || [''];
                codeChunks.forEach((chunk) => {
                    blocks.push({
                        object: 'block',
                        type: 'code',
                        code: {
                            rich_text: [{ type: 'text', text: { content: chunk } }],
                            language: codeBlockLang.toLowerCase().split(' ')[0] || 'plain'
                        }
                    });
                });
                inCodeBlock = false;
                codeBlockLang = '';
                codeBlockContent = [];
            }
            continue;
        }

        if (inCodeBlock) {
            codeBlockContent.push(line);
            continue;
        }

        // --- Quotes ---
        const quoteMatch = line.match(/^>\s?(.*)$/);
        if (quoteMatch) {
            flushList(); // Quotes break lists
            if (!inQuoteBlock) {
                inQuoteBlock = true;
                quoteBlockContent = [];
            }
            quoteBlockContent.push(quoteMatch[1]);
            continue;
        } else {
            // Check if we should close the quote
            if (inQuoteBlock) {
                // Formatting choice: Standard markdown breaks quote on empty line or non-quote line.
                // We'll flush here.
                flushQuote();
            }
        }

        // --- Headers ---
        const headerMatch = line.match(/^(#{1,3})\s+(.+)$/);
        if (headerMatch) {
            flushAll();
            const level = headerMatch[1].length;
            const headerType = level === 1 ? 'heading_1' : level === 2 ? 'heading_2' : 'heading_3';
            blocks.push({
                object: 'block',
                type: headerType,
                [headerType]: {
                    rich_text: parseInlineMarkdown(headerMatch[2])
                }
            });
            continue;
        }

        // --- Lists ---
        const bulletMatch = line.match(/^[\s]*[-*]\s+(.+)$/);
        if (bulletMatch) {
            flushQuote(); // Ensure quote is closed
            if (listType !== 'bulleted') {
                flushList();
                listType = 'bulleted';
            }
            listItems.push(bulletMatch[1]);
            continue;
        }

        const numberedMatch = line.match(/^[\s]*\d+\.\s+(.+)$/);
        if (numberedMatch) {
            flushQuote();
            if (listType !== 'numbered') {
                flushList();
                listType = 'numbered';
            }
            listItems.push(numberedMatch[1]);
            continue;
        }

        // --- Paragraphs ---
        flushAll();

        if (line.trim() === '') {
            continue;
        }

        const richText = parseInlineMarkdown(line);
        const chunks = splitRichText(richText);
        chunks.forEach(chunk => {
            blocks.push({
                object: 'block',
                type: 'paragraph',
                paragraph: {
                    rich_text: chunk
                }
            });
        });
    }

    flushAll(); // Final flush

    // Handle unclosed code block
    if (inCodeBlock && codeBlockContent.length > 0) {
        const codeText = codeBlockContent.join('\n');
        blocks.push({
            object: 'block',
            type: 'code',
            code: {
                rich_text: [{ type: 'text', text: { content: codeText.slice(0, 2000) } }],
                language: codeBlockLang.toLowerCase().split(' ')[0] || 'plain'
            }
        });
    }

    return blocks.length > 0 ? blocks : [{
        object: 'block',
        type: 'paragraph',
        paragraph: { rich_text: [{ type: 'text', text: { content: content.slice(0, 2000) } }] }
    }];
}

function convertMessagesToBlocks(messages) {
    const blocks = [];

    messages.forEach(msg => {
        const roleLabel = msg.role === 'user' ? 'Prompt:' : 'Gemini:';

        // Heading for the role
        blocks.push({
            object: 'block',
            type: 'heading_2',
            heading_2: {
                rich_text: [{ type: 'text', text: { content: roleLabel } }]
            }
        });

        // For Gemini responses: Thinking comes FIRST (in toggle with quote blocks)
        if (msg.role === 'model' && msg.thinking) {
            // Parse thinking content as markdown too
            const thinkingBlocks = markdownToNotionBlocks(msg.thinking);
            blocks.push({
                object: 'block',
                type: 'toggle',
                toggle: {
                    rich_text: [{ type: 'text', text: { content: 'Thinking:' } }],
                    children: thinkingBlocks.slice(0, 100) // Notion limit: max 100 children
                }
            });
        }

        // Convert content from Markdown to Notion blocks
        const contentBlocks = markdownToNotionBlocks(msg.content);
        blocks.push(...contentBlocks);
    });

    return blocks;
}
