---
name: add-stack
description: Add Stack — a daily-drop tutor for indie-builder culture, tools, and lore. Sends 3 emails per day from scraped sources (HN, Lobste.rs, blogs, etc.), uses Qwen locally for grading and Haiku for enrichment, mirrors all drops to an Obsidian vault, and learns from numeric 1-10 reply ratings.
---

# Add Stack

This skill adds Stack to NanoClaw. Stack is a personal cultural-fluency tutor that delivers daily email drops about tools, concepts, and lore from the indie-builder / sovereignty / power-user world.

## Phase 1: Pre-flight

Check if `src/stack/index.ts` exists. If it does, skip to Phase 3 (Setup).

## Phase 2: Apply Code Changes

```bash
git remote add stack https://github.com/qwibitai/nanoclaw-stack.git 2>/dev/null || true
git fetch stack
git merge stack/skill/stack --no-edit
```

If the merge succeeds, run:

```bash
npm install
npm run build
```

## Phase 3: Setup

1. Ensure Ollama is installed and reachable. If not, run `/add-ollama-tool` first.
2. Pull required models: `ollama pull qwen3:14b`
3. Re-authenticate Gmail (Stack sends FROM `amazingkangaroofilms@gmail.com` TO `kaitseng@seattleacademy.org`):
   ```bash
   npx tsx scripts/gmail-auth.ts
   ```
4. Create the Obsidian vault directory:
   ```bash
   mkdir -p /mnt/c/Users/Explo/Documents/Stack/{Drops/{Foundations,Tools,Concepts,Lore},Scraped/{Pending,Dropped},Reviews,Index}
   ```
5. Run Stack DB migrations:
   ```bash
   npx tsx scripts/run-migrations.ts groups/stack/migrations
   ```
6. Confirm cron entries are registered (Stack adds them on startup):
   ```bash
   npm run dev
   ```
7. Wait for the next 08:00 / 10:00 / 15:00 PT slot — first email should arrive.

## Phase 4: Verify

- Check Gmail inbox for first drop
- Reply with a number 1-10 (optionally with feedback text after)
- Verify the rating shows up in the Obsidian vault file's frontmatter

## Troubleshooting

See `docs/superpowers/specs/2026-04-27-stack-design.md` "Error Handling" section.
