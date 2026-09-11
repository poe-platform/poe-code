# Issue 707: bounded ASCII case-insensitive grep

## Problem and scope

Issue #707 reports that the bounded provider refuses ordinary `grep -i` and
`grep -Eoi` even for ASCII HTML patterns. This is an extension of its supported
profile. Match enumeration and valid UTF-8 subjects were separately delivered
in #708 and #709; this change retains those bounds and byte-preserving paths.

Support ASCII `A`–`Z` / `a`–`z` folding for grep fixed, supported BRE, and ERE
patterns. Selection and extraction must both retain the original subject bytes
and case. Matching remains locale-independent, including `LC_ALL=C`.

Non-ASCII fixed literals remain exact UTF-8 byte matches; this is not Unicode
case folding. Regex patterns retain the ASCII grammar. Subjects remain valid
non-NUL UTF-8 scalar sequences, with dot/complement semantics and original byte
offsets from #709. Invalid UTF-8/NUL, word matching, and rg case modes retain
their explicit restrictions. No native RegExp fallback is introduced.

## Implementation

- Admit grep's insensitive descriptor flag without opening word or rg modes.
- Fold owned fixed-pattern bytes before building KMP failure links. Fold each
  compared ASCII subject byte transiently; never rewrite retained input/output.
- Add an explicit ASCII-insensitive literal flag to compiled ERE nodes. Close
  bracket-set membership over ASCII case pairs **before** complementing the set.
  This also makes ASCII upper/lower named classes match both cases under `-i`.
- Add a validated optional fourth `compileEre` argument, `asciiInsensitive`,
  defaulting to false. Existing BASH/expr consumers keep their existing default
  behavior; opted-in capture values still contain original text.
- Charge folding iterations, class closure, and retained literal-program
  metadata through the existing ledger. Preserve work/state/allocation,
  per-line/total-match/result-byte limits, cooperative cancellation, and awaited
  worker retirement.

## TDD and focused verification

Before implementation, direct provider tests reproduced both selection and
enumeration refusal: 2 failures, 0 passes in
`/tmp/poe-707-provider-red.log`. Independent command tests reproduced the same
gap: 23 failures and 4 passing controls in `/tmp/poe-707-command-red.log`.

After implementation, provider, ERE work-accounting, and portable-executor tests
passed 119/119 in 2.212 seconds (`/tmp/poe-707-provider-final.log`). These cover
fixed/BRE/ERE byte spans, ASCII range and named-class closure, complement order,
non-ASCII fixed exactness, default case-sensitive ERE behavior, original capture
case, work/allocation/state refusal, falsey cancellation, and subsequent reuse.
Focused strict no-emit TypeScript passed (`/tmp/poe-707-provider-types.log`).

Command/default-plugin tests passed 39/39 in 1.111 seconds
(`/tmp/poe-707-command-green.log`). Their independent profile covers original
output bytes, selection versus extraction, Unicode boundaries, resource limits,
cancellation, and the remaining unsupported flags. Command strict TypeScript
also passed (`/tmp/poe-707-command-types.log`).

## Review and delivery status

Independent review found no blocker in the ASCII-only profile, set complement
ordering, original-byte output, resource accounting, or default case-sensitive
consumers. The normal workspace/root build passed (`/tmp/poe-707-build.log`),
including the final literal-program allocation charge. The broader relevant
grep/search/regex/expr gate passed 1,127 tests with no failures or skips in
54.81 seconds (`/tmp/poe-707-focused-gate.log`). Exact input inventory passed
100 tests (`/tmp/poe-707-inventory.log`).

Guarded root lint plus type/workflow checks passed in 369.98 seconds: 10,508
configured/linted files, zero errors or warnings, and all 25 receipts
(`/tmp/poe-707-lint.log`). Installed candidate packages passed 54 checks each on
Node, Bun, a browser-conditioned bundle executed on Node, and actual workerd;
three strict type profiles, the maintained browser fixture, and graph checks
also passed. Artifacts are in `/private/tmp/poe-707-public-z7wp4fo2`. The
coordinator inspected its CLI screenshot; the terminal font lacks the emoji
glyph, while byte-level output checks pass.

Remote-main delivery and actual registry publication remain pending. Local
candidate passes do not establish those outcomes.
