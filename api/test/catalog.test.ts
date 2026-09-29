import { describe, expect, it } from 'vitest';
import { addCatalogItems, listCatalog, normalizeEntry, removeCatalogItem } from '../src/catalog.js';
import { ingestDay, openDb, rebuildSolicitations } from '../src/db.js';
import type { IndexLine } from '../src/dibbs/parse.js';
import { getSolicitation, listQuerySchema, listSolicitations } from '../src/queries.js';

const line = (over: Partial<IndexLine>): IndexLine => ({
  solicitation: 'SPE0000000000',
  nsn: '0000000000000',
  purchaseRequest: '7018000001',
  returnBy: '2099-09-28',
  quantity: 1,
  unit: 'EA',
  nomenclature: 'THING',
  buyerCode: 'ABC12',
  amsc: 'Z',
  itemType: 'nsn',
  setAside: 'N',
  setAsidePct: 0,
  ...over,
});

function seed() {
  const db = openDb(':memory:');
  ingestDay(
    db,
    '2099-09-01',
    [
      line({ solicitation: 'SOLNSN0000001', nsn: '5305012345678', nomenclature: 'SCREW,CAP' }),
      line({ solicitation: 'SOLNIIN000002', nsn: '5306012345678', nomenclature: 'BOLT' }),
      line({ solicitation: 'SOLFSC0000003', nsn: '5962011231234', nomenclature: 'MICROCIRCUIT' }),
      line({ solicitation: 'SOLCAGE000004', nsn: '4820000000001', nomenclature: 'VALVE,GATE' }),
      line({ solicitation: 'SOLPART000005', nsn: '1Q0C4HH660-36060', itemType: 'part', nomenclature: 'NON-NSN' }),
      line({ solicitation: 'SOLKEYW000006', nsn: '5330000000001', nomenclature: 'O-RING' }),
      line({ solicitation: 'SOLNONE000007', nsn: '6515000000001', nomenclature: 'SCALPEL' }),
    ],
    null,
    [{ nsn: '4820000000001', cage: '1AB23', partNumber: 'GV-100', company: '' }],
  );
  rebuildSolicitations(db);
  return db;
}

const ids = (db: ReturnType<typeof seed>, q: Record<string, string> = {}) =>
  listSolicitations(db, listQuerySchema.parse({ status: 'all', ...q }))
    .items.map((i) => i.solicitation)
    .sort();

describe('catalog', () => {
  it('normalizes and validates each kind', () => {
    expect(normalizeEntry('nsn', '5305-01-234-5678')).toEqual({ norm: '5305012345678', value: '5305-01-234-5678' });
    expect(normalizeEntry('nsn', '012345678')).toEqual({ norm: '012345678', value: '012345678' });
    expect(normalizeEntry('nsn', '12345')).toBeNull();
    expect(normalizeEntry('fsc', '5962')).toEqual({ norm: '5962', value: '5962' });
    expect(normalizeEntry('cage', '1ab23')).toEqual({ norm: '1AB23', value: '1AB23' });
    expect(normalizeEntry('part', 'gv-100')).toEqual({ norm: 'gv100', value: 'GV-100' });
    expect(normalizeEntry('keyword', 'O-Ring')).toEqual({ norm: 'o ring', value: 'o ring' });
  });

  it('matches every kind and filters to "mine"', () => {
    const db = seed();
    const res = addCatalogItems(db, {
      mode: 'append',
      items: [
        { kind: 'nsn', value: '5305-01-234-5678' },
        { kind: 'nsn', value: '012345678' }, // NIIN also hits 5306-01-234-5678
        { kind: 'fsc', value: '5962' },
        { kind: 'cage', value: '1ab23' },
        { kind: 'part', value: 'HH660-36060' },
        { kind: 'keyword', value: 'o-ring' },
        { kind: 'nsn', value: 'not-an-nsn' },
        { kind: 'fsc', value: '5962' },
      ],
    });
    expect(res).toMatchObject({ added: 6, duplicates: 1, invalid: [{ kind: 'nsn', value: 'not-an-nsn' }] });

    expect(ids(db, { mine: 'true' })).toEqual([
      'SOLCAGE000004',
      'SOLFSC0000003',
      'SOLKEYW000006',
      'SOLNIIN000002',
      'SOLNSN0000001',
      'SOLPART000005',
    ]);
    expect(getSolicitation(db, 'SOLNSN0000001')!.matches).toEqual([
      { kind: 'nsn', value: '5305-01-234-5678' },
      { kind: 'nsn', value: '012345678' },
    ]);
    expect(listSolicitations(db, listQuerySchema.parse({ status: 'all' })).facets.mine).toEqual({
      count: 6,
      catalogSize: 6,
    });
    expect(listCatalog(db, '2000-01-01').totals).toMatchObject({ items: 6, openMatches: 6 });
  });

  it('updates matches when items are removed or replaced', () => {
    const db = seed();
    addCatalogItems(db, {
      mode: 'append',
      items: [
        { kind: 'fsc', value: '5962' },
        { kind: 'keyword', value: 'scalpel' },
      ],
    });
    removeCatalogItem(db, 'fsc', '5962');
    expect(ids(db, { mine: 'true' })).toEqual(['SOLNONE000007']);
    addCatalogItems(db, { mode: 'replace', items: [{ kind: 'cage', value: '1AB23' }] });
    expect(ids(db, { mine: 'true' })).toEqual(['SOLCAGE000004']);
  });
});
