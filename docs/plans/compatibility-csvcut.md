# csvcut independent qualification

Compatibility target: csvkit 2.2.0 / agate 1.14.2 on Python 3.9, with separate
source controls at csvkit `194c904256a09dc203c460944d35e9d414244503` and agate
`34856488cfcbe9077af8e3e557cbf98a044fdd64`. Later source flags do not enter the
release profile. Full compatibility remains incomplete until missing cells are
executed. No XAN source admission is requested or used.

## Manual QA plan

1. Create a temporary isolated Python venv under task-owned
   `out/compatibility-csvcut`. Install csvkit==2.2.0 and agate==1.14.2 as manual
   controls only. Download the two exact source archives, extract them, and run
   a second control with explicit PYTHONPATH pointing only to those source
   roots. Record archive SHA-256 and runtime/distribution versions.
2. Extract only the literal `controls` initializer from
   `packages/safe-bash-command-csvcut/src/compatibility.test.ts` with TypeScript's
   AST. Execute each argv/input against both controls, capturing exact UTF-8
   bytes, stdout, stderr and status. Remove PYTHONIOENCODING from native
   controls so default utf-8-sig is exercised; capture UTF-8 stdout bytes.
   Candidate tests independently set that variable
   to ascii as a negative authority control. No fixtures are fetched.
3. Independently run open ranges, --zero ranges, generated names beyond z,
   whitespace/missing selectors, invalid exclusion ranges, empty names mode,
   -nH, NUL, unterminated quoting and later-source flags. Record differences
   rather than infer parity. Pipe native csvcut projection to native csvgrep
   using the exact memory fixture in csvcut-independent-controls.test.ts.
4. Run command workspace unit/lint/type checks, shared engine units, all three
   csvcut Shell boundary files and the maintained selected safe-bash build
   closure. Run artifact controls for private implementation/declarations.
5. Through built public entries execute CLI and registered SDK projection,
   pipe both to csvgrep, inspect equal complete results and unchanged VFS bytes.
   Capture and visually inspect terminal output with npm run screenshot.
6. Record candidate source fingerprint and fixture hashes, then purge task-owned
   temporary logs, downloaded sources, venv, drivers and images. Absolute /out
   is unavailable on this host; workspace out is the existing evidence route.

No native process is a unit-test dependency. No performance measurement is
semantic evidence. Preserve unrelated working-tree changes. No publication or
remote delivery is part of this task.

## Executed control receipt

Candidate base HEAD: `ab1fa8d34101e1e7f61272973f3bc28a842043d8` plus the
existing working-tree private command, CSV engine, contracts and composition.
This task changes only two test files and this qualification document; no
production repair was made. Package ownership and public export remain as
requested. Node v22.22.2, npm 10.9.7, TypeScript 5.9.3, Vitest 4.1.11.
Native Python: 3.9.6 (default, Apr 30 2025, 02:07:17)  [Clang 17.0.0 (clang-1700.0.13.5)]

Release distributions (source execution uses the same environment with only
explicit source-root PYTHONPATH overriding csvkit and agate imports):

```json
{
  "SQLAlchemy": "2.0.54",
  "agate": "1.14.2",
  "agate-dbf": "0.2.4",
  "agate-excel": "0.4.2",
  "agate-sql": "0.7.3",
  "babel": "2.18.0",
  "csvkit": "2.2.0",
  "dbfread": "2.0.7",
  "et_xmlfile": "2.0.0",
  "importlib_metadata": "8.7.1",
  "isodate": "0.7.2",
  "leather": "0.4.1",
  "olefile": "0.47",
  "openpyxl": "3.1.5",
  "parsedatetime": "2.6",
  "pip": "21.2.4",
  "python-slugify": "8.0.4",
  "pytimeparse": "1.1.8",
  "setuptools": "58.0.4",
  "text-unidecode": "1.3",
  "typing_extensions": "4.16.0",
  "xlrd": "2.0.2",
  "zipp": "3.23.1"
}
```

Source import paths were inspected and resolve to the two pinned extracted
roots, not installed distribution files. Source archive SHA-256:

- csvkit: `863825ee6d19b8253d318bbeaac9e54ac92d3c51c4dff2a7617d7f37182de603`
- agate: `131751d4706647f0b079b030672cb7ff0411a8fb1e58d20535cd15d8c96f5691`

