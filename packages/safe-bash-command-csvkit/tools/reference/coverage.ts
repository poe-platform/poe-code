// Reference inventory generation is explicit, never a package build or unit hook.
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildCoverage } from './model.js';

const directory = fileURLToPath(new URL('../../../../docs/csvkit/', import.meta.url));
const names = ['reference-profile.json', 'feature-register.json', 'test-dispositions-20260917.json', 'source-flow-audit-20260917.json', 'source-manifest.json'];
const sources = await Promise.all(names.map(async name => {
  const data = await readFile(path.join(directory, name));
  return { path: `docs/csvkit/${name}`, sha256: createHash('sha256').update(data).digest('hex'), data: JSON.parse(data.toString('utf8')) };
}));
const profile = sources[0]!.data;
if (profile.source.sha256 !== '147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b') throw new Error('wrong csvkit source archive');
const result = buildCoverage(sources[1]!.data, sources[2]!.data);
const captures = await Promise.all((await readdir(directory)).filter(name => name.endsWith('-reference.json') || name.startsWith('oracle-')).sort().map(async name => {
  const data = await readFile(path.join(directory, name));
  return { path: `docs/csvkit/${name}`, sha256: createHash('sha256').update(data).digest('hex'), qualification: 'historical capture; no inferred case attribution or current candidate pass' };
}));
const coverage = {
  ...result,
  target: profile.target, archive: profile.source,
  inputs: sources.map(({ path: inputPath, sha256 }) => ({ path: inputPath, sha256 })),
  profiles: profile.profiles.map((entry: { id: string }) => entry.id),
  historicalCaptures: captures,
  policy: {
    denominators: 'All source declarations retained, including historical failures, static assignments, optional dependencies and uncollected tests; counts are not runtime collection counts.',
    attribution: 'No compatibility credit until a case id, exact inputs, authenticated reference/candidate hashes and compared effects are linked to each declaration.',
    stderr: 'Exact bytes, including warning and verbose source paths; no normalization.',
    structured: 'Workbook/database/interactive semantics and timings require separate qualified evidence.',
    discovery: 'tools/reference has no canonical unit-test filename or product export; native capture is explicitly invoked only.'
  },
  blockers: [
    'Complete case-to-option/applicability/default/quirk/branch attribution is unresolved.',
    'Upstream test declarations and assignments are not all ported or runtime-collected; original dispositions retained.',
    'Real database drivers/services and observed transaction/result traces require authenticated separate captures.',
    'TTY/IPython/interactive, buffering and signal profiles are unmeasured by the pipe-only runner.',
    'Workbook/compression/interpreter cases without their exact oracle dependencies are blocked, not passed.',
    'Historical scoped captures do not qualify the current dirty candidate or establish full support.'
  ]
};
await writeFile(path.join(directory, 'coverage.json'), JSON.stringify(coverage, null, 2) + '\n');
console.log(JSON.stringify({ denominators: coverage.denominators, qualifiedPasses: coverage.qualifiedPasses, fullSupport: coverage.fullSupport }));
