import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { root, owned, stress, author, review, digest, read, json, artifact } from './common.mjs';

const manifest = json(`${owned}/patch-manifest-v3.json`);
const map = json(`${owned}/row-map-final-v3.json`);
const native = json(`${owned}/native-v3.json`);
const verification = json(`${owned}/verification-v3-final.json`);
const reviewCommit = 'f84b8e229063847833fff24bab55c890a318e715';
const pinnedReview = [];
for (const name of ['REPORT.md', 'audit.json', 'native-review.json']) {
  const path = `${review}/${name}`;
  const committed = spawnSync('git', ['show', `${reviewCommit}:${path}`], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  assert.equal(committed.status, 0, committed.stderr);
  assert.equal(committed.stdout, read(path));
  pinnedReview.push({ path, commit: reviewCommit, sha256: digest(committed.stdout) });
}
artifact('pinned-review-v3.json', pinnedReview);
const key = input => JSON.stringify([input.argv, input.inputHex, Object.entries(input.files ?? {}).sort()]);
artifact('proof-links-v3.json', {
  nativeArtifact: `${owned}/native-v3.json`, nativeArtifactSha256: digest(read(`${owned}/native-v3.json`)),
  rows: map.rows.map(row => ({ number: row.number, newTestName: row.newTestName, constituents: row.constituents.map(input => {
    const index = native.results.findIndex(result => key(result) === key(input));
    assert.ok(index >= 0);
    return { id: input.id, nativeResultIndex: index, independentlyReexecutedLiteralArgv: native.results[index].executed, remainingLiteralFileGate: !native.results[index].executed };
  }) })),
});
const artifactNames = ['native-v3.patch', 'host-conditional-v3.patch', 'patch-manifest-v3.json', 'row-map-final-v3.json', 'host-row-v3.json', 'proof-links-v3.json', 'native-v3.json', 'verification-v3-final.json', 'invocation-schedules-v3.json', 'mutation-checks-v3.json', 'unrelated-preservation-v3-final.json', 'static-preservation-v3.json', 'inputs-before.json', 'inputs-after.json', 'pinned-review-v3.json'];
artifact('handoff-v3.json', {
  version: 3, recordedAt: new Date().toISOString(), applied: false, reviewAuthorized: false,
  sourceAcceptance: { status: 'separate leaf; not certified here', userSuppliedCommit: 'b9187c0', userSuppliedStructuredSha256: '120a10c34d96b26f584c6e4349ef9098c0537d76952078e70e9ce6ab5c3f0176' },
  artifacts: artifactNames.map(name => ({ path: `${owned}/${name}`, sha256: digest(read(`${owned}/${name}`)) })),
  targets: manifest.files.map(({ path, patch, beforeSha256, afterSha256, beforeSnapshot, afterSnapshot }) => ({ path, patch, beforeSha256, afterSha256, beforeSnapshot, afterSnapshot })),
  gates: ['Independent review of exact native patch and both test-only helpers', 'Two unavailable literal binary-file checks require independently authorized resolution', 'Separate stable source/build acceptance; no source imports here', 'Explicit host contract ruling before any conditional host patch application', 'Separate root authorization and later TEST-ONLY application commit; never apply from this proposal authoring step'],
});

artifact('README.md', `# Corrected jq canonical proposal v3 — NOT APPLIED

This leaf owns only this new directory. Read [PROPOSAL.md](PROPOSAL.md) before
reviewing either patch. No source, canonical test, old fixture, or old report was
changed. No product module was imported, no dependency installed, no delegation
performed, and no source or whole-product pass is claimed.

- **Native patch:** \`native-v3.patch\`, 29 selected named tests, two explicit
  opt-in byte-helper adjustments, and three new test-only expectation/assertion files.
- **Conditional host patch:** \`host-conditional-v3.patch\`, one JqError sink
  identity assertion. It is NOT a native delta and awaits the source reviewer's
  contract decision. Its existing EPIPE control is retained.
- **Authoritative map:** \`row-map-final-v3.json\` (29 rows),
  \`host-row-v3.json\` (one separate host row), \`proof-links-v3.json\` and
  \`invocation-schedules-v3.json\` (all 464 selected original/proposed invocations).
  \`row-map-v3.json\` is the earlier audit-derived capture input, not the final
  naming authority; the final map corrects the mixed resource test's name.
- **Handoff:** \`handoff-v3.json\` pins exact paths and SHA-256 values;
  \`patch-manifest-v3.json\` pins every original, full proposed-after snapshot,
  all 36 nonoverlapping edit spans, and unchanged byte ranges.
- **Validation:** \`verification-v3-final.json\` records proposal-only checks,
  including all 14 documented byte mutants rejected by the actual proposed
  callbacks. Frozen tuples injected into test code are NOT product execution.

## Safe reviewer checks, from repository root

\`node tests/commands/structured-stress/jq-grammar-canonical-plan/verify.mjs\`

\`git apply --check tests/commands/structured-stress/jq-grammar-canonical-plan/native-v3.patch\`

\`git apply --check tests/commands/structured-stress/jq-grammar-canonical-plan/host-conditional-v3.patch\`

\`(cd tests/commands/structured-stress/jq-grammar-canonical-plan && shasum -a 256 -c MANIFEST.sha256)\`

These do not apply the patches. Existing local TypeScript tooling is used only
for in-memory transpilation/typechecking; no emitted build or product import.
Do not rerun capture/generation scripts into their frozen output paths. They
refuse overwrite. A subsequent capture needs separately reviewed new paths.

## Open gates

Native capture reran 88 exact-input cases twice: 178 processes including version
and build queries. All captured tuples match the immutable expectations. The
two \`file-unicode\` cases could NOT be rerun as literal paths: the author's
immutable \`native-files/\` contains no \`unicode-start\` and no file with bytes
\`f09f\`. Inventory, raw bytes, provenance and before/after namespace/content
hashes are recorded. No new binary fixture, fd substitution, or literal-path
claim was made. **That native gate remains open.** Independent patch/helper
approval and separate source acceptance also remain open; only the source
reviewer can resolve the conditional host contract. Do not apply either patch
without explicit authorization. Do not call canonical tests green.
`);

const targetRows = manifest.files.map(file => `| \`${file.path}\` | ${file.patch} | \`${file.beforeSha256 ?? 'NEW; must not exist'}\` | \`${file.afterSha256}\` |`).join('\n');
const nameRows = map.rows.map(row => `| ${row.number} | ${row.oldTestName.replaceAll('|', '\\|')} | ${row.newTestName.replaceAll('|', '\\|')} | ${row.schedule.executions} |`).join('\n');
artifact('PROPOSAL.md', `# Corrected executable TEST-ONLY proposal v3

**NOT APPLIED. NOT INDEPENDENTLY APPROVED. August 27, 2026 UTC.**

The user supplied source handoff \`b9187c0\` and structured hash
\`120a10c34d96b26f584c6e4349ef9098c0537d76952078e70e9ce6ab5c3f0176\`.
Another leaf owns source acceptance. This proposal does not certify those
identities, execute/import that source, or claim a green canonical suite.
Review rejection \`${reviewCommit}\` is checked byte-for-byte against Git for
REPORT.md, audit.json and native-review.json; see \`pinned-review-v3.json\`.
Both prior proposals, canonical snapshots and the independent red inventory
were read; their original trees remain endpoint-hash-identical.

## Application artifacts and ownership

- \`native-v3.patch\` SHA-256: \`${manifest.patches.native}\`.
- \`host-conditional-v3.patch\` SHA-256: \`${manifest.patches.host}\`.
- Complete originals are under \`before/<canonical-path>.txt\`; complete
  proposed snapshots are under \`after-native/\` or \`after-host/\`, with the
  same canonical path plus \`.txt\`. The extension avoids registering evidence
  snapshots as real tests. New canonical artifacts have no original snapshot.
- The unified patches reconstruct those snapshots exactly in memory and pass
  \`git apply --check\` against current originals. They are precise patches,
  not prose replacement templates. No \`git apply\` without \`--check\` was run.
- Only the following explicit targets are permitted. No source, frozen old
  fixture, inventory, audit/report tree, or neighboring suite is a target.
  The host author safety test is an explicitly requested conditional canonical
  target, not permission to alter that subtree's other artifacts.

| Canonical target | Patch | Original SHA-256 | Proposed SHA-256 |
| --- | --- | --- | --- |
${targetRows}

## R1–R4 corrections

**R1 — bounded spans.** The native and host proposals have 36 exact,
nonoverlapping original-text edit spans total, with byte offsets and hashes.
Shared loops are changed once, not once per row. The entire safety suffix
starting at \`const preflight:\` remains byte-identical: 7,017 bytes, SHA-256
\`8b1f26fa92b33bf83dee716cf778d7bfd5572a62e64b825751465fbbeaa0bf32\`.
There are 93 untouched top-level statements checked bytewise, including the
unrelated safety/resource controls. No signals, limits, timeouts, counters,
cleanup assertions, source arrays, split endpoints or empty chunks are removed.

**R2 — actual bytes.** The two proposed test helpers expose opt-in
\`executeWithBytes\`/\`runWithBytes\` results with copied \`stdoutBytes\` and
\`stderrBytes\`. Legacy \`execute\` and \`run\` retain their existing fields,
including \`run\`'s context/command-result fields; no product API changes.
Structured capture uses \`Buffer.from(chunk)\`, not a potentially shared Buffer
slice. Raw bytes are collected before decoding; decoded strings are retained
only for existing tests. The stress helper's 128 KiB per-stream cap, all command
limits, input defaults and overrides remain intact. The structured helper gets
no new arbitrary budget. Both helper diffs require independent review.

\`assertNative\` compares exact status and hex derived from these raw arrays,
not from decoded strings. All 14 documented invalid-byte/U+FFFD mutants still
produce equal decoded text but fail both the byte assertion and their actual
proposed canonical callbacks. A proposed 15-test assertion suite covers the
14 mutants plus exact lookup controls. Validation also checks missing/duplicate
keys, forbids undefined input, and injects reusable output Buffers into the two
helpers to verify copies, legacy return fields, default input, override identity
and the existing stress capture cap. These are test-harness checks, not product
sink/cancellation or quota acceptance.

**R3 — concrete invocation binding.** The four incremental cases retain the
baseline \`input\` and every \`source()\` call, inclusive cuts and empty middle
chunks. CLI captures \`result\`, \`single\` and \`slurp\` independently, including
exact stderr and slurp's empty stdout. The resource test retains all 29 calls:
15 JSON inputs, four byte inputs, three division/modulo filters, three large
decimals, three arithmetic/conversion filters and the explicit surrogate call.
Its six omitted-input filters still receive helper-default \`null\`, with lookup
inputHex \`6e756c6c\`, not empty input or undefined. The independently captured
six corrected controls are referenced, and this leaf reran those actual inputs.
All 36 CLI mode/input pairs and 297 CLI schedules remain represented.

Only the 13 raw IDs listed in the patch are overridden. Their original virtual
file setup and four chunk sizes remain intact. Original fixture bytes are not
overwritten. The old raw tests do not contain post-run VFS namespace/content
assertions; retaining setup does not invent such coverage.

**R4 — six selected malformed indices.** Only \`{5,14,15,16,21,22}\` receive
exact native acceptance overrides and corrected names. Index20 remains the
existing successful large-exponent case with its original assertions. All
other 17 original loop branches, including that success, are left intact.
There is no blanket-failure rewrite and no gratuitous strengthening of the
16 neighboring malformed rejections. The separate three native compiler rows
are join/0, join/2 and split/0. Split/2 regex flags retain their existing name,
unsupported diagnostic branch, status, empty stdout and no-acquisition guard.
Split/0 retains a throwing iterator; empty native stdin is only the compiler
control, never a claim that the iterator is empty or acquired.

## Exact names and schedules

The authoritative structured \`row-map-final-v3.json\` has all 29 rows and each
constituent's argv, actual inputHex, file bytes, exact status/stdoutHex/stderrHex,
immutable proof identity and schedule. \`proof-links-v3.json\` maps each to
this leaf's native observation or explicit unavailable-file result.
\`invocation-schedules-v3.json\` records all actual original/proposed callback
inputs and chunks from the test-only simulation: **464 selected invocations**
(461 original26 + three compiler diagnostics), not 464 product executions.

| Row | Original name | Proposed name | Retained calls |
| --- | --- | --- | ---: |
${nameRows}

Final preservation validation registers 373 unselected tests alongside the
selected rows: 167 callbacks remain byte-identical after transpilation and 206
shared-loop callbacks retain identical simulated call/assertion traces. All 69
split-native fixtures are included as unchanged registrations. Synthetic traces
are not utility results; the independent byte-span/static-statement checks are
the source-preservation evidence. A first report omitted these 69 registrations
via an empty fixture stub: \`verification-v3.json\` and
\`unrelated-preservation-v3.json\` remain as recorded. The authoritative final
files explicitly supersede that accounting; the selected464, mutant14 and
static93 observations are unchanged, checked against their first artifacts.

## Native evidence and literal-file limitation

This leaf ran only local \`/usr/bin/jq\` as the native oracle, without a host
shell, inherited environment, network or product execution. Capture began
\`${native.startedAt}\` and ended \`${native.endedAt}\`. Native reports
\`jq-1.7.1-apple\`, build \`--with-oniguruma=builtin\`; executable SHA-256
\`${native.executableSha256}\`. Full environment:
\`PATH=/usr/bin:/bin LC_ALL=C LANG=C TZ=UTC NO_COLOR=1\`. Every process used a
5-second timeout and 256 KiB capture bound in this owned isolated cwd.

The 96 row constituents deduplicate to 90 exact input keys; 88 were rerun
twice, with equal status/stdout/stderr both times and exact frozen matches.
Including version/build queries, that is **178 processes**. Two file keys were
not executed. Full raw tuples, argv, cwd, environment, executable hash, both
repetitions and before/after cwd hashes are in \`native-v3.json\`.

For both file-unicode cases the required argv contains literal
\`unicode-start\`, whose required bytes are \`f09f\`; stdin is \`98800a\`.
The existing immutable author \`native-files/\` inventory has 11 regular files,
no \`unicode-start\`, and no exact \`f09f\` candidate. The inspected
\`freeze-files.mjs\` creates its listed text fixtures through
\`artifacts.mjs\`/apply_patch; it does not create the missing binary fixture.
\`native-v3.json\` records all existing file hex/size/mode/hash entries, hashes
both provenance scripts, and preserves namespace/content hashes before/after.
There was therefore no honest available literal-file invocation to make.
No bytes were scripted into old files, no binary fixture was created, and no
fd rerun was substituted. Historical literal-file expectations remain frozen;
prior review fd variants remain separately labeled, NOT literal-path evidence.
**Independent literal-file verification remains an open gate.**

## Conditional host proposal — separate one-row decision

\`host-row-v3.json\` and \`host-conditional-v3.patch\` concern only
\`host stdout failure is never a recoverable filter error: host sink failure\`.
The source reviewer, not this leaf, decides whether that host-thrown JqError
must reject with identical object identity rather than become status5. The
patch is explicitly conditional, has no native proof, and is not described as
retiring a stale native expectation. It retains writes===1, reads===1, cleanup
and the existing EPIPE identity control; only JqError gets a stderr-write probe
requiring zero. A synthetic identity stub passes; converting to status, adding
diagnostic writes or extra input reads makes the proposed callback reject.
This proves assertion wiring only, not the product's host contract.

## Validation and handoff boundaries

- Both unified patches pass non-applying \`git apply --check\`; an independent
  in-memory hunk parser reconstructs every complete after snapshot.
- No product imports. In-memory TypeScript checking of proposed files reports
  zero proposed or transitive diagnostics at capture time, with no emit. This
  is not the repository's global type/build gate or a stable source certificate.
- Original snapshots, old raw JSON and five immutable evidence trees remain
  endpoint-hash-identical. This is not a transient-ABA guarantee.
- Authoring attempts initially stopped on a duplicate proof-input lookup, two
  ambiguous/escaped edit anchors, and VM cross-realm object prototypes. Each
  was fixed in owned scripts before successful artifacts; none was a product
  failure or silently normalized byte result. The first validation registration
  omission is preserved and corrected separately as described above.
- Historical original42 accepted790, legacy94 45 exact/49 differences,
  original22 red, and author-current1550/1580 remain historical. No denominator,
  fixture, result or snapshot is rebaselined; these observations are not added
  to accepted790 or represented as canonical green.
- Reviewer must inspect both helper changes and the exact native diff, resolve
  or explicitly route the unavailable literal-file gate, and independently
  authorize a later TEST-ONLY application. Source/build acceptance is separate.
  The host patch additionally requires an explicit contract ruling and must not
  be bundled into a native delta. This leaf applies neither patch.
- Later authorized validation must run the changed canonical files, retained
  neighboring controls and independent source cohorts, including the prepared
  35/178 + 256/790 + 94/376 exact executions and failure-boundary repetitions.
  This bounded proposal does not establish quotas, cancellation, VFS safety,
  complete jq/Bash support, 72 hours of work or superiority over just-bash.
`);
console.log(JSON.stringify({ nativePatchSha256: manifest.patches.native, hostPatchSha256: manifest.patches.host, summary: verification.summary }));
