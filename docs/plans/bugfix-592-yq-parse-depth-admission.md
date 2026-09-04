# Issue #592: admit YAML collection depth during parsing

## Validated defect

A 258-byte input containing 129 nested arrays is fully constructed by the YAML
parser before the command's graph measurement rejects it. Block and mixed
block/flow nesting behave similarly. Small instrumented witnesses suffice;
reported heap amplification, timing and concurrent-isolate OOM were not measured.

## Implementation

Use one active-collection depth counter on the per-document Composer, shared by
block and flow parsers. Check cancellation before admitting the existing fixed
maxDepth of 128, before collection work or allocation. Restore depth in finally.
Include implicit flow-pair mappings before mapped-value descent and block sequence
mapping items. Preserve scalar leaves at depth 128 and existing node/byte/work
admission ordering apart from the new earlier depth check.

Keep post-parse expanded-graph measurement and all alias accounting unchanged.
Parser depth does not describe alias-expanded value depth. Malformed content
beyond the depth cap may now report LIMIT_MAX_DEPTH before its former syntax or
schema diagnostic; that earlier rejection is intentional. This does not bound
all input decoding/scanning or claim a general RSS limit.

## Verification and ownership

TDD in the existing yq.test.ts: exact boundaries across flow/block/mixed/implicit
collections, admission before a deep leaf, sibling and document restoration,
falsey cancellation, earlier deep-malformed rejection and retained alias graph
measurement. Run the complete yq suite, unchanged repair-allocation tests,
relevant adjacent structured-query tests and the maintained virtual-bash build
closure. Root owns independent review, lint, Git, delivery and release monitoring.
Only parser.ts, the existing yq.test.ts and this plan are in implementation scope;
no README, public-type, policy, query-core or dependency changes.

## Experimental surface qualification

The yq source runtime is experimental: its files are explicitly excluded from
tsconfig.build.json, and it is neither publicly exported nor registered by the
default agentCommands plugin. The maintained build and current consumer checks
validate the maintained public surface, not yq declaration emission, exports or
publication. Source-runtime tests and an explicitly installed source yqCommands
plugin exercise this fix; they do not establish published yq availability. This
change does not expand build admission, exports or default registration.
