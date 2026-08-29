# Independent PPR2 fixture packaging refresh

## Scope and plan

Independent packaging review on August 29, 2026. The author is closed. Input
manifest SHA-256 is
`442d7028a286a43b2e9bcb6d5b3a54df11438a4bd5d4860bb874f75b3e4a2ade`.
Publication approval belongs to root and is not granted by this report.

1. Verify all frozen input identities, original PPR2 scope, and current G01.
2. Materialize base plus effective prerequisites plus publication delta into a
   fresh physical tree without historical `out/` support or source symlinks.
3. Execute unchanged historical, recovery, compatibility, and shadow controls
   using the normal root configuration; retain every failure.
4. Check configured build, type, lint, formatting, and exact ignore behavior.
5. Preserve historical RED evidence and seal a delta-only publication manifest
   with separate prerequisite identities and explicit absent preimages.

No original audit payload, neighboring live author tree, provider request,
security research, production repair, test rewrite, or Git mutation is allowed.
The historical artifact-dependent alternate adjudication configuration is not
the normal test configuration; its separate scope must remain explicit.

## Results

**READY for the bounded fixture-packaging repair. Publication is not authorized.**
The missing-publication-fixture blocker is repaired without changing runtime
code, historical fixture bytes, assertions, or version markers. The two exact
formatter exceptions preserve existing implicit ignore behavior. Root approval
and actual publisher-main integration gates remain separate requirements.

### Immutable intake and scope

- All 294 manifest-listed files verify, plus the manifest itself: 295 immutable
  input files. The input SHA-256 matches the supplied pin.
- Actual base: `6e3733a0df3b764a5d87d5f19fe6142bfed905f1`, not the older integrated
  PPR2 base. No pull, branch, index mutation, commit, or push occurred in this
  independent review. Read-only Git object access materialized the pinned base.
- All original 22 PPR2 paths are checked against the separately pinned upstream
  author manifest
  `8aa982da2dab9b01da8f80c2035397143e1693c17ed64ab6a8f9247f37061826`.
  Twenty-one are byte-identical. The remaining path changes only the exact
  historical fixture lookup from the nonpublished `out/` location to
  `new URL(..., import.meta.url)` in the package fixture directory.
- The repaired publication contains 27 author paths. This independent Markdown
  report adds one: **28 PPR2 publication paths**. The 50 prerequisite paths remain
  separately identified, with five overlapping paths and 73 distinct combined
  paths after adding this report. Prerequisite postimages apply before PPR2;
  overlapping prerequisite bytes must not overwrite PPR2 afterward.
- The 27 author paths have eight actual-base file preimages and 19 explicit
  absent identities. The new report is also absent at the base. Ten ordered
  PPR2 preimages are separately preserved; actual-base absence is not confused
  with presence after prerequisite application.
- Current G01 `packages/safejs/src/interp/values.ts` remains
  `a453757823a826a5c533a5b13e44cdb2021783889e90601608bac932f5f3db86`.
  Historical NUM bytes
  `1e027e9c9c100b0849b7b8e4ab02b747181f63ce1383e9e467fecc37e76ad4a6`
  were not applied over G01. Effective prerequisite identities, not historical
  NUM postimages, drive this projection and the publication manifest.

### Physical publication-only projection

The independent tree is `.tmp/ppr2-independent-publication`, created from the
3,799 tracked base paths, then the exact 50 effective prerequisites, then the
27 PPR2 postimages. It has its own lockfile-based dependency installation and
68 internal workspace dependency links. No source or fixture links point into
another clone or an artifact directory. The base `CLAUDE.md` link only names
`AGENTS.md`. Neither historical artifacts nor the independent evidence directory
are mounted inside this tree.

The projection has **no `out/` directory**, before or after every runtime gate.
All 72 scoped postimages remain exact afterward; all 3,753 nonoverlaid base blobs
also remain exact after build and testing. Root configuration, setup, lockfile,
and hooks are therefore unchanged. This review does not rely on the author's
previous projection or its installed dependencies.

Static examination covers all 23 test modules in the combined publication
scope. Every direct relative import resolves inside the projection. None names
another clone or a SafeJS artifact root. The only file reads introduced by the
historical test resolve the two published package fixtures relative to its own
module URL. Actual default-root collection and execution confirm closure.

