# ZIP final profile manual QA

Execute from repository root on the candidate recorded in the remaining-features
evidence plan. This is a manual plan, not a discovered test script. Product
commands use memory VFS; native programs below are isolated oracles only.
Run interactive snippets with `node --import tsx --input-type=module` and import
`fixture` / `execute` from
`packages/safe-bash/tests/commands/zip-standard-flags.helpers.ts`.
`execute(command, fs, argv, archiveOptions, contextOverrides)` returns status,
owned stdout bytes and diagnostic text. `fixture()` creates `/work` in memory.
Use `toByteSource` from `packages/safe-bash/src/contracts/index.ts` for stdin.
For every case also execute its maintained negative, boundary, cancellation
and neighbor controls in the corresponding test file; manual positive QA alone
does not complete a feature. No real password is used in this plan.

## Password cross-read

1. Set payload to hex `00ff410d0a`. Invoke `zip -q0Ptest encrypted.zip -`
   with that stdin and `zipHost.entropy(length, signal)` backed by Node
   `randomBytes`, checking cancellation before generating bytes.
2. Send the resulting archive bytes on stdin to the isolated oracle:
   `python3 -c 'import sys,io,zipfile; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); sys.stdout.buffer.write(z.read("-",pwd=b"test"))'`.
   Expected status 0, stdout hex `00ff410d0a`, no extraction files.
3. Load the first frozen native archive from `zip-crypto-infozip.json` into
   `/work/native.zip`. Invoke `unzip -pPtest native.zip file`. Expected status 0,
   the exact fixture payload (60 UTF-8 bytes), no extracted files. With
   `-pPwrong`, expected status **82**, zero stdout, password diagnostic.
4. Repeat with fixture STORE/DEFLATE and Unicode passwords through the crypto
   suite. No-echo prompts need an explicitly supplied password host, not stdin.

Executed for the first frozen native STORE member and product STORE output with
CPython 3.9.6; both directions passed. This is frozen native input cross-read,
not a newly generated native regular-file encryption run. Native encrypted
stdin remains outside this passing profile: Apple Zip 3.0 `zip -qPtest - -`
with a real pipe produces a local CRC field containing DOS time in the high
word, which the current strict reader refuses with status 2. Native `-0` on
pipes returns 16. Node subprocess stdin can be a socket; that changes native
archive type metadata and is not a valid FIFO oracle. Neither difference is
waived or counted as passing password support.

## Newline conversion

Invoke `zip -q0ll newline.zip -` with ASCII `A\r\nB\nC\rX` via explicit stdin.
Then `unzip -p newline.zip -`. Expected statuses 0 / 0 and stdout hex
`410a420a430d58`; only the archive is published. Binary input is unchanged.
Run `zip-line-endings.test.ts` and `zip-text-attributes.test.ts` for native
window, Ctrl-Z, compression and binary controls. BZIP2 with `-ll` is refused
before publication, rather than treated as a passing conversion profile.
Executed: expected bytes and statuses passed.

## Gated stdin/stdout

Use `makeZipEntry("live", emptyBytes, regularAttributes, limits, signal, 0)`
with a live `source` generator yielding `first`, awaiting a manually released
promise, then yielding `last`. Iterate `streamZipArchive` explicitly. The first
record must arrive with zero source pulls. The next payload must arrive with
one pull and source EOF false, before releasing the gate. Release it in `finally`,
drain output, and verify extraction is ASCII `firstlast`, hex
`66697273746c617374`. No file publication is required. Do not wait for full
buffered `Shell.exec` output to test internal streaming.
Executed: header pulls 0; first payload pulls 1 / EOF false; final EOF true.
Maintained stream/backpressure/cleanup controls: `zip-format.test.ts` and
`zip-review.test.ts`. An opaque blocked host cannot be forcibly preempted.

## ZIP64 central fields

Invoke `zip -q0fz wide.zip -` with hex `00ff410d0a`. Inspect the serialized
central header independently with a byte reader: compressed size at +20,
size at +24 and local offset at +42 must all be `0xffffffff`. The first
ZIP64 extra ID must be 1 with ordered uint64 values `[5,5,0]`. Verify ZIP64
EOCD/locator presence and exact extraction. Expected status 0, one archive,
unchanged stdin bytes. Executed: sentinels and extra values passed.

