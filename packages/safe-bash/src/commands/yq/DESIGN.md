# Bounded yq Module Specification (Design Proposal)

Status: Proposed

Implemented Through: Not applicable

Purpose: Define a useful, zero-runtime-dependency YAML command without implying implementation, full YAML conformance, or reference-CLI parity.

## Normative Language

The key words `MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, `MAY`, and `OPTIONAL` are interpreted as in RFC 2119.

## Problem Statement

The package has no yq command. A scalar-only shortcut would not handle ordinary configuration files, while importing a parser or invoking a host CLI would violate the desired zero-runtime-dependency and virtual-execution boundaries.

## Goals and Non-Goals

Goals are a real bounded YAML parser/composer/encoder, reuse of the existing safe jq query dialect, byte-stream/VFS operation, cancellation, and a useful pinned-comparator workflow. Non-goals are full YAML or reference-CLI parity, presentation round-tripping, non-YAML data formats beyond strict JSON, root exports, aggregate registration, and implementation in this design task.

## 1. Scope and Reference Choice

The proposed command is a Mike Farah v4-style `yq` subset: expression first, `-p/--input-format`, `-o/--output-format`, and opt-in in-place update. This choice follows the pinned just-bash 3.4.2 command, whose declaration says it is inspired by Mike Farah yq and whose recorded positive workflow is `yq -o json '.items[1].name' data.yaml`. It is **not** the kislyuk Python wrapper, which transcodes into an external `jq`, defaults to JSON output, and uses `-y/-Y` for YAML output.

This proposal MUST add zero runtime dependencies and MUST NOT spawn a native process, call `eval`/`Function`, load ambient files, or parse YAML by splitting JSON-like text. It covers YAML and strict JSON only. XML, INI, CSV, TOML, HCL, comments/style round-tripping, full Mike Farah operators, and full YAML 1.2.2 conformance are non-goals for the first implementation.

No yq product existed when this draft was made. The fixed jq/contracts baseline `5137a74ec855a32d8a8860eb66b62eb44d11e290` is byte-identical to the inspected live files at `427aac51898fc733111098019fe50c2675d515b6`; this document is not an implemented-version claim.

## 2. Command profile

The initial syntax SHOULD be:

```text
yq [-p auto|yaml|json] [-o yaml|json] [--yaml-schema core|json|failsafe]
   [-I 1..8] [-c] [-r] [-e] [-s] [-n]
   [-i --allow-lossy-write] [--] [FILTER] [FILE...]
```

`FILTER` defaults to `.`, but a file without an explicit filter is not guessed; callers use `yq . file.yaml`. With no files, or with the single operand `-`, input is the supplied stdin byte stream. Multiple files are processed in argv order; `-` MAY occur once. `-n` evaluates once against null without reading input. Without `-s`, the filter runs once per document; `-s` collects all documents across all operands into one bounded array and runs once.

Input `auto` selects strict JSON only for a `.json` named operand and YAML otherwise; stdin is YAML. Mixed detected formats are allowed because each operand is decoded separately. Output defaults to YAML, matching pinned just-bash 3.4.2 rather than Mike Farah's broader auto-format behavior. `-c` and `-r` MUST be rejected unless `-o json`; raw output applies only to string results. `-e` follows the existing jq status profile: 0 for a final truthy result, 1 for false/null, and 4 for no result.

The query surface MUST be the existing bounded jq dialect, not a second evaluator: identity, literals, field/index/slice/iteration, pipelines and comma, arrays/objects, conditionals, optional access, comparisons/arithmetic/boolean/alternative operators, assignments supported by the existing path evaluator, and its declared functions (including `select`, `map`, `length`, `keys`, sort/group/unique, conversions, entries, range/limit, and type selectors). Definitions/modules, regex, recursion, `reduce`, `try/catch`, environment/file/load/system operators, and unlisted Mike Farah operators remain unsupported.

## 3. YAML representation profile

The parser MUST be a real tokenizer/parser/composer. It MUST accept nested block sequences/mappings (including compact mappings in sequence entries), nested flow sequences/mappings, comments, single- and multiline plain scalars, single- and double-quoted scalars, and literal/folded block scalars. Single quotes escape only as `''`; double quotes implement the complete YAML 1.2.2 section 5.7 escape set and reject unknown or invalid code points. It MUST implement scalar folding and block scalar indentation plus clip/strip/keep chomping (`|`, `>`, `|-`, `|+`, and indentation indicators 1–9 in either legal order). Plain `:` and `#` MUST obey YAML context/separation rules rather than naïve delimiter splitting.

The parser MUST accept UTF-8, one leading UTF-8 BOM, and LF/CRLF/CR input line breaks; it MUST use fatal decoding, reject malformed UTF-8 and unpaired surrogates, and preserve Unicode code points without normalization. UTF-16/32, NEL/LS/PS structural line breaks, tab indentation, reserved indicators, `%TAG`, unknown directives, and unsupported productions MUST fail explicitly. `%YAML 1.2` MAY appear before an explicit document; other version directives MUST fail.

