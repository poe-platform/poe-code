# DOCX Office CLI verification — 2026-09-16

Verified the existing implementation with the [owned agent procedure](../plans/docx-office-cli-verification-20260916.md)
and [shared QA](../plans/office-cli-qa.md). Baseline: `f140f50cd` on main.
[Exact commands and outputs](office-cli-verification-20260916/commands.json)
and [contract/audit hashes](office-cli-verification-20260916/contracts.json)
are retained. Only Q33 diagnostic recovery changes product code.

## Fresh bounded observations

Original SDK-created inputs use an explicit `/work` MemoryFileSystem, fixed
`2026-01-02T03:04:05Z`, scoped archive limits and owned byte streams. The DOCX
five-build closure is fresh; the unchanged Shell adapter uses existing output.
No publisher inputs/binaries were acquired or cleaned up. Development tools
read source and write evidence/screenshots; document/media I/O has no host access.

- Q03 aliases agree. Q04 replaces three matches across styled split runs and a
  hyperlink; reopened text is `Final coastal café Final Final link`. Bold stays
  true, hyperlink target stays `https://example.invalid/harbor`, and header stays
  `Draft header`. Only `word/document.xml` changes among all seven admitted parts.
  This supplements the earlier receipt's unrun hyperlink variant; its original
  fixture and receipt remain historical. Q05 changes only the second match.
- Q11/Q12 logical B2 works; reopened cell is `Harbor 🌊`. Human dry-run reports one
  changed selection without requiring JSON. Q15 stores typed boolean false;
  missing custom type returns usage 2 with the previously fixed nested help.
- Q18 file/inline batches are byte-identical; unknown argument rejects usage 2.
  Q19/Q20 equal/different comparisons return 0/1 with successful JSON data.
  Q21/Q22 expose conservative capabilities. Q27's actual create-to-text pipe
  succeeds; cancellation/transport variants are not run.
- Q28 proposed stdout plus JSON dry-run succeeds. Q32 rejects an original B2
  token on the committed cell revision with stale-selection 1 and fresh-inspection
  guidance. The ordered fresh-token retry is covered only by the prior receipt.
- Q36 root help aliases agree, common tasks precede the complete direct register.
  Q37/Q42 expose image/cell selection and publication rules. Q38/Q49 schemas and
  Q39 version work. Q40 missing comparison input returns trouble 2. Q41 rejects
  singular image with plural recovery. Q43 rejects before image acquisition and
  exposes token/ordinal/help guidance. Q47 unknown scope rejects usage 2 with
  nested help. Q48 lowered XML depth returns limit 4.

Every inspected JSON probe has exactly the eight shared envelope fields. Reads
and failed prepublication mutations have zero affected; ordinary failures have
null data. Source fingerprint is retained after probes; part comparisons and
exact bytes/hashes are recorded. These are finite semantic checks, not exhaustive
schema/capability or per-operation SDK certification.

## Q33 correction and verification

The new original memfs human/JSON tests failed before code, after status,
input preservation and envelope checks passed. Retained [red log](office-cli-verification-20260916/red.log)
shows missing flag/help guidance. Recovery now advises reviewing `--find`,
`--scope` and selection, consulting `docx help text replace`, and using
`--allow-empty` only for an intended no-match result. No private text is exposed.
Exit 1, null data, zero effects and empty locations are unchanged.

[Focused green](office-cli-verification-20260916/focused-green.log): four files,
44 tests passed. One supplied optional filename had no matching test file; it
adds no coverage. Baseline maintained DOCX tests passed 224 files/4,965 tests.
Final maintained `npm test --workspace=docx` passed 225 files/4,967 tests, with
no skipped tests ([unit log](office-cli-verification-20260916/unit-green.log)).
Scoped `npm run lint --workspace=docx` passed with the existing type-only-variable
warning ([lint log](office-cli-verification-20260916/lint.log)). The selected
`npm run build:workspaces -- --workspace=docx` closure passed all five builds,
including maintained postbuild export smoke checks ([build log](office-cli-verification-20260916/build.log)).
No full repository, schema witness, Shell-adapter rebuild or counterpart suite
was run; these do not become passes through the focused DOCX checks.
[Fresh-process built output](office-cli-verification-20260916/fresh-built.json)
confirms the new message at exit 1 with the original failure envelope. An initial
manual probe omitted required engine options and threw during setup; it is no
product defect or pass. The corrected invocation supplies explicit limits.

