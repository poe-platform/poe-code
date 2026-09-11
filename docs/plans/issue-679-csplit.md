# GNU-compatible bounded csplit

## Requirement and reference

After priority issue #687 is delivered, implement issue #679's virtual-filesystem
`csplit`: `-f PREFIX`, `-b SUFFIX`, `-k`, `-z`, a file or stdin, positive line
numbers, `/regex/` and `%regex%`, signed or unsigned offsets, and `{N}`/`{*}`.
Preserve raw input bytes and the exact output-file, count, diagnostic and status
semantics. Do not invoke host utilities in the product.

The installed reference is GNU coreutils 8.30, Ubuntu package 8.30-3ubuntu2.
The applied source commit is `26a1fa64acd11d62b28a59fab6b938ab57d12ba7`;
the source receipt is
`e667692aed25a9ea5e8280104d58ef022f6cd9cd6b714aae8b4b8b8e98af26be`.
The complete `csplit.c` and relevant I/O and numeric-conversion helpers were read;
the entire GNU regex implementation and libc dependency closure were not.
Nineteen bounded native probes remain in `/tmp/issue679-oracle-rhprhwf9`.
They establish a baseline, not complete GNU parity.

## Implementation boundaries

Keep the command in `src/commands/csplit/`, separating option and suffix parsing,
pattern preparation, splitting and owned output lifecycle where each has real
responsibility. Integrate through the existing shared regex executor and plugin
lifecycle rather than creating an unowned executor per invocation. Root owns
public exports, preset registration, inventories, package consumers and delivery.

The existing bounded grep provider does not implement the required GNU BRE
language. The expr engine offers a charged parser and VM, but assumes an anchored
match. Add an explicit bounded unanchored BRE-search operation without changing
expr results or its exact-step contracts. Preserve original subject coordinates
and one cumulative budget across candidate starts; slicing the subject, prefixing
`.*`, restarting budgets or silently accepting a smaller dialect is insufficient.

Handle groups, backreferences, intervals, GNU alternation and repetitions, word
and buffer escapes, context-dependent anchors, bracket expressions and nullable
repetition with validated capture histories. Program-counter-only empty-cycle
pruning is not enough to justify backreference semantics. Preserve CR, NUL and
high bytes while excluding only the line's terminating LF. Qualify locale and
invalid-byte behavior explicitly against the installed reference.

## Test-first milestones

1. Reproduce absence through the public shell. Validate every option and pattern
   before output effects. Implement numeric splits, default growing two-digit
   suffixes, prefix and single-integer printf suffix formatting, and byte counts.
2. Establish native-backed BRE search tests before changing the shared engine.
   Preserve existing expr tests. Add regex retain/skip, offsets, separate search
   and output cursors, finite additional repetitions and repeat-to-EOF.
3. Match file ownership and failure behavior: default failures remove owned
   outputs, including previously existing outputs truncated by this invocation;
   `-k` preserves partial files. This is not rollback. Printed counts survive
   later deletion; `-z` suppresses empty files/counts and reuses suffix indices.
   Preserve source-verified special cases such as empty input with numeric `1`.
4. Bound argument/pattern preparation, match steps and histories, input buffering,
   output count and bytes, and physical output attempts. Register cooperative
   cleanup before acquisition, retain raw-byte identity, drain admitted work and
   preserve falsey cancellation. Test provider, sink and late I/O failures using
   memory filesystems; do not weaken safety to copy unsafe host behavior.
5. Exercise an actual saved `.sh` file through the default preset. Run exact
   native comparisons, independent review, maintained discovery/types/lint/build
   and full tests as required by the cross-workspace change. Check fresh packed
   Node/Bun/portable consumers and a local terminal screenshot. Do not claim a
   real-browser check without its separately required approval.

Publish atomic validated improvements to main, verify remote delivery, and close
the issue only after the requested behavior is implemented and verified. Monitor
actual release publication while continuing the remaining issue queue. Do not
add README content without user permission or include this plan in the ZIP fix.

## Initial public regression evidence

After ZIP was verified on remote main in
`bf6f214400ff3a40c13f4cba057a72d2b276e578` and #687 closed, four public csplit
regressions fail in `/tmp/issue679-public-red-v1.log`: preset/factory availability,
an actual saved-script numeric split, elided-empty suffix reuse, and malformed
later-pattern rejection before output effects. These use memory filesystems.
The command and shared BRE implementation have separate worker write scopes;
root owns exports, preset wiring, literal discovery and public consumers.

The planned shared protocol uses a distinct `bre-search` operation, raw pattern
and subject bytes, original byte offsets, and accounted steps. It does not relax
the anchored `expr-match` reply contract. Csplit prevalidates every pattern and
charges subsequent compilation/search work to a shared invocation budget.

## Public integration

