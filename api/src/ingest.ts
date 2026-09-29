import AdmZip from 'adm-zip';
import type { FastifyBaseLogger } from 'fastify';
import { ingestDay, ingestedPostDates, rebuildSolicitations, type DB } from './db.js';
import { DIBBS } from './dibbs/codes.js';
import { DibbsClient, DibbsUnavailableError } from './dibbs/client.js';
import {
  parseApprovedSourcesFile,
  parseBatchQuoteFile,
  parseIndexFile,
  type ApprovedSource,
  type BatchQuoteLine,
} from './dibbs/parse.js';

export interface IngestStatus {
  running: boolean;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastAdded: number;
}

const DOWNLOAD_CONCURRENCY = 3;

export class Ingester {
  readonly status: IngestStatus = {
    running: false,
    lastRunAt: null,
    lastSuccessAt: null,
    lastError: null,
    lastAdded: 0,
  };
  private client = new DibbsClient();

  constructor(
    private db: DB,
    private log: FastifyBaseLogger,
  ) {}

  /** Runs an ingest unless one is already in flight. Never throws. */
  async run(): Promise<void> {
    if (this.status.running) return;
    this.status.running = true;
    this.status.lastRunAt = new Date().toISOString();
    try {
      const added = await this.ingestNewFiles();
      this.status.lastAdded = added;
      this.status.lastSuccessAt = new Date().toISOString();
      this.status.lastError = null;
    } catch (err) {
      this.status.lastError = err instanceof Error ? err.message : String(err);
      this.log.error({ err }, 'ingest failed');
    } finally {
      this.status.running = false;
    }
  }

  private async ingestNewFiles(): Promise<number> {
    const available = await this.listPostDates();
    const done = ingestedPostDates(this.db);
    const todo = available.filter((d) => !done.has(toIso(d))).sort();
    this.log.info({ available: available.length, todo: todo.length }, 'ingest: files to fetch');
    if (todo.length === 0) return 0;

    const downloaded = await mapLimit(todo, DOWNLOAD_CONCURRENCY, (d) => this.download(d));
    let added = 0;
    // Apply oldest first so later amendments win.
    for (const day of downloaded) {
      if (!day) continue;
      ingestDay(this.db, toIso(day.yymmdd), day.lines, day.bq, day.sources);
      added++;
      this.log.info({ file: day.yymmdd, lines: day.lines.length, bq: !!day.bq }, 'ingest: day loaded');
    }
    const total = rebuildSolicitations(this.db);
    this.log.info({ added, solicitations: total }, 'ingest: read model rebuilt');
    return added;
  }

  /** Post dates (yymmdd) listed on the "Recent RFQs" page, with a blind fallback. */
  private async listPostDates(): Promise<string[]> {
    try {
      const html = await this.client.getText(DIBBS.recentFilesPage);
      const dates = [...new Set([...html.matchAll(/\bin(\d{6})\.txt/g)].map((m) => m[1]!))];
      if (dates.length > 0) return dates;
      this.log.warn('ingest: no files listed on recent page, falling back to date probing');
    } catch (err) {
      this.log.warn({ err }, 'ingest: recent page failed, falling back to date probing');
    }
    const out: string[] = [];
    for (let i = 1; i <= 30; i++) {
      const d = new Date(Date.now() - i * 86_400_000);
      out.push(d.toISOString().slice(2, 10).replace(/-/g, ''));
    }
    return out;
  }

  private async download(yymmdd: string) {
    let lines;
    try {
      lines = parseIndexFile((await this.client.getFile(DIBBS.indexFile(yymmdd))).toString('latin1'));
    } catch (err) {
      if (err instanceof DibbsUnavailableError) return null;
      throw err;
    }
    // The batch-quote zip only enriches the index; losing it is not fatal.
    let bq: BatchQuoteLine[] | null = null;
    let sources: ApprovedSource[] | null = null;
    try {
      const zip = new AdmZip(await this.client.getFile(DIBBS.batchQuoteZip(yymmdd)));
      for (const entry of zip.getEntries()) {
        const text = entry.getData().toString('latin1');
        if (entry.entryName.startsWith('bq')) bq = parseBatchQuoteFile(text);
        else if (entry.entryName.startsWith('as')) sources = parseApprovedSourcesFile(text);
      }
    } catch (err) {
      this.log.warn({ err, file: yymmdd }, 'ingest: batch quote zip unavailable');
    }
    return { yymmdd, lines, bq, sources };
  }
}

function toIso(yymmdd: string): string {
  return `20${yymmdd.slice(0, 2)}-${yymmdd.slice(2, 4)}-${yymmdd.slice(4, 6)}`;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return results;
}
