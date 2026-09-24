# Bounded XAN module

Internal TypeScript ESM module for `virtual-bash`, independently implemented
against accepted baseline `5137a74ec855a32d8a8860eb66b62eb44d11e290`.
No runtime dependencies, native commands, ambient files or network fallback.
This module does not add root exports, package exports or default registration.
The public normative freeze is `55810d4aea70fadf151c2fbf746a17f96bfeb599`.
Author tests are project expectations, not independent acceptance or native parity.

Factories: `createXanCommand`, `createXanCommands`, `xanCommands`.
The family contains one registry command, `xan`; plugin name `xan-commands`.
Options are `replace?: boolean` and `limits?: Partial<XanLimits>`.
Unknown keys and invalid limits fail construction. Limits are invocation-wide.

## CLI

- `headers` / `h`: `-j/--just-names`, `--csv`, `-s/--start N`,
  `--color auto|never`, zero or more inputs (at most one `-`).
- `count`: `-n/--no-headers`, `-H/--human-readable`, `-c/--check-alignment`,
  `-a/--approx`, `-p/--parallel`, `-t/--threads N`, zero or one input.
  Counting remains exact and sequential through EOF within invocation limits.
  Approximation and parallel/thread options require a file; parallel/thread options
  emit `nothing is actually parallelized!`. Threads must be positive. Approximation
  conflicts with alignment; parallel/thread options conflict with either mode.
  Human-readable counts use comma grouping and a short suffix from 10,000 rows;
  as in XAN 0.61.0, parallel/thread options bypass human-readable formatting.
- `select`: `-n/--no-headers`, required literal selector, optional input.
  `-e/--evaluate` accepts a single ASCII column identifier; `-f/--evaluate-file`
  reads that expression from a virtual UTF-8 file instead of a literal selector.
  Surrounding whitespace is accepted; other expression syntax refuses.
- `slice`: `-n/--no-headers`, `-s/--start N`, `--skip N`, `-e/--end N`,
  `-l/--len N`, `-i/--index N`, `-I/--indices LIST`, `-L/--last N`,
  `-B/--byte-offset N`, `--end-byte N`, `--raw`,
  `-S/--start-condition EXPR`, `-E/--end-condition EXPR`.
  Conditions support named columns compared with quoted strings or finite numeric
  literals using `==`, `!=`, `<`, `<=`, `>`, `>=`; other Moonblade expressions refuse.
  Start includes the first matching row; end excludes the first matching row.
  Row ranges apply after the start condition. Indices conflict with conditions.
  Byte offsets require a file and stream past preceding bytes within input/work limits;
  this is not constant-time seeking. End-byte is exclusive and, matching XAN 0.61.0,
  applies only with a byte offset. Raw requires both offsets and copies exact bytes
  after serializing the original header (unless `-n`), ignoring row/condition flags.
  Last-row mode ignores byte offsets and conditions, matching XAN 0.61.0.
- Every subcommand accepts `-h/--help`, `-d/--delimiter BYTE`, `-o/--output PATH`.
  Long equals forms, short attached values, clustered switches and `--` work.
  Repeated flags and mixed slice modes refuse. Headers has no `-n`.

No input means borrowed stdin. `-` denotes stdin/stdout. Virtual paths resolve
against command cwd. `.tsv`/`.tab`, `.ssv`/`.scsv`, `.psv` infer tab, semicolon,
pipe; otherwise comma. Input delimiter override does not change output delimiter.
NUL/CR/LF/quote/non-ASCII delimiters refuse; literal `\t` is accepted.
Compression and `.cdx`, `.ndjson`, `.jsonl`, `.vcf`, `.gtf`, `.gff2`, `.sam`,
`.bed` formats refuse, as do expressions beyond the condition subset and
forced color. No shell/eval interpretation occurs.

