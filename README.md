# RFQ Desk

A fast browser for DLA **DIBBS** Requests for Quotation. It pulls the daily RFQ files from DIBBS, turns them into one row per solicitation, and lets a vendor search, filter and sort down to the ones worth quoting. Every row links back to its original DIBBS record.

```bash
docker compose up --build
# open http://localhost:8080 (first start loads ~30 days of files in about 20s)
```

Stack: React 19 + TypeScript + Tailwind v4 (Vite, TanStack Query) · Node 24 + TypeScript (Fastify, better-sqlite3, zod) · nginx · Docker Compose.

## How the data is pulled

**Bulk files, not page scraping.** DIBBS's RFQ pages show 50 rows per page. Paging uses ASP.NET postbacks and takes about 8s per page, so one day of RFQs (~2,000) takes about 5 minutes and is fragile. DIBBS also publishes the same data as daily files:

| File | Contents | Used for |
|---|---|---|
| `inYYMMDD.txt` | Fixed-width index, one line per solicitation line: sol #, NSN/part #, PR, return-by, qty, unit, nomenclature, buyer, AMSC, item type, set-aside | The main data |
| `bqYYMMDD.zip` → `bq*.txt` | Batch-quote CSV (121 columns) | Solicitation type (Fast Award / auto-evaluated / AIDC), line numbers |
| `bqYYMMDD.zip` → `as*.txt` | Approved sources: NSN, CAGE, part number | Approved-source filter and search |
| `caYYMMDD.zip` | Every solicitation PDF (500 MB+) | **Never downloaded.** Rows link to the individual PDF instead |

About 25 days of files download in ~3s. On startup the API loads every file it hasn't seen yet, then checks hourly (or when you click "Check for new files").

### Pitfalls found while probing DIBBS

1. **A DoD consent gate on each host.** Both `www.dibbs.bsm.dla.mil` and `dibbs2.bsm.dla.mil` (the file host) show a "Warning and Consent" WebForm, and each needs its own consent. Without it, requests get a 200 HTML page instead of an error. The client (`api/src/dibbs/client.ts`) keeps cookies per host, recognizes the consent page and submits it automatically.
2. **The firewall blocks Node's `fetch`.** The F5 firewall answers undici/`fetch` with "Request Rejected", even with a browser User-Agent. Python `requests` is blocked too. Plain `node:https` gets through, so the client uses that.
3. **Missing files return 302 → HTML, not 404.** This covers today's file (published a day late), weekends, and anything older than ~30 days. The file list comes from the "Recent RFQs" page, and any HTML response to a file request counts as "not available".
4. **A file's date is its post date, not the issue date.** Most RFQs in `inYYMMDD` are issued the next business day, and the files have no issue-date column. The UI says **First posted** rather than guessing an issue date.
5. **Amendments re-post solicitations.** About 10% of lines reappear in a later file, almost always with an extended return-by date. Lines are upserted by (solicitation, PR) with the newest file winning. The previous date is kept, so the UI can show "Extended".
6. **~72% of a month's RFQs are already closed,** so the default view is *Open*.
7. **Coverage is ~97%.** Comparing the website's 09-28 issue list against the files found 63 of 1,947 lines (3%) missing from the files. They were probably posted after the day's file closed. Scraping the web listing could fill that gap (see "Next steps").
8. **Data quirks.** Nomenclature is cut at 21 characters. Part-number items (item type 2) put a CAGE plus part number in the NSN field, so they get no FSC. Approved-source company names are almost always blank.

## Data model: one row per solicitation

The files are line-level, but 95% of solicitations have a single line. Of the multi-line ones, 2,076 of 2,077 are **the same NSN split across purchase requests** (one has 126 lines of safety glasses). Showing lines would fill pages with duplicates, so:

- `lines` is the source of truth (one row per solicitation + PR).
- `solicitations` is rebuilt after each ingest: total quantity, line count, approved-source CAGEs, and flattened search columns. Every query runs against this one indexed table, and responses take ~10–30ms.
- The detail panel shows the individual lines and approved sources.

## My catalog: only the RFQs relevant to you

Vendors don't want to browse 14,000 open RFQs; they want the ones for things they sell or make. **My catalog** lets a vendor enter or import that list once, then flip the whole app to *only matching RFQs*. Each match says why it matched.

| Entry | Matches |
|---|---|
| NSN (or 9-digit NIIN) | That exact item. A NIIN matches it under any FSC. |
| Part number | Approved-source part numbers for the item, and part-number buys that have no NSN. |
| FSC | Everything in the product class. |
| CAGE | RFQs where that company is a listed approved source: your own CAGE, or the manufacturers you distribute. |
| Keyword | Words in the item name (e.g. `o-ring`), ignoring punctuation. |

