# Root publication verification

[Release run 34697326933](https://github.com/poe-platform/poe-code/actions/runs/34697326933) succeeded at exact source `5fd3b4f08463ebd03cc09203162acf58f5a05b9c`. All validation jobs succeeded, including the fresh unit/native job completed at 14:21:29 UTC on 2026-09-12. Its archived log and job metadata are in [the unit receipt](delivery-root-unit.json). The separate release job published **poe-code 15.0.26** and [GitHub release v15.0.26](https://github.com/poe-platform/poe-code/releases/tag/v15.0.26) at 14:22:58 UTC. This is the root package publication; scoped versions have independent receipts.

Exact registry metadata for `poe-code/15.0.26` and `/latest` both identify version `15.0.26` and `gitHead` `5fd3b4f08463ebd03cc09203162acf58f5a05b9c`. The downloaded 34,299,981-byte tarball's SHA-512 equals registry integrity and the decoded SLSA subject digest; SHA-1 also matches registry `shasum`. The registry ECDSA signature was cryptographically checked using the primary npm keys endpoint over `<name>@<version>:<integrity>`. Decoded SLSA provenance names this repository, `.github/workflows/release.yml`, source SHA above and invocation `34697326933/attempts/1`. This direct signature check and decoded provenance identity are separate from the installed registry signature audit below. No independent Sigstore certificate verification is implied by merely decoding the provenance.

[Registry receipt](root-publication-registry.json), [exact metadata](root-publication-metadata.json), [raw attestations](root-publication-attestations.json) and [timestamped HTTP observations](root-publication-propagation.jsonl) retain source, digests and consumer path. No root propagation failure was observed on these requests. The three scoped packages previously required retries; no locally published artifact was used.

## Installed immutable artifact

From the disposable consumer recorded in the registry receipt:

```sh
npm install --ignore-scripts --no-audit --no-fund poe-code@15.0.26
npm audit signatures --json
```

Installation exited 0, adding 185 packages. The installed package is exactly `15.0.26`; its lockfile resolves the primary registry tarball and matching integrity. `npm audit signatures --json` on Node 22.23.2 / ICU 78.2 / npm 10.9.8 exited 0 with `{"invalid":[],"missing":[]}`. [Signature receipt](root-publication-signatures.json) includes lock hash, exact resolution and actual latest observation.

Executed installed-artifact smoke, with no checkout imports:

```sh
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import {run} from 'poe-code/safejs';
import {createMemoryFileSystem,FsError} from 'poe-code/safe-fs';
const basic=await run('const values=[1,2];values.push(3);return [values.reduce((a,b)=>a+b,0),await Promise.resolve(42)]');
assert.equal(basic.ok,true);assert.deepEqual(basic.returnValue,[6,42]);
for(const locale of ['en-US','pl-PL','ru-RU']) {
 const f=new Intl.DateTimeFormat(locale,{calendar:'gregory',month:'long',timeZone:'UTC'});
 const a=Date.UTC(2000,1,29),b=Date.UTC(2000,2,2);
 const outcome=await run(`const options={calendar:'iso8601',month:'long',timeZone:'UTC'};const f=new Intl.DateTimeFormat(${JSON.stringify(locale)},options);return [f.formatToParts(${a}),f.formatRangeToParts(${a},${b}),f.resolvedOptions().calendar,new Temporal.PlainMonthDay(2,29).toLocaleString(${JSON.stringify(locale)},options),new Temporal.PlainYearMonth(2000,2).toLocaleString(${JSON.stringify(locale)},options)]`);
 assert.equal(outcome.ok,true);
 assert.deepEqual(outcome.returnValue,[f.formatToParts(a),f.formatRangeToParts(a,b),'iso8601',f.format(a),f.format(a)]);
}
const memory=createMemoryFileSystem();
await memory.writeFile('/hello.txt',new TextEncoder().encode('published root\n'));
assert.equal(new TextDecoder().decode(await memory.readFile('/hello.txt')),'published root\n');
await assert.rejects(memory.readFile('/missing'),e=>e instanceof FsError&&e.code==='ENOENT');
JS
```

All assertions passed. [Smoke receipt](root-publication-smoke.json) records actual imported package path, runtime and every locale result. Host filesystem authority is limited to the disposable package installation; the guest filesystem smoke uses an explicitly created in-memory filesystem. No runtime support, timeout, budget or assertion was weakened.

Root disposition: **poe-code 15.0.26** is registry-, integrity-, provenance-identity-, signature-audit- and installed-smoke-verified at source **5fd3b4f08463ebd03cc09203162acf58f5a05b9c**. All initial implementation delivery workflows succeeded. Complete V4 corpus acceptance and its subsequent documentation delivery remain separate gates.
