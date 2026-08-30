# Packed core env84ab: package proof, retained consumer failures

Independent verifier, source author separate. Source candidate:
`84ab66ca717e0dff21abf57051b41cb553f3c7f3`.
Frozen preparation: `dc1fcc48251027c240bf1674f1e0af7f0f16a2b4`.
One acceptance attempt on August27,2026,11:04:44–11:04:52 UTC. No product/build/
pack/install retry, no source overlay, no hidden cases read, no frozen expectation
or fixture edits. **Packing is proven; the complete frozen consumer is NOT green.**

## Counts, without hiding the oracle defects

| Measurement | Result |
| --- | --- |
| Committed full-source build |exit0;343 authenticated actual compiler inputs|
| Actual offline npm pack |exit0;710 audited packed files|
| Actual offline local-tgz install |exit0;one real installed package, no runtime dependencies|
| Real installed public declaration probe |exit0;242 authenticated actual compiler inputs|
| Frozen native-row assertions |**0/10 GNU5.3,0/10 historical3.2**|
| Frozen host assertions |**0/5 executions**,3 host case IDs|
| Installed-module/source/file guards |**13/13** consumer processes;174 compiled JS loads each|
| Raw native tuples, separately observed |**7/10 both profiles**,NOT a revised assertion score|
| Non-S policy tuple |matches frozen126 tuple;overall frozen assertion still fails|

All10 native rows and all5 planned host executions ran once, in13 consumer
processes. The input case has3 subexecutions. Child Node exits0 because the
frozen consumer serializes caught assertions; that is not an assertion pass.
The capture driver completed successfully and explicitly records the zero-pass
strict summary. No skip, xfail, per-case profile switch or normalization occurred.

The WHOLE primary and historical10-row references are reused from native-frozen
without fresh native runs. Their exact tools, versions, argv, source/header bytes,
environments, effects and separate optional-argument controls remain authoritative.
No old kernel, OLD9, accounting, canonical-profile, hidden or broad suite ran.

## Two frozen verifier mistakes, not env-S source regressions

These mistakes belong to this independent verifier's prepatch preparation.
They are preserved rather than corrected during acceptance.

**Cross-exec state assumption.** Frozen consumer.mjs:66 executes
`SECRET=parent-local` in a separate Shell.exec. Lines92–93 use another exec and
expect `parent-local|parent-public`. Actual output is `|parent-public`.
Candidate Shell.#execute constructs a fresh variables/state object from shell
options for every exec (src/shell/shell.ts:133–145). The same behavior exists in
the6e source inspected during preparation. Setting a local in one exec does not
create a persistent session for another exec. This is not an env child modifying
parent state, and does not justify a product state/lifecycle change.

This final assertion fails all10 native cases and both budget/cancel controls
after their primary work. Consequently this cohort does **not** establish the
intended same-invocation parent-local/export-attribute preservation. The raw
primary tuples remain available, but cannot override those frozen assertion
failures. Source extracts/hashes from both revisions are in the audit artifact.

**Overstrong downstream environment assumption.** All3 input variants reach
the `forward` command with the exact replacement map `{KEEP:"value"}`. Frozen
forward then calls `context.invoke('sink', [])` without replaceEnv. The actual
sink map is `{KEEP:"value",PWD:"/packed"}`, while the frozen host assertion
incorrectly demands `{KEEP:"value"}` there too.

Candidate src/contracts/command.md:3–7 explicitly retains legacy merge/PWD
behavior when replaceEnv is absent/false. Runtime.ts:1342 implements exactly that
choice. It is also present in6e. Exact replacement applies at the explicit env
child boundary; it does not silently impose a lineage policy on a subsequent
default invocation. No source fix or expectation relaxation was made.

## Exact remaining native tuple losses

All7 direct env invocations match BOTH complete native references exactly in
status, stdout bytes, stderr bytes and effects:
quotes-empty-concatenated; long-option-preserves-tail; escapes-and-comments;
variables-are-not-shell-code; split-before-ignore-environment;
unset-and-repeated-assignment; unsupported-dollar-stops-before-dispatch.
This includes literal empty/quoted/metacharacter args, expansion before -i,
repeated assignments/-u and exact125 malformed-dollar diagnostics. No marker
effect appears. These are raw observations, not corrected seven-case assertions.

The3 shebang rows remain raw losses; both profiles have the same expectations:

| ID | Current84ab | Frozen native, both profiles |
| --- | --- | --- |
| shebang-split-bash-errexit |126;empty stdout;phase=seed,0644|1;empty stdout/stderr;phase=before,0644|
| shebang-long-split-sh-argv |126;empty stdout;phase=seed,0644|0;`<./script>\|<1>\|<a b>\n`;empty stderr;phase=kept,0644|
| non-split-header-one-argument |126;empty stdout;phase=seed,0644|0;empty stdout/stderr;phase=reached,0644|

Current stderr lines, each with exactly one final newline:
```
shell: line 1: ./script: unsupported interpreter: /usr/bin/env -S bash -e
shell: line 1: ./script: unsupported interpreter: /usr/bin/env --split-string=sh -e
shell: line 1: ./script: unsupported interpreter: /usr/bin/env bash -e
```

The first two are the acknowledged **unimplemented env-S interpreter path**,
separately routed to the runtime owner. They are not waived/native passes. The
third is the existing approved literal-one-optional-argument126 policy versus
actual Darwin kernel splitting. Its raw tuple matches policyExpected, but the
faulty cross-exec assertion still makes the frozen overall policy result false.
Both facts stay visible; neither raw native oracle is replaced by its separately
recorded explicit-single-argument control.

## Host observations and evidence limits

