/**
 * auth.ts
 *
 * OAuth2 authentication for Google APIs.
 *
 * Flow:
 *  1. Read client credentials from GOOGLE_CREDENTIALS_JSON, GOOGLE_CREDENTIALS_PATH,
 *     or the local credentials.json fallback.
 *  2. Check for a saved token from GOOGLE_TOKEN_JSON, GOOGLE_TOKEN_PATH,
 *     or the local token.json fallback.
 *  3. If no token exists in the local fallback, open the browser-based consent flow
 *     and save the token locally.
 *
 * The exported `getAuthClient()` returns a ready-to-use OAuth2 client.
 * Call it once at startup; subsequent calls return the cached client.
 */

import { google, Auth } from "googleapis";
import fs from "fs";
import http from "http";
import path from "path";
import { URL } from "url";
import open from "open";
import { logger } from "./logger";

// OAuth2 scopes — read-only access to spreadsheets
const SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"];

// Local redirect URI used during the auth code flow
const REDIRECT_PORT = 4242;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/oauth2callback`;

const credentialsPath =
  process.env.GOOGLE_CREDENTIALS_PATH ?? path.join(process.cwd(), "credentials.json");

const tokenPath = process.env.GOOGLE_TOKEN_PATH ?? path.join(process.cwd(), "token.json");

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

interface LoadedCredentials {
  clientId: string;
  clientSecret: string;
}

interface LoadedToken {
  token: Auth.Credentials | null;
  sourceLabel: string;
  writable: boolean;
  path: string | null;
  isEnvJson: boolean;
  isFallbackPath: boolean;
}

let cachedClient: Auth.OAuth2Client | null = null;

function parseJson<T>(raw: string, sourceLabel: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse ${sourceLabel}: ${message}`);
  }
}

function extractCredentialPair(
  raw: Credentials
): { clientId: string; clientSecret: string } | null {
  const creds = raw.installed ?? raw.web;
  if (!creds) return null;

  return {
    clientId: creds.client_id,
    clientSecret: creds.client_secret,
  };
}

