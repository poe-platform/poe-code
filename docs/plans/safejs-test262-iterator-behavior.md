# Pinned Test262 iterator-helper qualification

## Source and execution boundaries

Use upstream Test262 commit
`72faf8ec1445c55149615e8b35187830783aba1a`, under
[test/built-ins/Iterator/prototype](https://github.com/tc39/test262/tree/72faf8ec1445c55149615e8b35187830783aba1a/test/built-ins/Iterator/prototype).
The read-only probes fetch source and declared harness includes into memory;
they do not install dependencies or copy upstream files into the repository.

For each selected file, parse its YAML metadata, load sta.js, assert.js and its
declared includes, and execute its strict variant. Run the native side in a
fresh Node 26.8.1 VM context and the guest side in a fresh SafeJS run. Record
native failures separately; do not misclassify them as guest mismatches. Append
a true return only to the guest run so successful completion is observable.
Negative, noStrict, async, module and raw cases require separate adapters and
must be reported as skipped if encountered, not passed.

This is a bounded source-level probe, not the official Test262 runner or a full
conformance result. Non-strict variants, resource limits, host admission and
snapshot replay are not qualified by it.

## Results

All 214 selected strict cases pass in SafeJS, with no metadata skips:

| Method | Guest passes | Native passes |
| --- | ---: | ---: |
| flatMap | 44 | 44 |
| map | 36 | 36 |
| filter | 37 | 37 |
| take | 33 | 30 |
| drop | 34 | 31 |
| reduce | 30 | 30 |

FlatMap completed in 307532, map in 475f81, and the remaining batch in c83e4d.
The six native failures were excluded from that batch's guest execution, then
run directly against Test262 assertions; all six guest cases pass (2e9cce).
They cover argument effect order, validation/closing, and finite limits above
Number.MAX_SAFE_INTEGER. The current
[ECMAScript algorithm](https://tc39.es/ecma262/multipage/control-abstraction-objects.html#sec-iterator.prototype.take)
rejects those finite limits before obtaining the next method, closing the
iterator with the original RangeError completion. Its raw source was verified
in 03c5e9. Negative fractions that truncate to zero and positive Infinity remain
accepted; no new limit rule was inferred from the native mismatch.

The first flatMap attempt incorrectly used one native realm across files.
Property tests modified intrinsics needed by later files, producing 12 native
failures. That attempt was rejected as invalid evidence and rerun in fresh VM
contexts. No production fix followed from those harness failures.

No runtime edits were made during this qualification. These results do not
resolve ISO formatting, host Promise property admission, non-strict conformance,
or the remaining broader goal. No push or release was made.

## Additional early-exit consumers

The same pinned strict-source procedure subsequently qualifies 98 additional
cases without runtime changes:

| Method | Guest passes | Native passes | Metadata skips |
| --- | ---: | ---: | ---: |
| some | 33 | 33 | 0 |
| every | 33 | 33 | 0 |
| find | 32 | 32 | 0 |

The some result is d9ffac; every/find complete in d974b3. No guest or native
failure was reported in these selections. The full-package gate was still
running independently, and these results do not supersede its eventual result.

The remaining checked consumers/adaptor add 64 unchanged passes with matching
fresh native controls and no metadata exclusions: forEach 27, toArray 18
(d7ed28), and Iterator.from 19 (77f3a5). The same strict-source and harness
limitations apply; this does not qualify every iterator proposal or realm case.
