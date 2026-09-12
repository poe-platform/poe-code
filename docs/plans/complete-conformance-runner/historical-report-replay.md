# Historical report replay

There are two different checks. Before changing the frozen working tree, run the maintained `--aggregate` CLI against every V3 schedule-selected report; it enumerates the current corpus and verifies current source/runtime/configuration provenance. That is the check supporting the frozen-code baseline. After a commit, checkout, runtime upgrade, dependency rebuild, or changes to unrelated fingerprinted workspace files, that CLI should reject the historical manifest. Do not weaken its checks to reuse old results.

The read-only command below independently replays the archived report accounting on a later checkout. It verifies the archived manifest's digest, all batch headers and terminal summaries against that manifest, exact scheduled selections, and then invokes the existing pure `aggregateReports` export from `packages/safe-js/test/conformance/report.ts`. Calling `aggregateReports` alone is insufficient: its input contract does not include the runtime/source/header fields that the CLI validates first.

This proves historical artifact consistency, not current-code conformance. It does not claim the later checkout has the manifest's source SHA/content hash or recorded Node/ICU. The archive receipt supplies the separate artifact-file hashes; verify those before extracting into a fresh directory. The selected report archive stores basename members; extract it into the `batches` subdirectory, and decompress the separately archived manifest beside `resume-batch-schedule.json`. Set `TEST262_REPORT_ROOT` to the extracted `baseline-v3` directory containing `manifest.json`, `resume-batch-schedule.json`, and `batches/`. The resume schedule replaces two incomplete ENOSPC attempts with whole-selection retries under fresh report names; neither partial prefix is reused. Do not include the superseded V1/V2 reports or ad hoc diagnostic selections. The command reads only those explicitly selected paths and prints a concise historical summary; no runner sources, manifests, or reports are rewritten.

Run from a checkout containing the maintained `report.ts` API and its declared TypeScript loader dependency:

```sh
TEST262_REPORT_ROOT=docs/plans/complete-conformance-runner/baseline-v3 \
node --import tsx --input-type=module <<'JS'
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {aggregateReports} from './packages/safe-js/test/conformance/report.ts';
const root = process.env.TEST262_REPORT_ROOT;
if (!root) throw new Error('TEST262_REPORT_ROOT is required');
const json = async name => JSON.parse(await readFile(path.join(root, name), 'utf8'));
const manifest = await json('manifest.json');
const {id, ...payload} = manifest;
const digest = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
if (digest !== id) throw new Error('Invalid archived manifest digest');
if (id !== 'b974f63562bfa3431a18d4da5113a2a0f05ee919c08016df82d5eab78c99bacd')
  throw new Error('Not the selected V3 cohort manifest');
const schedule = await json('resume-batch-schedule.json');
if (schedule.manifestId !== id) throw new Error('Schedule manifest mismatch');
const reports = [];
for (const selection of schedule.selections) {
  const filename = path.join(root, 'batches', selection.label + '.jsonl');
  const records = (await readFile(filename, 'utf8')).trim().split('\n').map(JSON.parse);
  const header = records[0], summary = records.at(-1), entries = records.slice(1, -1);
  if (header?.type !== 'header' || summary?.type !== 'summary' || summary.complete !== true ||
      header.manifestId !== id || summary.manifestId !== id ||
      JSON.stringify(header.selected) !== JSON.stringify(summary.selected) ||
      entries.some(entry => entry.type !== 'result'))
    throw new Error('Incomplete or malformed report: ' + filename);
  for (const key of ['revision', 'sourceSha', 'sourceHash', 'runtime', 'execution']) {
    if (JSON.stringify(header[key]) !== JSON.stringify(manifest[key]))
      throw new Error('Header provenance mismatch: ' + filename + ' ' + key);
  }
  for (const key of ['revision', 'runtime', 'execution']) {
    if (JSON.stringify(summary[key]) !== JSON.stringify(manifest[key]))
      throw new Error('Summary provenance mismatch: ' + filename + ' ' + key);
  }
  const selected = manifest.files.slice(selection.offset, selection.offset + selection.limit);
  if (selected.length !== selection.limit ||
      JSON.stringify(header.selected) !== JSON.stringify(selected.map(file => file.filename)) ||
      selected.reduce((n, file) => n + file.variants.length, 0) !== selection.expectedVariants)
    throw new Error('Schedule selection mismatch: ' + filename);
  reports.push({...summary, entries});
}
const result = aggregateReports(manifest, reports);
console.log(JSON.stringify({
  interpretation: 'historical-artifact-accounting-only',
  manifestId: id, sourceSha: manifest.sourceSha, sourceHash: manifest.sourceHash,
  recordedRuntime: manifest.runtime, recordedExecution: manifest.execution,
  replayRuntime: {node: process.version, icu: process.versions.icu},
  complete: result.complete, success: result.success,
  enumeratedVariants: result.enumeratedVariants, counts: result.counts
}, null, 2));
JS
```

A replay command exit of zero means the historical accounting checks succeeded, even when its printed `success` is false. The maintained runner/aggregation CLI has the stricter task-facing exit contract: zero only when every selected variant passes. A historical replay is not a release receipt, a new Test262 execution, or evidence that a current checkout's unsupported capabilities have been repaired.