- Default input is empty with origin true; explicit empty has origin false;
  binary input/output is exactly hex00ffc3a90a with origin false. Each reaches
  env, forward, sink and real cat, without lost/duplicated bytes. Sink assertions
  fail on the downstream PWD assumption, not bytes or immediate replacement.
- Middleware sees the original literal env arguments and selected child args.
  The default invoke forwards the existing input object; this frozen cohort
  does not independently exercise a partially consumed cursor or firstread API.
- Budget reaches tick(first), not tick(forbidden). The frozen typed limit/name/
  witness assertions precede the later failing parent assertion.
- Cancellation reaches waiter once; the exact reason-identity assertion also
  precedes the later failing parent assertion. The late rejection produces no
  unhandled stderr. However the frozen catch overwrites the serialized original
  exception with that parent assertion, so final sameReason is false. Evidence
  that the earlier check was reached is a control-flow inference from the frozen
  code and exact later error, NOT a standalone all-host/cancellation pass.
- No product child_process/fetch denial hook was called. These hooks and load
  guards are retained unchanged, not claimed to sandbox arbitrary trusted JS.

## Genuine packed-package authentication

The driver inspects the full committed Git inventory, then archives every one
of the candidate's213 src files plus all7 root files, including unchanged
manifest, lockfile, README and complete tsconfig extends chain:220 files.
Archive entries are audited before extraction and verified against Git blob IDs;
the independent audit rechecks every file SHA256 against the exact commit.
No selected source-only stub, live missing-file overlay or foreign root barrel
substitution is used. The excluded non-source directories are not build inputs;
this is not a whole-repository/global TypeScript gate.

Existing Node22.22.2 and TypeScript5.9.3 are authenticated. The existing dev
node_modules symlink is used **only for build**, removed before pack and product.
Compiler inputs are prelisted from the fixed archive and toolchain files and
checked against actual listed paths/hashes; no live source alias is eligible.

Actual npm10.9.7 pack runs offline/ignore-scripts/noaudit in the archive package,
with isolated HOME/cache/user/global config. Runtime, optional, peer, bundled
dependencies and workspaces are checked empty before packaging. The product
name, exports, files list and manifest bytes are unchanged. The actual630766-byte
tgz is retained losslessly as base64 in packed-core-84ab66c-tarball.json:

```
SHA256 3ac9f899fbabb14e0473a9345113642fbfd2d12ac6e957659695b6b9e2fbac8c
SHA1   09a3036291301ce501ec458ff4ca5bf29008e984
```

npm's SHA512 integrity is independently recomputed too. The tar auditor checks
checksums, effective paths/PAX metadata, sizes, duplicates, file ancestors and
entry types; it rejects path escape, links, devices and unsupported extensions.
All708 emitted dist files plus README/package.json (710 files) match the exact
archive outputs/metadata. The same tarball is then actually installed offline,
ignore-scripts/noaudit/nofund into a clean external consumer directory. That
scratch consumer's minimal private ESM manifest is the only new package metadata.
No root install, network, registry fetch, borrowed consumer modules or fake
virtual-bash package exists. Installed virtual-bash is a real directory, not
a symlink; the only installed package is virtual-bash. All710 installed hashes
match the tarball before/after every consumer run.

Plain Node, not tsx, resolves bare virtual-bash and virtual-bash/contracts through
the real installed manifest to installed dist/index.js and dist/contracts/index.js.
Each of13 consumers records174 actual compiled-JS imports, all inside installed
dist and equal to audited tar/emitted hashes. Frozen host-process/fetch hooks
are armed before dynamic product imports. Public types are separately checked
through the actual installed .d.ts exports; no stubs or source aliases. This one
typed probe is not a full inventory of all public consumers or a global check.

Full archive inputs, emitted files, installed files, npm files and compiler
inputs remain stable. Unique manifests are reused by digest. Raw child outputs,
statuses, argv/env/cwd, source/hash anchors and installed URLs remain durable
even though the temporary installation has been removed. Packing is not proof
of npm publication or a full-feature acceptance.

## Exact source and stop state

Runtime SHA256:
`2223ef9e02565d163ded042d933553a1efae502ce7531fe83bba5611d959c84b`.
Parser SHA256:
`10d015eb62fd4e4f964666c04e5869ea78afdb76d930181760adecbcf16ab65e`.
Execution SHA256:
`61940d3b86593243c13cab716be87f84647e42b69476757482dfebafc7d693a6`.
Private env-split SHA256:
`b005331bff0dd207a65b9001d235020f005eed45b813cca912851502c3f9dcf4`.
Manifest SHA256:
`792ba8de3f1927e58564350621834ad8470345fec9eaf126485d0ed5fe03577e`.

The env commit's production delta is only execution.ts and env-split.ts;
runtime/shell/contracts are unchanged from its parent. Current candidate runtime
and manifest hashes are NOT mislabeled as the older6e/preparation hashes.

All8 original dc1fcc4 files remain byte-identical. Only additive owned evidence,
packing/audit tooling and the declaration probe are committed. All17 acceptance
child groups are stopped and the complete owned archive/install/cache scratch
tree is removed, verified by a separate cleanup artifact and audit. No SIGSTOP,
watcher, source write or waiting for runtime routing remains. Foreign staging
is preserved by explicit git commit --only; no latest-live-cleanliness claim.

No new source bug is demonstrated by the two frozen host-contract mistakes.
Any future correction requires a separately authorized, disclosed test revision;
this attempt and its0/10+0/5 results stay immutable. No extra semantic probes,
rerun for green, hidden denominator pooling, new lifecycle/API/creation-mask
policy or deferred bash-c status fix was introduced. Stop after this checkpoint.
