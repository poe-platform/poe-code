# Modern comment CLI verification

Scope: original memory-only fixtures through public `pptx` SDK exports and the
safe-bash command adapter. No adapter implementation change is needed. The only
existing integration-file edit adds the exact discovery assertion for
`tests/commands/pptx/modern-comments.test.ts`.

The test constructs a slide with independently authored legacy and modern review
parts, two modern identities, one reply, one reaction, an opaque mention and an
unknown association. It checks original expected values in addition to SDK/CLI
agreement and validates the advertised JSON result schema. Slide rename and
legacy comment edits must preserve modern part and association bytes. Modern
identity mutation must fail before publication for ordinary, signed and protected
packages; reads must continue to expose both comment families.

The pinned inventories and audits under `docs/pptx` were consulted. Their comment
property rows describe core metadata, not threaded comments; this suite adds
format-contract evidence, with no imported upstream assets or test wording and
no claim to close the whole public API or upstream suite.

## Checks and manual QA procedure

1. Build only the explicitly selected `pptx` workspace dependency closure with
   the maintained workspace build route after the implementation owner is ready.
2. Run `node --import tsx --test
   packages/safe-bash/tests/commands/pptx/modern-comments.test.ts` and the existing
   comments suite. Run maintained integration-input discovery verification.
3. Capture an actual comments help/read/error display using terminal-png with an
   explicit Node entry point, avoiding the root screenshot command's predev
   pipeline. Put the disposable PNG under `.cache` and inspect it visually.
4. Stage only the owned test, this plan, and the single registration assertion.
   Root coordinates atomic commits; this worker neither commits nor pushes.

Initial TDD evidence: the original compiled API returned only one legacy comment
where the four inventory checks independently require two. The preservation
check already passed; it does not establish modern semantic reading.

An additional original regression reduces a corpus finding reported by the root
agent: an author registry may exist without any threads. Both SDK and CLI must
return the identities without inventing comments. The baseline CLI lacked the
`authors` result field. The test does not read corpus bytes or require downloads.

The maintained integration-input test `default normal runner passes every
discovered active file to serial Node execution` passed with the exact added
registration (1 selected test, 1096 discovered active files). This is discovery
evidence, not a claim to have executed all discovered suites.

`npm run test:runner --workspace=virtual-bash` passed all 499 maintained runner,
integration-input, build-guard, asset-copy and historical-type-model tests in
20.7 seconds.

After the root agent's maintained selected `pptx` build, the new six-case suite
and existing two-case comments suite passed together: 8/8, no skips, 1.38 seconds.
This exercises public compiled SDK imports and the actual safe-bash adapter.
The inventory case also retrieves a reply independently by ID in both surfaces.

Captured actual safe-bash `pptx comments get --help` output with terminal-png in
`.cache/pptx-modern-comments-qa/comments-help.png`, then opened the PNG for visual
inspection. Text is legible, complete and unclipped; the display uses generic
`--id ID` and explains modern read-only inventory and opaque extensions. This
fixed the observed help drift without running the root predev pipeline. The PNG
is disposable QA output and must not be committed.
