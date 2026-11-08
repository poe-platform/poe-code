# numfmt compatibility

The virtual `numfmt` selects GNU coreutils 9.10 kilo-unit vocabulary:
`--from=auto` and `--from=si` accept `k` or `K` as 1000;
`--from=iec` accepts either as 1024; `--from=auto` and
`--from=iec-i` accept `ki` or `Ki` as 1024. Other unit letters remain
uppercase. SI output uses `k`; IEC output uses `K` or `Ki`.

For example, `numfmt --from=auto 3.5k` prints `3500`, and
`numfmt --to=si 2700` prints `2.7k`.

Ronna (`R`, 10^27) and quetta (`Q`, 10^30) prefixes are supported for
input and output scaling, including binary `Ri` and `Qi` units. For example,
`numfmt --from=auto --to=si 3.5Q` prints `3.5Q`. Direct large decimal inputs
and conversions using `--from-unit` can also produce these prefixes.
Numeric conversion remains bounded; unit-size options still require a
positive unsigned 64-bit size.

This selects the reported GNU 9.10 behavior for kilo units, not complete
GNU 9.10 command parity. The implementation remains virtual and reports
`numfmt (virtual-bash)` through `--version`; it never runs a host utility.
The original GNU 8.30 snapshots remain unchanged. Canonical tests apply
explicit authored kilo-vocabulary expectation edits to those older captures
and separately test the GNU 9.10 cases reported in issues 508 and 509.
Affected numeric expectations also use GNU 9.10 captures from Darwin x86_64
with a 64-bit long-double significand in the C locale. Separate compatibility
expectations retain existing invalid-input, developer-diagnostic and virtual-help
behavior; they are authored expectations rather than GNU 9.10 captures.
