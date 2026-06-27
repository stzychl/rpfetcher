/**
 * dashboard.ts
 *
 * Express web dashboard and REST API.
 *
 * Endpoints:
 *   GET /           → HTML dashboard with live status
 *   GET /status     → JSON: scheduler status + spreadsheet metadata
 *   GET /changes    → JSON: last 50 change events
 *   GET /tabs       → JSON: currently discovered tab names
 *
 * State is updated by index.ts via the exported store object.
 */

import express, { Request, Response } from "express";
import { DiffResult } from "./diff";
import { SpreadsheetData } from "./sheets";
import { SchedulerStatus } from "./scheduler";
import { logger } from "./logger";

// -------------------------------------------------------------------
// In-memory state store (updated externally by index.ts)
// -------------------------------------------------------------------

export interface DashboardState {
  scheduler: SchedulerStatus;
  currentData: SpreadsheetData | null;
  recentChanges: DiffResult[];
  spreadsheetId: string;
}

export const dashboardState: DashboardState = {
  scheduler: {
    isRunning: false,
    lastCheckAt: null,
    nextCheckAt: null,
    totalChecks: 0,
    totalErrors: 0,
    lastError: null,
  },
  currentData: null,
  recentChanges: [],
  spreadsheetId: "",
};

/** Adds a diff to the recent changes list (capped at 50) */
export function recordChange(diff: DiffResult): void {
  dashboardState.recentChanges.unshift(diff);
  if (dashboardState.recentChanges.length > 50) {
    dashboardState.recentChanges.length = 50;
  }
}

// -------------------------------------------------------------------
// Dashboard HTML
// -------------------------------------------------------------------