Both native profiles were rerun with PYTHONIOENCODING removed. Initial
explicit utf-8 stdout configuration also changed csvkit input defaults and
retained the BOM. Investigation found cli.py derives encoding from that
variable; this was a control-setup failure, not a candidate BOM defect.
Corrected default utf-8-sig runs agree on BOM removal. Candidate continues to
ignore ambient encoding as required. No failed preliminary run is counted
as a completed final gate.

Exact final release observations below use JSON string escaping for literal
bytes (UTF-8), including LF, CR, NUL and BOM. All stdin cases acquire only
stdin/stdout/stderr and do not mutate fixtures. The 17 named cells compare
against literal candidate outputs: 16 semantic agreements and one NUL
deviation per native profile. Native additional observations are not all
candidate compatibility passes.

```jsonl
{"name":"duplicate-blank-exact","args":["-c","id,,x-y,id"],"input":"id,,id,x-y\nA,B,C,D\n","stdout":"id,,x-y,id\nA,B,D,A\n","stderr":"","status":0,"agree":true}
{"name":"numeric-position","args":["-c2,1,2"],"input":"2,1\nx,y\n","stdout":"1,2,1\ny,x,y\n","stderr":"","status":0,"agree":true}
{"name":"quoted-unicode-crlf","args":["-c2,1"],"input":"\ufeffa,b\r\n\"\u00e9,\ud83d\ude00\",\"x\r\ny\"\r\n","stdout":"b,a\n\"x\n\ny\",\"\u00e9,\ud83d\ude00\"\n","stderr":"","status":0,"agree":true}
{"name":"tabs-override","args":["-d;","-t","-c2"],"input":"a\tb\nx\ty\n","stdout":"b\ny\n","stderr":"","status":0,"agree":true}
{"name":"width-pad-discard","args":["-c3,1,3"],"input":"a,b,c\nshort\nx,y,z,excess\n","stdout":"c,a,c\n,short,\nz,x,z\n","stderr":"","status":0,"agree":true}
{"name":"empty-after-projection","args":["-xc1"],"input":"a,b\n,keep\n ,\n0,\n,\n","stdout":"a\n \n0\n","stderr":"","status":0,"agree":true}
{"name":"zero-columns","args":["-C1,2"],"input":"a,b\nx,y\n,\n","stdout":"\n\n\n","stderr":"","status":0,"agree":true}
{"name":"unknown-exclusions","args":["-Cmissing,999"],"input":"a,b\nx,y\n","stdout":"a,b\nx,y\n","stderr":"","status":0,"agree":true}
{"name":"physical-skip","args":["-K2"],"input":"ignored\nignored\na,b\nx,y\n","stdout":"a,b\nx,y\n","stderr":"","status":0,"agree":true}
{"name":"names-zero","args":["-n","--zero"],"input":",id,id\n","stdout":"  0: \n  1: id\n  2: id\n","stderr":"","status":0,"agree":true}
{"name":"empty-input","args":[],"input":"","stdout":"\n","stderr":"","status":0,"agree":true}
{"name":"open-range","args":["-c2-"],"input":"a,b,c\nx,y,z\n","stdout":"b,c\ny,z\n","stderr":"","status":0,"agree":true}
{"name":"zero-open-start","args":["--zero","-c:1"],"input":"a,b,c\nx,y,z\n","stdout":"b\ny\n","stderr":"","status":0,"agree":true}
{"name":"generated-names","args":["-H","-c26-29"],"input":"1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29\n","stdout":"z,aa,bb,cc\n26,27,28,29\n","stderr":"","status":0,"agree":true}
{"name":"permissive-quoted-eof","args":[],"input":"a\n\"unfinished","stdout":"a\nunfinished\n","stderr":"","status":0,"agree":true}
{"name":"python39-nul-deviation","args":["-c1"],"input":"a\nx\u0000y\n","stdout":"a\n","stderr":"Error: line contains NUL\n","status":1,"agree":false}
{"name":"embedded-crlf-no-bom","args":[],"input":"a\n\"x\r\ny\"\n","stdout":"a\n\"x\n\ny\"\n","stderr":"","status":0,"agree":true}
{"args":["-c","2-"],"input":"a,b,c\nx,y,z\n","stdout":"b,c\ny,z\n","stderr":"","status":0}
{"args":["--zero","-c",":1"],"input":"a,b,c\nx,y,z\n","stdout":"b\ny\n","stderr":"","status":0}
{"args":["--zero","-c","1-"],"input":"a,b,c\nx,y,z\n","stdout":"","stderr":"ColumnIdentifierError: Column 3 is invalid. The last column is 'c' at index 2.\n","status":1}
{"args":["-H","-c26-29"],"input":"1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29\n","stdout":"z,aa,bb,cc\n26,27,28,29\n","stderr":"","status":0}
{"args":["-c"," id"],"input":"id,value\nx,y\n","stdout":"","stderr":"ColumnIdentifierError: Column ' id' is invalid. It is neither an integer nor a column name. Column names are: 'id', 'value'\n","status":1}
{"args":["-C","1-99"],"input":"id,value\nx,y\n","stdout":"","stderr":"ColumnIdentifierError: Column 3 is invalid. The last column is 'value' at index 2.\n","status":1}
{"args":["--ignore-unknown-columns","-cmissing"],"input":"a\nx\n","stdout":"","stderr":"usage: csvcut [-h] [-d DELIMITER] [-t] [-q QUOTECHAR] [-u {0,1,2,3}] [-b]\n              [-p ESCAPECHAR] [-z FIELD_SIZE_LIMIT] [-e ENCODING] [-S] [-H]\n              [-K SKIP_LINES] [-v] [-l] [--add-bom] [--zero] [-V] [-n]\n              [-c COLUMNS] [-C NOT_COLUMNS] [-x]\n              [FILE]\ncsvcut: error: unrecognized arguments: --ignore-unknown-columns\n","status":2}
{"args":["-n"],"input":"","stdout":"","stderr":"StopIteration: \n","status":1}
{"args":["-u1"],"input":"a,b\nx,y\n","stdout":"a,b\nx,y\n","stderr":"","status":0}
{"args":["-c1"],"input":"a\nx\u0000y\n","stdout":"a\n","stderr":"Error: line contains NUL\n","status":1}
{"args":[],"input":"a\n\"unfinished","stdout":"a\nunfinished\n","stderr":"","status":0}
{"args":["-nH"],"input":"a\nx\n","stdout":"","stderr":"RequiredHeaderError: You cannot use --no-header-row with the -n or --names options.\n","status":1}
```

