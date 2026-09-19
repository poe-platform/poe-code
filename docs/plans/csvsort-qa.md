# csvsort implementation and QA

1. Inspect root/scoped instructions, current edits, the frozen reference lock and authenticated csvsort source. Preserve unrelated changes and staging; do not commit or publish.
2. Reproduce Unicode uppercase and Decimal NaN failures with original in-memory regressions before implementation. Capture native measurements separately from canonical tests.
3. Put the literal executable engine in `packages/csvkit/src/commands/csvsort.ts`, preserving its exact descriptor, original executable name, common names helper and injected capabilities.
4. Implement frozen Python uppercase keys, stable tuple ordering and typed/null comparisons. Reproduce duplicate/unnamed header refusal before adding normalization and injected warning provenance.
5. Delegate independent in-memory safe-bash stress cases to a different agent. Root owns integration inventory, capability wiring, exports and Git.
6. Run uncached csvkit workspace unit/lint checks, selected maintained safe-bash build closure, runner inventory tests, strict type/consumer checks and focused shell tests covering selectors, types and lifecycle. Mark incomplete routes explicitly.
7. Screenshot the actual built Shell csvsort numeric/reverse, Unicode and names output through the maintained screenshot renderer. Inspect the image and record renderer limitations separately from command bytes.
8. Reduce evidence into `docs/csvkit` and `docs/specs`; purge only owned temporary reference/visual artifacts in `out`. Do not add README content.
