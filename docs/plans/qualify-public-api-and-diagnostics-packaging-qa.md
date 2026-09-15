# Public declaration packaging visual QA

Run after `npm run build:workspaces -- --workspace=@poe-code/safe-js`, canonical staging, `npm pack --ignore-scripts`, and installation of both SafeJS and SafeFS candidate tarballs into `/private/tmp/safejs-api-qualification-final/tarball-consumer`.

1. Capture installed help:
   `npm run screenshot -- -o /private/tmp/safejs-api-qualification-final/help.png node /private/tmp/safejs-api-qualification-final/tarball-consumer/node_modules/@poe-platform/safe-js/dist/safe-js/cli.js --help`
2. Capture installed syntax diagnostics:
   `npm run screenshot -- -o /private/tmp/safejs-api-qualification-final/syntax.png node /private/tmp/safejs-api-qualification-final/tarball-consumer/node_modules/@poe-platform/safe-js/dist/safe-js/cli.js docs/plans/qualify-public-api-and-diagnostics/qualification-20260914/syntax.ajs`
3. Inspect both PNGs. Check readable flags, exit codes, original filename, line/column, source excerpt and caret, and absence of host implementation stacks.

No screenshot tests are added. These captures qualify the locally staged candidate only, not a remote release. Record any failure in the gap-closure evidence report.
