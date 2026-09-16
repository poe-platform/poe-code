# PPTX transition subset

## Scope and ownership

Implement F44 cut/fade/push/wipe and manual/timed advance through the typed
operation SDK and shared plural CLI. Do not run the whole pipeline, edit README,
push, release, or stage unrelated changes. Work on main.

The domain worker owns `packages/pptx/src/transitions.ts` and
`transitions.test.ts`. The CLI worker owns transition additions only in
`command-engine.ts` and `index.ts`, new transition schema/command tests, and the
safe-bash transition test plus its exact integration registration. Existing edits
in shared files remain outside this task's commits. The QA worker owns the
separate corpus QA plan. The coordinator owns this plan and research/usage
receipts and performs final verification and Git staging.

## Procedure

1. Read root/scoped instructions, format/shared contracts, both upstream audits
   and complete inventories, and disposable corpus manifest.
2. Establish missing behavior with original failing tests before implementation.
3. Independently assert saved XML attributes, selected node removal, retained
   sound relationships, unsupported/Morph retention and unchanged unrelated parts.
4. Verify all four kinds; all directions; integer millisecond boundaries;
   manual/automatic/immediate advance; conflicting settings; absent/existing
   transitions; selectors, empty/ambiguous results and publication failures.
5. Exercise SDK and command engine plus actual safe-bash routing with memfs.
   Inspect generated help screenshots. Keep downloaded fixtures outside tests.
6. Run maintained pptx unit/lint checks and narrowly scoped adapter checks.
7. Review and stage only owned paths/hunks. Commit atomic improvements using
   Conventional Commits and report local hashes independently of remote delivery.

## Research receipt

The complete inventory scan found zero transition-specific cases among 2,700
unit variants, 973 expanded BDD cases and 2,407 API records. This is an additive
format feature, not an implementation of a previously documented live model.
Inherited/underscore-prefixed APIs and unrelated source cases remain in their
existing inventories. See `docs/pptx/transitions-evidence.md` and
`docs/pptx/transitions-case-map.json` for boundaries and exact mappings.

## Verification

Executed checks and scope limitations are recorded below.

## Executed implementation receipt

Original failing tests first established missing behavior. Review regressions
then reproduced empty-set acceptance, direction coercion, malformed imported
timing, repeated compatibility tokens, missing-removal effect counts and
multi-owner add. Fixes retain explicit error categories and publication atomicity.

- Domain: 46 original cases, including the actual Morph namespace, MCE retention,
  sound/media relationship preservation, integer bounds and Strict duration XML.
- Commands: 20 original cases through all five paths, with independent expected
  fields and executable option/result schema validation.
- `npm run test --workspace=pptx`: 144 files / 3,890 tests passed.
- `npm run build:workspaces -- --workspace=pptx`: maintained selected closure passed.
- `node --import tsx --test packages/safe-bash/tests/commands/pptx/transitions.test.ts`:
  one public SDK/virtual-shell script test passed.
- `node --test packages/safe-bash/scripts/integration-inputs.test.mjs`:
  107 exact inventory checks passed.

The preliminary package run caught only new in-progress transition regressions;
all 142 preexisting test files passed. Preliminary lint caught typed-array fixture
inference and the original Map received an explicit byte-array type. A transient
ENOSPC interrupted formatting once; retry succeeded without deleting any shared
file or fixture. Final lint outcome is recorded below when complete.

## Visual QA

`pptx` is an injected safe-bash command rather than a root poe-code CLI route.
Used the maintained `npm run screenshot -- --output PATH --no-header -- node
--input-type=module -e ...` route with the exported command engine, literal argv,
explicit byte input and actual stdout/stderr/status. No native product adapter
was introduced. Separately, the adapter test exercises actual Shell execution.
Inspected `/tmp/pptx-transitions-help.png` (scoped help and rejected nonzero cut
with exit 2) and `/tmp/pptx-transitions-list.png` (help and readable push/1251 ms/
immediate automatic advance output). Final help adds an explicit null-disable
sentence. Temporary PNGs are not staged or shipped.

## Scope decisions

`--advance-after null` / `advanceAfter: null` explicitly clears automatic advance;
this supplements numeric format-table grammar using the shared SDK absence
convention. `set` omissions preserve existing values. Add requires one owner even
with explicit all; set/remove permit multiple selected slides. Unsupported
transitions, through-black variants and MCE branches are preserve-only; exact
millisecond duration is unknown for legacy speed-only metadata. This implements
the direct documented subset, not playback or whole-public-model parity.

Independent corpus QA and hashes are in
[pptx-transitions-corpus-qa.md](pptx-transitions-corpus-qa.md). No pipeline,
README changes, fixture downloads, push or release occurred.

Final selector review added two RED/GREEN regressions: unfiltered lists now
return the whole slide collection (including empty decks), and token plus all
retains the token owner rather than forwarding an invalid selection combination.

Final `npm run lint --workspace=pptx` passed ESLint and both TypeScript projects.
Final maintained package run: 144 files / 3,890 tests passed.

The final selected build hit ENOSPC. Cleared only npm’s regenerable download
cache with `npm cache clean --force`, recovering about 2.3 GiB. Project sources,
other work and shared corpus inputs were retained; the selected build was retried.

Selected workspace build retry passed (three declared build tasks). The final
rebuilt public adapter test passed (one case, about 201 ms test time). Recaptured
and inspected `/tmp/pptx-transitions-final.png` from the final exported engine;
null-disable guidance is visible and help exits zero. No presentation outputs,
caches or screenshots enter the commit.
