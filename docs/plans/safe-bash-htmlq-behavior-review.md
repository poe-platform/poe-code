# htmlq behavior increment review

The implementation remains in the private `safe-bash-command-htmlq` workspace.
Safe-bash only exports/composes its public APIs. No publication is authorized.
The package-pattern document has moved to
`docs/plans/archive/safe-bash-command-package-pattern.md`; the archived contract
was used without restoring the unrelated deletion/move.

## Reviewed increments and evidence

1. Six failing behavior edge-case tests initially could not import the absent
   `selectHtml`/`htmlqBytes` APIs. Added bounded selector compilation and live
   matching, attribute/text/HTML projections, inclusive first-match removals,
   selected-link URL rewriting and stateful pretty serialization.
2. Four failing command tests initially could not import the absent command/SDK
   APIs. Added opt-in `htmlqCommands`, `createHtmlqCommand`, `htmlqCommand` and
   `htmlq(context, { argv?, limits? })`. The same parser/projection runs behind
   CLI and SDK; filenames are literal VFS paths, not host files.
3. Two failing controls exposed permissive nth/identifier parsing and missing
   decoded-byte accounting. Corrected token boundaries and added explicit
   UTF-16 `decodedBytes` accounting. All behavior stages share a cumulative
   invocation ledger rather than resetting per result.
4. A failing exhausted-budget control exposed unaccounted diagnostics. Results
   now retain structured errors and accounting even when insufficient budget
   remains for the bounded code-only diagnostic.
5. A failing parent-budget control exposed missing shell input-budget checks;
   a failing consumer-close control exposed uncancelled pending reads. Parent
   input ceilings now apply before parser admission, and owned output consumer
   cancellation forwards to the invocation signal and awaits source cleanup.
6. Re-inspected the checksum-verified selectors 0.22.0 archive **in memory**.
   `parse_negation` accepts exactly one simple selector, not a compound,
   combinator or list; nth coefficients are i32. A new failing control exposed
   accidental broader negation/integer acceptance and the parser was repaired.
   No upstream source was adopted or added as a dependency.
7. A failing command source control showed that the shared byte-reader wrapper
   rejected cross-realm Uint8Array and discarded cancellation cleanup errors.
   The command now leaves read cancellation and awaited cleanup with the engine,
   using only an iterator observer for parent input-budget checks. Both controls
   pass, including a falsey cleanup failure.
8. A failing late-read control showed that a pending producer could invoke the
   parent budget after invocation cleanup. The observer checks invocation state
   immediately after awaiting next, before invoking any parent capability.

The 40 independent literal acceptance rows A01–A40 each have a separately named
memory-byte-stream test. Every row passes implementation comparison. Existing
S/R research labels retain their meaning: implementation comparison does not
claim a new independent native replay of all exact fixtures.

| Cells | Implementation evidence | Qualification |
| --- | --- | --- |
| A01–A04 | wrappers/default, empty success, result LF, tree-order deduplication | fixture pass |
| A05–A12 | precedence, requested attribute order/missing/empty rules, text and escaping | fixture pass |
| A13–A17 | inert raw content and independent template selection/text/serialization | fixture pass |
| A18–A23 | all three lazy mutation controls, inclusive root removal, comma-joined first match, ignored invalid removal | fixture pass |
| A24–A31 | selected-link rewrite, first base/fallback, invalid explicit base, descendant isolation, slash special case, invalid join, inert javascript URL | fixture pass |
| A32–A35 | leading block LF, pre whitespace omission, Rust whitespace, CR/NUL/entities | fixture pass |
| A36–A40 | false browser state, attribute i/s, empty href links, context-free root scope | fixture pass |

## Open cells and intentional limits

- Full HTML5 insertion-mode/recovery parity remains open;
  `htmlqBaseline.fullHtml5Parity` remains false.
- Complete selectors 0.22.0 lexical grammar, CSS comments, every namespace
  attribute form and HTML default attribute case-sensitivity remain open.
  Verified modern `:is/:where/:has/:lang`, nested or nonsimple `:not`, named
  namespace prefixes and pseudo-elements are explicitly rejected.
