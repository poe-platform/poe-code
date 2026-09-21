# Current hidden analysis protocol QA

Do not push, publish, edit README files, or use native utilities in product/unit code.
Preserve the existing implementation and historical QA reports.

1. Hash `out/ssconvert-lifecycle/gnumeric-1.12.61.tar.xz` against the requested
   SHA-256. Authenticate the source files listed in the retained profile against
   both archive members and extracted source. Read `run_tool_test` and
   `parse_property_based_options` and the tool setters.
2. Execute the separately installed colima statistics QA oracle with its captured
   C locale/plugin/dependency profile. Use original XML with 256-column Small and
   512-column Large sheets and two values at IW1:IW2. Compare selection of Large
   against Small as a negative control. Retain exact input, argv, status and channels.
   Version 14 and the standard gnm prefix are necessary for this fixture; record
   rejected intermediate fixture measurements separately.
3. Reproduce the selected-sheet bound defect with a failing memfs/shared-engine
   regression before changing preparation. Verify the corrected positive and
   negative native outputs through both actual CLI and SDK with the real XML/CSV
   codecs. No unit test reads native captures or runs native tools.
4. Assign an independent agent to stress/fix the implemented analysis runner.
   Root retains integration, exports and Git. Require failing regressions and
   source evidence for each repair; execute its separate Markdown procedure.
5. Run fresh maintained ssconvert build closure, package test and lint routes.
   Run the Safe Bash virtual-command cohort for shared bytes, failures and replay.
   Inspect a screenshot of actual shared CLI diagnostics and CSV output using
   injected byte I/O. Record any failed or incomplete gate separately.
6. Seal the final owned source/tests and QA results in a permanent receipt.
   Purge temporary owned logs and screenshot artifacts after reduction. Preserve
   the existing upstream archive, source and oracle container.

## Results

The requested archive SHA-256 and all 41 listed source members were verified
against extracted bytes and the retained profile. Oracle executable and linked
Gnumeric/goffice library hashes still match that profile. The product catalog
matches all 31 captured tools and 154 writable properties/defaults/enums/bounds.
This inventories the profile; it does not measure every setter transition.

The selected-sheet regression failed before the preparation fix. The independent
agent reproduced missing italic headings and incorrect output-size rejection
before repairing the runner. Native positive/negative selection cases, 128-cell
clipping and italic headings with formulas retained/materialized passed. Original
fixtures, exact argv/status/channels and reversible native output are reduced in
`docs/ssconvert/analysis-tool-protocol-current.json`.

Fresh maintained `npm run build:workspaces -- --workspace=@poe-code/ssconvert
--no-cache`, `npm test --workspace=@poe-code/ssconvert`, and `npm run lint
--workspace=@poe-code/ssconvert` passed. The final package run passed 5,918 tests
in 291 files; lint includes source ESLint and production/test TypeScript. The
native workspace package test route invokes fresh Vitest without a task cache.
The Safe Bash virtual-command cohort passed all 66 tests with no skips. After
sealing 559 source/test/helper files, independent fresh analysis and Safe Bash
cohorts passed 42 and 66 tests respectively, and the seal remained unchanged.
The inspected final screenshot shows real CLI warning/failure ordering followed
by labeled CSV values. No timeout or test assertion was weakened.

Investigated failures: an attempted direct workspace-runner API invocation was
rejected because the maintained runner requires npm lifecycle ownership; it was
not a completed gate. Two native fixture attempts used ignored XML dimensions
or omitted the required Version-14 SheetNameIndex; their output was not counted
as parity. Initial screenshot harness attempts omitted required codecs or an
explicit exporter for fd://1; corrected runs exercised the actual tool protocol.
An inventory comparator initially compared native capture metadata against
product fields; comparing the exact property/default/enum/bound projection passed.

Remaining measured mismatches: native GLib critical classification and PID/time
prefixes differ; the previously measured nonexistent selected sheet crashes the
oracle with 139 while this engine returns 1. Other tools' numerical output,
moving-average variants 1-4, graphs and standard errors remain unsupported by the
default runner. Other styles/array/group metadata, named expressions, sheet spans,
multidimensional ranges, all setter boundaries and alternate libc/plugin/locale
profiles remain unqualified. Injected numerical output depends on the capability
honoring interpreted setup. Italic headings are now verified; the earlier report
of that gap remains historical. No performance claim is made.

The package change is confined to analysis preparation/runner/tests. Existing
Safe Bash tests qualify Node virtual-command CLI/SDK bytes, failure destination
preservation and original/checkpoint/replay namespace effects. No host authority
or public exports changed. Browser/workerd/other realm cells, broader adapter and
host authority matrices, repository-wide npm test/lint/build and a new packed
consumer gate were not run and remain unverified for this candidate. Focused
passes do not imply those gates passed. Source was checked as a dirty working
candidate at the recorded HEAD plus hashes; no local commit, push, publication
or release occurred. Existing edits and README files were preserved. Owned
temporary output was purged after receipt reduction.
