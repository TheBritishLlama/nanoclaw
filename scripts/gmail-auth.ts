/**
 * Gmail Auth — copy-paste code flow
 *
 * Generates a sign-in URL the person opens on any device.
 * After signing in, Google redirects to localhost (which fails to load).
 * The person copies the full URL from their browser and pastes it here.
 * No external tools or setup required.
 *
 * Usage:
 *   npx tsx scripts/gmail-auth.ts <group-folder>
 *
 * Example:
 *   npx tsx scripts/gmail-auth.ts discord_andrew_chat
 *
 * Credentials are saved to ~/.gmail-mcp/group-<group-folder>/credentials.json
 */

import fs from 'fs';
import https from 'https';
import os from 'os';
import path from 'path';
import readline from 'readline';

const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.settings.basic',
];

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const REDIRECT_URI = 'http://localhost';

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

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  const groupFolder = process.argv[2];
  if (!groupFolder) {
    console.error('Usage: npx tsx scripts/gmail-auth.ts <group-folder>');
    console.error('Example: npx tsx scripts/gmail-auth.ts discord_andrew_chat');
    process.exit(1);
  }

  if (!fs.existsSync(OAUTH_KEYS_PATH)) {
    console.error(`OAuth keys not found at ${OAUTH_KEYS_PATH}`);
    console.error('Run /add-gmail first to set up OAuth credentials.');
    process.exit(1);
  }

  const keys = JSON.parse(fs.readFileSync(OAUTH_KEYS_PATH, 'utf-8'));
  const { client_id, client_secret } = keys.installed ?? keys.web;

  // Build auth URL
  const authUrl =
    `${AUTH_URL}?` +
    new URLSearchParams({
      client_id,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: GMAIL_SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent',
    }).toString();

  console.log(`\nAuthenticating Gmail for: ${groupFolder}\n`);
  console.log('='.repeat(60));
  console.log('Send this link to the person:');
  console.log('');
  console.log(authUrl);
  console.log('');
  console.log('They sign in with Google, then get redirected to a page');
  console.log('that fails to load. They copy the URL from their browser');
  console.log('address bar and paste it here.');
  console.log('='.repeat(60));

  const pasted = await prompt('\nPaste the redirect URL here: ');

  // Extract code from pasted URL or raw code
  let code: string;
  try {
    const url = new URL(pasted.includes('?') ? pasted : `http://localhost?code=${pasted}`);
    const extracted = url.searchParams.get('code');
    if (!extracted) throw new Error('No code found');
    code = extracted;
  } catch {
    console.error('Could not extract auth code from the pasted URL.');
    process.exit(1);
  }

  console.log('\nExchanging code for tokens...');

  const tokenResponse = (await post(TOKEN_URL, {
    code,
    client_id,
    client_secret,
    redirect_uri: REDIRECT_URI,
    grant_type: 'authorization_code',
  })) as {
    access_token?: string;
    refresh_token?: string;
    token_type?: string;
    scope?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (tokenResponse.error || !tokenResponse.access_token) {
    console.error(`Auth failed: ${tokenResponse.error}`);
    console.error(tokenResponse.error_description ?? '');
    process.exit(1);
  }

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

  console.log(`\nAuthorized! Credentials saved for ${groupFolder}.`);
  console.log('Restarting NanoClaw...');
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
