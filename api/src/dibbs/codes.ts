export const SET_ASIDES: Record<string, string> = {
  N: 'Unrestricted',
  Y: 'Small Business',
  H: 'HUBZone',
  R: 'SDVOSB',
  L: 'WOSB',
  A: '8(a)',
  E: 'EDWOSB',
};

// Solicitation Type Indicator from the batch quote file. Blank = not auto-evaluated.
export const SOL_TYPES: Record<string, string> = {
  F: 'Fast Award',
  P: 'Auto-evaluated',
  I: 'Indefinite Delivery (AIDC)',
  '': 'Manual evaluation',
};

export const DIBBS = {
  www: 'https://www.dibbs.bsm.dla.mil',
  files: 'https://dibbs2.bsm.dla.mil',
  recentFilesPage: 'https://www.dibbs.bsm.dla.mil/Rfq/RfqDates.aspx?category=recent',
  indexFile: (d: string) => `https://dibbs2.bsm.dla.mil/Downloads/RFQ/Archive/in${d}.txt`,
  batchQuoteZip: (d: string) => `https://dibbs2.bsm.dla.mil/Downloads/RFQ/Archive/bq${d}.zip`,
  packageView: (sol: string) => `https://www.dibbs.bsm.dla.mil/rfq/rfqrec.aspx?sn=${sol}`,
  // DIBBS's own quote form; requires the vendor to log in with their CAGE account.
  quote: (sol: string) => `https://www.dibbs.bsm.dla.mil/RA/Quote/QuoteFrm.aspx?sn=${sol}`,
  // PDFs are bucketed into folders by the last character of the solicitation number.
  pdf: (sol: string) => `https://dibbs2.bsm.dla.mil/Downloads/RFQ/${sol.slice(-1)}/${sol}.PDF`,
  nsnView: (nsn: string) => `https://www.dibbs.bsm.dla.mil/RFQ/RFQNsn.aspx?value=${nsn}&category=issue`,
};
