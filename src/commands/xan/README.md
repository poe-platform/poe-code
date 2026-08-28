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
- `count`: `-n/--no-headers`, zero or one input; exact count through EOF.
- `select`: `-n/--no-headers`, required literal selector, optional input.
- `slice`: `-n/--no-headers`, `-s/--start N`, `--skip N`, `-e/--end N`,
  `-l/--len N`, `-i/--index N`, `-I/--indices LIST`, `-L/--last N`.
- Every subcommand accepts `-h/--help`, `-d/--delimiter BYTE`, `-o/--output PATH`.
  Long equals forms, short attached values, clustered switches and `--` work.
  Repeated flags and mixed slice modes refuse. Headers has no `-n`.

No input means borrowed stdin. `-` denotes stdin/stdout. Virtual paths resolve
against command cwd. `.tsv`/`.tab`, `.ssv`/`.scsv`, `.psv` infer tab, semicolon,
pipe; otherwise comma. Input delimiter override does not change output delimiter.
NUL/CR/LF/quote/non-ASCII delimiters refuse; literal `\t` is accepted.
Compression and `.cdx`, `.ndjson`, `.jsonl`, `.vcf`, `.gtf`, `.gff2`, `.sam`,
`.bed` formats refuse, as do expressions, conditions, byte slicing, raw slicing,
parallel/approximate count and forced color. No shell/eval interpretation occurs.

Selectors use the adopted consuming grammar: signed indices, named duplicate
occurrences, literal byte prefix/suffix, inclusive reversible/open ranges,
ordered duplicate lists and one leading complement. Whole empty means all;
bare `!` selects zero fields. One trailing comma is permitted. Quoted numbers
remain numeric; doubled selector quotes remain two characters. Range second
endpoints treat stars as literal names. Syntax/numeric errors precede I/O;
resolution errors consume only the first logical record and precede publication.

Headers decode only first records as fatal UTF-8. Count is a quote-state splitter
without width validation. Select/slice preserve bytes, refuse stray/post-close
quotes and enforce first-record width. BOM stripping is source-offset-zero only.
Select retains EOF CR; slice removes it. EOF quoted fields are safely completed.
Select may preserve valid same-comma data lexemes; cross-delimiter data is decoded
and reserialized. Header rows always serialize decoded cells.
Ordinary zero/equal slice ranges retain the post-write stop behavior (remainder);
`-L0` emits no data uniformly. `-n -L0` acquires no input iterator.

## Logical limits (default / hard ceiling)

| Name | Default | Ceiling |
|---|---:|---:|
| maxArgs | 128 | 4096 |
| maxArgumentBytes | 65536 | 1048576 |
| maxInputFiles | 16 | 256 |
| maxInputBytes | 268435456 | 4294967296 |
| maxChunks | 262144 | 4194304 |
| maxChunkBytes | 8388608 | 67108864 |
| maxRecordBytes | 8388608 | 67108864 |
| maxCellBytes | 4194304 | 33554432 |
| maxColumns | 16384 | 65536 |
| maxRecords | 1000000 | 16000000 |
| maxSelectorBytes | 16384 | 262144 |
| maxSelectorNodes | 4096 | 65536 |
| maxSelectorDepth | 2 | 2 |
| maxSelectedColumns | 16384 | 65536 |
| maxLastRows | 4096 | 65536 |
| maxWork | 1000000000 | 16000000000 |
| maxOutputBytes | 268435456 | 4294967296 |
| maxRetainedBytes | 33554432 | 268435456 |

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
