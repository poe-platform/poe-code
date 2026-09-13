# CLI startup package enumeration repair

Source base: `11a7a80571a633cd452fde83a3fd57290fc019a4`, Node 22.23.2 / ICU 78.2.

The broad test gate failed in `scripts/cli-startup.test.ts` while trying to open `packages/.DS_Store/package.json` (ENOTDIR). The Finder metadata file is preserved. The test now reads directory entries with file types and visits directories only, matching the maintained workspace discovery policy. It still checks the entire CLI startup import graph and rejects filesystem imports; no assertion is removed.

The focused root integration invocation recorded in `integration-resolution-green.log` passed all 38 tests, including this startup control. Full gate and publication receipts are recorded separately in the Promise admission evidence. This test setup change does not alter product behavior.
