import { EreLedger } from './artifact/limits.js';
import type { EreResult } from './artifact/types.js';
const ledger = new EreLedger({ maxExpansionBytes: 1, maxExpansionFields: 1 });
ledger.charge('maxOutputBytes', 1);
const result: EreResult = { matched: true, captures: [], values: [] };
result.values.push('unowned');
new EreLedger({ maxExpansionBytes: '1', maxExpansionFields: 1 });