Selectors use the adopted consuming grammar: signed indices, named duplicate
occurrences, literal byte prefix/suffix, inclusive reversible/open ranges,
ordered duplicate lists and one leading complement. Whole empty means all;
bare `!` selects zero fields. One trailing comma is permitted. Quoted numbers
select column names; doubled selector quotes decode to one quote. Range second
endpoints treat stars as literal names. Syntax/numeric errors precede I/O;
resolution errors consume only the first logical record and precede publication.
Empty headerless select input emits nothing without resolving column positions;
selector syntax is still validated before I/O.
Run source-only select regression coverage from `packages/safe-bash` with
`node --import tsx --conditions=poe-code-source --test tests/experimental/xan-select.test.mjs`.

Headers decode only first records as fatal UTF-8. Count is a quote-state splitter
without width validation unless `-c/--check-alignment` is set. Select/slice preserve bytes, refuse stray/post-close
quotes and enforce first-record width. BOM stripping is source-offset-zero only.
Select retains EOF CR; slice removes it. EOF quoted fields are safely completed.
Select may preserve valid same-comma data lexemes; cross-delimiter data is decoded
and reserialized. Header rows always serialize decoded cells.
Ordinary zero/equal slice ranges retain the post-write stop behavior (remainder);
`-L0` emits no data uniformly. `-n -L0` acquires no input iterator.

## Logical limits

Resource limits are unlimited when omitted. Each explicit limit must be a positive
safe integer and leaves other limits unlimited; there is no implicit ceiling.

| Name | Default |
|---|---:|
| maxArgs | Unlimited |
| maxArgumentBytes | Unlimited |
| maxInputFiles | Unlimited |
| maxInputBytes | Unlimited |
| maxChunks | Unlimited |
| maxChunkBytes | Unlimited |
| maxRecordBytes | Unlimited |
| maxCellBytes | Unlimited |
| maxColumns | Unlimited |
| maxRecords | Unlimited |
| maxSelectorBytes | Unlimited |
| maxSelectorNodes | Unlimited |
| maxSelectorDepth | Unlimited |
| maxSelectedColumns | Unlimited |
| maxLastRows | Unlimited |
| maxWork | Unlimited |
| maxOutputBytes | Unlimited |
| maxRetainedBytes | Unlimited |

These bound logical work/storage, not RSS, elapsed time or provider allocations.
Input delivery accounting includes empty chunks and unread chunk tails. Output
accounting combines stdout, stderr and files; diagnostics require their full
remaining budget. Parent sink/provider limits are not raised or bypassed.

## VFS and lifecycle limits

Input requires actual `readStream`. Borrowed stdin forwards `next` only and is
never returned/cancelled. Cleanup registers before input acquisition; repeated
close calls share completion. Output ownership is destination-specific; file and
stderr are independent of stdout closure. Opaque host work is observed with
cancellation and late rejection handlers, not universally drained or preempted.
Owned VFS iterator returns are enrolled as cooperative resource cleanup; an
uncooperative registered return can delay settlement. Pending opaque `next`,
metadata or write promises are not themselves cleanup barriers.

Output preflight rejects same paths, same/unknown identities, dangling destination
links and borrowed stdin with existing output. `compareObservedEntries` supplies
existing-file authority; URI or bare inode guesses are not used. Missing output
requires actual `wx`; proven distinct existing output uses `w`. No explicit mode,
chmod, append emulation, temp file, rename or rollback. Streaming output may leave
partial files on later errors. Missing `writeStream` uses bounded whole-result
`writeFile` with identical flags and simultaneous staging accounting. Identity
observation is not an atomic open condition, lease or ABA defense. No deployed
provider acceptance or full XAN/just-bash comparison is claimed.

Source-only count compatibility checks: from the repository root run
`node --import tsx --conditions=poe-code-source --test packages/safe-bash/tests/commands/xan-count-options.test.mjs`.

Source-only slice compatibility checks: run
`node --import tsx --conditions=poe-code-source --test packages/safe-bash/tests/commands/xan-slice-options.test.mjs`.