Pinned-source observations are identical except this later-source flag:

```json
[
  {
    "args": [
      "--ignore-unknown-columns",
      "-cmissing"
    ],
    "input": "a\nx\n",
    "stdout": "\n\n",
    "stderr": "",
    "status": 0
  }
]
```

The release flag remains rejected with candidate status 2. Both native
pipeline observations are identical:

```json
{
  "input": "id,note,extra\n1,\"a\nb\",x\n2,no,y\n3,a,z\nshort\n",
  "cut_status": 0,
  "cut_stdout": "note,id,note\n\"a\nb\",1,\"a\nb\"\nno,2,no\na,3,a\n,short,\n",
  "cut_stderr": "",
  "grep_status": 0,
  "stdout": "note,id,note\n\"a\nb\",1,\"a\nb\"\na,3,a\n",
  "stderr": ""
}
```

File controls use temporary task-owned paths, explicit removed ambient
encoding and unchanged input bytes. Identical results under both profiles:

```json
[
  {
    "profile": "release",
    "input_hex": "efbbbf612c620a782c790a",
    "args": [],
    "stdout": "a,b\nx,y\n",
    "stderr": "",
    "status": 0,
    "unchanged": true
  },
  {
    "profile": "release",
    "input_hex": "610a782cff0a",
    "args": [
      "-c1"
    ],
    "stdout": "",
    "stderr": "Your file is not \"utf-8-sig\" encoded. Please specify the correct encoding with the --encoding flag. Use the -v flag to see the complete error.\n",
    "status": 1,
    "unchanged": true
  },
  {
    "profile": "source",
    "input_hex": "efbbbf612c620a782c790a",
    "args": [],
    "stdout": "a,b\nx,y\n",
    "stderr": "",
    "status": 0,
    "unchanged": true
  },
  {
    "profile": "source",
    "input_hex": "610a782cff0a",
    "args": [
      "-c1"
    ],
    "stdout": "",
    "stderr": "Your file is not \"utf-8-sig\" encoded. Please specify the correct encoding with the --encoding flag. Use the -v flag to see the complete error.\n",
    "status": 1,
    "unchanged": true
  }
]
```

