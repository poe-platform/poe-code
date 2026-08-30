# Independent native holdout replay

This directory records an actual replay of the 20 frozen cases from commit
`55bd112804564605e397d3ee9948226d89efd457` against candidate
`f1a90436c45208ca248e058a039893233c608daa`. The native capture was explicitly
post-source-commit; no independent pre-source-commit freeze exists. Replay occurred
after source inspection. This is neither full native parity nor a whole-gate rescore.

## Authenticated boundaries

- Frozen `native-capture.json` SHA-256:
  `18036bce5b0a7cfcf6ae1d744a1cdb39b24a905f50d9cbb7e51f8d059b7bb4ce`.
  All 11 files in its immutable `SHA256SUMS` authenticated. The Darwin arm64 tree
  2.2.1 oracle SHA-256 remains
  `34a794e5737d4b09a20a58dc0b7231e6300a3d229be5065c3a549969d205f10a`;
  this replay did not rerun or rewrite the native freeze.
- A fresh streamed Git archive and the copied archive both matched SHA-256
  `fe133818ee69dcbdac7e2330e97fefa1dd07037ba73c6135ccf106b770e7f325`.
  All 232 selected `src/**`, package, and TypeScript configuration files matched
  their exact candidate Git blobs. The isolated build succeeded via TypeScript 5.9.3.
- The npm-packed tarball SHA-256 was
  `2713175a12912952999c6e0e8d81cef2638692b573081bc281ba0e785d099bab`.
  Its 762-file recursive manifest exactly matched the clean moved installation.
- Source-build and bare-package imports loaded distinct paths but identical root and
  tree modules: root SHA-256
  `77b771a6066aa32f82b903f7a80c578132388d6d9cec9fbde15485915859df5d`,
  tree SHA-256
  `702a5d511ede375a30473275f8428b84f7b4c44b7caa706ba3796d5e9b94140a`.
  The installed consumer used literal bare `import("virtual-bash")`, resolved within
  the moved installation, and contained no source import or fallback.
- Every case on both boundaries observed the same 70-command default registry,
  including `tree`; registry-name-list SHA-256 was
  `8474668b6e9abe5450d7096b0b0a5efafc464f50c98d7ede411e6ae0604aec2c`.
  Author handoff commit `0d8623634995549d8e717d310c28db83a02a9532`, file blob
  `6c3d64ad1e81f86b804ddfeb6bcb025acb192529`, was also authenticated.

Full authentication data is in `authentication-001.json`.

## Result

Attempt 004 is the final replay. Each boundary ran 20 isolated children with explicit
virtual environments, ignored stdin, a 5-second process deadline, a 3-second Shell
abort deadline, 64 KiB Shell output limit, and 256 KiB per child-stream cap.

| Boundary | literal parity | native-only observations | native same / different | clean close events |
| --- | ---: | ---: | ---: | ---: |
| committed source build | 11/11 | 9 | 6 / 3 | 20/20 |
| moved installed package | 11/11 | 9 | 6 / 3 | 20/20 |

All 22 asserted literal boundary/case results matched frozen stdout bytes, status 0,
and empty stderr. The 18 native-only boundary/case runs were observations, not
retroactive parity assertions. All followed the committed virtual contract:

- `LANG=en_US.utf8` produced UTF-8 connectors (147 bytes) rather than native ASCII
  connectors (111 bytes), the documented lowercase `.utf8` virtual extension.
- Empty and unknown explicit `--charset` each returned status 2, no stdout, and the
  supported-charsets diagnostic rather than native status-0 ASCII output.
- The other six native-only cases happened to match native bytes: empty/unknown
  environment selection, locale fallthrough, and ASCII fallback behaved as specified.

No candidate bug was found in this cohort. Literal equality on this simple ASCII-name
fixture does not add traversal, counting, sorting, filename escaping, annotation, or
collation semantics. In particular, it does not hide retained native differences in
those areas. The native-only divergences above are deliberate contract outcomes.

Final result SHA-256:
`f5a8093f2d4b357ae17302753ab390f9763dbe03b529a1771dce3fe66eafcd92`.
Raw child stdout/stderr is under `attempt-004/raw-children/`; the consolidated file is
`attempt-004/replay-results.json`.

## Preserved corrections

- Attempt 001 failed before spawning cases because runner v1 misaddressed parsed CLI
  keys. Its empty raw directory and failure description are retained.
- Attempt 002 closed all 40 children, but worker v1 failed after Shell execution while
  hashing `file:` URL strings. All raw streams and result SHA-256
  `e7d34f6b4887de9462054feedb3a94fd8d50b0e860bc492f483a1a54d7b1493d`
  are retained. Worker v2 corrected only URL handling.
- Attempt 003 passed with result SHA-256
  `ffedc904eb60b65489edfddfb9c8a08ebd83900356fe37eb62631e924975b8d6`.
  Attempt 004 repeated it after removing an unrelated nested retry-copy artifact;
  `copy-correction-001.txt` records why.
- Three build/authentication preflight failures are retained verbatim with their
  corrections. Frozen expectations were never changed.
