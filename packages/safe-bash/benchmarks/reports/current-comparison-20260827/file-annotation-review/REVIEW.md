# Independent file annotation review

**Verified, narrowly:** commit `1a18cb1858f9453f41a20caff0988c578aa9c7e2`
against its exact parent `9e6c5e2394d5d36df42529d74d1dd21301ddeab6`.
Observed HEAD was `8ab677479e0094ec0c6cdf90d1f0e87883b2f8dc`, not the reviewed commit.

- Exact Git delta: only `tests/commands/file/text-bound.test.ts`; **one** added
  aliased type-only `node:util` import and **three** callback `this` annotations.
  The handoff's “3 aliased type imports” is not the actual delta. Exact text
  reconstruction confirms every other byte, including assertions, vectors,
  runtime imports and control flow, is untouched.
- Independent actual scoped command, once per frozen variant:
  `node --import tsx --test tests/commands/file/text-bound.test.ts`.
  Before **17/17**, after **17/17**; zero failures, cancellations, skips or TODOs.
- Independent `node <copied-typescript>/bin/tsc --noEmit -p tsconfig.scoped.json --pretty false`:
  parent exits 2 with exactly three TS2749 diagnostics (67:72, 79:72, 136:72);
  reviewed commit exits 0 with no diagnostics. Config extends its frozen root
  config, with only this fixture in `files` and empty `include`/`exclude`.
- Independently emitted each exact fixture using TypeScript 5.9.3
  `transpileModule`, original compiler options and the original fixture filename.
  Both outputs are **12,453 bytes**, byte-identical; SHA-256 for each:
  `bfcd49d6bcfc3a7d57dc76dcba07a6b224f9d9001b6c8adca71ca8c8500b5ff2`.
  This is single-file TypeScript emission, not a whole-project build.
- Negative control: `apply_patch` appended `new TextEncoder().encode(42);` only
  to a separate regular copy of the after tree. The same scoped type command
  exits 2 with exactly **TS2345 at 187:26**, number not assignable to string.
  Neither the pristine after copy nor the actual repository fixture changed.

## Binding, evidence and limits

Each variant archives `src/**`, the exact fixture, its `helpers.ts`, and root
package/lock/tsconfig from its own exact revision. Relative `.js` imports are
unchanged and bind to those copied TypeScript sources through tsx/TypeScript;
there are no imports into the live working tree and no source symlinks.
Existing dev dependencies were dereferenced into regular files in the shared
scratch parent `node_modules`, with a complete byte census. Installed versions
match both frozen locks: TypeScript 5.9.3, tsx 4.23.12, @types/node 22.20.1.
Host: Node v22.22.2, Darwin arm64. No installs or private-checkout writes.

`SUMMARY.json` records exact input/emission hashes, commands' outcomes and
bindings; `commands.json` and `*.stdout.log`/`*.stderr.log` retain every verifier
subprocess result, including the expected failing type checks. `*-inputs.json`
and `tools.json` enumerate frozen files. Git archive stdout is losslessly stored
as `*-archive.stdout.tar.gz.data`; decompress before comparing its recorded raw
stdout hash. Captured source/patch/JS/archive and the one-off verifier are data,
not canonical TypeScript inputs or test discovery entries. `HASHES.json` seals
all other evidence files; it intentionally cannot include its own hash.

The author's supplied SUMMARY used revision `21049bedb7d086c68952153a82a0add91aadd570`.
Its preserved fixture bytes match the exact parent/commit respectively, but this
review freshly archives, runs and emits the actual requested revisions rather
than trusting that receipt. The author's disposable roots were already removed;
an initial read of its old scoped config therefore failed. Fresh scratch replaced
that unavailable prerequisite; no verification failure was discarded or retried.

No full typecheck, build or test gate ran; the other eight historical errors are
outside this review, as are current dirty-tree qualification, engine comparisons
and performance claims. Other owners' changed/untracked files were left alone.
`CLEANUP.json` confirms the owned scratch was removed; all synchronous child
processes settled, and no background processes were launched.

Reproduction: the exact one-off program is `verify.mjs.data` (run with
`node --input-type=module < .../verify.mjs.data` into an empty owned evidence
directory; exclusive writes deliberately reject overwriting this sealed run).
`seal.mjs.data` records lossless archive packing, hash verification and explicit
regular-file-only atomic staging/commit, including an unrelated-index check.
