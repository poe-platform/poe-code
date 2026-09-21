# Listing and diagnostics follow-up QA

Execute as an agent; native ssconvert remains a separate oracle. Preserve the
existing implementation and evidence, all unrelated edits and README files.
Root owns integration, exports and Git. Do not push or publish.

1. Acquire Gnumeric 1.12.61, GOffice 0.10.61 and captured GLib 2.84.4 sources
   only under `out/ssconvert-listing-current`. Check their archive hashes against
   `docs/ssconvert/reference-profile.json` before extraction.
2. Inspect listing ordering, channel, width and image enum contracts and the
   GOffice key/value parser with GLib character classification. Execute failing
   original in-memory regressions before changing code. Use memfs for file
   changes; no unit native utilities or disk fixtures.
3. Check vertical tab in initial syntax and trailing sheet values against GLib
   whitespace classification. Check Unicode alphanumeric keys and negative
   controls independently from the implementation's table.
4. After the repair, assign a different agent independent stress and validated
   minimal fixes. Root retains integration/export/Git ownership. Cover SDK and
   CLI diagnostics, sink failures, cancellation, budgets and namespace effects.
5. Run maintained package test and lint routes and the selected uncached
   `@poe-code/ssconvert` build closure. Run actual virtual Shell ssconvert tests.
   Distinguish partial broader runs from completed gates.
6. Invoke the built public engine and compare version and all three listings
   byte-for-byte with authenticated captured status/stdout/stderr. Listing codec
   activation fixtures prove metadata only, not native format conversion.
7. Capture the built image listing with `npm run screenshot -- --no-header
   --output out/ssconvert-listing-current/cli-readable.png` and an inline Node
   host that calls public `createEngine` and `runCommand`. Inspect the screenshot.
   Keep stdout/stderr byte assertions separate from visual evidence.
8. Record exact candidate content hashes, verified coverage, failures, skips,
   unsupported and unmeasured runtime/profile cells in a follow-up verification
   document. Purge only owned scratch after reducing evidence.
