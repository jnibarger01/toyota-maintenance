/**
 * Minimal Airtable REST client — backend/CLI only, never imported by server/ or web/.
 *
 * - Pagination via \`offset\` until exhausted.
 * - 429: bounded retry honoring Retry-After when present, else exponential backoff.
 * - Transient 5xx: same bounded retry.
 * - The token is redacted from EVERY thrown or surfaced error string.
 */

export interface AirtableRecord {
  id: string;
  createdTime?: string;
  fields: Record<string, unknown>;
}

type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<Response>;

export interface AirtableClientOptions {
  token: string;
  baseId: string;
  fetchImpl?: FetchLike;
  sleepImpl?: (ms: number) => Promise<void>;
  maxRetries?: number;      // retries per request for 429/5xx
  pageSize?: number;
}

export class AirtableHttpError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

const API = "https://api.airtable.com/v0";

export class AirtableClient {
  private readonly token: string;
  private readonly baseId: string;
  private readonly fetchImpl: FetchLike;
  private readonly sleepImpl: (ms: number) => Promise<void>;
  private readonly maxRetries: number;
  private readonly pageSize: number;

  constructor(opts: AirtableClientOptions) {
    this.token = opts.token;
    this.baseId = opts.baseId;
    this.fetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init));
    this.sleepImpl = opts.sleepImpl ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.maxRetries = opts.maxRetries ?? 5;
    this.pageSize = opts.pageSize ?? 100;
  }

  /** Strip the secret from any string that might be thrown, logged, or printed. */
  redact(text: string): string {
    if (!this.token) return text;
    return text.split(this.token).join("***REDACTED***");
  }

  private async requestPage(table: string, offset?: string): Promise<{ records: AirtableRecord[]; offset?: string }> {
    const q = new URLSearchParams({ pageSize: String(this.pageSize) });
    if (offset) q.set("offset", offset);
    const url = `${API}/${this.baseId}/${encodeURIComponent(table)}?${q.toString()}`;

    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await this.fetchImpl(url, { headers: { Authorization: `Bearer ${this.token}` } });
      } catch (e) {
        // Network-level failure: redact and rethrow (no retry loop for hard failures
        // beyond the bounded attempts below).
        const msg = e instanceof Error ? e.message : String(e);
        if (attempt < this.maxRetries) { await this.backoff(attempt, null); continue; }
        throw new AirtableHttpError(this.redact(`Airtable request failed: ${msg}`), 0);
      }

      if (res.ok) {
        const body = (await res.json()) as { records?: AirtableRecord[]; offset?: string };
        return { records: body.records ?? [], offset: body.offset };
      }

      const retryable = res.status === 429 || res.status >= 500;
      if (retryable && attempt < this.maxRetries) {
        await this.backoff(attempt, res.headers.get("Retry-After"));
        continue;
      }

      const bodyText = this.redact(await res.text().catch(() => ""));
      throw new AirtableHttpError(
        this.redact(`Airtable ${res.status} for table "${table}": ${bodyText.slice(0, 300)}`),
        res.status,
      );
    }
  }

  private async backoff(attempt: number, retryAfter: string | null): Promise<void> {
    const headerMs = retryAfter !== null && Number.isFinite(Number(retryAfter))
      ? Math.max(0, Number(retryAfter) * 1000)
      : null;
    const ms = headerMs ?? Math.min(8000, 500 * 2 ** attempt);
    await this.sleepImpl(ms);
  }

  /** Pull every record from a table, paginating with offset until exhausted. */
  async listAll(table: string): Promise<AirtableRecord[]> {
    const out: AirtableRecord[] = [];
    let offset: string | undefined;
    do {
      const page = await this.requestPage(table, offset);
      out.push(...page.records);
      offset = page.offset;
    } while (offset);
    return out;
  }
}
