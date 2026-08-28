# Execution continuation / exact type fixture v2

Actual-frozen-01 independently built, packed846 with exact author hash, installed,
and loaded candidate LET. Its original negative API fixture returned exactly one
TS2724 at negative-api.mts(1,10), with the missing createLetCommands export and
createFileCommands suggestion. The original TS2305 assertion fails and remains
in the raw report. The root-authorized v2 matcher accepts only that full exact
diagnostic, exit2, naturally reaped child, then requires the Shell-import positive
inversion to compile without diagnostics. No whitelist or compiler suppression.

That run then hit a harness-only unlink of negative-api-neutralized.mts, which
the original failing assertion prevented creating. This continuation checks
existence before removing only those five named generated consumer files. All
58 literal/26 synthetic bodies remain unchanged and original type failures are
still accumulated and prevent original-cohort acceptance. Mechanism recipes
remain the presealed4b94b827 M1–M6; this revision does not modify their guards.

During authoring, a generator initially placed the v2 runner on the v1 path. It
was restored byte-for-byte from4b94b827 immediately, before any new execution;
the v2 runner is a distinct regular file. Old seals are checked before/after.
No source/test golden or previous raw report was changed.
