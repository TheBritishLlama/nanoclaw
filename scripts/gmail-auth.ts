/**
 * Gmail Device Flow Auth
 *
 * Authenticates a Gmail account using Google's device authorization flow.
 * The person can sign in on any device — no localhost redirect needed.
 *
 * Usage:
 *   npx tsx scripts/gmail-auth.ts <group-folder>
 *
 * Example:
 *   npx tsx scripts/gmail-auth.ts discord_andrew_chat
 *
 * Credentials are saved to ~/.gmail-mcp/group-<group-folder>/credentials.json
 * and the container for that group will use them automatically.
 */

import fs from 'fs';
import https from 'https';
import os from 'os';
import path from 'path';

const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.settings.basic',
];

const DEVICE_CODE_URL = 'https://oauth2.googleapis.com/device/code';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_MCP_DIR = path.join(os.homedir(), '.gmail-mcp');
const OAUTH_KEYS_PATH = path.join(GMAIL_MCP_DIR, 'gcp-oauth.keys.json');

function post(url: string, body: Record<string, string>): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const data = new URLSearchParams(body).toString();
    const urlObj = new URL(url);
    const req = https.request(
      {
        hostname: urlObj.hostname,
        path: urlObj.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(data),
        },
      },
      res => {
        let body = '';
        res.on('data', chunk => (body += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new Error(`Failed to parse response: ${body}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const groupFolder = process.argv[2];
  if (!groupFolder) {
    console.error('Usage: npx tsx scripts/gmail-auth.ts <group-folder>');
    console.error('Example: npx tsx scripts/gmail-auth.ts discord_andrew_chat');
    console.error('\nAvailable groups can be found in the groups/ directory.');
    process.exit(1);
  }

  if (!fs.existsSync(OAUTH_KEYS_PATH)) {
    console.error(`OAuth keys not found at ${OAUTH_KEYS_PATH}`);
    console.error('Run /add-gmail first to set up the base OAuth credentials.');
    process.exit(1);
  }

  const keys = JSON.parse(fs.readFileSync(OAUTH_KEYS_PATH, 'utf-8'));
  const { client_id, client_secret } = keys.installed ?? keys.web;

  console.log(`Authenticating Gmail for group: ${groupFolder}`);
  console.log('Requesting device authorization...\n');

  const deviceResponse = (await post(DEVICE_CODE_URL, {
    client_id,
    scope: GMAIL_SCOPES.join(' '),
  })) as {
    device_code?: string;
    user_code?: string;
    verification_url?: string;
    expires_in?: number;
    interval?: number;
    error?: string;
    error_description?: string;
  };

  if (deviceResponse.error || !deviceResponse.device_code) {
    console.error(`Error from Google: ${deviceResponse.error}`);
    console.error(deviceResponse.error_description ?? '');
    console.error(
      '\nDevice flow may not be enabled for this OAuth client. In the Google Cloud Console,'
    );
    console.error(
      'go to APIs & Services > Credentials, edit the OAuth client, and ensure it is a "Desktop app" type.'
    );
    process.exit(1);
  }

  const { device_code, user_code, verification_url, expires_in = 1800, interval = 5 } =
    deviceResponse;

  console.log('='.repeat(55));
  console.log(`Ask the person to:`);
  console.log(`  1. Go to:  ${verification_url}`);
  console.log(`  2. Enter:  ${user_code}`);
  console.log(`  3. Sign in with their Google account and approve access`);
  console.log('='.repeat(55));
  console.log('\nWaiting for authorization', { end: '' });

  const pollMs = interval * 1000;
  const deadline = Date.now() + expires_in * 1000;

  while (Date.now() < deadline) {
    await sleep(pollMs);
    process.stdout.write('.');

    const tokenResponse = (await post(TOKEN_URL, {
      client_id,
      client_secret,
      device_code,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    })) as {
      access_token?: string;
      refresh_token?: string;
      token_type?: string;
      scope?: string;
      expires_in?: number;
      error?: string;
    };

    if (tokenResponse.error === 'authorization_pending') continue;
    if (tokenResponse.error === 'slow_down') {
      await sleep(pollMs);
      continue;
    }
    if (tokenResponse.error) {
      console.error(`\nAuth failed: ${tokenResponse.error}`);
      process.exit(1);
    }

    if (tokenResponse.access_token) {
      const groupCredDir = path.join(GMAIL_MCP_DIR, `group-${groupFolder}`);
      fs.mkdirSync(groupCredDir, { recursive: true });

      // Copy oauth keys so the MCP server can refresh tokens
      fs.copyFileSync(OAUTH_KEYS_PATH, path.join(groupCredDir, 'gcp-oauth.keys.json'));

      const credentials = {
        access_token: tokenResponse.access_token,
        refresh_token: tokenResponse.refresh_token,
        scope: tokenResponse.scope ?? GMAIL_SCOPES.join(' '),
        token_type: tokenResponse.token_type ?? 'Bearer',
        expiry_date: Date.now() + (tokenResponse.expires_in ?? 3600) * 1000,
      };

      fs.writeFileSync(
        path.join(groupCredDir, 'credentials.json'),
        JSON.stringify(credentials, null, 2)
      );

      console.log('\n\nAuthorized!');
      console.log(`Credentials saved to ~/.gmail-mcp/group-${groupFolder}/`);
      console.log(
        `\nRestart NanoClaw to activate: systemctl --user restart nanoclaw`
      );
      process.exit(0);
    }
  }

  console.error('\nAuthorization timed out. Please try again.');
  process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
