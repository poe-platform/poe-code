# Release failure recovery — independent execution receipt

Executed 2026-09-15 on main at source `e63e1b158c58de8b14a926a6e6c8989da1d23feb` plus preserved dirty inputs. Node 22.23.2 / ICU 78.2 / Unicode 17.0 / Darwin arm64. This documentation-only increment does not certify the dirty runtime candidate. Target remains ECMA-262 edition 16 and ECMA-402 edition 12 (June 2025), Test262 `419d3e0a2273ba01a3bfcbec423f2801425b8e93`, with existing separately tracked newer APIs. Host authority was limited to repository reads, Node helper execution and isolated memfs manifests; no publishing capability was invoked.

## Executed scenarios and recovery

| Scenario | Executed evidence | Concrete recovery |
| --- | --- | --- |
| Failed validation | Maintained packageSafeLibraries rejected invalid explicit version before filesystem access; exit 0 for expected rejection. Retained run 34931319430 / SHA55c7d8b1186be5e272595dc6499ec349fa86d833 remains failure. | Preserve gate logs and exact source. Reproduce actual failure, repair with red regression and maintained checks on main; record successor ancestry and its own gates. Infrastructure retry requires evidence and a separate attempt receipt. Original failure remains failure. |
| Cancelled/superseded | Parsed retained run34929329559 / SHAd7af44927f6badab9504647da63f7748b86015b2; asserted cancelled independently of failed/green receipts. Cancellation cause not established. | Read every attempt and publish step before retry; cancellation does not establish absence of side effects. Revalidate intended source. Record a superseding source only with ancestry and scheduler/source evidence, retaining cancelled identity. |
| Concurrent main pushes | Two equal registry views607/607/607 select608; serialized next view608/608/608 selects609. Actual semver machinery executed; no remote pushes induced. | Honor release-safe serialization (cancel-in-progress:false), track running and replaced pending identities; ordering is not guaranteed. Refresh registry after terminal publisher. Root/scoped concurrency groups are independent. Never dispatch a competing publisher as recovery. |
| Partial scoped publication | FS607 / JS606 / Bash606 selects608, not missing607. | Ledger all three exact names/versions. Verify accepted FS607 and mark JS607/Bash607 absent/uncertain. Current workflow cannot selectively resume607. Prefer tested forward fix and ordinary GitHub cohort above every published version, requiring FS/JS/Bash individually. Explicitly abandon/supersede missing old versions; if exact old versions required, remain blocked pending reviewed GitHub selective-resume machinery with original artifacts. Never retry consumed versions. |
| Stale checksum | In-memory SHA256 fresh equality passed; appended stale bytes rejected; no extraction. | Download build-sourceSHA from original run/attempt; compare with validation's expected digest before extraction. Never derive expected checksum from suspect bytes. Missing/expired artifact requires new build and validation; retain failed attempt. |
| Registry propagation | Maintained preparePublishedWorkspaceVersion using memfs: two missing reads then visible source returned607; exhaustion rejected without manifest mutation. Each branch three reads/two mocked delays. | Keep accepted publish receipt pending visibility; poll exact name/version and explicit registry, preserving timestamps. Compare visible tarball integrity and provenance to retained artifact/source. Deadline is pending/blocker, never permission to duplicate publish. Resume same ledger. Fixture attempts3 are not changes to production24/5000ms budgets. |
| Green no-release | Repository-configured analyzeCommits returned null for docs, patch for fix; no publish plugins invoked. Retained root34974246493 reported no relevant changes. | Record successful validation plus no-release independently of publication. Inspect commit range/rules if publication expected; legitimate tested forward change only. Root green does not settle scoped failures. |

## Receipts, monitoring and boundaries

The existing local raw-evidence manifest was independently rehashed: **21/21 entries matched**. This validates retained bytes, not fresh registry state, signatures or historical failure repair. Predecessor scoped run34974245983/attempt1 at sourceff1923235ea1e0fa0a40bdeb06468fda13cc8d8b accounts separately for SafeFS0.1.607 (accepted13:24:19Z, shasum4e3229b1287da9d1d09341213cd8ccb4963e19ff), SafeJS0.1.607 (13:24:29Z, b145b7fc7b10a24119819069a2bbfa117de2ea7a), SafeBash0.1.607 (13:26:10Z, 14a922c504173cd868e0213517ace59cfd501dcd). These are dated predecessor observations from preserved local evidence, not this task's publications. Root34974246493 is no-release; existing poe-code15.0.41 is a predecessor, not its release.

