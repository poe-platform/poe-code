# Current wc native profile — September 23, 2026

The current `wc` contract selects Linux GNU coreutils 9.1, as documented in
`src/commands/README.md`. The historical `native.json` remains the original GNU
9.7/Darwin capture. Its inputs, observations and prior failures are unchanged.
Fresh GNU 9.11/Darwin controls reproduce all 39 historical wc observations;
the eight current mismatches are real differences between selected profiles.

`native-linux91.json` retains all 77 observations from the unchanged
`capture-native.ts` and `vectors.ts`, executed in Debian 12 on x64 with glibc
2.36, GNU coreutils 9.1 and generated `en_US.UTF-8`. Only the 39 wc rows are
selected from this capture by `native.test.ts`. The other 38 rows still use
the original Darwin capture. No product code changed for this reconciliation.

The capture is [GitHub run 35893815154](https://github.com/poe-platform/poe-code/actions/runs/35893815154),
at source revision `c07d3f50e917da168e7f07601bb338c0e796ce50`.
`native-linux91-profile.json` retains the run and artifact identity, actual
OS/libc/locale/binary identities, source hashes and exact profile differences.
The downloaded ZIP matches GitHub's artifact SHA256; all three original input
files match the dispatched Git objects, before/after receipts and current
checkout. Every captured vector hash matches its unchanged original vector.

Before changing canonical selection, current wc matched the Linux capture at
all three original chunk widths (1, 3 and 65536): 39 vectors, 117 exact
status/stdout/stderr/filesystem comparisons. The old Darwin replay remained
31/39 with eight failures. These observations qualify this finite Linux 9.1
profile; they do not establish all GNU versions or libc implementations.

The eight changed stdout rows cover C-locale Unicode/invalid-byte words,
UTF-8 invalid-byte words, POSIXLY_CORRECT whitespace and invalid-only input.
Their original and Linux output bytes remain recorded side by side in the
profile receipt. Line, character and byte counts are unchanged in these rows.

The first dispatch, run 35893020734, failed before native execution because
Git rejected container checkout ownership during the revision read. The later
workflow uses an exact command-local safe.directory setting for that read,
retains the revision equality assertion and records the earlier failure.
