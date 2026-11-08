# Preserved fixture defects and proposed accounting clarification

The first baseline moved-package run passes 26/28 original frozen cases. Raw TAP,
cases, results, loaded-module proof and source/package manifests are in
`baseline-attempt1/`; they are not rewritten. Missing-file stderr was incorrectly
abbreviated by the fixture. The budget fixture used an unsupported property;
baseline `ShellLimits` calls it `maxOutputBytes`, as does its rejection's `limit`.
`holdouts-v2.mjs` makes only those two disclosed corrections, keeping count 28.
No candidate has been inspected. Findings were reported to root before correction.

Root's pre-candidate coordination requested accounting triage. Baseline
`keyBytes` returns a transient record subarray; `parseNumeric` copies that selected
range with `Buffer.from(bytes)` before Latin1 decoding. Whole/fraction strings can
retain the selected decoded backing, including nonnumeric suffix. An unrelated
record suffix cannot thereby be retained by the decoded selected-key string.
The record itself is already owned and separately bounded by input accounting.
Thus original intent requiring every cache to re-charge the entire existing
record was overstrong. A selected-key-length charge is sound if only parsed
strings and an existing record reference survive, not extracted byteviews or
whole-record decoded strings. Proposed versioned cap/mutation clarification keeps
all ten recipes, full-backing investigation and huge-key suffix detection; it
does not demand double-accounting existing record storage. Root adjudication is
required before accepting the clarification. Original freeze remains immutable.
