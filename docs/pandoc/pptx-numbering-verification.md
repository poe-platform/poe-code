# PPTX numbering verification

Date: 2026-09-16. Task remains open for presentation-application QA.

The separate presentation engine public byte APIs are present; the converter
already implements the bounded reader/writer profile in `packages/pandoc` with
a thin safe-bash SDK adapter. No replacement PresentationML/ZIP implementation
or native runtime fallback was added. Root instructions were read; no scoped
AGENTS.md exists under packages/pandoc, packages/pptx or docs. Unrelated workspace
changes were preserved.

Original tests failed before implementation: 3 failures and 21 passes in
`pptx-numbering-red.log`. The fixes preserve explicit adjacent numbering
restarts, reject unsupported writer delimiters and diagnose unsupported source
schemes when lossy extraction is selected. The independent ZIP/Saxes inspector
asserts original slide text/order and decimal-period marker starts 3 and 1.
All fixtures are original bytes; unit mutations remain in memfs. No external
executable, downloaded fixture, LLM or host scratch file is used in unit tests.

Maintained scope checks passed:

- `npm test --workspace=@poe-code/pandoc`: 47 files, 1,066 tests.
- `npm run lint --workspace=@poe-code/pandoc`: ESLint, source/test TypeScript.
- `npm run build:workspaces -- --workspace=@poe-code/pandoc`: five dependency
  closure builds, derived from maintained workspace declarations.
- Conversion suite: 24 tests, including the final independent marker assertion
  in the final workspace run (`pptx-numbering-workspace-test-final.log`).

Logs use the `pptx-numbering-` prefix, with build output in
`pptx-current-build.log`. These checks establish a current focused gate, not a
full repository gate or application interoperability pass.

The initial independent marker assertion compared every attribute and failed
on an additional XML namespace declaration (`pptx-numbering-inspector-assertion.log`).
It now selects the semantic `type` and `startAt` attributes, retaining exact
assertions on both markers. This was an inspector assertion correction, not a
product numbering failure or a waived test.

An original deck was generated through the built public converter SDK as
`pptx-qa-numbering.pptx`. The inspected adjacent PNG was produced by macOS Quick
Look (`qlmanage -t -s 1600`). Title/body, slide ratio and label order render;
however both numbering markers display 1 although the independently inspected
XML starts are 3 and 1. Marker spacing is tight. Quick Look is not sufficient
evidence of correct rendered numbering in a presentation application. No
measured text-fit claim is made.

`pptx-application-open-current.json` records the actual LibreOffice attempt:
the macOS open request returned success, but application-process GUI inspection
timed out after 15 seconds. No application/version, repair-warning check, notes
GUI check or application-open signoff could be verified. An additional
window-list probe also failed to return an inspectable array; its actual error
is recorded in `pptx-application-windows-current.json`. It is not a QA pass.
The remaining QA
procedure is in `docs/plans/pandoc-pptx-conversion.md`; this task is not complete.
No push or release was performed.
