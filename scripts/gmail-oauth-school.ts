// One-shot OAuth helper to add a SECOND Gmail account (kaitseng@seattleacademy.org)
// alongside the existing amazingkangaroofilms@gmail.com.
//
// Reads the existing GCP OAuth client (~/.gmail-mcp/gcp-oauth.keys.json), spins
// up a tiny HTTP server on localhost:9100 to catch the OAuth redirect, prints
// the auth URL, and saves the resulting refresh token to
// ~/.gmail-mcp/credentials-school.json.
//
// If Seattle Academy's Workspace blocks the OAuth, you'll see a Google error
// page after sign-in (no callback fires); the script prints what to do next.
//
// Usage:  npx tsx scripts/gmail-oauth-school.ts

import http from 'http';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { google } from 'googleapis';

const PORT = 9100;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;
const SCOPES = ['https://www.googleapis.com/auth/gmail.modify'];

const keysPath = path.join(os.homedir(), '.gmail-mcp', 'gcp-oauth.keys.json');
const tokensPath = path.join(
  os.homedir(),
  '.gmail-mcp',
  'credentials-school.json',
);

const keys = JSON.parse(fs.readFileSync(keysPath, 'utf-8')).installed;
const oauth2 = new google.auth.OAuth2(
  keys.client_id,
  keys.client_secret,
  REDIRECT_URI,
);

const authUrl = oauth2.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: SCOPES,
  // Hint Google to land us on the school account picker.
  login_hint: 'kaitseng@seattleacademy.org',
});

console.log('\n=== Gmail OAuth — add school account ===');
console.log('\nOpen this URL in any browser, sign in as kaitseng@seattleacademy.org,');
console.log('and approve the requested permissions:\n');
console.log(authUrl);
console.log('\nWaiting for callback on http://localhost:' + PORT + ' …\n');
console.log('(If Google shows "Access blocked" or "App not authorized by admin",');
console.log(' the school Workspace is blocking us. Press Ctrl+C and report what');
console.log(' you saw — we\'ll switch to forwarding or admin-allowlist path.)\n');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  if (url.pathname !== '/oauth2callback') {
    res.writeHead(404).end();
    return;
  }
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  if (error) {
    res.writeHead(200, { 'content-type': 'text/html' }).end(
      `<h2>OAuth failed: ${error}</h2><p>Description: ${url.searchParams.get('error_description') ?? '(none)'}</p><p>Tell Claude what this page says — most likely Seattle Academy IT is blocking the app.</p>`,
    );
    console.error('OAuth error:', error, url.searchParams.get('error_description'));
    server.close();
    process.exit(1);
  }
  if (!code) {
    res.writeHead(400).end('No code in callback');
    return;
  }
  try {
    const { tokens } = await oauth2.getToken(code);
    fs.mkdirSync(path.dirname(tokensPath), { recursive: true });
    fs.writeFileSync(tokensPath, JSON.stringify(tokens, null, 2), {
      mode: 0o600,
    });
    res
      .writeHead(200, { 'content-type': 'text/html' })
      .end(
        '<h2>Success — you can close this tab.</h2><p>Refresh token saved to ~/.gmail-mcp/credentials-school.json.</p>',
      );
    console.log(
      `\n✅ Saved tokens to ${tokensPath} (refresh token = ${tokens.refresh_token ? 'yes' : 'NO — try again with prompt=consent'})`,
    );
    server.close();
  } catch (e) {
    console.error('Token exchange failed:', e);
    res.writeHead(500).end('Token exchange failed: ' + (e as Error).message);
    server.close();
    process.exit(1);
  }
});

server.listen(PORT, '127.0.0.1');
