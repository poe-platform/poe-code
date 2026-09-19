# in2csv JSON user stress QA

Run this focused procedure after rebuilding the csvkit workspace used by safe-bash.
No commit, push, release or README changes are authorized by this procedure.

1. Run `node --import tsx --test packages/safe-bash/tests/commands/in2csv-json-user-stress.test.ts` uncached.
2. Check exact stdout, stderr and exit status for frozen native cases 17–48 from `docs/csvkit/in2csv-json-native-reference.json`. Exercise both a named memory file and borrowed stdin yielding a reused one-byte buffer. Check that named input never consumes borrowed stdin and input bytes remain unchanged with no extra files created.
3. Check scalar rows, scalar roots, keyed string/object values, mixed row kinds, unnamed/duplicate warning identities, literal dotted keys, duplicate object keys, ignored common flags, null policy, empty key handling, malformed/trailing-comma JSON, empty NDJSON lines and heterogeneous NDJSON values.
4. Respect universal-newline provenance: named CRLF input diagnoses an empty line at char 1; borrowed CRLF stdin diagnoses it at char 2. Frozen case 40 measures borrowed CR-only stdin, so do not infer the named-input result from it.
5. Check six independently captured codec cases in `docs/csvkit/in2csv-json-user-codec-reference.json`: UTF-8 BOM with `utf-8-sig` in JSON and NDJSON; Latin-1; malformed UTF-8; UTF-16 with BOM; and unknown codec. The artifact records the source SHA-256, dependency versions and explicit C/UTC/UTF-8 capture environment. Exact expectations were captured using the hash-qualified csvkit 2.2.0 reference at `out/in2csv-user-oracle/bin/in2csv`, CPython 3.14.2. Canonical tests contain only those captured bytes and in-memory inputs, never an oracle subprocess.
6. Check consumer closure during the second stdout write. Writes must serialize, preserve the original consumer reason, stop before publishing the final row, close input once, register and drain cooperative cleanup, and leave the caller signal intact.
7. Check original edge cases 70–74 from `docs/csvkit/in2csv-json-user-edge-reference.json` through JSON and NDJSON without an added newline. Bare final backslash in root/array/object strings, including an astral character, must report the original string-start position as `Unterminated string starting at`. Exercise named files and reused one-byte input.
8. Run `npx eslint packages/safe-bash/tests/commands/in2csv-json-user-stress.test.ts`; root owns the maintained workspace build/typecheck/integration checks.

Unmeasured encodings/locales, cooperative resources absent from the injected contract, and arbitrary concurrent producer mutation are outside this focused qualification. Nested flattening versus requested nested serialization remains a separately tracked requirements conflict; this suite makes no nested-policy parity claim. The 14-command suite and unrelated formats are not established complete by this procedure.
