// Mirrors the API's code tables; used when a selected value has no facet row to borrow a label from.
export const SET_ASIDE_LABELS: Record<string, string> = {
  N: 'Unrestricted',
  Y: 'Small Business',
  H: 'HUBZone',
  R: 'SDVOSB',
  L: 'WOSB',
  A: '8(a)',
  E: 'EDWOSB',
};

export const SOL_TYPE_LABELS: Record<string, string> = {
  F: 'Fast Award',
  P: 'Auto-evaluated',
  I: 'Indefinite Delivery (AIDC)',
  M: 'Manual evaluation',
};
