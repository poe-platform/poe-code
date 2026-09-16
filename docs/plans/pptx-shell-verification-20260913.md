# PPTX bounded shell verification, 2026-09-13

Delegated verification only. Ownership covers this evidence document; no product,
test, export, README or unrelated working-tree files were edited. No commit,
push, release, whole pipeline, native presentation runtime or download was run.

## Inputs and candidate

Read root and safe-bash AGENTS.md, applicable shared command/SDK contract sections,
the existing shell plans, test/API audit and inventory metadata, and corpus manifest
metadata. Existing source case identities remain in research. This run adds no
derived assets or source cases and does not promote research inventory rows.
The corpus manifest is the disposable-fixture authority; no corpus bytes were used.

Observed HEAD: `9d32a97f8c5dd6715e4024f0442a4a52ccd4c5cd`.
The working tree contained concurrent changes, including PPTX domain changes.
This is a live working-tree check, not an immutable commit/archive qualification.
Runtime: Node `v22.23.2`, Darwin arm64. The tests import the public `pptx` package
and safe-bash source adapters. No build was performed by this worker; the result
does not certify that every concurrently edited domain source matches its build.

## Executed check

From repository root:

```sh
node --import tsx --test packages/safe-bash/tests/commands/pptx/selectors.test.ts packages/safe-bash/tests/commands/pptx/create.test.ts packages/safe-bash/tests/commands/pptx/workflow-examples.test.ts
```

Exit 0; 107 tests passed, zero failures, cancellations, skips or TODOs;
reported duration 5,064.10275 ms. These are existing maintained test inputs run
directly for a focused check, not the full maintained workspace gate.

Post-run SHA-256 hashes of the selected bounded regular text inputs:

| File under `packages/safe-bash/tests/commands/pptx` | SHA-256                                                            |
| --------------------------------------------------- | ------------------------------------------------------------------ |
| `selectors.test.ts`                                 | `99f7ca81af36de8bd26b0832c81210af28046eeeff07d9b3e6ed717d224ed3e0` |
| `create.test.ts`                                    | `eec91fa79891d4741a6e357511b087f3874e769875ce60f787b38cc5d45dded0` |
| `workflow-examples.test.ts`                         | `bac1a65b4bfa37179d2ccfad7140cdf7124d4e7cb2f004a8e3a20e88d4799d39` |

## Observed coverage

After the coordinating agent reported a successful selected `pptx` maintained
build closure, ran the broader current command suite:

```sh
node --import tsx --test packages/safe-bash/tests/commands/pptx/*.test.ts
```

Exit 0; 236 tests passed, zero failures, cancellations, skips or TODOs;
reported duration 8,639.199792 ms. This refreshes command integration evidence
against that build and includes the selected tests above. No failing case was
encountered. This direct focused command-family run is not a full workspace gate
or proof of a complete command/API coverage mapping.

- Real safe-bash `sh` execution reads `.sh` files stored in memfs. Selected
  scripts cover inspection, text replacement, groups, frame/paragraph formatting,
  image insertion and table column resizing. These are virtual script workflows;
  they do not invoke a native host shell to implement product behavior.
- Literal paths containing spaces, Unicode, apostrophes and dollar signs survive
  quoting. `--` protects option-looking filenames. Binary input is supplied through
  the shell byte stdin API; custom byte producers and PPTX binary stdout feed pipes.
- Plugin absence returns 127. Explicit registration succeeds; duplicate registration
  rejects, explicit replacement succeeds, and one plugin can serve multiple shells.
- Assertions distinguish status 0, unmatched selection 1, usage 2, missing file 3
  and resource limit 4. Binary stdin exceeding 65,536 bytes returns `resource-limit`.
- Memfs publication assertions cover dry-run, force, source preservation, alias and
  stale-input refusal, unavailable atomic publication and secondary-input aliases.
  Capability tests deny content access when reads are unavailable, preserve streaming
  cancellation, and exercise buffered fallback only before partial content.
- SDK/CLI byte comparisons are supplemented by independent expected drawing IDs,
  geometry, ordered text and parsed XML values. Table workflow assertions check
  explicit row/column values and body text rather than agreement alone.

## Remaining coverage and interpretation

No PPTX-specific maintained rooted-real or mock-remote workflow route was located
in the inspected PPTX plans or command tests. The explicit bounded QA below
therefore exercises existing adapters separately from unit testing. These results
are not evidence of deployed remote enforcement or universal host isolation.

The selected scripts do not exercise every public command, inherited model member,
enum, helper or collection. Exact source parametrizations and expanded BDD coverage
remain governed by the research ledgers. The test inventory contains 2,700 unit
variants and 973 expanded BDD cases; its historical unmapped labels cannot be
interpreted as current pass counts. The current API inventory metadata declares
2,409 objects. No whole-public-surface completeness claim follows from 107 passes.

The existing table batch rejection regression passed: non-animation batch operations
remain rejected with `invalid-value` and no publication. The existing workflow plan
already records this limit; it is not a newly fixed finding.

No product output changed, so no screenshot was produced. No failing maintained
test or new meaningful product defect was found, and no code regression was added.

## Explicit memory, rooted-real and mock-remote QA

Read the existing canonical adapter and rooted-real allocation examples first.
The following ephemeral Node command executed the documented procedure, without
adding a QA script file. It creates one original 4,927-byte presentation using
the public SDK, writes virtual `.sh` files through each supplied adapter, and
checks their actual safe-bash execution. Only the explicitly owned real-adapter
temporary directory uses host filesystem I/O; this is QA, not a unit test.

