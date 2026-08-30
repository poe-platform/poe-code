# Independent full846 package addition

## Verdict and historical qualification

**PASS, narrow additive packing proof.** The original length review remains
accepted under `16c4502da78ac209e8979d7bd576f2be5492f104` for the 845-file runtime,
declaration, and package.json projection. Its original package
`351e03ad72b0bd82bb16d97cc50ec80b136edeaf705ec1590b414cb4cdf8b82e` is unchanged and
is **not** relabeled full-package composition parity. The author's original
`reconstruct.mjs` and every original result remain immutable.

The old projection omitted only `package/README.md` compared with accepted
baseline5137 fullpack `13fe54de1cf900d587855e276375fdf72ed1ed0d0e0625cf7ef00730f2bb74c9`.
That omission came from staging only package.json and dist, not from the interpreter
branch. This revision closes precisely that inventory gap; it does not rescore
the original 60 observations or 93 regressions.

## New artifact and bindings

- Artifact: `result/virtual-bash-0.0.0.tgz`, **742,519 bytes; 846 regular members**.
- SHA256: `ff230f2e9079cc843198533e412f836abb62e4ade63f4fa210b7269f7deb4eff`.
- npm SHA1: `aefe9d8c32902b2ca1cbb20de9285e3f18632ac5`.
- npm integrity: `sha512-fEyo+YMtZbO6d77YhArZnuu2NPt6aWYpAdxB+xaZX4z9WuM9z41roV4jR9ehTMldNuWLnKVJu0FUQXNWuwy3bQ==`.
- Complete member SHA256/bytes/modes and npm file manifest are in
  `result/REPORT.json`, SHA256
  `04cbb2f907badb0dabde5a5c1f16ed4f63056d2efd1a395dd1d90c7f10746100`.
- Exact added member: `package/README.md`, **36,273 bytes, mode0644**, SHA256
  `87e92b73c7339b104212a9fb11006d339694f65575a7b79debfaa902ef9cf9d1`.
  Its content was independently matched both to the authenticated baseline pack
  and `5137a74ec855a32d8a8860eb66b62eb44d11e290:README.md`.

All **845 common files are byte-for-byte identical**, with identical SHA256,
length, and mode0644, to the previously reviewed projection. No member was removed
or renamed. The full846 path inventory now exactly matches the accepted baseline
full846. Relative to that baseline, content differs only in the approved
`dist/commands/structured/interpreter.js`, `.js.map`, and `.d.ts.map` artifacts;
all declaration contents are unchanged. Candidate source identity remains
`74361026502d76b8c2b696f9c60e410ac9b78d95`, not moving HEAD.

## Actual execution and metadata

Preseal commit `4e4fbb56ae92720735bb30c63b27708a22d248e1` was created at
2026-08-28 **01:32:06 -05:00**, before the sole fresh packing execution,
**06:32:17.578–06:32:21.022 UTC** (01:32:17–01:32:21 CDT). The runner checks its
committed bytes before staging. No failed pack attempts preceded this result.

Authenticated Node **v22.22.2**, executable SHA256
`5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011`, invoked the
authenticated npm CLI directly. All **2,039 npm tool files/links** were inventoried
before and after, with unchanged aggregate SHA256
`e24c6333b73bc817b544fca92fc5696c0a69dff6a108088594032b2d0dff1fe3`.
The command used an empty isolated stage, HOME/config/cache, offline mode, and
disabled lifecycle scripts. It installed no dependencies. The complete command,
environment, exit0, stdout, and stderr are retained. Only owned temporary files
were removed; the process exited and scratch removal was confirmed.

Package.json is byte-identical: name/version/private flag, engines, files, scripts,
main/types, **25 export keys**, and all development metadata are unchanged.
Runtime, optional, peer, and bundled dependencies remain empty. All **50 declared
export target patterns/paths** resolve to retained members by static inventory;
this is not a new import or execution test. npm's 846-member list, sizes/modes,
compressed size, SHA1, and SHA512 were checked against the produced archive.
Unpacked payload totals **4,113,345 bytes**. Tar paths, checksums, regular-file types,
duplicates, and archive bounds were checked before any staging writes.

Three explicitly limited in-memory manifest controls reject missing README,
changed interpreter digest, and changed package.json mode. These are comparator
controls, not product mutants or new behavioral cases. The stage, Node/npm inputs,
and all **22 prior independent evidence files** remain unchanged before/after.

## Completeness limits and verification

This is a complete **846-member distributable composition**, not a complete source
repository or Git-history archive. Prior source/build provenance remains the
authenticated **269-input selected archive**, SHA256
`9b9b7c8a7e4c117c2348dfcbc06be64f6dc569301182142122e806d8c7282625`, with baseline5137
inputs and the single approved interpreter overlay. This run reused its proven
emitted bytes; it did not rebuild, import, install, run native oracles, replay
60+93 tests, or execute a whole gate. No AGENTS files, private repositories, live
product source, root exports, or author fixtures were copied or edited.

From repository root, run:

```sh
node tests/commands/structured-length-independent-20260828/full-package-addendum-v1/verify-seal.mjs
```

This verifies exact new-scope membership/hashes, the historical evidence, recipe
commit, old/new package contents, and metadata without repacking or executing
product. Historical whole-directory seal validators are not silently rewritten
to admit this new append-only revision; this versioned verifier supplies that
explicit composition boundary.
