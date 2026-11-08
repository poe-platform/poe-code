# Independent encounter-order freeze v2

This is an independent leaf evidence freeze, not product implementation. Ownership
is only this new directory. Production and historical fixtures remain read-only.
No parser-author implementation was inspected. The old parser contract was read
before freezing. No new public API, prototype implementation or native research.

The byte-identical original `freeze/original-cases.json` has 61 original cases
(44 GNU semantic inputs, 17 project controls), plus the unchanged separately
denominated historical old-cap case. Its SHA-256 is
`d1892a748a9437fa253735636abf6f8d349c00d4898579d7a8b92bf0a2598314`.
The JSON-serialized exact 61-case array has SHA-256
`d4bb6baf0109a8f5ba2e6752a1bb5d56c492cbdde43495883f68a4a2ea124a47`.
Original argv/options/expectations and the original driver are exact Git copies.
The manifest makes the original implicit `{LC_ALL:"C"}` environment explicit
without changing the original file. Historical actual worker/event traces are
retained byte-for-byte, not converted into newly invented expected events.

The freeze preserves accepted-source 40/61 evidence from `e9ff18dc`/`514f8407`
beside qualified `cf5caabe` 42/61 evidence with all 19 failures. The baseline
archive binds commit `1b2ddea9e38b25cc91134a2f35a318e27f4d7c29`, before the
forthcoming parser candidate. Its 40-file static import/build-input closure is
87,870 compressed bytes, not a whole-repository archive. Exact committed and
observed live hashes appear in `freeze/source-manifest.json`; dirty unrelated
shell files are not overlaid. Any later quota-only index revision is a different
candidate and must be separately qualified, not relabeled as this baseline.

Sixteen small nearby project controls are frozen separately in
`freeze/controls.json`, with their observation driver. They cover inactive nested
prefixes, no encoding/value conversion, retained syntax/arity/structural limits,
active late syntax, three ordered regex submissions, caller-reason cancellation,
awaited stdout, sink failures without replay, and repeated awaited cleanup.
They are not an expanded native corpus. Instrumentation wraps existing methods
for observation only and is restored; it neither replaces parsing nor evaluation.

Native normative references are ONLY the existing frozen official GNU coreutils
9.7 executable observations on Darwin 25.4.0/arm64, `LC_ALL=C`, binary SHA-256
`e8a4e2b58a33d2ad6bfa9eb8a4ed5f62775ab9ceac4b9421680c98973fd9109c`.
No Linux assumption and no new native execution or oracle changes. Inactive
project policy validates syntax/arity/structural limits without evaluating values,
encoding operands, reducing expressions, or submitting regex jobs. Active
reductions are awaited once in encounter order with one Budget/matcher, no replay
or reset, cleanup before resource acquisition, idempotent awaited cleanup, and
the caller's exact abort reason.

Drivers are explicit opt-in `.mjs`, outside canonical test discovery. Frozen
source is classified compressed data. Captures must use unique explicit output
paths and refuse overwrite. Future final-candidate replay is separately assigned;
this task does not wait for it or make a candidate-acceptance claim.
