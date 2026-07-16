# 📊 Spreadsheet Monitor

A production-ready Node.js/TypeScript application that monitors a private Google Spreadsheet via the official Google Sheets API (OAuth2), detects changes, and delivers multi-channel notifications.

---

## ✨ Features

| Feature | Details |
|---|---|
| **Authentication** | OAuth2 browser flow, auto-refresh, token persistence |
| **Change Detection** | SHA256 hash + full row/cell diff |
| **Notifications** | Console, Desktop (OS toast), Telegram |
| **Scheduler** | Configurable interval, overlap-safe, crash-resilient |
| **Web Dashboard** | Live HTML UI at `localhost:3000` |
| **REST API** | `/status`, `/changes`, `/tabs` |
| **History** | Timestamped JSON diffs + Markdown reports |
| **Logging** | Winston rotating file logs |
| **Tests** | Jest unit tests for hash, diff, and config |
| **Docker** | Multi-stage image + Docker Compose |

---

## 🚀 Step-by-Step Setup

### Step 1 — Prerequisites

- **Node.js 18+** — [nodejs.org](https://nodejs.org)
- A **Google Account** that owns the spreadsheet

### Step 2 — Install Dependencies

```bash
cd rpfetcher
npm install
```

### Step 3 — Create a Google Cloud Project & Enable the Sheets API

1. Go to [https://console.cloud.google.com/](https://console.cloud.google.com/)
2. Create a new project (e.g. `SpreadsheetMonitor`)
3. Navigate to **APIs & Services → Library**
4. Search for **Google Sheets API** and click **Enable**

### Step 4 — Create OAuth2 Credentials

1. Go to **APIs & Services → Credentials**
2. Click **+ Create Credentials → OAuth 2.0 Client IDs**
3. Set **Application type** to **Desktop app**
4. Name it anything (e.g. `Monitor Desktop Client`)
5. Click **Create**
6. Click **Download JSON**
7. Rename the downloaded file to `credentials.json`
8. Move it to the project root (`rpfetcher/credentials.json`)

> ⚠️ If this is a new project, you may need to configure the **OAuth consent screen** first:
> - Go to **APIs & Services → OAuth consent screen**
> - Choose **External**, fill in the app name and your email
> - Add your Google account email under **Test users**

### Step 5 — Configure Environment

```bash
# Copy the template
cp .env.example .env
```

Edit `.env` and set at minimum:

```env
SPREADSHEET_ID=your_spreadsheet_id_here
```

Get your Spreadsheet ID from the URL:
```
https://docs.google.com/spreadsheets/d/THIS_PART_IS_THE_ID/edit
```

**Optional — Telegram notifications:**
```env
NOTIFY_TELEGRAM=true
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
```

To get a Telegram bot token: message [@BotFather](https://t.me/BotFather) and use `/newbot`.  
To get your chat ID: message [@userinfobot](https://t.me/userinfobot).

### Step 6 — Authenticate with Google

Run the app for the first time:

```bash
npm run dev
```

On first launch:
1. Your browser will open automatically to a Google consent page
2. Log in with the Google account that has access to the spreadsheet
3. Grant the requested permissions
4. You'll see a success page — return to your terminal
5. A `token.json` file is saved locally — **never commit this file**

### Render Deployment

Render is supported in two ways:

#### Option A — Environment Variables

Set these Render environment variables:

```env
GOOGLE_CREDENTIALS_JSON=...
GOOGLE_TOKEN_JSON=...
```

Use the full JSON contents from Google OAuth credentials and the saved OAuth token.

#### Option B — Secret Files

Mount the files in Render and set these environment variables to their mounted paths:

```env
GOOGLE_CREDENTIALS_PATH=/etc/secrets/credentials.json
GOOGLE_TOKEN_PATH=/etc/secrets/token.json
```

The app will read the mounted files directly.

### Step 7 — The Monitor is Running! 🎉

You'll see output like:
```
╔═══════════════════════════════════════════════════════╗
║          📊  Spreadsheet Monitor  v1.0.0             ║
╚═══════════════════════════════════════════════════════╝
✅ Monitor is running. Dashboard: http://localhost:3000
```

Open [http://localhost:3000](http://localhost:3000) to see the dashboard.

---

## 📁 Project Structure

```
rpfetcher/
├── src/
│   ├── config.ts        ← Config loader + validation
│   ├── logger.ts        ← Winston structured logging
│   ├── auth.ts          ← OAuth2 browser flow + token management
│   ├── sheets.ts        ← Google Sheets API wrapper + retry
│   ├── hash.ts          ← SHA256 change detection
│   ├── diff.ts          ← Row/cell diff engine + history export
│   ├── notifier.ts      ← Console / Desktop / Telegram notifications
│   ├── scheduler.ts     ← Overlap-safe polling scheduler
│   ├── dashboard.ts     ← Express web dashboard + REST API
│   └── index.ts         ← Application entry point
│
├── tests/
│   ├── hash.test.ts
│   ├── diff.test.ts
│   └── config.test.ts
│
├── state/                ← Auto-created at runtime
│   ├── previousHash.json
│   ├── previousData.json
│   └── history/          ← Timestamped diffs + markdown reports
│
├── logs/                 ← Auto-created at runtime
│   ├── app-YYYY-MM-DD.log
│   └── errors-YYYY-MM-DD.log
│
├── credentials.json      ← OAuth2 client credentials (you provide)
├── token.json            ← Saved OAuth2 tokens (auto-created)
├── .env                  ← Your configuration
├── .env.example          ← Template
├── Dockerfile
├── docker-compose.yml
├── package.json
└── tsconfig.json
```

---

## 🛠️ Available Commands

| Command | Description |
|---|---|
| `npm run dev` | Run in development mode (hot reload with tsx) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled production build |
| `npm test` | Run Jest unit tests |
| `npm run lint` | Run ESLint |
| `npm run lint:fix` | Auto-fix ESLint issues |

---

## 🌐 REST API

| Endpoint | Description |
|---|---|
| `GET /` | HTML dashboard |
| `GET /status` | JSON: scheduler status + metadata |
| `GET /changes` | JSON: last 50 detected changes |
| `GET /tabs` | JSON: currently discovered tabs |

---

## 🐳 Docker

First, authenticate locally to generate `token.json`:
```bash
npm run dev
# Complete the browser auth flow, then Ctrl+C
```

Then run with Docker:
```bash
docker compose up -d
docker compose logs -f
```

---

## ⚙️ Configuration Reference

| Variable | Default | Description |
|---|---|---|
| `SPREADSHEET_ID` | *required* | ID from the spreadsheet URL |
| `GOOGLE_CREDENTIALS_JSON` | — | Google OAuth client JSON for Render env vars |
| `GOOGLE_TOKEN_JSON` | — | Saved OAuth token JSON for Render env vars |
| `GOOGLE_CREDENTIALS_PATH` | `credentials.json` fallback | Path to Google OAuth client JSON file |
| `GOOGLE_TOKEN_PATH` | `token.json` fallback | Path to saved OAuth token file |
| `CHECK_INTERVAL_MS` | `300000` | Poll interval (milliseconds) |
| `DASHBOARD_PORT` | `3000` | Web dashboard port |
| `NOTIFY_CONSOLE` | `true` | Coloured terminal output |
| `NOTIFY_DESKTOP` | `true` | OS desktop toast |
| `NOTIFY_TELEGRAM` | `false` | Telegram bot messages |
| `TELEGRAM_BOT_TOKEN` | — | From @BotFather |
| `TELEGRAM_CHAT_ID` | — | Your Telegram chat ID |
| `MAX_HISTORY_SNAPSHOTS` | `50` | Max diff/report files kept |
| `LOG_LEVEL` | `info` | Winston log level |

---

## 🔒 Security Notes

- `credentials.json` and `token.json` are in `.gitignore` — never commit them
- The application only requests `spreadsheets.readonly` scope
- Tokens are auto-refreshed — you only authenticate once

---

## 🧪 Running Tests

```bash
npm test
# or with coverage:
npm test -- --coverage
```

Tests cover:
- Hash consistency and change detection
- All diff scenarios (added/deleted/modified rows, tab changes, cell-level changes)
- Config validation with missing and invalid fields