- Rust url 2.5.8 complete normalization/join parity remains open. WHATWG `URL`
  is used as an inert first-party platform capability only for the enumerated
  controls; this is no URL grammar parity claim and performs no network I/O.
- Every pretty writer state and direct doctype/processing-instruction node
  control remains open. No browser display calculation is used.
- Full Clap lexical/help/version parity (including grouped short flags) remains
  open. Enumerated full short/long options and long `=VALUE` forms work; unknown
  options, singular `--attribute`, abbreviations and extra operands fail.
- Arbitrary external producers/providers must honor the explicit signal and
  settle cleanup promptly. No wrapper can force a noncooperative capability to
  stop or make its cleanup promise settle.

Explicit VFS output uses atomic conditional streaming publication or bounded
spooling followed by atomic conditional byte mutation. It refuses symlinks or
missing atomic capabilities. It consumes the projection privately
before commit, so failed projections preserve the previous destination,
including same input/output. stdout remains a stream and can expose an admitted
prefix before failure. Code-only diagnostics consume work/retention/output
budgets; if admission fails, only the structured error is returned. Source,
sink, cancellation and cleanup failures remain observable.

Input and UTF-16 decoded bytes, conservative cumulative allocation admission,
output bytes and algorithm work are counted separately. Depth and token storage
report high-water bounds; node/attribute creation is cumulative. Parser,
selector, ancestor/sibling walks, removal, rewriting and projections share the
invocation ledger. Standalone engine operations retain independent budgets.
Limit overrides can only lower command host ceilings. This is conservative
admission accounting, not measured live heap accounting.

No commit, push, release or private-package publication was performed.

A further failing long-ID matcher control exposed missing comparison work and
selector AST string admission. Those strings and comparisons are now counted;
ASCII folding and class word matching avoid temporary character arrays. All
113 focused package tests pass after the byte-only VFS increment. Repository lint and package
lint passed. A full-test run exposed an omitted existing soffice workspace root
declaration; adding that first-party devDependency and matching lock metadata
made the dependency-wiring control pass. The five-second browser fixture timeout
passed unchanged in targeted replay. A later DOCX bookmark timeout passed unchanged
both individually and in its complete 22-test file; the full route is being
verified separately.

The subsequent maintained full route passed all 17 shared batches, safe-bash
and the private command tasks, then reported SafeJS camera and interpreter
failures. Replaying both complete files passed all 477 interpreter cases but
timed out in a different camera sample (adjacent samples ordinarily took 1–2
seconds). Camera timing instability remains unresolved; this is not a full-suite
pass. No assertions/deadlines were weakened and no speculative SafeJS repair
was made. The route exited 1 with exactly three SafeJS timeouts: camera,
million-element iteration-budget and contextual class-binding replay; SafeJS
reported 31,118 passes and 48 skips. Remaining native tasks and root posttest did
not run after that failed workspace. The complete class-binding file passed
unchanged (10 tests, 898 ms). After the broad run finished, the complete camera
file passed unchanged (18 tests, 16.875 seconds total; each interpreter sample
about 1.1 seconds). All three failed files therefore passed complete focused
replays, but the full maintained route remains failed and timing instability is
not repaired. Passing replays do not replace the broad gate.

A failing atomic byte-write VFS control reproduced explicit output failure with
the public memory filesystem. Bounded spooling now supports its existing
`atomicFileMutation`/`writeFileConditional` capability while retaining conditional
commit and destination preservation. No unconditional write fallback was added.

Latest generated artifacts passed the outside-checkout runtime fixtures under
Node and Node-hosted browser/workerd conditions, including CLI/SDK equivalence,
canonical ownership and same-file output. Strict NodeNext declarations passed.
Only public artifact copies and their existing published dependencies were
provisioned offline; no private workspace was installed. An adhoc screenshot of
text, attribute and pretty queries was captured and visually inspected.
Package lint/typecheck and all 113 htmlq tests passed on the final code.
`git diff --check` passed. Task-owned generated artifacts, screenshot and
outside-checkout consumer were purged after recording these results.

## September 21 follow-up review

