# Primary source reading map

Only target `0.54.0`, commit `2f9156c8ec79a3ecc09e0879735ac68ec8997b7a`.
Access UTC 2026-08-28. All selected upstream file hashes, URLs, sizes and cached
paths are frozen in `tests/commands/xan-oracle-prep-20260828/provenance.json`.
No whole xan repository or release binary is tracked; no Rust implementation
source was copied into the product. Exact license notices are retained separately.

Official release page:
`https://github.com/medialab/xan/releases/tag/0.54.0`.
Official tag reference API:
`https://api.github.com/repos/medialab/xan/git/ref/tags/0.54.0`.
Official expanded assets:
`https://github.com/medialab/xan/releases/expanded_assets/0.54.0`.
The GitHub release JSON endpoint returned 504 twice. Do not reinterpret that
failure as a missing release; expanded-assets HTML and matching checksum worked.
Web search/fetch inspected official release/source pages; third-party search
results were not used as semantic or license authority.

For each xan path below, prefix the immutable URL:
`https://raw.githubusercontent.com/medialab/xan/2f9156c8ec79a3ecc09e0879735ac68ec8997b7a/`.

| Path / source location | Why inspected |
| --- | --- |
| Cargo.toml:1,20,73,77,119 | target version, license expression, dependency requirements |
| Cargo.lock:401,413,589,2164 | csv 1.4.0, csv-core 0.1.13, docopt 1.1.1, simd-csv 0.9.0 checksums |
| README.md | intended CSV IO, explicit official platform distribution |
| LICENSE-MIT; UNLICENSE | complete exact license text, not remembered license claims |
| src/cmd/headers.rs:21,58,77,119,174 | grammar, Unicode headers, transposition, padding, duplicate-sensitive summaries |
| src/cmd/count.rs:8,65 | -n documentation contradiction, splitter rather than record-width validation |
| src/cmd/select.rs:105,174 | argv, zero-copy data vs decoded header serialization |
| src/cmd/slice.rs:97,176,287,330,383,417 | options, branch precedence, zero-length bug, ring/plural/range paths |
| src/select.rs:17,150,237,365,431 | complement, parser, quoted/index quirks, literal wildcards and name errors |
| src/config.rs:24,165,258,707,726,742,754,809 | ASCII delimiters, extension inference, reader distinctions, output defaults |
| src/util.rs:116,130,168,463,489 | docopt setup, stdin multiplicity, range validation, display sanitation |
| src/main.rs:219 | exact error family prefixes/status and native EPIPE special case |

Official crates.io archives are primary published crate artifacts, not third-party
reimplementations. Each archive checksum was checked against the pinned xan lock:

| Package | Archive URL | SHA256 |
| --- | --- | --- |
| simd-csv 0.9.0 | `https://static.crates.io/crates/simd-csv/simd-csv-0.9.0.crate` | `68d453a9cbd8d5f3a6fc36ae07e7a976717438f03a0bf8b790804a15ac873fb0` |
| csv 1.4.0 | `https://static.crates.io/crates/csv/csv-1.4.0.crate` | `52cd9d68cf7efc6ddfaaee42e7288d3a99d613d4b50f76ce9827ae0c6e14f938` |
| csv-core 0.1.13 | `https://static.crates.io/crates/csv-core/csv-core-0.1.13.crate` | `704a3c26996a80471189265814dbc2c257598b96b8a7feae2d31ace646bb9782` |
| docopt 1.1.1 | `https://static.crates.io/crates/docopt/docopt-1.1.1.crate` | `7f3f119846c823f9eafcf953a8f6ffb6ed69bf6240883261a7f13b634579a51f` |

simd-csv `src/core.rs` was inspected for three-state quote scanning, LF/CR behavior,
EOF permissiveness and suspicious lookahead; `records.rs` for trailing CR removal;
`utils.rs` for BOM/unescape/raw quote stripping; `zero_copy_reader.rs` for width
checks and first-header conversion; `splitter.rs` for count independence from
width; `writer.rs` for quote policy and empty-record behavior. Their file hashes
are in the pre-execution manifest. Crate Cargo metadata binds the official source
repository `https://github.com/medialab/simd-csv` and MIT license; no unpinned
master behavior is used.

csv/csv-core metadata binds `https://github.com/BurntSushi/rust-csv` and the exact
Unlicense/MIT notices. csv-core `src/reader.rs:607` documents partial-initial-buffer
BOM limitations; its NFA around 990–1055 establishes permissive quote handling.
This is why the proposed independent implementation does not claim strict RFC
parsing as native compatibility. docopt's official repository is
`https://github.com/docopt/docopt.rs`; the verified 1.1.1 archive's parse.rs
establishes options-after-positionals/--/clusters, and dopt.rs:694 establishes
empty/whitespace-only numeric values becoming zero. These additional readings
use the already bound crate archive, not a new unpinned dependency version.

## Classification

Native-observed facts are restricted to the 28 ROWS.json entries. Source-derived
facts not exercised there remain source-only. Proposed corrections/restrictions
are explicitly labeled in DESIGN.md and need root policy, not retrospective
editing of these rows. The native release's matching publisher checksum/version
does not prove a reproducible build from the source commit or transitive supply
chain attestation. No signature was present in the inspected asset listing.

## Existing local contracts

Read-only local inputs: src/contracts/{io,output,command,filesystem,plugin,path}.ts,
command.md, filesystem.md; src/commands/copy-identity.ts; table-text/index.ts and
internal.ts; package.json; brief src/commands/index.ts and src/index.ts registration
search. No xan registration was found in those inspected roots; this is a scoped
static observation, not a whole-repository proof of absence. No hidden reviewer
fixture, private checkout, old benchmark dispatch or unrelated command source
was required. New design files and native oracle artifacts are not product tests.
