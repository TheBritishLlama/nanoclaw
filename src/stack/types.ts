// Minimal type stub for Task 2 — Task 3 will expand this file.

export type Bucket = 'tool' | 'concept' | 'lore' | 'foundation';

export type DropStatus = 'queued' | 'pending_review' | 'sent' | 'rejected' | 'archived';

export interface Drop {
  id: string;
  bucket: Bucket;
  name: string;
  tagline: string;
  bodyHtml: string;
  bodyPlain: string;
  sourceUrl: string;
  sourceFetchedAt: string;
  tags: string[];
  confidence: number;
  status: DropStatus;
  vaultPath: string;
  emailMessageId?: string;
  createdAt: string;
  sentAt?: string;
}
