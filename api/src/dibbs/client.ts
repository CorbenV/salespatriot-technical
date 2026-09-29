import https from 'node:https';

/**
 * Minimal HTTP client for DIBBS.
 *
 * Why not fetch()? DIBBS sits behind an F5 WAF that rejects undici/fetch requests
 * ("Request Rejected") regardless of User-Agent, while plain node:https passes.
 *
 * Every DIBBS host (www.dibbs.bsm.dla.mil, dibbs2.bsm.dla.mil) has its own
 * "DoD Warning and Consent" gate: an ASP.NET WebForm that must be posted back
 * with butAgree=OK before content is served. Cookies are kept per host and the
 * gate is passed transparently whenever a consent page comes back.
 */

const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const TIMEOUT_MS = 60_000;
const MAX_REDIRECTS = 5;

export interface RawResponse {
  url: string;
  status: number;
  contentType: string;
  body: Buffer;
}

export class DibbsUnavailableError extends Error {}

export class DibbsClient {
  private jars = new Map<string, Map<string, string>>();

  /** GET a URL, following redirects and passing the consent gate if needed. */
  async get(url: string): Promise<RawResponse> {
    let res = await this.follow(url);
    if (isConsentPage(res)) {
      await this.acceptConsent(res);
      res = await this.follow(url);
      if (isConsentPage(res)) throw new Error(`DIBBS consent gate not accepted for ${url}`);
    }
    if (isRejected(res)) throw new Error(`DIBBS WAF rejected request for ${url}`);
    return res;
  }

  async getText(url: string): Promise<string> {
    const res = await this.get(url);
    if (res.status !== 200) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.body.toString('latin1');
  }

  /**
   * Download a data file. Missing / not-yet-published files come back as a
   * 302 to an HTML error page (never a 404), so anything HTML is "unavailable".
   */
  async getFile(url: string): Promise<Buffer> {
    const res = await this.get(url);
    if (res.status !== 200 || res.contentType.includes('text/html')) {
      throw new DibbsUnavailableError(`File not available: ${url}`);
    }
    return res.body;
  }

  private async follow(url: string): Promise<RawResponse> {
    let current = url;
    for (let i = 0; i <= MAX_REDIRECTS; i++) {
      const res = await this.request(current);
      if (res.status >= 300 && res.status < 400 && res.location) {
        current = new URL(res.location, current).href;
        continue;
      }
      return res;
    }
    throw new Error(`Too many redirects for ${url}`);
  }

  private async acceptConsent(page: RawResponse): Promise<void> {
    const html = page.body.toString('latin1');
    const action = html.match(/<form[^>]*action="([^"]+)"/i)?.[1];
    if (!action) throw new Error('Consent form not found');
    const form = new URLSearchParams();
    for (const m of html.matchAll(/<input type="hidden" name="([^"]+)"[^>]*value="([^"]*)"/g)) {
      form.append(decodeEntities(m[1]!), decodeEntities(m[2]!));
    }
    form.append('butAgree', 'OK');
    const target = new URL(decodeEntities(action), page.url).href;
    // Response is a redirect back to the original page; the cookies are what matter.
    await this.request(target, 'POST', form.toString());
  }

  private request(
    url: string,
    method: 'GET' | 'POST' = 'GET',
    body?: string,
  ): Promise<RawResponse & { location?: string }> {
    const u = new URL(url);
    const jar = this.jarFor(u.hostname);
    const headers: Record<string, string | number> = {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,*/*',
    };
    if (jar.size) headers.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    if (body !== undefined) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      headers['Content-Length'] = Buffer.byteLength(body);
      headers.Referer = url;
    }
    return new Promise((resolve, reject) => {
      const req = https.request(u, { method, headers, timeout: TIMEOUT_MS }, (res) => {
        for (const cookie of res.headers['set-cookie'] ?? []) {
          const pair = cookie.split(';')[0] ?? '';
          const eq = pair.indexOf('=');
          if (eq <= 0) continue;
          const name = pair.slice(0, eq).trim();
          const value = pair.slice(eq + 1).trim();
          if (value) jar.set(name, value);
          else jar.delete(name);
        }
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve({
            url,
            status: res.statusCode ?? 0,
            contentType: String(res.headers['content-type'] ?? ''),
            location: res.headers.location,
            body: Buffer.concat(chunks),
          }),
        );
        res.on('error', reject);
      });
      req.on('timeout', () => req.destroy(new Error(`Timeout after ${TIMEOUT_MS}ms: ${url}`)));
      req.on('error', reject);
      if (body !== undefined) req.write(body);
      req.end();
    });
  }

  private jarFor(host: string): Map<string, string> {
    let jar = this.jars.get(host);
    if (!jar) this.jars.set(host, (jar = new Map()));
    return jar;
  }
}

export function isConsentPage(res: Pick<RawResponse, 'contentType' | 'body'>): boolean {
  if (!res.contentType.includes('text/html')) return false;
  const head = res.body.subarray(0, 20_000).toString('latin1');
  return head.includes('butAgree') && /Warning and Consent/i.test(head);
}

function isRejected(res: RawResponse): boolean {
  return (
    res.contentType.includes('text/html') &&
    res.body.length < 2000 &&
    res.body.toString('latin1').includes('Request Rejected')
  );
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}