## Verification and limits

Passed, with no final focused failures/skips/cancellations/incomplete runs:

- Maintained command workspace units: 116 passed, including 17 named literal
  cells through CLI and SDK at every byte split plus empty chunks, and negative
  selectors/grammar/capability controls. Command lint and source/test types pass.
- Shared CSV engine units: 24 passed; three csvcut Shell files: seven passed.
  New Shell file ESLint and git diff --check pass. Existing checks cover
  falsey cancellation, cooperative cleanup, retained budgets, foreign realms,
  forged byte types, partial transport failure, quota rollback, symlink and
  same-file redirect effects and negative host/network authority.
- Maintained selected safe-bash build closure and native postbuild pass.
- Private artifact controls: 224 passed in four root Vitest files; isolated
  command graph, branded argv and rewritten bundled declarations are covered.
- Markdown QA steps 1–5 executed. Built public entries produce equal complete
  CLI/SDK results; native and candidate csvcut-to-csvgrep stdout bytes agree.
  VFS input and sentinel remain unchanged; failed pipefail selector status is 1.
  Screenshot inspected: multiline CSV, statuses and diagnostic are readable.

Confirmed difference: Python 3.9 native NUL input returns status 1, stdout
`a\n`, stderr `Error: line contains NUL\n`; candidate permissive-v1 returns
status 0 and `a\nx\u0000y\n`. The minimized regression explicitly pins this
candidate deviation, not native parity. Quoting modes 1/2, non-UTF-8 codecs,
Sniffer and native field-size options remain explicit unsupported capabilities;
native -u1 succeeds in the observed simple fixture. Candidate diagnostics use
`csvcut:` wording and buffered validation, whereas native incremental output
and argparse diagnostics have different bytes/effects. Do not claim error-byte
or streaming-effect parity. Strict-v1 is a candidate profile, not Python CSV
strictness equivalence. No uniform-width enforcement is introduced.

Still unverified: actual browser/workerd runtime cells, full quoting-constant/
codec/Python-patch matrix, complete Sniffer dialect/error profiles, all argparse
abbreviations/verbosity/compression, and original/checkpoint/replay execution.
Existing realm tests execute in Node only. Required upstream variants were
executed on Python 3.9.6, not every Python release. No performance measurements
were made. Full compatibility is incomplete. Full npm test, repository-wide
lint and root npm run build were not run for this focused test-only increment;
focused passes do not substitute for those broad gates.

No commit, verified remote-main delivery, publication or successful release
was performed. No private command package was published. Unrelated edits
were preserved. Task-owned temporary evidence is purged after this receipt.

## Candidate identity

Candidate SHA-256: `92754aec9471482cb3b5771b60d17b8ab2206d6be35fecf48e76c49a02c291d2` over 833 files.
Collect regular files recursively beneath these roots, excluding path
components dist and node_modules:

```text
packages/safe-bash-command-csvcut
packages/safe-bash-command-csvgrep
packages/safe-bash-csv-engine
packages/safe-bash-contracts
packages/safe-bash/src
packages/safe-fs/src
```

Add these explicit files:

```text
packages/safe-bash/package.json
packages/safe-bash/scripts/build.mjs
packages/safe-bash/scripts/integration-inputs.mjs
packages/safe-bash/integration-boundaries.json
scripts/bundle-safe-bash.mjs
scripts/package-safe.mjs
scripts/safe-command-publication.mjs
packages/safe-bash/tests/plugins/csvcut-independent-controls.test.ts
packages/safe-bash/tests/plugins/csvcut-boundaries.test.ts
packages/safe-bash/tests/plugins/csvcut-wiring.test.ts
```

Deduplicate relative POSIX paths, sort lexicographically, hash UTF-8 path,
NUL, original file bytes, NUL sequentially. This identifies the working-tree
implementation/composition/contract/filesystem graph and selected artifact
inputs, not the entire repository or lockfile. Test fixture SHA-256: `e6900d4591ad8cad377eed049e60a0e7e910e44b1b6af78c26670dbc8ad2678c`.
Shell control SHA-256: `f9a97d897db434076cbf02ebfb520e705916ad8aea0be29d1f46c431219829ef`.
