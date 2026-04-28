import { query } from '@anthropic-ai/claude-agent-sdk';

import type { HaikuClient } from './pipeline/enricher.js';

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