function pathWritable(targetPath: string): boolean {
  try {
    if (fs.existsSync(targetPath)) {
      fs.accessSync(targetPath, fs.constants.W_OK);
      return true;
    }

    fs.accessSync(path.dirname(targetPath), fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function loadCredentials(): LoadedCredentials {
  if (process.env.GOOGLE_CREDENTIALS_JSON) {
    const rawCreds = parseJson<Credentials>(
      process.env.GOOGLE_CREDENTIALS_JSON,
      "GOOGLE_CREDENTIALS_JSON"
    );
    const creds = extractCredentialPair(rawCreds);

    if (!creds) {
      throw new Error("Unsupported credentials format in GOOGLE_CREDENTIALS_JSON.");
    }

    logger.info("✓ Loaded credentials from GOOGLE_CREDENTIALS_JSON");
    return {
      ...creds,
    };
  }

  if (!fs.existsSync(credentialsPath)) {
    throw new Error(
      `credentials.json not found at: ${credentialsPath}\n` +
        `  → Set GOOGLE_CREDENTIALS_JSON, GOOGLE_CREDENTIALS_PATH, or provide a local credentials.json file.`
    );
  }

  const rawCreds = parseJson<Credentials>(fs.readFileSync(credentialsPath, "utf-8"), credentialsPath);
  const creds = extractCredentialPair(rawCreds);

  if (!creds) {
    throw new Error(`Unsupported credentials format in ${credentialsPath}.`);
  }

  logger.info(`✓ Loaded credentials from ${credentialsPath}`);
  return {
    ...creds,
  };
}

function loadToken(): LoadedToken {
  if (process.env.GOOGLE_TOKEN_JSON) {
    const token = parseJson<Auth.Credentials>(
      process.env.GOOGLE_TOKEN_JSON,
      "GOOGLE_TOKEN_JSON"
    );

    logger.info("✓ Loaded token from GOOGLE_TOKEN_JSON");
    return {
      token,
      sourceLabel: "GOOGLE_TOKEN_JSON",
      writable: false,
      path: null,
      isEnvJson: true,
      isFallbackPath: false,
    };
  }

  if (process.env.GOOGLE_TOKEN_PATH) {
    if (!fs.existsSync(tokenPath)) {
      throw new Error(
        `token.json not found at: ${tokenPath}\n` +
          `  → Mount a secret file there or set GOOGLE_TOKEN_JSON.`
      );
    }

    const token = parseJson<Auth.Credentials>(fs.readFileSync(tokenPath, "utf-8"), tokenPath);
    logger.info(`✓ Loaded token from ${tokenPath}`);
    return {
      token,
      sourceLabel: tokenPath,
      writable: pathWritable(tokenPath),
      path: tokenPath,
      isEnvJson: false,
      isFallbackPath: false,
    };
  }

  if (fs.existsSync(tokenPath)) {
    const token = parseJson<Auth.Credentials>(fs.readFileSync(tokenPath, "utf-8"), tokenPath);
    logger.info(`✓ Loaded token from ${tokenPath}`);
    return {
      token,
      sourceLabel: tokenPath,
      writable: pathWritable(tokenPath),
      path: tokenPath,
      isEnvJson: false,
      isFallbackPath: true,
    };
  }

  logger.info(`No token found at fallback path ${tokenPath}; starting OAuth2 browser flow.`);
  return {
    token: null,
    sourceLabel: tokenPath,
    writable: pathWritable(tokenPath),
    path: tokenPath,
    isEnvJson: false,
    isFallbackPath: true,
  };
}

function persistTokenIfWritable(tokenSource: LoadedToken, token: Auth.Credentials): void {
  if (!tokenSource.path || !tokenSource.writable || tokenSource.isEnvJson) {
    return;
  }

  fs.writeFileSync(tokenSource.path, JSON.stringify(token, null, 2));
}

/**
 * Returns an authenticated OAuth2 client.
 * On first call this may trigger the browser-based consent flow.
 */
export async function getAuthClient(): Promise<Auth.OAuth2Client> {
  if (cachedClient) return cachedClient;

  const creds = loadCredentials();

  const oAuth2Client = new google.auth.OAuth2(
    creds.clientId,
    creds.clientSecret,
    REDIRECT_URI
  );

  const tokenSource = loadToken();

  if (tokenSource.token) {
    oAuth2Client.setCredentials(tokenSource.token);

    oAuth2Client.on("tokens", (newTokens) => {
      const merged = { ...(tokenSource.token ?? {}), ...newTokens };
      tokenSource.token = merged;

      if (tokenSource.isEnvJson) {
        logger.warn(
          "OAuth2 token refreshed. Update GOOGLE_TOKEN_JSON with this value:\n" +
            JSON.stringify(merged)
        );
        return;
      }

      if (!tokenSource.path) {
        return;
      }

      if (tokenSource.writable) {
        persistTokenIfWritable(tokenSource, merged);
        logger.debug(`OAuth2 token refreshed and saved to ${tokenSource.path}.`);
        return;
      }

      logger.warn(
        `OAuth2 token refreshed in memory, but ${tokenSource.path} is not writable so the refresh token was not persisted.`
      );
    });

    cachedClient = oAuth2Client;
    return oAuth2Client;
  }

  if (!tokenSource.isFallbackPath) {
    throw new Error(
      `No token found at ${tokenSource.sourceLabel}.\n` +
        `  → Set GOOGLE_TOKEN_JSON, GOOGLE_TOKEN_PATH, or provide a local token.json file.`
    );
  }

  const freshToken = await runBrowserAuthFlow(oAuth2Client, tokenSource);
  oAuth2Client.setCredentials(freshToken);

  oAuth2Client.on("tokens", (newTokens) => {
    const merged = { ...(freshToken ?? {}), ...newTokens };
    tokenSource.token = merged;

    if (tokenSource.writable) {
      persistTokenIfWritable(tokenSource, merged);
      logger.debug(`OAuth2 token refreshed and saved to ${tokenSource.path}.`);
      return;
    }

    logger.warn(
      `OAuth2 token refreshed in memory, but ${tokenSource.path} is not writable so the refresh token was not persisted.`
    );
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
 * 5. Saves token.json when the fallback path is writable
 */
async function runBrowserAuthFlow(
  oAuth2Client: Auth.OAuth2Client,
  tokenSource: LoadedToken
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

        const { tokens } = await oAuth2Client.getToken(code);
        tokenSource.token = tokens;

        if (tokenSource.writable) {
          persistTokenIfWritable(tokenSource, tokens);
          logger.info(`✓ Authentication successful. Token saved to: ${tokenSource.path}`);
        } else {
          logger.info("✓ Authentication successful. Token kept in memory for this run.");
        }

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