The default preset appends `csplit` after the existing 91 commands, preserving
their order. `AgentCommandsOptions.csplit.limits` forwards command limits while
regex configuration and provider ownership remain aggregate-level. Public
factories are exported from the portable core and explicit command subpaths.
The first four public regressions pass with individual test reporting in
`/tmp/issue679-public-integrated-v4.log`. Earlier sandboxed runs reported only
a file-level result; they are not counted as four-case evidence. Aggregate-provider
forwarding, invocation-worker retirement and nested-option isolation have
additional public tests. The initial additional test wrongly expected worker reuse
between completed invocations; existing `RegexSession.close()` intentionally
retires idle workers. Preserve that red result in
`/tmp/issue679-public-inventory-v1.log`; the corrected assertion requires both
workers retired before shell disposal, not a product lifecycle change.

The corrected four-file public/inventory run passes 77 cases in
`/tmp/issue679-public-inventory-v2.log`; maintained discovery passes 100 cases in
`/tmp/issue679-discovery-v2.log`. The focused root bundle suite passes 13 cases.
The first playground workspace run preserves 218 passes and two stale-artifact
inventory failures (91 built commands versus 92 expected); it must be rerun
after rebuilding the browser artifact, without weakening its assertions.

The selected maintained virtual-bash build closure passes in
`/tmp/issue679-worker-build-v1.log`, building safe-fs and virtual-bash. This
refreshes the actual Node regex worker for independent validation; it is not
the final normal workspace build or browser bundle qualification. At this
checkpoint, independent review found identical input/output paths could be
truncated when input stat lacks identity metadata. Preserve the failing
`/tmp/issue679-independent-alias-v1.log` and require a source fix before delivery.

An actual VFS `sh /work/verify.sh` workflow creates two regex-separated files
with exact counts `6` and `11`, then reads their contents through `cat`.
The asserted source-run transcript and visually inspected local terminal image
are `out/issue679/terminal-v1.txt` and `out/issue679/terminal-v1.png`. This uses
the repository's SVG/resvg terminal renderer, not browser automation or a
claim of a real-browser run.

The input-alias regression is fixed before destructive output creation:
identical virtual paths are rejected independently of backing identity, and
existing outputs are refused when known input metadata lacks trustworthy
identity. Distinct new outputs remain permitted. Owned command tests pass
133/133 in `/tmp/issue679-csplit-combined-v1.log`; targeted strict types pass in
`/tmp/issue679-csplit-types-v6.log`. Independent alias/lifecycle coverage passes
20/20 after expanding the original regression. Full integrated gates remain
required; these focused results do not substitute for them.

The refreshed Node-worker run passes 148/148 cases in
`/tmp/issue679-bre-actual-node-v1.log`; source/expr/history/provider regressions
pass 175/175 in `/tmp/issue679-bre-source-regression-v3.log`, with scoped types
passing and all seven production hashes unchanged through validation.
Independent review passes 288/288 actual cases with no skips in
`/tmp/issue679-independent-final-tests-v5.log` and scoped types in
`/tmp/issue679-independent-final-types-v4.log`. Its preserved reds exposed
16 diagnostic-byte mismatches, ten finite-repeat/backreference false positives,
and the missing-input-identity truncation. Native expectations were not normalized
or weakened. Production and independent review files are frozen for final gates.

The first full gate preserves 22443 shared-unit passes, one skip and two failures
in `/tmp/issue679-full-test-v1.log`: the maintained public export inventory lacked
the new subpath, and the browser consumer could not resolve it. Add the literal
export expectation and a real browser/workerd csplit bundle entry shared with the
portable root, following existing XML/YQ/network entry handling. Focused TDD
preserves three browser failures in `/tmp/issue679-browser-subpath-red-v1.log`
and 14 subsequent passes in `/tmp/issue679-browser-subpath-green-v1.log`, including
factory identity and the saved-script byte workflow. The first freeze is
superseded by these integration changes; command and BRE production remain
unchanged. The initial full lint succeeds but must be repeated for the new freeze.

The second full run preserves 22443 shared-unit passes, one skip and three
failures from the same omitted literal entry in `scripts/bundle.test.ts`.
The exact isolated-bundle inventory now includes csplit as well; no expectation
is replaced with runtime-derived membership. All three maintained bundle/export
suites pass together, 44/44, in `/tmp/issue679-bundle-closure-green-v1.log`.
The second full lint also passes. A third 70-input freeze includes this final
test-inventory update before repeating the complete gates.

The third pipeline passes 22446 shared unit cases (one skip), 29 Python cases,
and 303 Bash runner checks. Its supervising command exits with SIGTERM/status
143; the cause is not established. The detached Bash child continues against
unchanged inputs and finishes with 28318 passes, 63 skips and one failure. This
is not a completed full pipeline, and later workspace tasks still require a run.

The sole Bash failure is the committed-archive metadata prerequisite, reproduced
separately in `out/issue679/committed-head-v1.json`: current package metadata
contains the new csplit export, but selected HEAD `bf6f214` does not. The guard
correctly refuses mismatched metadata before compilation. Create the atomic
candidate commit locally and repeat the unchanged committed/full gates before
any push. Do not overlay live files into the archive or weaken that assertion.
The third full lint passes 10571 configured files with no errors or warnings,
plus root types and workflow validation. All 70 frozen code/test/config inputs
remain unchanged.
