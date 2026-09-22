# csvcut research evidence — 2026-09-20

Scope: `research-csvcut`, behavior pin and independent acceptance matrix.
No runtime code, package scaffold, publish, commit or push was performed.

## Current-main inspection

Local branch `main`, HEAD `ab1fa8d34101e1e7f61272973f3bc28a842043d8`.
The tracked tree contains `docs/plans/safe-bash-csvcut.md` but no csvcut
implementation or tests. Working-tree search of safe-bash source/tests/manifest
also finds no csvcut reference; no csvcut workspace exists in the inspected
package inventory. Thus absence is concrete inspection evidence, not a reported
runtime bug. Remote main was not queried; no delivery claim follows.

Existing untracked csvgrep/csvsort/shared CSV engine work and unrelated tracked
edits were preserved. They are not established csvcut prerequisites or tested
candidates. The package-pattern file was already deleted at the requested path
and present in `docs/plans/archive`; its private-package, contract DAG, guarded
build and bundled installed-declaration requirements were read there without
restoring or moving it.

## Source inspection receipts

Files fetched as bounded UTF-8 HTTPS text from `raw.githubusercontent.com`,
maximum 200,000 bytes per file. Nothing fetched was executed, installed or
imported. SHA256 hashes below identify the observed source responses.

| Repository revision / path | SHA256 |
| --- | --- |
| csvkit 194c904256a09dc203c460944d35e9d414244503 / csvkit/utilities/csvcut.py | 53390318f0b57b4da4ee367c55922c726ea47a48191a7caf11470832c36fd474 |
| same / csvkit/cli.py | bf1eae820afbcd614915faa44e46b2bcba7cf7639ec8dffdd6bab7e3da239ca9 |
| same / csvkit/__init__.py | b71691f66eaf70fc5b09eff5c1e80dc8f33457ddbc6d4b933b2c443c836383d9 |
| csvkit tag 2.2.0 / csvkit/utilities/csvcut.py | 245edc7ec8203c821c00cb7447948ae43fb52b121af8218b919bf80ecbeed85f |
| csvkit tag 2.2.0 / csvkit/cli.py | c471f8df975c4a934eba380f5443dd035b1e0582d957aa5d1e70f20beaf33c78 |
| agate 34856488cfcbe9077af8e3e557cbf98a044fdd64 / agate/csv_py3.py | c7691077b4cbe4a66bd941c08653f6fc47ac8f5ac7b3d96cc6ed786bc75b90c4 |

Also inspected agate/utils.py imports (not hashed or executed). A guessed
csvkit/columns.py URL returned 404; selectors actually live in cli.py, which
was then inspected. Do not treat that unsuccessful lookup as a product gap.

Authoritative source locations: csvcut.py `add_arguments/main`, cli.py
`_init_common_parser`, `_extract_csv_reader_kwargs`, `_extract_csv_writer_kwargs`,
`_open_input_file`, `get_rows_and_column_names_and_column_ids`,
`print_column_names`, `match_column_identifier`, `parse_column_identifiers`;
agate/csv_py3.py `Reader`, `Writer.writerow`, `Sniffer.sniff`.

## Findings that affect the pin

- Select release 2.2.0, not a hybrid of release and later source. The later
  source adds `--ignore-unknown-columns`; the release rejects it.
- Release exclusion open end uses `len(column_names)` as the exclusive Python
  range stop. With three columns, `-C 2-` removes only position 2. Later source
  uses `len + 1` and removes positions 2 and 3. Inclusion uses `len + 1` in
  both. Under `--zero`, open starts still default to 1 and open inclusion ends
  may exceed the last valid position. Independent controls retain these defects.
- Malformed-range errors in release retain literal `%s`; later source formats
  the identifier. Selection/unknown/exclusion errors must be versioned.
- csvcut passes kwargs directly to agate.csv.reader, with no sniffer call.
  Shared sniffer observations do not imply automatic delimiter detection or
  admission of `--snifflimit` for this command.
- Reader dialect flags do not feed the writer. NONNUMERIC is still a reader
  conversion capability, despite absence of csvkit table inference options.
- Native default encoding consults `PYTHONIOENCODING`. The requested
  deterministic utf-8-sig default explicitly removes this ambient behavior.
- Native text files open with Python universal-newline defaults. Agate's
  direct writer replaces CR character-by-character; direct cell and native
  byte-stream newline profiles need separate captures to avoid conflating them.
- Writer `-l` counts emitted rows. The shared grep physical-parser-line
  observation is preserved separately, including multiline controls.

## Delivered evidence and limits

[Acceptance matrix](safe-bash-csvcut-acceptance.md) records exact literal fixtures,
argv, projected output and source-derived errors, plus explicit pending grammar,
Python strictness/NUL/encoding, chunk, cancellation, cleanup, budgets, realm,
replay, CLI/SDK and packed-consumer cells. Expected values were specified
independently of any product implementation. Source-derived status/error
predictions are not new native execution evidence.

No native executable was run or downloaded. No implementation tests were run:
there is no csvcut implementation, and this task changes documentation only.
No CLI exists to screenshot. Python patch identity, installed-oracle hashes,
exact argparse/setup diagnostics, buffering/partial-output and direct/native
newline differences remain manual-QA requirements. No cell is counted as an
executed compatibility pass. No speculative parser repair, strict RFC4180
substitution, uniform-width validation or inferred capability was introduced.
