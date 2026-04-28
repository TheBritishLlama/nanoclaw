import Anthropic from '@anthropic-ai/sdk';

import type { HaikuClient } from './pipeline/enricher.js';

/**
 * Creates a HaikuClient backed by the Anthropic SDK.
 * Reads ANTHROPIC_API_KEY from the environment.
 */
export function createHaiku(model: string): HaikuClient {
  const client = new Anthropic();
  return {
    async complete(prompt: string): Promise<string> {
      const response = await client.messages.create({
        model,
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      });
      return response.content
        .filter((b) => b.type === 'text')
        .map((b) => (b as { type: 'text'; text: string }).text)
        .join('\n');
    },
  };
}
