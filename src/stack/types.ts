export type Bucket = 'tool' | 'concept' | 'lore' | 'foundation';
export type DropStatus =
  | 'queued'
  | 'pending_review'
  | 'sent'
  | 'rejected'
  | 'archived';
export type FoundationStatus =
  | 'pending'
  | 'enriched'
  | 'sent'
  | 'done'
  | 'retry'
  | 'archived';
export type HealthState = 'healthy' | 'degraded' | 'recovered' | 'down';
export type ScrapeOutcome =
  | 'graded_keep'
  | 'graded_drop'
  | 'duplicate'
  | 'enriched'
  | 'enrich_rejected'
  | 'unparsed_reply'
  | 'vault_write_failed';

const BUCKETS: Bucket[] = ['tool', 'concept', 'lore', 'foundation'];
const DROP_STATUSES: DropStatus[] = [
  'queued',
  'pending_review',
  'sent',
  'rejected',
  'archived',
];
const FOUNDATION_STATUSES: FoundationStatus[] = [
  'pending',
  'enriched',
  'sent',
  'done',
  'retry',
  'archived',
];

export function isBucket(s: string): s is Bucket {
  return (BUCKETS as string[]).includes(s);
}
export function isDropStatus(s: string): s is DropStatus {
  return (DROP_STATUSES as string[]).includes(s);
}
export function isFoundationStatus(s: string): s is FoundationStatus {
  return (FOUNDATION_STATUSES as string[]).includes(s);
}

export interface RawItem {
  source: string;
  title: string;
  url: string;
  blurb?: string;
  fetchedAt: string;
}

export interface Graded {
  raw: RawItem;
  keep: boolean;
  bucket?: Bucket;
  confidence: number;
  reasoning: string;
}

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
  rating?: number;
  ratedAt?: string;
}

export interface FoundationItem {
  id: string;
  name: string;
  category: string;
  sourceUrl: string;
  status: FoundationStatus;
  retries: number;
}

export interface Rating {
  dropId: string;
  rating: number;
  feedback?: string;
  ratedAt: string;
}
