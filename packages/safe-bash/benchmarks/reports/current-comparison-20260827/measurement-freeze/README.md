# Committed comparison freeze — ready for independent check

**STOPPED at static PREFLIGHT. No product imports or MEASURE calls.**
ROOT must announce these exact bindings before product imports, then delegate
execution as already authorized. No further user reapproval is requested here.
The independent freeze check is pending, not represented as already accepted.

## Exact announcement

- Candidate: `e33974b8c643077453227a9679d8ceca8367998c`
- Git tree: `f559246f1317af7691de00333e13dfc8f44ef428`
- Source archive SHA256: `903784b4a5b1123d285e81fff65883b44d486759fb5ce3f4d28c602ed66736cf`
- Source inventory SHA256: `00e2633c564a461bf095e7fb9444d165e2c261b3d3b02a0143194044b36a70dd`
- Built public archive SHA256: `bc4f0e01d9daba5dc7c99a7d66615e52808a83a162140d59e88544c7c71fbd51`
- Binding SHA256: `1c74655402eba80a12e1c190fa43ba6923faace8a7db81c7f17da8a3b4528b1e`
- Proposed ROOT receipt SHA256: `c0f9468f33d1df5ec468bc98830c06fc8fcadb797f3595b0a7fa18f346f607a5`

The source archive is 564,762 bytes and the public package archive is 682,405
bytes. Both live beneath the exact artifact root recorded in `location.json`:
`/private/tmp/safe-bash-measurement-freeze-XAFOrN/artifacts`.
The immutable `execution-binding.json` and `proposed-root-receipt.json` live in
this report directory. `READY.json` supplies the concise machine handoff.

## What was frozen

All six required ancestors passed before preparation: `1ad428ed`, `7d7dce7c`,
`b2821599`, `3bf672f`, `c3fbda62`, `84ab66ca`; full IDs are in `location.json`.
Source, package metadata, compiler configuration, bridge and cohorts came from
Git at the exact candidate, never the moving product worktree.

The selected source archive contains 220 tracked product/build/documentation
files, with Git blob IDs, content SHA256, original and sealed modes retained in
`source-inventory.json`. This is not a complete repository test/consumer audit.
The unchanged candidate build script is `tsc -p tsconfig.build.json`. Only that
compiler build ran, using a regular copied 318-file existing development tree
whose lock equals the candidate lock. No npm install, npm lifecycle command,
full tests, global typecheck or product JavaScript import occurred.

Packaging uses deterministic Python-stdlib tar/gzip with `package/` members:
the actual built `dist`, exact candidate package.json and README. This is an
npm-compatible public archive, explicitly **not an npm pack/install receipt**.
The primary authentication commit's guarded stdlib extractor was reused without
editing its bytes. All 710 public package members match before/after extraction.
The extracted package was moved, not linked, into the independent offline
consumer; its source-build file inodes are distinct. The candidate consumer has
711 regular files including its explicit lock, no source-tree symlink or alias.
Public package resolution succeeded without importing either product.

The retained primary just-bash 3.4.2 tar was reauthenticated against
`010411eff3dd210b9575e061914efccd65c13547`, including metadata-body identity,
tar SHA256/SHA1/SHA512 SRI and all 955 published files in the selected copy.
The exact 3,844-file closure was copied to the independent baseline consumer and
its moved bytes/modes/membership rechecked. The older failed 3,842-only profile
remains a separate failed identity, not silently repaired. All 11 asset and 18
dependency-entry references, four lock paths and the public entry are bound.
Only just-bash package publication is authenticated; other dependencies, tools,
dynamic system libraries and optional runtime behavior have narrower proof.

## Reviewed bridge and static check

All 15 frozen runtime files match the committed independent review's exact
hashes. They are unchanged. Fifteen sealed cohort/data files are copied beside
the runtime with its expected relative layout. Original/aligned/breadth retain
their separate identities; no new holdout or native capture is performed.

`static-preflight.json` reports `BOUND_NOT_MEASURED`, zero product imports.
The additional preflight-only loader admits only the nine static helper modules
reachable from PREFLIGHT, verifies returned source hashes and denies product
module paths. It is not used by the future measurement command and does not
modify the bridge or product. No engine child or fixture server was started.
Six preparation tool children launched, closed and had absent owned process
groups; zero tool failures or cleanup signals. This is not host-wide quiescence.

The relocated Node hash is
`5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011`.
The candidate public entry hash is
`77b771a6066aa32f82b903f7a80c578132388d6d9cec9fbde15485915859df5d`;
baseline remains
`70dd1320d921b736e965b1545e50ab57af2b2807a26de7fa624d4f519a953b7c`.
`build-inputs.json`, `compiler-closure.json` and `tool-bindings.json` bind the
compiler, Python archive utility, Node and supporting code without claiming full
publisher authentication of the toolchain.

## Qualification and execution boundary

The binding/receipt explicitly define `qualificationAccepted: true` to mean
**ROOT's committed-comparison authorization only**. Release-qualified,
global-green and whole-gate approval are false. env-S remains partial, shebang
unsupported and independent fixture validity unresolved. No actual runtime
registry inventory or public consumer behavior was tested in this freeze.
ROOT whole-gate cleanup is not a prerequisite. These qualifications supersede
the older generic qualification paragraph in the unchanged bridge documentation.

The prospective bound heap policy is 256 MiB for both breadth engines; expanded
retains its reviewed 256 MiB. This is explicit for ROOT's binding announcement,
not a claim about historical breadth heap settings, total memory or symmetric
RSS limits. Guest environments remain sealed separately from scrubbed host env.

`NEXT_COMMAND.txt` gives the exact future MEASURE command, with the relocated
Node/runner, immutable binding/receipt, explicit scrubbed environment and a new
nonexistent output directory. **Do not execute it before ROOT's announcement and
the independent freeze check.** The runner's actual static PREFLIGHT command is
retained in `static-preflight.json`; no tests or sentinel executions are needed
to reproduce the recorded preparation result.

The driver's `hashedBytes` counter (584,139,015) measures its `stableRead` calls,
not total filesystem I/O: Git reads, compiler reads and required moved-closure
PREFLIGHT readback are separate. This was one current authentication/copy/build
pass, not a rerun of the old provenance audit. File read bounds are 128 MiB/file
and 2 GiB for that counter; archive extraction is capped at 64 MiB expanded data.
Raw subprocess stdout/stderr bytes are retained as base64 in process receipts;
display-only text logs normalize their final newline. Files are read-only regular
copies, not an OS-enforced immutable lease against a trusted host owner.

No source/root/private/other-owner changes, downloads, fresh native oracles,
measurements, timing trials, staging or commits were performed. The original
whole-gate owner's worktree changes and Plato's file remain untouched.
