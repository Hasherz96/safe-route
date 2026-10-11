/**
 * One-line JSON logs for outbound news/API requests. Cloud Run (Cloud Logging)
 * turns each line into a structured entry with a filterable `severity`, e.g.
 *   jsonPayload.event="news_fetch" AND jsonPayload.source="google_news"
 */

export type FetchOutcome = {
  source: string;
  ok: boolean;
  ms: number;
  status?: number;
  items?: number;
  error?: string;
  [detail: string]: unknown;
};

export function logFetch(outcome: FetchOutcome): void {
  console.log(
    JSON.stringify({
      severity: outcome.ok ? 'INFO' : 'WARNING',
      event: 'news_fetch',
      ...outcome,
    })
  );
}

/** Short description of a fetch failure: timeout, network error code, or message. */
export function describeFetchError(err: unknown): string {
  const e = err as { name?: string; message?: string; cause?: { code?: string } };
  if (e?.name === 'AbortError') return 'timeout';
  return e?.cause?.code || e?.name || String(e?.message || err).slice(0, 120);
}