- **Import:** paste a list, or upload a CSV/TSV/TXT file. Columns named like *NSN / Stock Number*, *Part Number / Mfr P/N / SKU*, *FSC*, *CAGE* or *Keyword* are picked up automatically. Other columns (descriptions, prices) are ignored, so an ERP export works as-is. The preview shows what will be added and what's invalid before anything is saved. Exports re-import cleanly.
- **Using it:** "Show: All RFQs / My catalog" sits at the top of the filters, with a live count. Matching rows get a green "Your NSN" / "Your FSC 5305" tag everywhere, and the detail panel lists every reason. Each catalog entry shows how many open RFQs it matches, and clicking the count jumps to them.
- **How it works:** matches are precomputed into `catalog_matches` whenever the catalog changes and after every ingest. Values are normalized into indexed temp tables, so a 4,000-entry catalog rebuilds in ~0.3s against 45k solicitations, and the "My catalog" filter is an indexed lookup (~20–90ms).
- **Limitation:** there are no user accounts yet, so there's one catalog per deployment.

## Filters, and why

A bid specialist's triage questions, in order:

| Filter | Why |
|---|---|
| **Status**: Open (default), Closing ≤ 3 days, Past due, All | The deadline decides whether an RFQ is worth reading at all. "Past due" rather than "closed": DIBBS can keep auto-evaluated RFQs open past the return-by date. |
| **First posted**: Latest drop / 3 / 7 days | "What's new since yesterday?" Uses *first* posted, so re-posted amendments aren't counted as new. |
| **Set-aside** (SB, WOSB, SDVOSB, HUBZone, 8(a), EDWOSB) | Eligibility: vendors can only bid on set-asides they qualify for. |
| **Solicitation type**: Fast Award, auto-evaluated, AIDC, manual | Fast Award RFQs can be awarded before the return date. AIDC is a long-term contract. |
| **Product class (FSC)**, searchable with names | Vendors specialize by product class. This is the main way to narrow the list. |
| **Total quantity** | Filters by capacity, and screens out one-off parts. |
| **Approved-source CAGE**, and listed / none | Enter your CAGE to see RFQs where you're a named approved source. "None" shows RFQs with no approved sources listed. |
| **Deadline changes** | Re-posted RFQs whose return-by moved, i.e. a second chance to quote. |

Every filter option shows how many results it would give, computed with all the *other* active filters applied.

**Search** covers nomenclature, FSC names, solicitation #, NSN, PR #, approved-source CAGEs and part numbers. It uses the syntax vendors already use on DIBBS:

- **Lists.** Commas, semicolons or newlines separate alternatives (any may match), and a space-separated run of identifiers is also a list. Paste the NSNs you stock, one per line, and see every RFQ for any of them. Words inside one alternative must all match (`safety glasses, helmet`).
- **Wildcards.** `*` anchors to the start of an identifier, so `5962*` finds a whole product class and `5962*, 5305*` finds two.
- **Punctuation is ignored in identifiers,** so `8315-00-075-0244`, `8315000750244`, `SPE1C1-26-Q-0309` and `spe1c126q0309` all work.

## UX notes

- All state lives in the URL (filters, sort, page, open solicitation), so any view can be bookmarked or shared.
- Keyboard: `/` to search, `j`/`k` or arrows to move, `Enter` to open, `Esc` to close.
- Deadlines are color-coded (today/tomorrow red, ≤3 days ochre) and always spelled out in words, so color isn't the only signal.
- The detail panel's main action is **Quote on DIBBS**, which opens DIBBS's own quote form (`RA/Quote/QuoteFrm.aspx?sn=…`). The vendor logs in and submits there; this app never quotes on anyone's behalf. It also links to the **Package View** and the solicitation **PDF** (`dibbs2…/Downloads/RFQ/{last char}/{SOL}.PDF`). DIBBS shows its consent notice once, then goes to the requested page.
- **Quote early.** Fast Award and auto-evaluated RFQs (~85% of open ones) can be awarded before the return-by date, and the detail panel says so.
- **Pivots.** Click the NSN (or "DLA has N other RFQs for this item") to see every RFQ for that item. Click the FSC for the whole product class, or a CAGE to see every RFQ where it's an approved source.
- Sortable headers cycle through the column's natural direction, then the opposite, then back to the default (newest first).
- On narrow screens, table columns drop out based on the table's own width (container queries), filters move into a sheet, and the detail panel docks beside the table on very wide screens.

## Development

```bash
cd api && npm i && npm run dev     # :3001, stores data in api/data/
cd web && npm i && npm run dev     # :5173, proxies /api to :3001
cd api && npm test                 # parser, consent detection, upsert/amendment and search tests
```

## Next steps

- Fill the ~3% gap and the one-day lag by scraping the current day's web listing (`RfqRecs.aspx?category=issue`) in the background.
- Accounts, so each vendor has their own catalog, plus a daily email digest of new catalog matches.
- Buying-office names from the solicitation prefix (e.g. SPE4A → DLA Aviation).
- Pull award history per NSN (DIBBS Awards) to show last price paid.
