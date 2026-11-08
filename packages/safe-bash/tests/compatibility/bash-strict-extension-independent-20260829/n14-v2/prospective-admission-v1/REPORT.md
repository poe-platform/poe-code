# Prospective package admission proof

Date: 2026-08-29. Scoped prospective PASS; ROOT acceptance is not published.

## Frozen bindings

- Pre-execution commit: 9cbb83c9d3491cd38cb8db818adb9f319d52d57a.
- Executable preseal SHA256: c0378c0d2a7325096f69643445fa3bdeaa92876a74da78dffd91de4aa75f0a80.
- Corrected gate SHA256: 9ce5c2829716f8b0734ac1dcb0a571f758df8874ab5d6e450c4ec03a307094a6.
- Retained archive: /private/tmp/strict-n14-independent-active-1AKd2V/strict-extension-independent-iRrorS/virtual-bash-0.0.0.tgz.
- Archive exact length 872281; SHA256 3f3ae85116f12ab4354a6103c0c95e967c4e88bd2eb133e63236148a2734af49.
- Prior manifest chain 026c4a76cd442793276730ca83bafdfcf74e4779138e754537308fc3b8a09b39 -> c471ecf8d9582fb7fed677ef25e734b51ab8f988a9e55a2c853489016cbdcabb -> RESULT c031715228f24c4bd48a231a87668f153ff7cf1ee2882fde7ac90ed372267a3a. Expected 954 member identities are copied as DATA, not regenerated from this parse.

## Actual finite results

12/12 controls PASS, one real retained-artifact admission/inflate/parse PASS. C01–C10 and C12 refuse with zero decoder/parser/extraction calls. C11 actually loads the sealed ordering mutant: its deliberately premature SPY decoder call is observed once and kills the ordering invariant; no real inflation occurs there. C12 loads the byte-identical restored gate and refuses with zero calls. The real artifact makes exactly one gunzip and one parser call, zero extraction/import/evaluation.

All 954 members match expected literal path, mode, length and SHA256; tar header checksum/regular type/end bounds also checked. Payload 4821648 bytes; decoded tar 5545984 bytes. Nothing extracted, no shipping module/consumer evaluated. No product/build/compiler/npm/native/Worker/network/private execution. Seven source-only node --check children are syntax checks, not compiler/product runs.

## Admission order and bounds

package-admission.mjs:28 checks regular lstat/type/exact size before open; :40 opens O_NOFOLLOW and fstat-binds identity; :43 reserves before :45 allocation. Reads are capped at 64KiB into one exact-size Buffer plus one EOF probe. Post-read fstat/lstat mutation checks precede :60 exact SHA rejection. Descriptor closes before :77 concurrent-buffer reservation and :80 decode. :83 parses that decoder output. There is no archive pathname reread between authentication and inflation.

Observed event sequence: lstat-type-size -> bounded-read -> postread-identity -> exact-hash -> descriptor-closed -> concurrent-buffers-reserved -> decoded -> parsed. Compressed ceiling 872281; decoded ceiling 67108864; compressed+probe+decoded ceiling+2MiB logical parser reservation peak 70078298, released to zero. C10 independently refuses insufficient concurrent capacity before decoding. Whole compressed and bounded decoded Buffers are used; this is NOT streaming inflation or exact RSS/native zlib-allocation accounting.

Metadata checks do not claim race-proof filesystem isolation from a malicious concurrent host. The exact SHA and same admitted Buffer bind the bytes actually decoded. The harness is a finite trusted code route, not a new universal OS sandbox. Untested descriptor-close failures, tar dialects, or arbitrary decompression bombs receive no new qualification.

## Capture, retirement, and preservation

Outer PID 24857, child PID 24859; natural child exit0/signal-null followed by close0/signal-null, outer exit0. Raw stdout 3438 bytes, stderr0. No timeout or termination signal, no outstanding owned fixtures (work contains only RESULT.json). Sealed source postguards and retained archive regular/type/size/hash match. Direct actual peak2; all grant/admin accounting and conservative qualifications are in CENSUS.json. Publication raw files are intentionally retained at /var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/strict-n14-prospective-publication-FOb12o; commit receipt is not recursively embedded in its own commit.

No correction runtime retried. Earlier source-only parser prefix mapping was reconciled before preseal/execution against the captured expected manifest. Source edits/tool metadata reads are not presented as a complete all-process OS telemetry trace.

The original c6992dfa admission-order finding and CLOSED/noncompliant attempt remain unchanged. Its 744 literal results are NOT rescored, rerun, or made contemporaneously compliant by this new proof. This prospective gate is in a new namespace; the old runner was not modified. The result supplies prospective correction evidence for ROOT's separate finite semantic/source adjudication; coherent end-to-end validation still requires contemporaneously compliant admission in any future authorized run. No automatic rerun or ROOT acceptance is asserted.
