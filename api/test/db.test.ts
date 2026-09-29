import { describe, expect, it } from 'vitest';
import { ingestDay, openDb, rebuildSolicitations } from '../src/db.js';
import type { IndexLine } from '../src/dibbs/parse.js';
import { getSolicitation, listQuerySchema, listSolicitations } from '../src/queries.js';

const line = (over: Partial<IndexLine> = {}): IndexLine => ({
  solicitation: 'SPE2DH26T6921',
  nsn: '6520017389973',
  purchaseRequest: '7018000001',
  returnBy: '2099-09-28',
  quantity: 10,
  unit: 'EA',
  nomenclature: 'BUR,DENTAL',
  buyerCode: 'ABC12',
  amsc: 'Z',
  itemType: 'nsn',
  setAside: 'N',
  setAsidePct: 0,
  ...over,
});

const query = (q: Record<string, string> = {}) => listQuerySchema.parse(q);

describe('ingest + read model', () => {
  it('collapses lines into one solicitation with totals', () => {
    const db = openDb(':memory:');
    ingestDay(
      db,
      '2099-09-01',
      [line(), line({ purchaseRequest: '7018000002', quantity: 5 })],
      [{ solicitation: 'SPE2DH26T6921', solType: 'F', lineNo: '0001', purchaseRequest: '7018000001' }],
      [{ nsn: '6520017389973', cage: '1AB23', partNumber: 'XY-1', company: '' }],
    );
    rebuildSolicitations(db);

    const { items, total } = listSolicitations(db, query());
    expect(total).toBe(1);
    expect(items[0]).toMatchObject({ totalQty: 15, lineCount: 2, solType: 'F', sourceCount: 1, fsc: '6520' });
    expect(items[0]!.fscName).toMatch(/Dental/);
  });

  it('tracks amendments: later files win and remember the previous return date', () => {
    const db = openDb(':memory:');
    ingestDay(db, '2099-09-01', [line()], null, null);
    ingestDay(db, '2099-09-05', [line({ returnBy: '2099-10-01' })], null, null);
    // An older file applied late must not overwrite newer data.
    ingestDay(db, '2099-08-30', [line({ returnBy: '2099-09-15' })], null, null);
    rebuildSolicitations(db);

    const s = getSolicitation(db, 'SPE2DH26T6921')!;
    expect(s).toMatchObject({
      returnBy: '2099-10-01',
      prevReturnBy: '2099-09-28',
      postedDate: '2099-09-05',
      firstPosted: '2099-08-30',
    });
  });

  it('searches identifiers ignoring punctuation and filters by CAGE', () => {
    const db = openDb(':memory:');
    ingestDay(db, '2099-09-01', [line()], null, [
      { nsn: '6520017389973', cage: '1AB23', partNumber: 'XY-1', company: '' },
    ]);
    ingestDay(
      db,
      '2099-09-01',
      [line({ solicitation: 'SPE4A626T0001', nsn: '5305000000001', nomenclature: 'SCREW' })],
      null,
      null,
    );
    rebuildSolicitations(db);

    const find = (q: Record<string, string>) => listSolicitations(db, query(q)).items.map((i) => i.solicitation);
    expect(find({ q: 'SPE2DH-26-T-6921' })).toEqual(['SPE2DH26T6921']);
    expect(find({ q: '6520-01-738-9973' })).toEqual(['SPE2DH26T6921']);
    expect(find({ q: 'dental bur' })).toEqual(['SPE2DH26T6921']);
    expect(find({ q: 'xy1' })).toEqual(['SPE2DH26T6921']);
    expect(find({ cage: '1ab23' })).toEqual(['SPE2DH26T6921']);
    expect(find({ sources: 'without' })).toEqual(['SPE4A626T0001']);
  });

  it('supports lists and wildcards the way vendors search DIBBS', () => {
    const db = openDb(':memory:');
    ingestDay(
      db,
      '2099-09-01',
      [
        line(),
        line({ solicitation: 'SPE4A626T0001', nsn: '5305000000001', nomenclature: 'SCREW,CAP' }),
        line({ solicitation: 'SPE7L126T0002', nsn: '5962011231234', nomenclature: 'MICROCIRCUIT,DIGITAL' }),
      ],
      null,
      null,
    );
    rebuildSolicitations(db);
    const find = (q: string) =>
      listSolicitations(db, query({ q }))
        .items.map((i) => i.solicitation)
        .sort();

    // Space-separated identifiers are a list, not an AND.
    expect(find('6520017389973 5305-00-000-0001')).toEqual(['SPE2DH26T6921', 'SPE4A626T0001']);
    // Commas / newlines separate alternatives; words inside one alternative must all match.
    expect(find('screw cap, microcircuit')).toEqual(['SPE4A626T0001', 'SPE7L126T0002']);
    expect(find('screw\nbur')).toEqual(['SPE2DH26T6921', 'SPE4A626T0001']);
    expect(find('screw bur')).toEqual([]);
    // Trailing * is a prefix on identifiers: an FSC.
    expect(find('5962*')).toEqual(['SPE7L126T0002']);
    expect(find('5962*, 5305*')).toEqual(['SPE4A626T0001', 'SPE7L126T0002']);
  });

  it('counts other RFQs for the same NSN', () => {
    const db = openDb(':memory:');
    ingestDay(
      db,
      '2099-09-01',
      [line(), line({ solicitation: 'SPE2DH26T9999', purchaseRequest: '7018000009' })],
      null,
      null,
    );
    rebuildSolicitations(db);
    expect(getSolicitation(db, 'SPE2DH26T6921')!.otherNsnRfqs).toBe(1);
  });
});