A new failing memory-only argument-parser test reproduced a token admission
gap: separate option values (`-f`, `-o`, `-b`, `-a`, `-r` and their full long
spellings) bypassed `tokenBytes` in the source-only API. Command execution
already checked every operand while taking its owned snapshot. The shared
parser now bounds each value before retaining it, keeping source-only and
command admission consistent. The test also verifies acceptance at the exact
UTF-16 token ceiling. This is a one-check repair, with no new abstraction.

Current verification passed all 114 htmlq tests, package lint and source/test
typechecks, 225 focused packaging/publication tests, the maintained selected
safe-bash workspace build closure and `git diff --check`. Freshly generated
public artifacts passed the htmlq runtime fixture outside the checkout with no
private package installed, plus strict NodeNext consumer declarations. Node and
Node-hosted browser/workerd conditions passed canonical identity, CLI/SDK
equivalence, live mutation and atomic same-file output controls. These are
hosted condition checks, not independent browser or workerd engine runs.
Temporary artifacts and the external consumer were removed after verification.

The task review found no additional host I/O, executable/network fallback,
proxy-only helper or test-supported simplification in the inspected htmlq
runtime closure. Command I/O remains on the explicitly supplied VFS; output
publication remains conditional and atomic. Existing tests cover cancellation,
source/sink cleanup, falsey failures, foreign-realm bytes, ownership and limits.
No claim is made that those controls establish arbitrary hostile-host isolation.

A01–A40 remain passing fixture comparisons. The open HTML5, complete selector,
URL, pretty-writer and Clap qualifications listed above remain open; this review
does not close them or resolve the previously recorded broad-suite SafeJS
timing failures. Those unresolved gates block a claim of full compatibility or
overall task completion. No commit, push, release or publication was performed.

## Selector escape increment

Candidate: HEAD `ab1fa8d34101e1e7f61272973f3bc28a842043d8` plus the
pre-existing working tree and this focused increment. Selector source SHA256:
`9baa9f8824fd8c969a870cd84e87e2bc4e9f5d09fd47ad673e0740c68dbf6306`.
Independent `selector-escapes.test.ts` SHA256:
`a6da4493863dee3e5e3e3ad6781231792fe4578b3a10153259f155f343fdbe22`.

Three failing memory-stream tests reproduced CRLF continuation rejection,
incorrect CRLF hex-escape termination and literal/escaped NUL mismatch in CSS
identifiers and strings. Expectations were independently checked against the
checksum-verified cssparser 0.27.2 tokenizer source archive specified by the
research pin. The archive was read in memory for development research only;
no source was adopted and no runtime dependency was added. CRLF now consumes
both characters as one escaped newline/terminator; literal and escaped NUL
become U+FFFD. Scanning retains work/cancellation accounting and allocation
admission. Negative controls retain rejection of unescaped quoted newlines and
escaped identifier newlines. Token admission and cancellation controls pass.
Command/SDK controls compare output bytes, diagnostic bytes and exit status.

Fresh verification for this increment:

- All 120 htmlq unit tests passed; no failures or skips.
- Package lint and source/test typechecks passed.
- The maintained selected safe-bash build closure passed, including postbuild.
- Public tarballs installed offline outside the checkout without any private
  command/contracts package. The maintained htmlq runtime fixture and new CRLF/NUL
  controls passed in Node and Node-hosted browser/workerd conditions. Strict
  NodeNext declarations passed. Artifact generation retained unpublished-import
  checks. No publication was performed.
- Markdown manual QA was executed for this focused increment; an adhoc CLI
  screenshot of text, attribute and pretty output was visually inspected.
- `git diff --check` passed. Temporary logs, consumer, tarballs and screenshot
  were purged. Literal `/out` is read-only; temporary evidence used task-specific
  `out` directories in/beside the checkout.

Only these enumerated escape cells close. Full HTML5/selector grammar, Rust URL
normalization, every pretty writer state and full Clap lexical parity remain
open. Actual browser/workerd engines and independent native replay of these new
fixtures were not run. No broad gate was rerun for this package-only repair;
earlier broad-suite timing failures remain unresolved and are not replaced by
focused passes. Local commits, verified remote-main delivery and successful
releases: none.
