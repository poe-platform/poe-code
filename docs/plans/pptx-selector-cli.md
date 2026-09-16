# PPTX selector CLI implementation and QA

Status: Implemented narrow inspection profile; final maintained integration checks coordinated by the root owner.

## Ownership and boundaries

The adapter owns `packages/safe-bash/src/commands/pptx` and its original tests in
`packages/safe-bash/tests/commands/pptx`. The SDK owner delegated the new shared
`packages/pptx/src/selector-schema.ts` metadata and its original test to this worker.
Package manifests, public exports and root bundle wiring remain integration-owned.

The adapter registers only when `pptxCommands({ engine })` is installed explicitly.
The genuine engine comes from `createPptxCommandEngine` in the public `pptx` SDK.
Command parsing, schema, indexing, selection and result construction all live in
`packages/pptx`; the safe-bash adapter imports no PPTX runtime or domain types.
All file reads use the invocation's VFS; stdin is bounded. Engine host ceilings
are supplied explicitly in `context`, `maxArgumentBytes` and `maxOutputBytes`
(at least 512 bytes for an error envelope).
No network, ambient host files, native presentation runtime, write operations or
environment variables are introduced.

The structural engine boundary receives owned raw argument bytes, the invocation
signal and a bounded input-read capability, and returns stdout/stderr bytes plus
an exit status. The adapter translates only input-limit and I/O failures, preserves
cancellation and awaits writes to the supplied sinks. `pptx` is a test dependency
of safe-bash; existing committed-archive source and dependency authority is unchanged.

## Implemented behavior

`inspect INPUT` lists slide identities in presentation order. `--slide N` selects a
one-based position; `--shape NAME` always selects an exact case-sensitive name,
including numeric strings, in that owner. Duplicate names require `--all`.
`--part URI` and explicit `--scope` address non-slide owners. `--select TOKEN`
accepts a canonical fingerprinted SDK token without simple selector combinations.
Malformed tokens fail before file reads, while stale fingerprints fail after
admitting the current package. Human output names records and owners; JSON includes
records, tokens, locations and the common version-1 result envelope.

`schema [inspect]`, `capabilities`, `help` and `version` expose this read profile.
Schema includes closed JSON Schema options/results and the SDK's closed typed
selection query with explicit one-based/zero-based coordinate objects. Capabilities
reject editing. Input-aware capabilities, general feature census, mutation batches,
the mirrored model API and the remaining shared CLI operations are not implemented
by this adapter slice. No whole-contract coverage claim is made.

## Original regression evidence

Tests use memfs and small originally authored OPC XML/ZIP assets; they never
download corpus data. The fixture stores `slide1.xml` before `slide99.xml` while
presentation order references `slide99.xml` first. Slide IDs 400/900 survive reorder;
object IDs repeat in different slides; duplicate names remain ambiguous; numeric
shape name `7` belongs to ID 9. Assertions state expected identities independently
and compare public SDK selection locations with actual Shell CLI results.

Red-to-green cases cover absent implementation, one-based slide bounds, duplicate
names/all, stale tokens, numeric names, token syntax before missing-file I/O,
output-budget JSON errors and human formatting. Additional cases cover stdin,
virtual `sh inspect.sh`, `--` filenames, repeated/conflicting/inapplicable flags,
schema and capabilities. Root metadata assertions independently require the new
optional export and declared root SDK files while preserving the existing runtime
dependency inventory.

Focused results after engine extraction: all 21 CLI cases pass with the genuine
injected SDK engine; 25 independent schema-validation cases pass. Existing archive
peer and dependency-lock controls pass without modifying their authority. Final
maintained build, full runner and repository tests are root-coordinated; scoped
results are not the final repository gate. No push or release occurred.

The complete existing `archive-controls.test.mjs` suite passed all 205 cases in
94.02 seconds after engine injection, with no skips or failures and no changes
to its source-provenance/dependency guards. New CLI regressions also verify
malformed part-selector rejection before input reads and preservation of a
literal initial byte-order character in filenames.

The schema cases use the existing `toolcraft-schema` compiler as an independent
validator. They accept named/positional/explicit-all queries and reject mixed
token fields, unknown fields, missing owners, missing coordinate systems and
fractional/out-of-range coordinates. Canonical token content and fingerprint
freshness remain SDK semantic validation against the admitted package.

## Manual QA procedure and receipt

1. Instantiate the actual Shell with the explicit adapter, genuine SDK engine
   and trusted ceilings.
2. Execute `pptx --help`, a zero slide-position request and a malformed-token
   request against a nonexistent file; capture stdout/stderr and statuses.
3. Render the captured terminal transcript with the maintained `terminal-png`
   renderer and visually inspect the PNG. Do not commit generated screenshots.
4. For corpus inspection, use only manifest-listed disposable files under
   `.cache/pptx-corpus`, copied explicitly into a configured VFS. Any new finding
   must become a small original regression before a code change.

Executed step 1–3 using actual source imports. `/tmp/pptx-selector-cli.png` was
rendered and opened: help displays the scope and exact-name rules clearly, error
lines are readable without truncation, and both invalid requests return status 2.
The standard `screenshot-poe-code` route cannot install an optional Shell plugin;
the same terminal renderer was used directly on the actual Shell transcript.

The upstream audits/inventories and corpus manifest were consulted. Reference
identities and adaptation accounting remain in the research inventory and the
root evidence owner's selector accounting; no reference assets or implementation
were copied into these original tests. Existing standalone legal notices remain
untouched.