`zip-format.test.ts` covers factored virtual sentinel neighbors without allocating
gigabytes. A **separate unexecuted large-artifact profile** must raise explicit
limits, stream a payload crossing `0xffffffff`, independently inspect central
size/compressed-size/offset promotion and locator offset, and cross-read with a
versioned native tool. Hash bytes in streaming fashion; budget disk/time/output
before starting. Tiny forced-ZIP64 success does not qualify that large artifact.

## Split reassembly

Put 150,000 bytes `2a` in `/work/large`. Invoke `zip -q0s64k split.zip large`.
Supply `zipHost.volume({archive,disk,disks})` using the explicit `volumeName`
mapping for this test namespace. Invoke `unzip -p split.zip large`, then
`zip -qs0 split.zip --out=joined.zip` and `unzip -p joined.zip large`.
Expected every status 0, exactly 150,000 `2a` bytes from both reads, bounded
`.z01` / `.z02` / `.zip` volumes, preserved split input, separate joined output.
Without a resolver, or with reordered/aliased volumes, expect refusal and no
extracted target. Executed: direct and joined bytes passed. Native reassembly
cross-read is not established by this memory-only positive case.

## Inert SFX

Prefix the newline archive above with ASCII `MZ inert\n` in memory. Invoke
`unzip -t sfx.zip`, `zip -A sfx.zip`, then `zip -qJ sfx.zip`.
Expected all statuses 0. Adjustment preserves the exact nine prefix bytes;
removal makes the first four bytes `504b0304`. No prefix is executed. Extracted
payload stays hex `410a420a430d58`. Corrupt payload/prefix ambiguity is refused
without replacing the input. Executed: read, adjustment and removal passed.
Maintained controls: `zip-repair.test.ts` / `zip-remaining-operations.test.ts`.

## Damaged recovery

Remove the 22-byte EOCD from the uncommented newline archive in memory. Invoke
`zip -F damaged.zip -O fixed.zip` and
`zip -FF damaged.zip -O recovered.zip` separately.
Expected status 0, exact damaged input preservation, separate output archives,
and extraction hex `410a420a430d58` from each. Repeat with a corrupt payload:
`-F` refuses; `-FF` may warn about partial recovery and omit that member.
No separate destination must be rejected before mutation. Cancellation must
preserve the original and close admitted cooperative work; earlier published
effects are not rolled back. Executed: missing-EOCD F/FF positives passed.
Maintained negative/partial/overlap controls: `zip-repair.test.ts`.

## Visible CLI

After builds and runtime suites settle, execute:

```sh
npm run screenshot-poe-code -- --output out/zip-qualification/cli.png bash -c 'zip --help | head -n 18; printf "A\r\nB\n" | zip -q0ll - - | wc -c'
```

Inspect the PNGs with the image viewer: legible option alignment, actual
compression/encryption/operation help, clean numeric pipeline output, no binary
terminal garbage or leaked password. Record status, screenshot hashes and
observations in the evidence plan; purge only owned generated captures afterward.
Executed: status 0; visibly aligned help and clean numeric output `270`. The
270-byte archive length is specific to this invocation/profile, not a stable
compressed-byte identity guarantee. Binary bytes are consumed by `wc`, not
rendered to the terminal.

## Grow extraction-version regression

Start with a one-member STORE archive containing `a` with ASCII `old`. In an
isolated memory fixture, set both local extraction version at +4 and central
extraction version at +6 to each of 10, 20, 45 and 46. Verify `unzip -tqq
sample.zip` succeeds before modification. Add memory file `b` containing ASCII
`new`; invoke `zip -qg sample.zip b`, then `unzip -tqq sample.zip` and `unzip -p
sample.zip a` / `unzip -p sample.zip b`. Expected statuses are all 0; payload
hex is `6f6c64` / `6e6577`, and original local record bytes remain unchanged.
Versions 9 and 47 must return 2 without replacing the original archive.

Low-level neighbor: read the classic input with `{ grow: true }`, serialize with
forced ZIP64, and verify extraction succeeds. Exact archive budget succeeds;
one byte less refuses. Pre-abort propagates the identical cancellation reason.
Serializing the same original archive afterward without forcing must reproduce
the original bytes, proving retained-record ownership was preserved.