The proposed initial default is a representability-restricted YAML 1.2.2 Core profile; `json` and `failsafe` are explicit alternatives. Core resolves only null, Boolean, integer, float, and string forms from section 10.3; timestamps remain strings. Supported explicit tags are `!!map`, `!!seq`, `!!str`, `!!null`, `!!bool`, `!!int`, and `!!float`, with kind/content validation. Local, application, binary, timestamp, set/omap/pairs, and other tags MUST fail. Non-finite inputs and unsafe integral inputs MUST fail. Finite non-integral decimals use the existing jq `Decimal` representation: normalized untouched numeric text is retained, while arithmetic/conversions that project through `numberValue` use IEEE 754 binary64. A query operation or conversion producing a non-finite value or an integral value outside the safe-integer range MUST fail before encoding. These numerical restrictions mean the initial profile MUST NOT be described as full Core conformance.

Mapping keys MUST compose to strings. Complex, sequence, mapping, numeric, Boolean, and null keys MUST fail rather than be coerced. Objects MUST use the existing ordered null-prototype representation, so keys such as `__proto__` are data. Duplicate keys MUST fail after scalar decoding and tag resolution using exact code-point equality; no Unicode normalization or case folding is permitted.

Anchors and backward aliases are supported within one document. An alias resolves to the most recent completed anchor and is deep-copied into the JSON-shaped query value. Aliases to missing or currently composing anchors, cycles, and cross-document aliases MUST fail. Anchor names/styles and object identity are discarded after composition. Anchor redefinition is allowed only after the prior node completes. Unquoted `<<` and explicit `!!merge` MUST fail: the merge key is a YAML 1.1 type, not YAML 1.2.2 Core. Quoted `"<<"` remains an ordinary key.

A stream MAY contain zero or more documents using `---`/`...`; empty explicit documents compose to null. The parser may stream between documents but MUST completely compose and validate the current document before querying it.

## 4. Encoding and I/O

YAML output is deterministic semantic output, not round-trip output. It uses insertion-order block mappings/sequences, `{}`/`[]` for empty collections, requested indentation (default 2), and a trailing LF. Strings are emitted plain only when legal and when Core would resolve them as strings; otherwise they are double-quoted with required escapes. Multiline strings SHOULD use literal block style with an exact chomping indicator. Comments, directives, source styles, tags, anchors, and aliases are not preserved.

Each query result is one output document. YAML inserts `---\n` before the second and later results, emits no `%YAML` header and no `...` footer. JSON emits one existing-jq JSON value per result plus LF; `-c` compacts it. Zero results emit zero bytes. A late document failure may follow already completed stdout documents, as with stream processors, but MUST NOT produce a partial document merely because a size limit was discovered: the encoder performs a bounded counting/validation pass before awaited chunk writes.

All reads MUST use VFS `readStream`/`readFile` through `readBytes` with `context.signal`; all writes MUST await `writeBytes`. No host path is visible. `-i` MUST require exactly one named regular YAML file, YAML output, and `--allow-lossy-write`. It MUST stage an exclusive sibling file with the original mode, publish only when `capabilities.atomicRename === true`, and produce no stdout; otherwise it returns unsupported. Parse/query/encode failure or pre-publication cancellation leaves the original unchanged and cleans the stage best-effort. Cancellation after atomic rename cannot undo publication. Symlink inputs are refused.

## 5. Bounds, work, and failures

One shared invocation budget MUST cover argument bytes, decoding, YAML tokenization/composition, alias expansion, query parsing/evaluation, counting, and encoding. Proposed yq-family defaults intentionally fit the existing jq `Budget`: 64 MiB total input, 8 MiB per document/value and slurped value, 16 MiB combined stdout/diagnostics, 64 KiB filter source, depth 128, AST depth 64, 1,000,000 work steps, 100,000 results, and 100,000 elements per collection. YAML adds proposed limits of 1 MiB per decoded scalar, 1,024 documents, 1,024 anchors, 1,024 alias references, and 100,000 composed/expanded nodes per document. Before allocating each alias-expansion copy, the implementation MUST check the projected work, expanded-node, per-scalar, and per-document/value byte totals; every copied node and the bytes of every copied scalar count toward those bounds. Every scanned code point, token/node, copied alias node, query action, and encoded scalar/key chunk consumes work; counting and emission are both charged. These numbers are root-approval proposals, not an implemented `Budget` API extension or a new shared shell budget.

Cancellation guarantees cover cooperative providers only. Before invocation-owned resource acquisition or admission, the implementation MUST synchronously register the existing `InvocationCleanup`, use the same idempotent cleanup from `finally`, close admission, and await cleanup of owned acquired/admitted cooperative work plus the existing root cleanup barrier before public settlement. It MUST observe late rejections, but MUST NOT claim to preempt opaque host JavaScript, unenrolled work, or a nonsettling/uncooperative provider. Implementations MUST yield and observe cancellation at least every 1,024 steps and at every awaited I/O boundary.