function renderDashboardHtml(state: DashboardState): string {
  const { scheduler, currentData } = state;
  const tabs = currentData?.tabs ?? [];
  const totalRows = currentData?.totalRows ?? 0;
  const lastFetch = currentData?.fetchedAt
    ? new Date(currentData.fetchedAt).toLocaleString()
    : "Never";

  const recentChangeSummaries = state.recentChanges.slice(0, 10).map((c) => `
    <div class="change-card ${c.hasChanges ? "has-changes" : "no-changes"}">
      <span class="change-time">${new Date(c.detectedAt).toLocaleString()}</span>
      <span class="change-summary">${escapeHtml(c.summary)}</span>
    </div>
  `).join("");

  const tabRows = tabs.map((t) => `
    <tr>
      <td>${escapeHtml(t.name)}</td>
      <td class="align-right">${t.rowCount.toLocaleString()}</td>
    </tr>
  `).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Nothing (Monitor)</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Doto:wght@100..900&family=Space+Mono:wght@400;700&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: #000000;
      --surface-card: #0c0c0c;
      --border: rgba(255, 255, 255, 0.08);
      --border-hover: rgba(255, 255, 255, 0.2);
      --primary: #ffffff;
      --accent: #ff2a2a; /* Nothing red */
      --text: #ffffff;
      --muted: #808080;
      --font-dot: 'Doto', sans-serif;
      --font-mono: 'Space Mono', monospace;
      --font-sans: 'Inter', system-ui, sans-serif;
    }
    
    body {
      background: var(--bg);
      color: var(--text);
      font-family: var(--font-sans);
      padding: 40px 24px;
      line-height: 1.6;
      background-image: radial-gradient(rgba(255, 255, 255, 0.15) 1px, transparent 1px);
      background-size: 20px 20px;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }
    
    .container {
      max-width: 1100px;
      margin: 0 auto;
    }
    
    /* Nothing Grid Layout */
    .nothing-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 20px;
    }
    
    @media (min-width: 992px) {
      .nothing-grid {
        grid-template-columns: 2fr 1fr;
      }
    }
    
    .main-column, .side-column {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }
    
    /* Widget Base */
    .widget {
      position: relative;
      background: var(--surface-card);
      border: 1px solid var(--border);
      border-radius: 32px;
      padding: 28px;
      transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    
    .widget:hover {
      border-color: var(--border-hover);
    }
    
    .widget-label {
      font-family: var(--font-dot);
      font-size: 0.85rem;
      font-weight: 700;
      color: var(--muted);
      letter-spacing: 1px;
      text-transform: uppercase;
      margin-bottom: 20px;
      display: block;
    }
    
    /* Widget Decor Dots */
    .widget-decor-dots {
      position: absolute;
      top: 28px;
      right: 28px;
      width: 24px;
      height: 24px;
      background-image: radial-gradient(rgba(255, 255, 255, 0.2) 1px, transparent 1px);
      background-size: 6px 6px;
      opacity: 0.5;
      pointer-events: none;
    }
    
    /* Header Widget */
    .header-widget {
      flex-direction: row;
      justify-content: space-between;
      align-items: center;
      padding: 28px 36px;
    }
    
    .logo-text {
      font-family: var(--font-dot);
      font-size: 2.2rem;
      font-weight: 800;
      letter-spacing: 3px;
      line-height: 1;
    }
    
    .logo-sub {
      font-family: var(--font-mono);
      font-size: 0.75rem;
      color: var(--muted);
      letter-spacing: 2px;
      margin-top: 4px;
    }
    
    .sync-badge {
      display: flex;
      align-items: center;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid var(--border);
      border-radius: 20px;
      padding: 8px 16px;
    }
    
    .pulse-dot {
      width: 8px;
      height: 8px;
      background: var(--accent);
      border-radius: 50%;
      margin-right: 10px;
      animation: pulse 2s infinite;
    }
    
    @keyframes pulse {
      0%, 100% { opacity: 1; box-shadow: 0 0 8px var(--accent); }
      50% { opacity: 0.3; box-shadow: none; }
    }
    
    .sync-text {
      font-family: var(--font-mono);
      font-size: 0.7rem;
      font-weight: 700;
      letter-spacing: 1px;
    }
    
    /* Stats Grid */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 16px;
    }
    
    @media (max-width: 576px) {
      .stats-grid {
        grid-template-columns: 1fr;
      }
    }
    
    .stat-widget {
      padding: 28px;
    }
    
    .stat-large-val {
      font-family: var(--font-dot);
      font-size: 2.5rem;
      font-weight: 800;
      line-height: 1.2;
      margin-bottom: 6px;
    }
    
    .stat-sub-label {
      font-family: var(--font-mono);
      font-size: 0.7rem;
      color: var(--muted);
      letter-spacing: 1px;
    }
    
    .alert-widget {
      border-color: rgba(255, 42, 42, 0.2);
    }
    .alert-widget:hover {
      border-color: var(--accent);
    }
    
    .accent-text {
      color: var(--accent);
    }
    
    /* Search Widget */
    .search-input-wrapper {
      position: relative;
      margin-bottom: 12px;
    }
    
    input[type="text"] {
      width: 100%;
      padding: 20px 28px;
      border-radius: 20px;
      border: 1px solid var(--border);
      background: rgba(255, 255, 255, 0.02);
      color: var(--text);
      font-size: 1.05rem;
      font-family: var(--font-mono);
      outline: none;
      transition: all 0.3s ease;
    }
    
    input[type="text"]:focus {
      border-color: rgba(255, 255, 255, 0.2);
      background: rgba(255, 255, 255, 0.04);
      box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.1);
    }
    
    .search-hint {
      position: absolute;
      right: 24px;
      top: 50%;
      transform: translateY(-50%);
      font-family: var(--font-mono);
      font-size: 0.65rem;
      color: var(--muted);
      letter-spacing: 1px;
      pointer-events: none;
      display: none;
    }
    
    @media (min-width: 768px) {
      .search-hint {
        display: block;
      }
    }
    
    /* Nodes Directory */
    .nodes-table-wrapper {
      overflow-x: auto;
    }
    
    .nodes-table {
      width: 100%;
      border-collapse: collapse;
      font-family: var(--font-mono);
      font-size: 0.85rem;
    }
    
    .nodes-table th {
      font-family: var(--font-dot);
      font-size: 0.8rem;
      color: var(--muted);
      padding: 12px 16px;
      text-align: left;
      border-bottom: 1px dashed var(--border);
      letter-spacing: 1px;
    }
    
    .nodes-table td {
      padding: 16px;
      border-bottom: 1px solid var(--border);
    }
    
    .nodes-table tr:last-child td {
      border-bottom: none;
    }
    
    .align-right {
      text-align: right !important;
    }
    
    /* Dial & Status Widget */
    .dial-main-widget {
      align-items: center;
      padding: 32px 24px;
    }
    
    .dial-container-wrapper {
      margin: 20px 0 32px 0;
    }
    
    .dial-widget {
      position: relative;
      width: 160px;
      height: 160px;
      margin: 0 auto;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    
    .dial-outer {
      position: absolute;
      width: 100%;
      height: 100%;
      border-radius: 50%;
      border: 1.5px dashed rgba(255, 255, 255, 0.15);
      animation: rotateClockwise 30s linear infinite;
    }
    
    .dial-dot {
      position: absolute;
      top: -5px;
      left: 50%;
      transform: translateX(-50%);
      width: 10px;
      height: 10px;
      background: var(--accent);
      border-radius: 50%;
      box-shadow: 0 0 8px var(--accent);
    }
    
    .dial-inner {
      text-align: center;
      z-index: 2;
    }
    
    .dial-value {
      display: block;
      font-family: var(--font-dot);
      font-size: 1.8rem;
      color: var(--primary);
      font-weight: 700;
      letter-spacing: 1px;
    }
    
    .dial-label {
      display: block;
      font-family: var(--font-mono);
      font-size: 0.75rem;
      color: var(--muted);
      text-transform: uppercase;
      margin-top: 4px;
    }
    
    @keyframes rotateClockwise {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
    
    .dial-footer-info {
      width: 100%;
      border-top: 1px dashed var(--border);
      padding-top: 20px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    
    .info-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 0.75rem;
      color: var(--muted);
      font-family: var(--font-mono);
    }
    
    .mono-value {
      color: var(--primary);
    }
    
    /* Event Log Widget & Timeline */
    .log-timeline {
      display: flex;
      flex-direction: column;
      gap: 16px;
      max-height: 480px;
      overflow-y: auto;
      padding-right: 8px;
    }
    
    .change-card {
      background: rgba(255, 255, 255, 0.02);
      border-left: 2px solid var(--border);
      padding: 16px 20px;
      border-radius: 0 16px 16px 0;
      transition: all 0.2s ease;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    
    .change-card.has-changes {
      border-left-color: var(--accent);
      background: rgba(255, 42, 42, 0.03);
    }
    
    .change-time {
      font-family: var(--font-mono);
      font-size: 0.75rem;
      color: var(--muted);
    }
    
    .change-summary {
      font-size: 0.9rem;
      line-height: 1.4;
    }
    
    .no-data-msg {
      text-align: center;
      color: var(--muted);
      font-family: var(--font-mono);
      font-size: 0.8rem;
      padding: 40px 0;
    }
    
    /* Search Results */
    .search-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 16px;
      margin-top: 16px;
    }
    
    @media (min-width: 768px) {
      .search-grid {
        grid-template-columns: repeat(2, 1fr);
      }
    }
    
    .search-card {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid var(--border);
      border-radius: 20px;
      overflow: hidden;
      transition: border-color 0.2s ease;
    }
    
    .search-card:hover {
      border-color: var(--border-hover);
    }
    
    .sc-header {
      padding: 16px 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid var(--border);
    }
    
    .sc-name {
      font-weight: 600;
      font-size: 0.95rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 150px;
    }
    
    .sc-points {
      font-family: var(--font-dot);
      background: var(--primary);
      color: var(--bg);
      padding: 4px 10px;
      border-radius: 8px;
      font-size: 0.9rem;
      font-weight: 800;
    }
    
    .sc-body {
      padding: 18px 20px;
      font-size: 0.85rem;
      display: flex;
      flex-direction: column;
      gap: 10px;
      font-family: var(--font-mono);
    }
    
    .sc-body div {
      display: flex;
      justify-content: space-between;
    }
    
    .sc-body strong {
      color: var(--muted);
      font-size: 0.75rem;
      font-weight: 400;
    }
    
    /* Footer */
    footer {
      text-align: center;
      color: var(--muted);
      font-size: 0.75rem;
      font-family: var(--font-mono);
      margin-top: 60px;
      letter-spacing: 1px;
    }
    
    footer a {
      color: var(--primary);
      text-decoration: none;
      border-bottom: 1px dotted var(--primary);
    }
    
    footer a:hover {
      color: var(--accent);
      border-bottom-color: var(--accent);
    }
    
    /* Scrollbar */
    ::-webkit-scrollbar {
      width: 6px;
      height: 6px;
    }
    ::-webkit-scrollbar-track {
      background: var(--bg);
    }
    ::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.1);
      border-radius: 10px;
    }
    ::-webkit-scrollbar-thumb:hover {
      background: rgba(255, 255, 255, 0.3);
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="nothing-grid">
      <!-- Left Column -->
      <div class="main-column">
        
        <!-- Header Widget -->
        <div class="widget header-widget">
          <div class="header-left">
            <h1 class="logo-text">RP.sync</h1>
            <p class="logo-sub">MONITOR.OS // V1.0.5</p>
          </div>
          <div class="header-right">
            <div class="sync-badge">
              <span class="pulse-dot"></span>
              <span class="sync-text">LIVE FEED</span>
            </div>
          </div>
        </div>
        
        <!-- Stats Widgets -->
        <div class="stats-grid">
          <div class="widget stat-widget">
            <span class="widget-label">SCAN CYCLES</span>
            <div class="stat-large-val">${scheduler.totalChecks}</div>
            <div class="stat-sub-label">TOTAL LOOPS RUN</div>
            <div class="widget-decor-dots"></div>
          </div>
          
          <div class="widget stat-widget">
            <span class="widget-label">DATABASE SIZE</span>
            <div class="stat-large-val">${totalRows.toLocaleString()}</div>
            <div class="stat-sub-label">TOTAL ROWS PARSED</div>
            <div class="widget-decor-dots"></div>
          </div>
          
          <div class="widget stat-widget">
            <span class="widget-label">ACTIVE NODES</span>
            <div class="stat-large-val">${tabs.length}</div>
            <div class="stat-sub-label">DISCOVERED TABS</div>
            <div class="widget-decor-dots"></div>
          </div>
          
          <div class="widget stat-widget ${scheduler.totalErrors > 0 ? 'alert-widget' : ''}">
            <span class="widget-label">EXCEPTIONS</span>
            <div class="stat-large-val ${scheduler.totalErrors > 0 ? 'accent-text' : ''}">${scheduler.totalErrors}</div>
            <div class="stat-sub-label">CRITICAL ERRORS</div>
            <div class="widget-decor-dots"></div>
          </div>
        </div>
        
        <!-- Query Engine Widget -->
        <div class="widget search-widget">
          <span class="widget-label">QUERY ENGINE</span>
          <div class="search-input-wrapper">
            <input type="text" id="searchInput" placeholder="Search database (e.g. Abinandh, Roll No)..." autocomplete="off" />
            <span class="search-hint">SPACE MONO SEARCH ACTIVE</span>
          </div>
          <div id="searchResults"></div>
        </div>
        
        <!-- Nodes Widget -->
        <div class="widget nodes-widget">
          <span class="widget-label">NODE DIRECTORY</span>
          <div class="nodes-table-wrapper">
            ${tabs.length === 0 ? "<p class='no-data-msg'>NO ACTIVE NODES DETECTED</p>" : `
            <table class="nodes-table">
              <thead>
                <tr>
                  <th>NODE ID</th>
                  <th class="align-right">RECORD SIZE</th>
                </tr>
              </thead>
              <tbody>${tabRows}</tbody>
            </table>`}
          </div>
        </div>
      </div>
      
      <!-- Right Column -->
      <div class="side-column">
        
        <!-- Dial Status Widget -->
        <div class="widget dial-main-widget">
          <span class="widget-label">SYSTEM STATE</span>
          <div class="dial-container-wrapper">
            <div class="dial-widget">
              <div class="dial-outer">
                <div class="dial-dot"></div>
              </div>
              <div class="dial-inner">
                <span class="dial-value ${scheduler.isRunning ? '' : 'accent-text'}">${scheduler.isRunning ? "RUNNING" : "HALTED"}</span>
                <span class="dial-label">ENGINE STATUS</span>
              </div>
            </div>
          </div>
          <div class="dial-footer-info">
            <div class="info-row">
              <span>LAST SYNC:</span>
              <span class="mono-value">${lastFetch}</span>
            </div>
            <div class="info-row">
              <span>NEXT SCAN:</span>
              <span class="mono-value">${scheduler.nextCheckAt ? new Date(scheduler.nextCheckAt).toLocaleTimeString() : "—"}</span>
            </div>
          </div>
        </div>
        
        <!-- Log Widget -->
        <div class="widget log-widget">
          <span class="widget-label">SYSTEM EVENT LOG</span>
          <div class="log-timeline">
            ${state.recentChanges.length === 0
      ? "<p class='no-data-msg'>EVENT LOG EMPTY</p>"
      : recentChangeSummaries}
          </div>
        </div>
      </div>
    </div>
    
    ${scheduler.lastError ? `<section style="border-color:var(--accent); margin-top:20px; border-radius:28px; padding:24px; background:var(--surface-card); border:1px solid var(--accent)">
      <h2 style="font-family:var(--font-dot); font-size:1.1rem; color:var(--accent); margin-bottom:12px; text-transform:uppercase;">[ Critical Fault ]</h2>
      <p style="color:var(--accent); font-family:var(--font-mono); font-size:0.85rem;">${escapeHtml(scheduler.lastError)}</p>
    </section>` : ""}

    <footer>
      Spreadsheet Target: ${escapeHtml(state.spreadsheetId)} &bull;
      API: <a href="/status" target="_blank">/status</a> &bull; <a href="/changes" target="_blank">/changes</a> &bull; <a href="/tabs" target="_blank">/tabs</a>
    </footer>
  </div>

  <script>
    let refreshTimer = setTimeout(() => window.location.reload(), 30000);
    const searchInput = document.getElementById('searchInput');
    const searchResults = document.getElementById('searchResults');
    let searchTimeout = null;

    searchInput.addEventListener('focus', () => clearTimeout(refreshTimer));
    searchInput.addEventListener('blur', () => {
      if (!searchInput.value.trim()) {
        refreshTimer = setTimeout(() => window.location.reload(), 30000);
      }
    });

    searchInput.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      const q = e.target.value.trim();
      if (!q) {
        searchResults.innerHTML = '';
        return;
      }
      searchTimeout = setTimeout(() => {
        fetch('/api/search?q=' + encodeURIComponent(q))
          .then(res => res.json())
          .then(data => {
            if (data.results.length === 0) {
              searchResults.innerHTML = '<p class="no-data-msg">NO MATCHING RECORDS</p>';
              return;
            }
            let html = '<div class="search-grid">';
            data.results.forEach(res => {
              const name = res.row.length > 3 ? escapeHtmlJs(res.row[3]) : 'Unknown';
              const roll = res.row.length > 2 ? escapeHtmlJs(res.row[2]) : 'N/A';
              const major = res.row.length > 5 ? escapeHtmlJs(res.row[5]) : 'N/A';
              const points = res.row.length > 9 ? escapeHtmlJs(res.row[9]) : (res.row.length > 0 ? escapeHtmlJs(res.row[res.row.length - 1]) : '0');
              
              html += \`
                <div class="search-card">
                  <div class="sc-header">
                    <div class="sc-name">\${name}</div>
                    <div class="sc-points">\${points}</div>
                  </div>
                  <div class="sc-body">
                    <div><strong>Roll No</strong> <span>\${roll}</span></div>
                    <div><strong>Major</strong> <span>\${major}</span></div>
                    <div><strong>Node</strong> <span>\${escapeHtmlJs(res.tab)}</span></div>
                  </div>
                </div>
              \`;
            });
            html += '</div>';
            searchResults.innerHTML = html;
          });
      }, 300);
    });

    function escapeHtmlJs(str) {
      return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
    }
  </script>
</body>
</html>`;
}


function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// -------------------------------------------------------------------
// Express app
// -------------------------------------------------------------------

export function createDashboard(): express.Application {
  const app = express();

  // GET / — HTML dashboard
  app.get("/", (_req: Request, res: Response) => {
    res.send(renderDashboardHtml(dashboardState));
  });

  // GET /status — JSON status
  app.get("/status", (_req: Request, res: Response) => {
    res.json({
      scheduler: dashboardState.scheduler,
      spreadsheetId: dashboardState.spreadsheetId,
      tabCount: dashboardState.currentData?.tabs.length ?? 0,
      totalRows: dashboardState.currentData?.totalRows ?? 0,
      lastFetchedAt: dashboardState.currentData?.fetchedAt ?? null,
    });
  });

  // GET /changes — recent change events
  app.get("/changes", (_req: Request, res: Response) => {
    res.json({
      count: dashboardState.recentChanges.length,
      changes: dashboardState.recentChanges,
    });
  });

  // GET /tabs — current tab names
  app.get("/tabs", (_req: Request, res: Response) => {
    const tabs = dashboardState.currentData?.tabs.map((t) => ({
      name: t.name,
      rowCount: t.rowCount,
    })) ?? [];
    res.json({ tabs });
  });

  // GET /api/search — Search data
  app.get("/api/search", (req: Request, res: Response) => {
    const q = (req.query.q as string || "").toLowerCase().trim();
    if (!q) {
      return res.json({ results: [] });
    }

    const results: any[] = [];
    if (dashboardState.currentData) {
      for (const tab of dashboardState.currentData.tabs) {
        for (const row of tab.rows) {
          const matches = row.some(cell => cell.toLowerCase().includes(q));
          if (matches) {
            results.push({ tab: tab.name, row });
            if (results.length >= 50) break; // Limit to 50 results
          }
        }
        if (results.length >= 50) break;
      }
    }
    res.json({ results });
  });

  return app;
}

/**
 * Starts the Express dashboard server.
 */
export function startDashboard(port: number): void {
  const app = createDashboard();
  app.listen(port, () => {
    logger.info(`[dashboard] Web dashboard running at http://localhost:${port}`);
  });
}