The unchanged alternate
`packages/safejs/test/ppr2-integration-adjudication.vitest.config.ts` remains an
explicitly historical, artifact-dependent ordered-preimage comparison tool.
It is not loaded by the default root configuration or these published unit
tests. This report does not claim that optional historical configuration can
run without its pinned archive. No alternate configuration, archive staging,
runtime test exclusion, or timeout override was used here.

### Fresh executed gates

All following results are from the independent physical projection, with
`TERM` unset. Test snapshot mode is playback/error. `SKIP_SYNC_SKILLS=1` avoids
home-directory skill synchronization; it does not bypass a validation gate.

- Historical package test: **40 pass** under the normal root configuration.
- Combined 38-file suite: **999 pass**, including PPR2 recovery/compatibility,
  all five fresh-version assertion sites, receiver-scoped ALS cleanup, AR,
  CBI, and the shadow supplement.
- Shadow supplement separately: **23 pass**.
- Default unfiltered root runtime, `./node_modules/.bin/vitest run`:
  **24,544 pass, 41 existing skips, zero failures**; 979 files pass and three
  are skipped. This is actual execution, not collection-only evidence.
- Full `npm run build`: exit 0, including workspace builds, schema generation,
  configured root compilation, and bundle generation. No force flag was used.
- Configured root and SafeJS type checks: exit 0.
- Introduced/scoped test compilation: **20 roots, zero diagnostics**, exit 0.
- Root ESLint: exit 0. Package rules: all 17 pass.
- Configured scoped Prettier check: exit 0 for all 71 formatter-supported
  composite paths, with only the two authorized fixture exceptions. The other
  69 paths are formatted; `.prettierignore` has no formatter parser and is
  checked as exact configuration text. The added independent report is checked
  separately before sealing.
- Strict whitespace: all 72 input paths pass; the independent report is checked
  separately. Neither fixture is falsely described as formatted.

The previous 24,060-pass full runtime record remains historical evidence, not
the source of this fresh 24,544-pass claim. Original held results are preserved,
not overwritten by new green results.

### Native recovery and genuine historical compatibility

The exact package source strings retain hashes
`21004b9bd197084cdfc54b678a69094d9fc2ca776710fd773f57c6bef753c1a8`
and `94f71537e4d19ff33a45cb950607c4e1eec1922276f15825166e4658cc64e9ff`.
Both execute natively with raw native Promise inputs, then through the built
publication-local SafeJS API. No caller wrapper, replacement Promise input,
private adapter, fabricated proof, or provider request is used.

Both native values/traces match the preserved native oracle; uninterrupted
SafeJS values/traces match the original ordered PPR2 baseline. The single case
returns `{ value: 7, sameHandle: true }`. Full output, typed identity graphs,
property descriptors, prototype identities, and untruncated inspected values
are retained. Serialized historical comparisons are explicitly separate from
the full typed comparison used between live execution and fresh restoration.

Eight independent Node children pass: two workflows, automatic/completed
captures, and parsed-object/JSON-round-trip forms. They import only the built
projection API and receive their newly captured input via stdin, without
replacement Promise inputs. They preserve complete return graphs, initial
inputs, replay metadata, Promise replay metadata, expected boundary effects,
unchanged input snapshots, and `jobs-v7` emissions. Providers are never called.

PPR1 remains separate: full native alias booleans are
`[true, true, true, true]`; PPR2 preserves
`[false, false, false, true]`. Input journal rows remain one for the single case
and five for the full case. This is not an alias-memoization repair.

Six genuine previously working v6 fixtures run in six fresh children, with
three continuations each: **18 generations**. Native controls return value 7.
Restoration preserves original data, trace, provider nonconsumption, and v6
emission throughout. The 40-case history test additionally exercises the
published 36 generation records and its unchanged interrupted continuations.

The two new package fixtures contain **four distinct ordered raw-v6 snapshots**.
All four are accepted and retain the exact original
`TypeError: Promise replay references work not created at this position.`
Each is independently executed in object and JSON forms: **eight fresh negative
children**, not eight distinct historical snapshots. Full error stacks are
retained; no version marker is relabeled, no input snapshot is mutated, and no
boundary/provider is consumed before the failure.

The prior independent eight-distinct-snapshot, two-cohort negative evidence
remains preserved and qualified in the unchanged historical integration report
and its pinned HOLD manifest. It is reused only for those additional historical
identities because production and conversion semantics are unchanged by this
packaging repair. Those additional archive-only snapshots were not smuggled
into this clean projection and are not claimed as freshly run here. The new
unchanged-workflow captures recover; historically broken raw-v6 recordings are
not retroactively repaired. There is no blanket v6 refusal.

