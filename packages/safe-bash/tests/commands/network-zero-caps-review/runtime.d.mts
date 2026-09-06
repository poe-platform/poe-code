export interface ReviewReceipt {
  name: string;
  pass?: boolean;
  skipped?: string;
  error?: string;
}
export interface ReviewResult {
  counts: { passed: number; failed: number; skipped: number };
  receipts: ReviewReceipt[];
}
export function runSuite(root: unknown, network: unknown, options?: {
  expectedDefaults?: Readonly<Record<string, number>>;
  baseline?: boolean;
  validators?: boolean;
  select?: (spec: { name: string }) => boolean;
}): Promise<ReviewResult>;
