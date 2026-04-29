import { query } from '@anthropic-ai/claude-agent-sdk';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';

import type { HaikuClient } from './pipeline/enricher.js';

const require = createRequire(import.meta.url);

// The SDK's native-binary auto-detection sometimes picks the musl variant on
// glibc systems (e.g. WSL Ubuntu), which fails because /lib/ld-musl-* isn't
// present. Resolve the gnu variant explicitly when it's installed and runnable.
function findClaudeBinary(): string | undefined {
  const candidates = [
    '@anthropic-ai/claude-agent-sdk-linux-x64',
    '@anthropic-ai/claude-agent-sdk-linux-x64-musl',
  ];
  for (const pkg of candidates) {
    try {
      const pkgJson = require.resolve(`${pkg}/package.json`);
      const binPath = path.join(path.dirname(pkgJson), 'claude');
      if (fs.existsSync(binPath)) return binPath;
    } catch {
      /* package not installed — try next */
    }
  }
  return undefined;
}

const PATH_TO_CLAUDE = findClaudeBinary();

/**
 * Creates a HaikuClient backed by the Claude Agent SDK.
 *
 * Auth is handled by the SDK via the local Claude Code installation —
 * uses the user's existing OAuth token (CLAUDE_CODE_OAUTH_TOKEN or
 * ~/.claude/.credentials.json) rather than a raw ANTHROPIC_API_KEY.
 * This keeps Stack's Haiku usage on the user's Claude subscription.
 *
 * Tools are explicitly disabled — enrichment is pure text completion;
 * the model should only return the JSON shape requested by the prompt.
 */
export function createHaiku(model: string): HaikuClient {
  return {
    async complete(prompt: string): Promise<string> {
      let result = '';
      for await (const message of query({
        prompt,
        options: {
          model,
          allowedTools: [],
          permissionMode: 'bypassPermissions',
          systemPrompt: undefined,
          ...(PATH_TO_CLAUDE
            ? { pathToClaudeCodeExecutable: PATH_TO_CLAUDE }
            : {}),
        },
      })) {
        if (message.type === 'assistant' && message.message?.content) {
          for (const block of message.message.content) {
            if (block.type === 'text' && typeof block.text === 'string') {
              result += block.text;
            }
          }
        }
      }
      return result;
    },
  };
}
