# Public cleanup emitted-artifact verification

The final unit gate timed out `real registered rg: normal waits owned native retirement` at its existing 15-second limit. Its native child had already passed: worker exit and termination completion preceded both public settlement boundaries, with no live workers or unhandled rejections. An unchanged focused reproduction passed; approximately 1.92 seconds elapsed between its successful child proof and the completed second verification.

Each verification separately hashed the complete emitted tree and then reread its JavaScript files to discover public peer imports. The captured candidate contained 1,496 emitted files, including 374 JavaScript files.

- Move the existing emitted census into an explicit full-tree mode of required-peer capture. Hash each fresh leaf and inspect JavaScript imports from those same bytes, without retaining payloads after the existing 16-read batch.
- Preserve complete fresh inventory checks, source checks, expected hashes before JavaScript parsing, all peer checks before and after capture, and the standalone stale-hash rejection path. Keep both per-case verification boundaries and the existing setup, case, and native-child deadlines.
- Use the existing memfs peer fixture to count reads across repeated captures and reject changed, missing, extra, symlinked, or private-import inputs. No cross-call cache or integrity verdict reuse.

TDD: with the existing census and import-read loop placed in the new full-tree mode, the regression failed because a JavaScript leaf was read twice instead of once. Co-locating hashing and import inspection passed all 53 required-peer and census tests, including the existing standalone hash checks. The actual public cleanup file then passed all 20 native and tampering cases in 118.35 seconds, with zero failures, cancellations, or skips. Independent review found no substantive issue. Product code and build outputs were unchanged; no rebuild was needed for these test-helper changes.