Inspected maintained `terminal-png` screenshots under disposable
`screenshots/docx-office-verification-20260916`: root/image/cell help, successful
human cell edit, stale selection, schema error, missing image selection, semantic
usage and Q33 before/after. The root `screenshot-poe-code` route does not expose
virtual DOCX; the same maintained renderer is used directly on built output.
No fake host wrapper or screenshot suite was added. The renderer does not emulate
an 80-column terminal; long JSON/token lines remain wide. The wave emoji renders
as a missing glyph while original UTF-8 output and reopened cell value are correct.
No font-fidelity or document-rendering pass is claimed.

## Prior evidence and exact mappings

Read both complete inventories: 920 API records, 262 enum values, 11 enum aliases,
23 documentation resolutions, 1,609 unit variants and 650 BDD cases. They remain
historical research denominators. Public inherited members, helpers, collections,
returned underscore-prefixed types and APIs without source tests remain in scope.
The whole-API register still says `partial-acceptance-blocked`; structural presence
of 1,337 rows is not passing behavior coverage.

The earlier diagnostic fixes `976cd35e4` and `468efe7bc` contain focused tests and
recorded red/green procedures. Current tests and fresh built Q43/Q15 outputs
confirm their effects. Their original failing diagnostic logs are not retained
in the linked receipt; chronological red execution is a recorded claim, not a
fresh independently observed run. Actual retained table-command red/green logs
were inspected: original failures concerned invalid slice types and stale table
receivers, followed by 14 focused passes. No historical source/runtime rerun,
reversion or rewritten inventory was used.

Shared CLI names stay plural; preserving text replace differs from destructive
setters. Model methods retain neutral snake_case; utility SDK options use
camelCase and CLI flags kebab-case. Admission/save/image input is always async;
admitted model access is synchronous. Model sequences use zero-based positions,
length/iteration and declared at/slice profiles; keyed collections keep keys,
get/at/items. CLI ordinals are one-based within the owner.

Null/false/zero/empty stay distinct. Lengths use safe integer EMUs: 914400/in,
360000/cm, 36000/mm, 12700/pt, 635/twip, rounding once halfway away from zero.
Dates are copied UTC instants serialized at whole seconds. Byte copies preserve
ownership; DPI fallback is 72 per axis. Compatibility SHA-1 differs from evidence
SHA-256. Live owner-bound XML/package views use validated mutations and deterministic
invalidation; they grant no evaluation, dynamic invocation, host or network
access. CLI reads use noncreating queries. These are contract mappings, not newly
exhaustive tests of each rule.

## Remaining gaps

This fresh run does not repeat Q01/Q02, Q06–Q10, Q13/Q14/Q16/Q17, Q23–Q26,
Q29–Q31, Q34/Q35 or Q44–Q46. Their prior bounded observations remain in the
[earlier receipt](office-cli-execution-20260916.md); additional variants are not
promoted. No PPTX counterpart is run. Cancellation, injected I/O/publication,
transactions/collisions, ambiguous/repeated/nested templates, shared header images,
exhaustive SDK/model acceptance, large/corpus qualification and native rendering
remain unrun here.

Image help still contains utility-era prose claiming live image-part/drawing/
collection models and live batches remain pending; current exported owners and
schema overlays supersede that prose for their supported subsets. This is a
visible documentation gap, not grounds to hide public APIs or claim full coverage.
Other whole-API gaps remain in [resumption evidence](whole-api-resumption.md):
numbering construction, nullable typed paragraph alignment, Paragraph.element
getter schema, save sink/VFS forms and context mapping. No scope expansion into
those implementation tasks occurs. No README, push or release.
