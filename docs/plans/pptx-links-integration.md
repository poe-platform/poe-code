# Hyperlink integration and local delivery

Scope: `docs/specs/pptx.md` F47 and shared Office CLI/SDK contracts. Implement
ordinary hyperlinks and supported slide navigation, preserve unsupported action
data on reads, and report explicit sanitization requirements. Do not execute the
whole pipeline, publish, push, edit README files, or stage disposable fixtures.

Ownership follows the scoped safe-bash delegation rule: domain worker owns link
semantics and slide transfer/removal regressions; command worker owns command
schema, adapter coverage and registration; accounting worker owns original-case
receipts, language/security mappings and disposable corpus QA. Integration owns
public exports, final review, maintained checks and atomic local commits.

Existing edits in the public export file, command engine and integration test
registration belong to other work. Stage only this task's changes in those files.
Preserve all other working-tree and index content.

Verification procedure:

1. Capture original failing tests before implementation. Assert serialized XML
   with independent parsers and verify both SDK and virtual-shell effects.
2. Check owner-local relationships, qualified attributes, click/hover and run
   scope, external and relative URLs, removed slide targets, custom shows,
   unsupported actions, relationship reuse and safe merging.
3. Reconcile every relevant parameter/BDD/API row with explicit evidence or an
   honestly described mapping limitation. Required notices remain standalone.
4. Run maintained `pptx` lint and tests and its selected workspace build closure;
   run exact safe-bash command tests and registration/type checks as applicable.
5. Capture and inspect actual command help using the maintained screenshot tool.
   The command is injected into safe-bash, so use its generic command capture
   route rather than inventing a root poe-code subcommand.
6. Review staged files and atomic dependency boundaries; commit on main using
   Conventional Commits. Record local hashes separately from remote delivery.

## Final checks and local delivery

- `npm run build:workspaces -- --workspace=pptx` passed its three declared
  dependency/workspace build tasks.
- `npm test --workspace=pptx` passed 154 files / 4,061 tests on the frozen final
  source (54.35 seconds). Earlier development runs caught the newly added
  cancellation, namespace-shadowing and misplaced-hover regressions before their
  fixes; they are not reported as passes.
- `npm run lint --workspace=pptx` passed ESLint and source/test TypeScript checks.
- The exact safe-bash link suite passed 2/2 against the final built package.
  Its registration suite passed 107/107. Maintained virtual-bash typecheck passed
  source/tests and 26 current consumer groups, including expected negative cases.
- The built public `pptx` SDK passed an in-memory URL-to-slide assignment/save
  workflow through `LinkShape`, enum identity and literal target inspection.
- Independent receipt verification matched all 144 unique source-test pointers
  exactly to the supplied inventory and checked 50 unique API identities.
- Actual command help was captured and visually inspected at
  `.cache/pptx-links-help.png`; it is not staged.

Local domain commit: `1ef32904f`. Local model/accounting commit: `336c6b627`.
The command integration commit carries this final receipt. All commits are on
main. No push, remote-main delivery or release was attempted. Existing unrelated
changes remain outside these commits; shared-file staging includes only owned
task hunks. No ignored QA fixtures, README edits or new license material were
included; the existing standalone required notices remain intact.

The bounded session model is implemented; integration with every older isolated
shape/text class is still an explicit API-ledger gap. Whole Presentation-model
parity and rendering fidelity are not claimed.

## Independent review findings

Review identified the distinct hover element names required by character and
shape properties: text `rPr`/`defRPr`/`endParaRPr` use `a:hlinkMouseOver`, while
shape `cNvPr` uses `a:hlinkHover`. The vendor's
[text hover reference](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.hyperlinkonmouseover?view=openxml-3.0.1)
and [shape hover reference](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.hyperlinkonhover?view=openxml-3.0.1)
document the respective parents. Original regressions must verify these names
independently, retain click/hover siblings and place run hyperlinks before `rtl`
and extension children. Lifecycle guards must recognize supported mouse-over
references rather than skipping their action semantics.

## Disposable corpus observations

The manifest entry `.cache/pptx-corpus/CERN-job-opp-250925.pptx` was admitted
after verifying its recorded SHA-256. Its four slides contain seven link nodes
by independent namespace-aware SAX inspection; `listLinks` reported seven URL
records and left the input bytes unchanged. Changing the first run link to the
original relative target `../guide.html#chapter` retained seven links, changed
only the owning slide and its relationship part, and left the input unchanged.
All output remained in memory; no corpus fixture or derivative is shipped.
This verifies bounded package behavior, not rendering or link activation.

The manifest entry `.cache/pptx-corpus/global-outlook-2026.pptx` was likewise
SHA-256 verified. Its 14 slides contain 24 link nodes by independent SAX
inspection; the SDK returned 24 URL records without changing input bytes.
The explicitly supplied QA ceilings were 16 MB input/member/XML, 64 MB total
expanded bytes, 1,000 members/parts, 100,000 XML nodes, XML depth 128 and
10,000 relationships. No network or renderer was used.
