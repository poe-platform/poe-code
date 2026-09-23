# numfmt compatibility

The virtual `numfmt` selects GNU coreutils 9.10 kilo-unit vocabulary:
`--from=auto` and `--from=si` accept `k` or `K` as 1000;
`--from=iec` accepts either as 1024; `--from=auto` and
`--from=iec-i` accept `ki` or `Ki` as 1024. Other unit letters remain
uppercase. SI output uses `k`; IEC output uses `K` or `Ki`.

For example, `numfmt --from=auto 3.5k` prints `3500`, and
`numfmt --to=si 2700` prints `2.7k`.

This selects the reported GNU 9.10 behavior for kilo units, not complete
GNU 9.10 command parity. The implementation remains virtual and reports
`numfmt (virtual-bash)` through `--version`; it never runs a host utility.
The original GNU 8.30 snapshots remain unchanged. Canonical tests apply
explicit authored kilo-vocabulary expectation edits to those older captures
and separately test the GNU 9.10 cases reported in issue 508.
