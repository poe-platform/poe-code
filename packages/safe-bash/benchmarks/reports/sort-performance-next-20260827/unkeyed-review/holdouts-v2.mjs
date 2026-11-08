import { holdouts } from './holdouts.mjs';

export function holdoutsV2() {
  const specimens = holdouts();
  const inherited = specimens.find(row => row.id === 'guard-key-local-replaces-global');
  inherited.id = 'guard-key-inherits-global';
  inherited.expected.stdout = Buffer.from('y:10\nx:2\n').toString('base64');
  specimens.push({ ...structuredClone(inherited), id: 'guard-key-local-replaces-global-explicit', script: 'sort -nr -t: -k2,2r', expected: { stdout: Buffer.from('x:2\ny:10\n').toString('base64'), stderr: '', status: 0, files: {} } });
  return specimens;
}
