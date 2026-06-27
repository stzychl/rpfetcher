/**
 * auth.ts
 *
 * OAuth2 authentication for Google APIs.
 *
 * Flow:
 *  1. Read client credentials from credentials.json (downloaded from Google Cloud Console)
 *  2. Check for a saved token.json
 *     a. If found → load it, attach to the OAuth2 client, let googleapis auto-refresh
 *     b. If not found → open the user's browser to the consent URL,
 *        spin up a temporary local HTTP server to capture the auth code,
 *        exchange it for tokens, save token.json, done
 *
 * The exported `getAuthClient()` returns a ready-to-use OAuth2 client.
 * Call it once at startup; subsequent calls return the cached client.
 */

import { google, Auth } from "googleapis";
import fs from "fs";
import http from "http";
import { URL } from "url";
import open from "open";
import path from "path";
import { logger } from "./logger";

// OAuth2 scopes — read-only access to spreadsheets
const SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"];

// Local redirect URI used during the auth code flow
const REDIRECT_PORT = 4242;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/oauth2callback`;

interface Credentials {
  installed?: {
    client_id: string;
    client_secret: string;
    redirect_uris: string[];
  };
  web?: {
    client_id: string;
    client_secret: string;
    redirect_uris: string[];
  };
}

let cachedClient: Auth.OAuth2Client | null = null;

/**
 * Returns an authenticated OAuth2 client.
 * On first call this may trigger the browser-based consent flow.
 */
export async function getAuthClient(
  credentialsPath: string,
  tokenPath: string
): Promise<Auth.OAuth2Client> {
  if (cachedClient) return cachedClient;

  // 1. Load client credentials
  if (!fs.existsSync(credentialsPath)) {
    throw new Error(
      `credentials.json not found at: ${credentialsPath}\n` +
      `  → Download it from https://console.cloud.google.com/apis/credentials\n` +
      `  → Create an OAuth 2.0 Client ID (Desktop app type)`
    );
  }

  const rawCreds: Credentials = JSON.parse(
    fs.readFileSync(credentialsPath, "utf-8")
  );
  const creds = rawCreds.installed ?? rawCreds.web;
  if (!creds) throw new Error("Unsupported credentials.json format.");

  const oAuth2Client = new google.auth.OAuth2(
    creds.client_id,
    creds.client_secret,
    REDIRECT_URI
  );

  // 2. Check for a saved token
  if (fs.existsSync(tokenPath)) {
    const token = JSON.parse(fs.readFileSync(tokenPath, "utf-8"));
    oAuth2Client.setCredentials(token);

    // Auto-save refreshed tokens
    oAuth2Client.on("tokens", (newTokens) => {
      const existing = JSON.parse(fs.readFileSync(tokenPath, "utf-8"));
      const merged = { ...existing, ...newTokens };
      fs.writeFileSync(tokenPath, JSON.stringify(merged, null, 2));
      logger.debug("OAuth2 token refreshed and saved.");
    });

    logger.info("Loaded saved OAuth2 token from token.json");
    cachedClient = oAuth2Client;
    return oAuth2Client;
  }

  // 3. No token — start the browser-based OAuth2 consent flow
  logger.info(
    "No token.json found. Starting OAuth2 browser authentication flow..."
  );
  const token = await runBrowserAuthFlow(oAuth2Client, tokenPath);
  oAuth2Client.setCredentials(token);

  // Auto-save refreshed tokens going forward
  oAuth2Client.on("tokens", (newTokens) => {
    const existing = JSON.parse(fs.readFileSync(tokenPath, "utf-8"));
    const merged = { ...existing, ...newTokens };
    fs.writeFileSync(tokenPath, JSON.stringify(merged, null, 2));
    logger.debug("OAuth2 token refreshed and saved.");
  });

  cachedClient = oAuth2Client;
  return oAuth2Client;
}

/**
 * Runs the OAuth2 authorization code flow:
 * 1. Generates an authorization URL
 * 2. Opens it in the user's browser
 * 3. Waits for the redirect to localhost:REDIRECT_PORT/oauth2callback
 * 4. Exchanges the code for access + refresh tokens
 * 5. Saves token.json
 */
async function runBrowserAuthFlow(
  oAuth2Client: Auth.OAuth2Client,
  tokenPath: string
): Promise<Auth.Credentials> {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    // Force re-consent to ensure we always receive a refresh_token
    prompt: "consent",
  });

  return new Promise((resolve, reject) => {
    // Temporary HTTP server to receive the redirect
    const server = http.createServer(async (req, res) => {
      try {
        if (!req.url?.startsWith("/oauth2callback")) return;

        const url = new URL(req.url, `http://localhost:${REDIRECT_PORT}`);
        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");

        if (error) {
          res.end(`<h1>Authentication Failed</h1><p>${error}</p>`);
          server.close();
          reject(new Error(`OAuth2 error: ${error}`));
          return;
        }

        if (!code) {
          res.end("<h1>No code received.</h1>");
          server.close();
          reject(new Error("No auth code received from Google."));
          return;
        }

        // Exchange the auth code for tokens
        const { tokens } = await oAuth2Client.getToken(code);
        fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2));
        logger.info(`✅ Authentication successful. Token saved to: ${tokenPath}`);

        res.end(`
          <html>
            <body style="font-family:sans-serif;text-align:center;padding:60px">
              <h1 style="color:#22c55e">✅ Authentication Successful!</h1>
              <p>You can close this tab and return to your terminal.</p>
            </body>
          </html>
        `);

        server.close();
        resolve(tokens);
      } catch (err) {
        res.end("<h1>Error during authentication.</h1>");
        server.close();
        reject(err);
      }
    });

    server.listen(REDIRECT_PORT, async () => {
      logger.info(`Opening browser for Google authentication...`);
      logger.info(`  If the browser doesn't open, visit:\n  ${authUrl}`);
      await open(authUrl);
    });

    server.on("error", (err) => {
      reject(new Error(`Failed to start local auth server: ${err.message}`));
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      server.close();
      reject(new Error("Authentication timed out after 5 minutes."));
    }, 5 * 60 * 1000);
  });
}