Executed on the 2026-09-17 edge-case fix: all seven maintained regressions passed.
The password/newline/gated-stream/ZIP64/split/SFX/recovery positive steps above
were also re-executed successfully on this source revision. The native oracle
was Python 3.9.6. Historical exclusions and unexecuted large-artifact profiles
remain unchanged; see the remaining-features evidence for final gates.

Built CLI host-capability control: put the valid version-20 archive and `b` in
the explicitly scoped owned scratch root, then invoke
`node dist/bin.cjs bash --root out/zip-edge-review/cli-root -c 'zip -qg sample.zip b'`.
On this Darwin build, observed status is **2** with `ZIP publication requires
atomic owned file staging`; input remains readable and `b` is not published into
the archive. This is an unsupported real-adapter publication capability, not a
passing grow update. A compound exploratory command ended with successful
`printf`, masking grow's failure in its aggregate status; the isolated invocation
above establishes the actual grow status. The CLI stdout profile is checked
separately in the screenshot and requires no archive-file publication.

## Grow central-only ZIP64 byte-budget regression

In memory, begin with STORE member `a` containing hex `6f6c64`. Set matching
local/central extraction versions to 45. Independently replace exactly one
central field (uncompressed size, compressed size, or local offset) with
`0xffffffff` and add its ordered ZIP64 extra value (3, 3, or 0 respectively).
Adjust central extra length and EOCD directory size; retain the classic local
record. Repeat with and without a classic signed descriptor.

Read with `{ grow: true }`, serialize once to measure output length, then
serialize with `maxArchiveBytes` equal to that length. Expected: byte-identical
output; unchanged original local record; `unzip -tqq sample.zip` status 0;
`unzip -p sample.zip a` status 0 and exact hex `6f6c64`. One byte less must refuse
with the archive-byte-limit diagnostic. Pre-abort must reject with the identical
reason. All six maintained memory regressions passed after the accounting fix;
this does not establish a new native ZIP64 or real-adapter publication profile.

Metadata-limit neighbor, executed manually in memory: add one well-formed
unknown extra (`0xcafe`) alongside the central-only ZIP64 size field. At input
central extra length 65,519, `zip -qg sample.zip binary` returns 0 and rewrites
that member's extras to exactly 65,535 bytes; `unzip -tqq` returns 0 and member
`a` still yields `6f6c64`. At input length 65,535, the rewrite would require
65,551 bytes: expected/observed status 2 with an extra-field-limit diagnostic
and byte-identical original archive. This is a disclosed rewrite limit, not
positive interoperability or a promise to preserve central header bytes.

After the central-only ZIP64 budget fixes, the independent review repeated all
bounded positive steps above on current source: encrypted product STORE to
CPython 3.9.6 returned `00ff410d0a`; frozen native STORE to product matched its
60-byte payload; wrong password returned 82 with zero stdout. Newline bytes
were `410a420a430d58`. Forced ZIP64 fields were ordered `[5,5,0]`; split direct
and joined reads each returned 150,000 `2a` bytes. SFX adjustment preserved
`4d5a20696e6572740a` and removal restored `504b0304`. F/FF preserved damaged
input and recovered the newline payload. Streaming produced a header with zero
pulls, first payload with one pull and EOF false, then exact `firstlast`.
These are bounded memory-VFS checks; the native/large-artifact exclusions stand.

The final `screenshot-poe-code` invocation exited 0 but captured only a command
header; it failed visual validation. The supplementary built CLI capture used:

```sh
npm run screenshot -- --output out/zip-edge-review/settled-cli-direct.png node dist/bin.cjs bash --root out/zip-edge-review/cli-root -c 'zip --help | head -n 18; printf "A\r\nB\n" | zip -q0ll - - | wc -c; zip -qg sample.zip b; printf "grow_status=%s\n" "$?"; unzip -t sample.zip'
```

It exited 0 and passed visual inspection: aligned help, numeric `270`, explicit
atomic-staging refusal and `grow_status=2`, readable validation of the preserved
original archive. Neither aggregate screenshot status establishes grow success.