CLI/VFS errors return 2, query compile errors 3, and YAML parse/composition, query runtime, and limit errors 5. Diagnostics use `yq: SOURCE:LINE:COLUMN: CATEGORY: MESSAGE`, are LF-terminated, bounded, and omit stack traces/input contents. Sink failure and cancellation escape under shared command contracts; neither is remapped into a normal result.

## 6. Required prerequisite and implementation bounds

Directly duplicating jq is forbidden. Before yq implementation, structured-command ownership SHOULD expose an internal query-core contract for compiling/evaluating with an injected shared `Budget` and for JSON encoding. The fixed source already exports `parse`, `Interpreter`, `Budget`, ordered-object helpers, JSON parsing, and stringification internally, but only limits are exported by the structured barrel. This prerequisite is an internal refactor, not authorization for root/package exports.

Realistic phases are: (1) tokenizer/composer plus schema and rejection tests; (2) deterministic encoder and multi-document/stdin/VFS reads; (3) shared jq-core integration and baseline workflow; (4) opt-in atomic lossy writes; (5) separately authorized format or round-trip extensions. Each phase requires cancellation/limit adversaries and a different-agent review.

## Test and Validation Matrix

Tests MUST include official YAML 1.2.2 examples and a pinned, licensed subset of a YAML Test Suite data release, classified as oracle data rather than copied implementation. They MUST cover every accepted scalar/collection style, schema boundary, duplicates, dangerous keys, anchors/aliases/exponential expansion, document separators, malformed UTF-8, depth/work/byte/output limits, cancellation, chunk reuse, stdout backpressure, and atomic write failure. Mike Farah yq v4.53.3 and pinned just-bash 3.4.2 are reference-behavior oracles only; disagreement outside this declared profile is not a failure and no parity claim follows. Any future reference execution MUST first seal its exact executable/package identity, inputs, argv, environment, bounds, and unique output directory; canonical tests MUST NOT execute an ambient yq.

No implementation code is to be copied. YAML 1.2.2 is the normative language source; YAML Test Suite is MIT; Mike Farah yq v4.53.3 is MIT; just-bash 3.4.2 is Apache-2.0; its installed `yaml` 2.9.0 parser is ISC. Exact local identities and primary URLs are recorded in `tests/commands/yq-design-20260828/evidence.json`.

## Conformance Criteria

An implementation conforms only when every `MUST`/`MUST NOT` requirement and declared rejection is covered, the complete safety and cancellation matrix passes on memory plus at least one configured real or remote adapter, public invocation exercises the actual command, and the pinned workflow passes. That bounded result would still not establish full YAML, Mike Farah, just-bash, or superiority parity.

## 8. Root decisions before implementation

1. Approve the proposed representability-restricted Core default, including rejection of non-finite and unsafe-integral input/results and existing-jq decimal/IEEE-754 behavior, with explicit JSON/failsafe alternatives; otherwise select the narrower JSON schema.
2. Approve the internal shared query-core refactor; direct private imports would create avoidable coupling.
3. Include opt-in `-i --allow-lossy-write` in the first release, or defer all in-place writes until presentation-preserving storage exists.
4. Approve the exact safety defaults as yq-family limits; they are not a new shared shell budget.

## 9. Root policy decision v1 (2026-08-28)

Sections 1-8 above are retained byte-for-byte as the initial proposal. This
versioned decision supersedes their conflicting choices; it does not retroactively
rewrite that evidence.

The first profile is settled as representability-restricted YAML 1.2 Core only.
`--yaml-schema` and every JSON/failsafe schema spelling are refused rather than
silently ignored. The genuine tokenizer/parser/composer, collections and scalars,
block and multi-document support, and bounded backward aliases remain required.
Keys are strings; duplicate decoded keys, cycles, forward aliases, merge keys,
custom/unknown tags, non-finite values, and integral values outside the safe-integer
boundary are rejected.

Output defaults to deterministic YAML; `-o json` selects JSON. Querying reuses the
existing safe jq dialect and is explicitly not full Mike Farah expression syntax.
All in-place spellings, including `-i`, `--inplace`, `--in-place`, and the former
`--allow-lossy-write`, are initially refused. No atomic-write capability or claim
belongs to this release.

The numeric family limits in section 5 remain useful starting points but are not
normative until a different pre-code freeze seals counter units, reset lifetime,
pre-allocation admission, retained-buffer accounting, UTF-8 measurement, output
and diagnostic admission, and exact boundary errors. No new runtime Budget or
deadline counter is implied.

The next design-only proposal is
`tests/commands/yq-design-20260828/query-adapter-v1/README.md`. It evaluates a new
narrow adapter over the existing private exports before any jq move/refactor,
defines the proposed CLI and query boundary, and identifies the precise cases
where the present private API cannot prove the requested accounting. It authorizes
no source extraction or implementation. Its inspection is bound to Git baseline
`5137a74ec855a32d8a8860eb66b62eb44d11e290`; no native/product probe was run.
