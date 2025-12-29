# Privacy Policy for Gemini to Notion Exporter

**Last Updated: December 29, 2024**

## Overview

Gemini to Notion Exporter is a Chrome extension that allows users to export their Google Gemini AI conversations to Notion databases. This privacy policy explains how we handle your data.

## Data Collection and Usage

### What We Access

- **Gemini Chat Content**: The extension reads the content of your conversations on gemini.google.com to enable export functionality.
- **Notion API Key**: Your Notion integration token is required to connect with your Notion workspace.

### What We Store

- **Local Storage Only**: Your Notion API key and database preferences are stored locally in your browser using Chrome's storage API.
- **No Server Storage**: We do not have any servers. All data remains on your device and is transmitted directly to Notion's servers when you export.

### What We Share

- **Notion Only**: When you export a conversation, the content is sent directly from your browser to Notion's API using your provided API key.
- **No Third Parties**: We do not share, sell, or transmit your data to any third parties.

## Permissions Explained

| Permission | Purpose |
|------------|---------|
| `activeTab` | Read the current Gemini chat page content for export |
| `storage` | Store your Notion API key and preferences locally |
| `scripting` | Extract chat messages from the Gemini page |
| `downloads` | Allow saving conversations as local files |
| `gemini.google.com` | Access Gemini website to read chat content |

## Data Security

- All API communications with Notion use HTTPS encryption
- Your Notion API key never leaves your browser except to authenticate with Notion
- No analytics or tracking code is included in this extension

## Your Rights

- You can delete all locally stored data by removing the extension
- You can revoke Notion access at any time from your Notion settings

## Contact

For questions or concerns about this privacy policy, please open an issue on our [GitHub repository](https://github.com/TreyDong/gemini_export).

## Changes

We may update this privacy policy from time to time. Any changes will be posted to this page with an updated revision date.
