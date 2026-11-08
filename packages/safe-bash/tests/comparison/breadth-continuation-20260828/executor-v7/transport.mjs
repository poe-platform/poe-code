import { encode } from './records.mjs';
import fs from 'node:fs';
import { requireThat } from '../executor-v4/safety.mjs';

const write = fs.writeSync.bind(fs);
export function transport(descriptor = 3, limit = 262144) {
  let total = 0;
  let sequence = 0;
  let failed = false;
  return {
    emit(value) {
      requireThat(!failed, 'TRANSPORT_ALREADY_FAILED', total);
      const bytes = encode({ sequence: sequence++, ...value }, limit);
      total += bytes.length;
      try {
        requireThat(total <= limit, 'RECORD_CAP', total);
        let offset = 0;
        while (offset < bytes.length) { const amount = write(descriptor, bytes, offset, bytes.length - offset); requireThat(amount > 0, 'TRANSPORT_ZERO_WRITE', offset); offset += amount; }
      } catch (error) { failed = true; throw error; }
    },
    state: () => ({ total, sequence, failed }),
  };
}
export function parseTransport(bytes) {
  requireThat(bytes.length <= 262144 && bytes.length > 0 && bytes.at(-1) === 10, 'RECORD_ENVELOPE', bytes.length);
  const rows = bytes.toString('utf8').trimEnd().split('\n').map(line => JSON.parse(line));
  requireThat(rows.every((row, index) => row.sequence === index), 'RECORD_SEQUENCE', rows.length);
  requireThat(rows.filter(row => row.kind === 'final').length === 1 && rows.at(-1).kind === 'final', 'FINAL_ENVELOPE', rows.length);
  return rows;
}
