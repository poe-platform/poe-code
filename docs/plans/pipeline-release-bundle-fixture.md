# Pipeline release bundle fixture repair

The pipeline TUI delivery rebased onto remote main, whose browser Node-command entry was missing from the root bundler regression fixture. The preceding release failed three assertions in `scripts/bundle.test.ts` for this exact mismatch.

Validation against current main reproduced all three failures with `npx vitest run scripts/bundle.test.ts`. Add the browser Node-command entry to the expected browser shell group. Preserve the assertions that all isolated groups are checked before canonical evidence is saved.

Run both maintained bundler test files and focused ESLint before committing. Push this independent fixture repair to main and monitor the replacement release through successful publication.
