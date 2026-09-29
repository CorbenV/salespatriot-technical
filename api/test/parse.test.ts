import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isConsentPage } from '../src/dibbs/client.js';
import {
  formatNsn,
  formatSolicitation,
  fscOf,
  parseApprovedSourcesFile,
  parseBatchQuoteFile,
  parseCsv,
  parseIndexFile,
} from '../src/dibbs/parse.js';

const fixture = (name: string) => fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'latin1');

describe('parseIndexFile', () => {
  const lines = parseIndexFile(fixture('in-sample.txt'));

  it('parses every fixed-width record', () => {
    expect(lines).toHaveLength(41);
  });

  it('extracts fields at the documented offsets', () => {
    expect(lines[0]).toEqual({
      solicitation: 'SPE1C126T1746',
      nsn: '8465016975689',
      purchaseRequest: '7018333578',
      returnBy: '2026-10-01',
      quantity: 50,
      unit: 'EA',
      nomenclature: 'BELT,MILITARY POLIC',
      buyerCode: 'DKV00',
      amsc: 'D',
      itemType: 'nsn',
      setAside: 'N',
      setAsidePct: 0,
    });
  });

  it('reads set-aside percentage and part-number items', () => {
    expect(lines[1]).toMatchObject({ setAside: 'Y', setAsidePct: 100 });
    const part = lines.find((l) => l.nsn === '7310GM5022323');
    expect(part?.itemType).toBe('part');
  });
});

describe('batch quote + approved source files', () => {
  it('maps the documented batch quote columns', () => {
    const [first] = parseBatchQuoteFile(fixture('bq-sample.txt'));
    expect(first).toEqual({
      solicitation: 'SPE1C126T1746',
      solType: 'F',
      lineNo: '0001',
      purchaseRequest: '7018333578',
    });
  });

  it('parses approved sources', () => {
    const [first] = parseApprovedSourcesFile(fixture('as-sample.txt'));
    expect(first).toEqual({ nsn: '1005002150036', cage: '05606', partNumber: '175F132-2', company: '' });
  });

  it('handles quoted commas, escaped quotes and CRLF', () => {
    expect(parseCsv('"a,b","say ""hi""",""\r\n"x","y","z"\r\n')).toEqual([
      ['a,b', 'say "hi"', ''],
      ['x', 'y', 'z'],
    ]);
  });
});

describe('formatting', () => {
  it('formats solicitation numbers and NSNs like DIBBS does', () => {
    expect(formatSolicitation('SPE1C126Q0309')).toBe('SPE1C1-26-Q-0309');
    expect(formatSolicitation('SPE7M126T389M')).toBe('SPE7M1-26-T-389M');
    expect(formatNsn('8315000750244')).toBe('8315-00-075-0244');
    expect(formatNsn('1Q0C4HH660-36060')).toBe('1Q0C4HH660-36060');
  });

  it('derives FSC only for real NSNs', () => {
    expect(fscOf('8315000750244', 'nsn')).toBe('8315');
    expect(fscOf('1Q0C4HH660-36060', 'part')).toBeNull();
  });
});

describe('isConsentPage', () => {
  it('recognises the DoD warning page', () => {
    const body = Buffer.from(fixture('consent-dibbs2.html'), 'latin1');
    expect(isConsentPage({ contentType: 'text/html; charset=utf-8', body })).toBe(true);
  });

  it('ignores data files', () => {
    const body = Buffer.from(fixture('in-sample.txt'), 'latin1');
    expect(isConsentPage({ contentType: 'text/plain', body })).toBe(false);
  });
});