Resume with gh run view ID and all attempts/jobs/logs, then gh run watch ID --exit-status; monitor each required workflow independently. Persist source, run, attempt, required package/version, gates, expected/observed archive digest, registry URL/integrity/provenance, timestamps and successor mapping. Missing evidence remains unknown. Built identifies source/run/artifact; validated adds passing gates; delivered requires verified remote-main source/ancestry; published requires every necessary exact package/version and matching registry artifacts/provenance. No-release is separate. A different green run never completes another failure.

No workflow/code edits, runtime repairs or workflow unit tests. npm run lint:workflows exit0. Both reproduced Node heredocs below exit0. Additional Python hashlib checks validated21 retained hashes and asserted both terminal identities. Node crypto asserted fresh/stale digests. Runtime/build/conformance/screenshots skipped for documentation-only scope, not counted as passes. Live cancellation, concurrency, partial publication and registry outage intentionally not injected; simulations are labeled. No destructive rollback authorized; any concrete destructive rollback needs separate explicit authorization. Prefer tested forward fixes on main; never force-push, bypass hooks, unpublish or duplicate publication.

Recovery-QA acceptance is evidenced within nonpublishing scope. Historical failures, fresh publication certification and exact-old-version resume capability remain unresolved as stated. Local commit is reported separately after commit; remote delivery:none; task publication:none. Existing record and raw receipts were present before task entry and remain uncommitted unrelated work; this standalone receipt records this increment's actual execution.

## Reproducible helper commands

Run from repository root; execute only these helpers, never full semantic-release.

```sh
node --input-type=module <<'JS'
import {packageSafeLibraries} from './scripts/package-safe.mjs';
import {analyzeCommits} from '@semantic-release/commit-analyzer';
import semver from 'semver';
import {readFileSync} from 'node:fs';
try { await packageSafeLibraries({version:'not-a-version'}); throw Error('unexpected pass'); }
catch(e) { console.log(e.message); if(e.message !== 'A valid explicit package version is required') throw e; }
const next = versions => semver.inc(versions.sort(semver.rcompare)[0],'patch');
console.log(next(['0.1.607','0.1.606','0.1.606']));
console.log(next(['0.1.607','0.1.607','0.1.607']),next(['0.1.607','0.1.607','0.1.607']));
console.log(next(['0.1.608','0.1.608','0.1.608']));
const config=JSON.parse(readFileSync('.releaserc.json','utf8')).plugins[0][1];
for(const message of ['docs(safe-js): record recovery QA','fix(safe-js): repair regression'])
  console.log(message,await analyzeCommits(config,{cwd:process.cwd(),commits:[{hash:'fixture',message}],logger:{log(){}}}));
JS
```

```sh
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import {Volume,createFsFromVolume} from 'memfs';
import {preparePublishedWorkspaceVersion} from './scripts/prepare-published-workspace-version.mjs';
for (const visible of [true,false]) {
 const fs=createFsFromVolume(Volume.fromJSON({'/candidate/package.json':JSON.stringify({name:'@poe-platform/safe-js',version:'0.0.0-dev'})}));
 let reads=0,delays=0;
 const options={packageDir:'/candidate',attempts:3,fileSystem:fs,
  delay:async()=>{delays++},
  sourceChangedSince:sha=>{assert.equal(sha,'fixture-source');return false},
  readPublishedMetadata:async()=>{reads++;if(!visible||reads<3)throw Error('simulated registry not visible');return {name:'@poe-platform/safe-js',version:'0.1.607',gitHead:'fixture-source'}}};
 if(visible)assert.equal(await preparePublishedWorkspaceVersion(options),'0.1.607');
 else {
  await assert.rejects(preparePublishedWorkspaceVersion(options),{message:'@poe-platform/safe-js has no published release containing the current workspace source.'});
  assert.equal(JSON.parse(fs.readFileSync('/candidate/package.json','utf8')).version,'0.0.0-dev');
 }
 assert.equal(reads,3);assert.equal(delays,2);
 console.log('PASS',visible?'eventual visibility':'exhaustion',reads,delays);
}
JS
```
