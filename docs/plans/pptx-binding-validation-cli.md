# PPTX binding validation CLI acceptance

Ownership: this leaf owns this document and the existing
`packages/safe-bash/tests/commands/pptx/template-bindings.test.ts` only.
Root owns domain changes, maintained package checks and commits.

## Procedure

1. Exercise the registered virtual-shell command against original memfs inputs.
   Omit each of the six required binding fields, repeat a binding record, and
   place a missing target after a valid binding. Include malformed table cells,
   ragged rows, out-of-range image bytes, unknown image fields and missing image
   content type. Assert exact error codes/statuses, unchanged input/destination
   bytes and zero conditional publication calls.
2. Bind 3,000 CJK characters under an 8,192-byte XML limit. Require resource-limit
   exit 4 during admission, before editing or publication. Preserve both files.
3. Rebuild the selected pptx workspace closure, run the focused CLI test and
   strict TypeScript check below, then inspect actual human diagnostic output
   using the maintained screenshot renderer. Keep temporary screenshots outside
   Git; no downloaded fixtures or standalone QA scripts are needed.

## Evidence

The new UTF-8 regression failed against the previous built SDK: it reported
`resource-limit` during `parse`, rather than `admit`. The other four tests passed.
After root's selected pptx build closure, all five tests passed (2.93 seconds
total; every individual test below 401 ms). Existing success cases retain
independent XML/media assertions and SDK/CLI byte comparisons.

```sh
node --import tsx --test packages/safe-bash/tests/commands/pptx/template-bindings.test.ts
node node_modules/typescript/bin/tsc --noEmit --target ES2023 --module NodeNext --moduleResolution NodeNext --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --skipLibCheck --types node packages/safe-bash/tests/commands/pptx/template-bindings.test.ts
```

Strict focused TypeScript checking passed before and after the rebuild. The package's
normal test runner does not honor `SAFE_BASH_TEST_RG`, so it must not be used as
though it selects this one file.

Visual receipt: `npm run screenshot -- --no-header --output
/tmp/pptx-binding-byte-limit.png node --input-type=module -e ...` invoked the
built public command engine with an original in-memory deck, explicit context
limits and read capability, and the same oversized text value. It emitted exit 4
and `pptx: resource-limit: Input or argument limit exceeded.` The PNG was opened
and inspected: the full diagnostic is readable, uncropped and clearly spaced.
The ellipsis denotes the inline setup invocation, not a stored QA script. The
screenshot is disposable and is not committed. No adapter logic or registration
changes were required; no commit or push was performed by this leaf.
