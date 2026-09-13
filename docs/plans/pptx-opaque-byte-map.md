# PPTX opaque-object fixture byte map

Root's maintained virtual-bash typecheck reproduced TS2345 at lines 75 and 80
in `packages/safe-bash/tests/commands/pptx/opaque-objects.test.ts`: the independent
ZIP reader inferred an ArrayBuffer-specific byte type while XML edits return
general Uint8Array bytes.

Root explicitly delegated this single annotation correction. Declare the archive
map as `Map<string, Uint8Array>`; byte values, fixtures, and runtime assertions are
unchanged. This is a test type correction, with no product behavior change.

After the maintained dependency build,
`node --import tsx --test packages/safe-bash/tests/commands/pptx/metadata.test.ts packages/safe-bash/tests/commands/pptx/opaque-objects.test.ts`
passed 12/12 cases, including all five opaque-object cases. Root repeats the
maintained virtual-bash typecheck. The rerun passed source/tests and all 26
consumer groups; expected negative compile cases retained exit 2. Root stages only
the test file and this plan in a separate atomic local commit. No push or release.
