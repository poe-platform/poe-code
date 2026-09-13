# Settings help QA regression

Handout CLI screenshot QA reproduced `pptx settings get --help` exiting with
usage status 2. The settings commands existed but were omitted from the explicit
resource-help admission path.

Add original no-I/O cases for list/get/set, each checking both `--help` and `-h`.
All three cases failed before implementation. Admit settings help through the
existing command engine and show the supported flags, stored print/view inventory,
explicit dimensions, output controls and pagination boundary. No adapter logic
or new resource spelling is introduced.

The focused settings/engine/text-style schema suite passed 57 tests after the
fix. Final maintained package checks and built virtual-Shell screenshot inspection
are recorded in the handout integration and CLI plans. No screenshot unit tests,
README edits, source fixture downloads, push or release.

Owned changes: settings-help admission and usage text in the shared command
engine, `packages/pptx/src/command-settings.test.ts`, and this plan. Commit these
separately from the handout inventory improvement, preserving unrelated edits in
the shared command engine through explicit hunk staging.
