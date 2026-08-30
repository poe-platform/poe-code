# Existing D03 diagnostic acquisition — STOP

## Actual result

Source/preseal commit33860b2b88f6e1b5492bfe3fb60d9ea41b70fa69; PRESEAL SHA25608e4dfa8914c4f9ed73d29c2bdccfe261123e19094f43bbe4f406d6583366932 (1439bytes). This is a new selected-field acquisition attempt, not a D03 rerun.

The sealed reader returned **NO_EXACT_MATCH** after one candidate header. It stopped and closed its one report descriptor. There was no second read/selector retry, no alternate directory/log access, no target or diagnostic-program launch, and no fence change.

- Both approved locator roots were inspected through fixed nonrecursive node/sandbox-exec .ips name patterns only. No unrelated names were retained or logged. One filename passed the declared process/date/time filter; the inventory and header limits were not reached.
- Candidate: /Users/kjopek/Library/Logs/DiagnosticReports/node-2026-08-29-000637.ips,6779bytes; mtime1787979997076.6523. The filename/mtime are metadata, **not proof that historical PID17408 reached Node**.
- One6779-byte header read was made under the8192-byte header allowance. Because the file itself is6779bytes, that header read physically covered the entire file. It was scanned only for identity/timestamp matching; no full-record selection/exception-body parsing/hash phase was admitted. The counter fullRecordsRead=0 denotes that latter phase, not zero whole-file-byte exposure.
- No exact record was selected, so there is no authenticated raw-record SHA256 to report. No raw header or record was copied to task captures or committed. Selected events contain762bytes; the nonmatching header's PID/path/timestamps were deliberately omitted from published evidence.
- Historical D03 remains SIGABRT with empty captures and cause UNKNOWN. Native qualification9 and semantics40 remain UNRUN.

## Important selection limitation

The reader required matchingPID17408, node/sandbox-exec process name, an exact predeclared executable path, parent17404 when present, AND both procLaunch/captureTime within the observed45ms interval expanded by1000ms. That is a **stricter author selector** than the root-authorized +/-120second metadata inventory window. It was declared in PLAN.json before access; it is not a root-required timestamp rule.

The single failed Boolean does not retain which subpredicate failed. Therefore this evidence cannot establish that the candidate is unrelated, that PID17408 has no diagnostic record, that a permission is missing, or which executable aborted. In particular, the filename appears13seconds after D03's observed finish in the declared CDT filename interpretation, but no inference is made about the header's launch/capture fields. Absolute-path matching could also refuse a privacy-placeholder path; whether that occurred is UNKNOWN.

No selector was widened or rerun after STOP. A different source-only review can assess the matcher and propose minimally sufficient PID/time/image correlation plus mismatch-category reporting. If root wants another acquisition, it requires a fresh explicit grant; this packet does not authorize reopening the candidate, relaxing identity checks, or an automatic fallback. Do not cycle fence permissions on this result.

## Source/primary basis

Apple documents the first IPS JSON object as metadata and the remaining object as crash data; procLaunch/captureTime describe process timing, unlike the metadata tracking timestamp. It also notes that procPath can use privacy placeholders. Primary reference: https://developer.apple.com/documentation/xcode/interpreting-the-json-format-of-a-crash-report . These schema facts do not identify this candidate's process or cause.

The reader uses bounded regular-file/O_NOFOLLOW admission, at most4 headers of8KiB, and only one full matched record of at most2MiB. It never executes report content. Selected reasons/images are explicitly restricted; no stack/environment is published. Six synthetic header-parser checks preceded access; they are DATA checks, not evidence of record matching or OS containment. Reader-v1/v2 preparation sources remain preserved; reader-v3 is the sealed active reader.

## Accounting and preservation

Fresh authorization starts1787981104026, deadline1787982004026:15minutes,32ALL-processes/peak2,32MiB capture/128MiB working including publication. Reading/parsing used the existing owner process and no new OS child. Administrative Git/editing children are captured separately. Counts describe observed direct lifecycle, not a universal kernel census, RSS, or hard filesystem-operation preemption.

Original F01/D01/D02/D03 evidence, source, profiles and all diagnostic files remain unchanged. Only this owned evidence subtree is committed. Selected-field artifacts authenticate what was retained; deliberately excluded private raw record bytes cannot be reconstructed from this packet. Terminal publication receipts use explicit cutoffs and remain at the owned capture locator.