First attempt: exit 1 from a harness assertion that incorrectly expected each
plain text command to append a newline. Observed `Reed 雪Reed 海 breeze` is exact
concatenated text. Corrected only that assertion; no product change. Both attempts
cleaned their own temporary root in `finally`.

Corrected attempt: exit 0. Each of memory, rooted-real and mock-remote returned
script status 0, missing-input script status 3 and invalid-selector status 2;
the original bytes stayed unchanged. Plugin absence returned 127 before explicit
registration; neither curl nor node was enabled. A global fetch tripwire was
never called. Rooted-real rejected a symlink pointing outside its configured root
with status 3. Mock transport recorded 128 operations and performed no network
requests. Its success does not qualify a deployed provider. Rooted-real cleanup
removed `/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/pptx-shell-qa-mPIPOl`.

The profiles cover read and binary-output mutation workflows, not atomic file
publication on every backend or every public operation. The memfs suite above
separately covers publication contracts.

## Exact executed QA command

```sh
node --import tsx --input-type=module <<'JS'
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,realpath,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createPresentation,createPptxCommandEngine,readPresentationText} from 'pptx';
import {Shell} from './packages/safe-bash/src/shell/index.ts';
import {pptxCommands} from './packages/safe-bash/src/commands/pptx/index.ts';
import {toByteSource} from './packages/safe-bash/src/contracts/index.ts';
import {MemoryFileSystem} from './packages/safe-bash/src/fs/memory/index.ts';
import {createRealFileSystem} from './packages/safe-bash/src/fs/real/index.ts';
import {S3FileSystem,MockS3Client,createS3Transport} from './packages/safe-bash/src/fs/s3/index.ts';
const context={limits:{maxBytes:262144,maxReads:1000,chunkBytes:4096},archiveLimits:{maxArchiveBytes:262144,maxEntryBytes:65536,maxTotalBytes:262144,maxMembers:64,maxPathBytes:256,maxDepth:16,maxPaxBytes:1024,maxTextBytes:65536,chunkSize:4096},xmlLimits:{maxBytes:65536,maxNodes:4000,maxDepth:32},relationshipLimits:{maxBytes:65536,maxParts:64,maxRelationships:64}};
const bytes=await createPresentation({slides:[{shapes:[{name:'Caption',x:0,y:0,width:100,height:100,text:'Reed 雪'}]}]},context);
assert.equal((await readPresentationText(bytes,{},context)).text,'Reed 雪');
const parent=await mkdtemp(join(tmpdir(),'pptx-shell-qa-'));const originalFetch=globalThis.fetch;
globalThis.fetch=()=>{throw new Error('Unapproved network call');};
try{
 await mkdir(join(parent,'root'));const root=await realpath(join(parent,'root'));
 await writeFile(join(parent,'outside'),'private-marker');await symlink(parent,join(root,'escape'));
 const client=new MockS3Client({buckets:['qa']});
 for(const [name,fs] of [['memory',new MemoryFileSystem()],['rooted-real',await createRealFileSystem({root})],['mock-remote',new S3FileSystem({bucket:'qa',transport:createS3Transport(client,client.capabilities)})]]){
  await fs.writeFile('/reed 雪.pptx',bytes);
  await fs.writeFile('/quoted workflow.sh',new TextEncoder().encode("set -e\npptx inspect - --json\npptx text 'reed 雪.pptx'\npptx text replace 'reed 雪.pptx' --find '雪' --with '海 breeze' --first --output - | pptx text -\n"));
  await fs.writeFile('/missing.sh',new TextEncoder().encode("pptx inspect 'missing 雪.pptx' --json\nstatus=$?\nexit \"$status\"\n"));
  const shell=new Shell({fs,cwd:'/'});
  try{
   assert.equal((await shell.exec('pptx --help')).exitCode,127);
   shell.use(pptxCommands({engine:createPptxCommandEngine({context,maxArgumentBytes:65536,maxOutputBytes:262144})}));
   assert.equal(shell.commands.has('curl'),false);assert.equal(shell.commands.has('node'),false);
   const result=await shell.exec("sh 'quoted workflow.sh'",{stdin:toByteSource(bytes)});
   assert.equal(result.exitCode,0,result.stdout+result.stderr);assert.equal(result.stderr,'');
   const newline=result.stdout.indexOf('\n');assert.equal(JSON.parse(result.stdout.slice(0,newline)).operation,'inspect');
   assert.equal(result.stdout.slice(newline+1),'Reed 雪Reed 海 breeze');assert.deepEqual(await fs.readFile('/reed 雪.pptx'),bytes);
   const missing=await shell.exec('sh missing.sh');assert.equal(missing.exitCode,3);assert.equal(JSON.parse(missing.stdout).ok,false);
   const invalid=await shell.exec("pptx inspect 'reed 雪.pptx' --slide 0 --json");assert.equal(invalid.exitCode,2);
   if(name==='rooted-real'){const denied=await shell.exec('pptx inspect /escape/outside --json');assert.equal(denied.exitCode,3,denied.stdout+denied.stderr);}
   console.log(JSON.stringify({profile:name,scriptStatus:result.exitCode,missingScriptStatus:missing.exitCode,invalidStatus:invalid.exitCode,sourceBytes:bytes.length,network:false}));
  }finally{await shell.dispose();}
 }
 console.log(JSON.stringify({mockOperations:client.requests.length,cleanupRoot:parent}));
}finally{globalThis.fetch=originalFetch;await rm(parent,{recursive:true,force:true});}
JS
```
