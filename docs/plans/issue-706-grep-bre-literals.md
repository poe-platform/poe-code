# Issue 706: bounded grep BRE literals and escapes

## Scope

Ordinary grep must accept escaped metacharacters in ASCII BRE URL patterns and
literal operators such as `a+b`, without assigning ERE repetition/group meaning
to unescaped BRE punctuation. Preserve UTF-8 scalar subjects, original output
bytes and offsets, ASCII case folding, and all existing resource/lifecycle bounds.

Outside brackets, escaped backslash, dot, caret, dollar, opening/closing bracket,
and star become literal atoms. Unescaped `+?(){}|` also become literal atoms.
Inside brackets, preserve member/range/class syntax and literal backslash;
recognize initial complement, first-member closing bracket, and POSIX named-class
terminators. Escaped grouping, intervals, backreferences and other extensions
remain explicitly unsupported. Existing interior-anchor and leading-star
restrictions remain. ERE, fixed, expr and other consumers retain their profiles.

## Implementation

Replace blanket BRE admission with a cooperative scanner producing the existing
ERE compiler's literal-tagged fragments. Escaped pairs produce one quoted atom;
unescaped operators become quoted atoms outside brackets. This avoids a textual
regex rewrite and does not introduce a native matching fallback.

Charge original source admission, each scan/escape step, each retained fragment,
and whole-record wrapper shifting before the corresponding work or allocation.
The existing compiler still validates bracket grammar and enforces its expansion,
grammar, allocation and work limits. Enumeration, output bounds, cancellation and
worker retirement continue through the shared paths.

## TDD and review evidence

Direct provider reproduction failed before implementation with the old BRE
refusal (`/tmp/poe-706-provider-red.log`). The regression covers selection and
extraction for escaped URL dots, literal operators, bracket members, and escaped
brackets/star/anchors/backslash.

Provider, ERE accounting and portable-executor tests now pass 123/123 in 3.627
seconds (`/tmp/poe-706-provider-final.log`). Additional controls distinguish BRE
literal plus from ERE repetition; cover complement/first-closing-bracket/named
class boundaries, quantified escaped caret, case-insensitive whole-line literal
matching, explicit extension refusals even without rows, original source-byte
limits, translation work/allocation limits, and falsey cancellation with reuse.
Focused strict no-emit TypeScript passes (`/tmp/poe-706-provider-types.log`).

Independent command tests pass 27/27 (`/tmp/poe-706-command-green.log`). The review
agent found no blocker in the literal-fragment approach, bracket-state handling,
explicit refusals, or accounting; requested edge controls are included above.

## Delivery record

Final independent review found no semantic or accounting blocker. The normal
workspace/root build passed (`/tmp/poe-706-build.log`). The broader relevant
grep/search/regex/expr gate passed 1,158 tests, with no failures or skips, in
81.98 seconds (`/tmp/poe-706-focused-gate.log`). Exact inventory passed 100 tests
(`/tmp/poe-706-inventory.log`).

Installed candidate packages passed 66 checks each on Node, Bun, a
browser-conditioned bundle executed on Node, and actual workerd. Three strict
type profiles, the maintained browser fixture, and graph checks also passed.
Artifacts are in `/private/tmp/poe-706-public-cp1anldj`; the coordinator inspected
the CLI screenshot and confirmed the displayed BRE outputs.

The first guarded lint run was intentionally stopped, incomplete, after CI
exposed obsolete #707 default-factory assertions. With those assertions corrected,
full lint passed twice: the default-heap run completed in 594.13 seconds; the
qualified run with 1 GiB old-space and external 600-second supervision completed
in 433.24 seconds (`/tmp/poe-706-bounded-lint.log`). It covered all 10,509 configured
files with zero errors/warnings and all 25 receipts; type/workflow checks passed.
These are observed runs, not a controlled performance comparison.

Main then received the equivalent aggregate-test repair in `f6b37d254`. The
coordinator preserved that commit and withdrew the duplicate local repair.
Only its positive fixture values differ; feature source, build and candidate
artifacts remain unchanged. Its exact test file passed all 24 tests separately
(`/tmp/poe-707-remote-default-executor.log`).
Remote-main feature delivery and actual publication remain separate pending
outcomes; local success does not imply either.