### Expanded type scope remains qualified RED

The same 24 explicit roots are independently compiled against the ten exact
ordered preimages and against the candidate. The list includes the fifth
agent-harness test, historical packaging test, and shadow supplement.

Both yield **56 diagnostics**, with zero new or removed canonical signatures
and 112 retained source anchors. TypeScript is 5.9.3. The exact canonical
signature multiset hash still equals
`530fba17d9b4808edeb86e1a33f88431758174c6b2e449959eeb51fc3eaa0333`.
Full multiline diagnostic messages, source spans, duplicate multiplicities,
numeric categories, line/column positions, and source hashes are preserved.
Preimages are supplied through an in-memory compiler host, not source rewrites.

The expanded check exits **2** and is **not a passing type gate**. Readiness is
qualified by the authorized identical-baseline scope, alongside genuinely clean
configured and introduced-root gates. No unrelated type repair or diagnostic
suppression was made.

### Exact formatter exception and hook preservation

The base has no `.prettierignore`; its preimage is absent, not an empty-file
hash. The authorized postimage is
`ef9b8964fc0ceeb91f53a1e0ddf10dd3e0a41c948ed4b866a0ac3abe17bb904b`.
Its only active entries are:

```text
/packages/safejs/test/fixtures/ppr2-integration-history/ordered-original-red.json
/packages/safejs/test/fixtures/ppr2-integration-history/ordered-v6-generations.json
```

The fixture SHA-256 values remain respectively
`a9feba99d6e0f02d631f8b38c4e027beaa30d7d240b0f8666edbb3ada26bed62`
and `d72a81042ddabc34835079e7d9e8aa53c058390ae9860fdbbe1d0051a01533ae`.

The installed Prettier CLI's default ignore list includes both `.gitignore`
and `.prettierignore`; the latter does not replace the former. Independent
classification of 3,839 base/publication/probe paths changes exactly these two
fixtures and loses **zero implicit ignores**. Seventeen actual CLI
`--file-info` checks confirm default discovery, including Git/dependency/build
ignores, adjacent names, suffixed filenames, and a same-suffix nested path.

Normal scoped formatting passes without `--ignore-path`. A separate retained
negative probe selecting only `.gitignore` still exits 1 for precisely the two
byte-exact fixtures. It is a diagnostic control, not a bypass used for a green
gate. `.husky/pre-commit` remains exactly
`npm run lint:eslint && npm run lint:types`; both commands pass independently.
No hook is invoked through a Git operation or disabled, and no configuration
outside the authorized new ignore file changes.

If publisher main acquires an ignore file before integration, the absent
preimage guard must fail rather than overwrite it. Root must preserve existing
entries and integrate only these two anchored exceptions, then rerun gates.

### Preservation, artifacts, and limits

The earlier fixture-format HOLD
`8aff9fe524dd9e85b27198c99d7076124468a1bef7ebe452f4c5c8a5ee96af61`
and independent publication-closure HOLD
`5284fa0766e3435d35d44cdaa7caf5c218fa7464eb51ecdf6cc6dcca4f5f2cdf`
remain immutable. The original integration HOLD report is included unchanged,
not retroactively rewritten to say READY. This report supersedes only the
packaging blocker after the authorized repair and fresh checks.

New evidence is under `out/safejs-ppr2-packaging-independent/`, including raw
command logs, full outputs, all native/fresh child observations, base and
projection identities, ignore probes, exact type comparisons, and preserved
tooling incidents. An initial own-copy immutable-flag collision, a shell
wrapper variable error, and a restricted Node-REPL import error were repaired
only in validation machinery. None was hidden by changing an assertion or a
candidate file. The initial installation log is retained; no vulnerability
research or dependency remediation was performed.

The final delta-only publication manifest is
`out/safejs-ppr2-packaging-independent/publication/manifest.json`. It inventories
all 28 publishables, their eight actual-base preimages and 20 absent identities,
the ten ordered preimages, the prior lookup bytes, all 50 separate effective
prerequisites with base guards, and supporting evidence. The manifest records
its exact captured file count; its SHA-256 is supplied in the handoff.

No original audit payload is read; the original 38 exclusions and entire
`security/` remain outside this review. No source/test assertion is rewritten,
no executable QA runner is published, and no racing neighboring clone is read.
There is no visual CLI behavior change, so no new screenshot claim is made.
Root still owns publication authorization and actual-main checks.
