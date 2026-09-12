# Scoped publication verification

Source: `5fd3b4f08463ebd03cc09203162acf58f5a05b9c`. GitHub [Release scoped safe packages run 34697326857](https://github.com/poe-platform/poe-code/actions/runs/34697326857), publish job `103562941653`, completed successfully at 2026-09-12 13:50:34 UTC. Its independent SafeFS, SafeJS and Safe Bash publishing steps report `0.1.561` at 13:50:14, 13:50:22 and 13:50:32 respectively. Workflow completion is distinct from registry verification below.

## Verified independently

At 13:53:20 UTC, exact `@poe-platform/safe-fs@0.1.561` and `@poe-platform/safe-bash@0.1.561` were fetched from the primary npm registry. Each downloaded tarball's SHA-512 matched registry `dist.integrity` and the SLSA provenance subject digest. The registry ECDSA signatures were cryptographically verified using keys from `https://registry.npmjs.org/-/npm/v1/keys` over the npm signed message `<name>@<version>:<integrity>`. Decoded SLSA build provenance identifies this repository, `.github/workflows/release-safe.yml`, and exact source `5fd3b4f08463ebd03cc09203162acf58f5a05b9c`. This distinguishes verified registry signatures from decoded provenance identity; it does not alone claim cryptographic Sigstore certificate verification.

Raw verified digests, package/dependency versions, provenance statements, URLs and disposable consumer path: [registry receipt](scoped-publication-registry.json). Independently installed SafeFS memory read/write, Safe Bash `cat` through `Shell`, and shared `FsError` identity passed on Node 22.23.2 / ICU 78.2: [installed smoke receipt](scoped-publication-fs-bash-smoke.json). Imports resolve inside the disposable consumer's `node_modules`, never the workspace.

Commands, from the disposable consumer recorded in the JSON:

```sh
npm install --ignore-scripts --no-audit --no-fund ./safe-fs.tgz ./safe-bash.tgz
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import {createMemoryFileSystem,FsError} from '@poe-platform/safe-fs';
import {Shell,agentCommands,FsError as BashFsError} from '@poe-platform/safe-bash';
const memory=createMemoryFileSystem();
await memory.writeFile('/hello.txt',new TextEncoder().encode('hello published\n'));
assert.equal(new TextDecoder().decode(await memory.readFile('/hello.txt')),'hello published\n');
assert.equal(FsError,BashFsError);
const shell=new Shell({fs:memory}).use(agentCommands());
try { const r=await shell.exec('cat /hello.txt');assert.equal(r.exitCode,0);assert.equal(r.stdout,'hello published\n');assert.equal(r.stderr,''); }
finally { await shell.dispose(); }
JS
```

The first smoke attempt started before npm installation had completed and correctly failed `ERR_MODULE_NOT_FOUND`; it is an orchestration timing error, not an installed artifact defect. After install exit 0 (six packages), the unchanged smoke passed.

## Propagation observations, subsequently resolved

Initial primary `/latest`: SafeFS and Safe Bash `0.1.561`, SafeJS `0.1.560`. Exact SafeJS `0.1.561` requests returned 404 at 13:52:17–18 UTC using multiple encoded URL forms, including cache-busting query and no-cache header. The full packument was HTTP 200 but lacked that exact version. At 13:52:46–47 UTC, exact metadata, tarball and attestation HEAD requests all returned 404. `npm view @poe-platform/safe-js@0.1.561 version dist.integrity --prefer-online --json` also exited 1 / E404. A fresh full primary packument query at 13:53:21 UTC still reported latest `0.1.560` and no `0.1.561` entry.

These earlier observations did not verify SafeJS. Read-only retries continued without installing mixed `latest`, assuming sibling success, locally publishing or rolling back. Exact metadata became HTTP 200 at 13:56:20 UTC. Its provenance and registry signature then verified, but the tarball remained 404 until 13:57:58 UTC. The downloaded tarball then matched its SHA-512, and `/latest` reported `0.1.561` at 13:58:13 UTC. [Retry timestamps and URLs](scoped-publication-propagation.jsonl) retain the transition. All three exact scoped versions are now independently verified; root `poe-code` publication and final V4 inventory remain separately owned tasks.


## SafeJS installed artifact regression

Installed the verified `safe-js.tgz` into the same disposable consumer with `npm install --ignore-scripts --no-audit --no-fund ./safe-js.tgz` (exit 0, twelve additional packages). All three installed package manifests are exactly `0.1.561`; both dependents require SafeFS `0.1.561`. Shared SafeFS error identity through SafeJS compatibility exports and Safe Bash is preserved. Basic Array/reduce and awaited Promise return `[6,42]`. Long ISO month parts/range parts, retained resolved ISO calendar and both Temporal locale paths pass against the same host's Gregorian month data for en-US, pl-PL and ru-RU. [Full installed JS smoke receipt](scoped-publication-js-smoke.json) includes actual results, runtime and module paths outside the checkout.

```sh
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import {run} from '@poe-platform/safe-js';
import {FsError} from '@poe-platform/safe-fs';
import {FsError as JsFsError} from '@poe-platform/safe-js/fs';
import {FsError as BashFsError} from '@poe-platform/safe-bash';
assert.equal(FsError,JsFsError);assert.equal(FsError,BashFsError);
const basic=await run('const values=[1,2];values.push(3);return [values.reduce((a,b)=>a+b,0),await Promise.resolve(42)]');
assert.equal(basic.ok,true);assert.deepEqual(basic.returnValue,[6,42]);
for(const locale of ['en-US','pl-PL','ru-RU']) {
 const f=new Intl.DateTimeFormat(locale,{calendar:'gregory',month:'long',timeZone:'UTC'});
 const a=Date.UTC(2000,1,29),b=Date.UTC(2000,2,2);
 const outcome=await run(`const options={calendar:'iso8601',month:'long',timeZone:'UTC'};const f=new Intl.DateTimeFormat(${JSON.stringify(locale)},options);return [f.formatToParts(${a}),f.formatRangeToParts(${a},${b}),f.resolvedOptions().calendar,new Temporal.PlainMonthDay(2,29).toLocaleString(${JSON.stringify(locale)},options),new Temporal.PlainYearMonth(2000,2).toLocaleString(${JSON.stringify(locale)},options)]`);
 assert.equal(outcome.ok,true);
 assert.deepEqual(outcome.returnValue,[f.formatToParts(a),f.formatRangeToParts(a,b),'iso8601',f.format(a),f.format(a)]);
}
JS
```

No runtime compatibility claim beyond the observed Node 22.23.2 / ICU 78.2 consumer is made here. The workflow independently passed its broader maintained tarball smoke steps. Neither evidence substitutes for root publication or whole-corpus completion.

## Registry-spec signature audit

After tarball verification and installed smoke, `npm install --ignore-scripts --no-audit --no-fund @poe-platform/safe-fs@0.1.561 @poe-platform/safe-js@0.1.561 @poe-platform/safe-bash@0.1.561` completed exit 0, up to date. The lockfile now resolves all three exact roots to primary registry tarballs, avoiding the local-file audit limitation. `npm audit signatures --json` on npm 10.9.8 / Node 22.23.2 exited 0 with `{"invalid":[],"missing":[]}`. The [signature audit receipt](scoped-publication-signatures.json) records command, result, exact registry resolutions and lock hash. This supplements direct ECDSA signature verification and SLSA source/subject checks for each artifact.

Final scoped disposition: SafeFS, SafeJS and Safe Bash **0.1.561** are independently registry-verified and installed-smoke-verified from source **5fd3b4f08463ebd03cc09203162acf58f5a05b9c**. Temporary SafeJS metadata/tarball propagation gaps resolved through read-only retries; no package was republished locally or rolled back. Root `poe-code` and V4 corpus acceptance retain independent receipts.
