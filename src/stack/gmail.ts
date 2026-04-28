import fs from 'fs';
import os from 'os';
import path from 'path';

import { google, gmail_v1 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';

import type { GmailSender } from './delivery/outbound.js';

/**
 * Wraps an authenticated Gmail v1 client as a Stack GmailSender.
 *
 * After each send, fetches the RFC 2822 Message-ID header — that's the
 * value that recipients echo in their In-Reply-To header on replies, and
 * it's what stack_queue.email_message_id must store for Stack's inbound
 * dispatcher to match replies against drops. The Gmail send response only
 * returns the internal message id (e.g. "190abc"), which is NOT the same.
 */
export function wrapGmailClient(gmail: gmail_v1.Gmail): GmailSender {
  return {
    async send({ from, to, subject, html, text }) {
      const boundary = `----=_Part_${Date.now()}`;
      const rawHeaders = [
        `From: ${from}`,
        `To: ${to}`,
        `Subject: ${subject}`,
        'MIME-Version: 1.0',
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        '',
        `--${boundary}`,
        'Content-Type: text/plain; charset=utf-8',
        '',
        text,
        '',
        `--${boundary}`,
        'Content-Type: text/html; charset=utf-8',
        '',
        html,
        '',
        `--${boundary}--`,
      ].join('\r\n');

      const encoded = Buffer.from(rawHeaders)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      const sendRes = await gmail.users.messages.send({
        userId: 'me',
        requestBody: { raw: encoded },
      });

      const internalId = sendRes.data.id;
      if (!internalId) return { messageId: '' };

      const meta = await gmail.users.messages.get({
        userId: 'me',
        id: internalId,
        format: 'metadata',
        metadataHeaders: ['Message-Id'],
      });
      const headers = meta.data.payload?.headers ?? [];
      const idHeader = headers.find(
        (h) => h.name?.toLowerCase() === 'message-id',
      );
      return { messageId: idHeader?.value ?? '' };
    },
  };
}

/**
 * Creates a GmailSender for Stack using the same OAuth token files as
 * the NanoClaw Gmail channel (~/.gmail-mcp/gcp-oauth.keys.json and
 * ~/.gmail-mcp/credentials.json). Tokens are refreshed automatically
 * and persisted back to disk.
 */
export async function createStackGmail(): Promise<GmailSender> {
  const credDir = path.join(os.homedir(), '.gmail-mcp');
  const keysPath = path.join(credDir, 'gcp-oauth.keys.json');
  const tokensPath = path.join(credDir, 'credentials.json');

  if (!fs.existsSync(keysPath) || !fs.existsSync(tokensPath)) {
    throw new Error(
      `Stack Gmail: credentials not found in ~/.gmail-mcp/. ` +
      `Run /add-gmail to set them up (keysPath=${keysPath}).`,
    );
  }

  const keys = JSON.parse(fs.readFileSync(keysPath, 'utf-8'));
  const tokens = JSON.parse(fs.readFileSync(tokensPath, 'utf-8'));

  const clientConfig = keys.installed || keys.web || keys;
  const { client_id, client_secret, redirect_uris } = clientConfig;

  const oauth2Client: OAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris?.[0],
  );
  oauth2Client.setCredentials(tokens);

  oauth2Client.on('tokens', (newTokens) => {
    try {
      const current = JSON.parse(fs.readFileSync(tokensPath, 'utf-8'));
      Object.assign(current, newTokens);
      fs.writeFileSync(tokensPath, JSON.stringify(current, null, 2));
    } catch {
      // non-fatal
    }
  });

  return wrapGmailClient(google.gmail({ version: 'v1', auth: oauth2Client }));
}
