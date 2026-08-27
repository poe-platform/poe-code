# Exact nonpass routing

Every listed nonpass remains in its profile denominator. Raw expected/actual byte fields, stdout/stderr text views, scripts and filesystem entries are in failure-routes.json; complete both-engine rows are in each functional.json.

| Profile | Case ID | Engine | Fields | Route/category |
|---|---|---|---|---|
| original | command/dirname/nul | just-bash | stdout | Exact native profile mismatch; no waiver or assumed cause |
| original | command/printf/binary | just-bash | stdout | Returned byte API mismatch consistent with UTF8 re-encoding; NOT internal pipe/file corruption proof |
| original | command/mkdir/mode | just-bash | stderr, exitCode, entries | Exact native profile mismatch; no waiver or assumed cause |
| original | command/touch/reference | just-bash | stdout | Exact native profile mismatch; no waiver or assumed cause |
| original | command/cp/preserve-link | just-bash | stdout, stderr, exitCode, entries | Exact native profile mismatch; no waiver or assumed cause |
| original | command/rm/empty-directory | just-bash | stderr, exitCode, entries | Exact native profile mismatch; no waiver or assumed cause |
| original | command/ln/hardlink | just-bash | stdout, entries | Exact native profile mismatch; no waiver or assumed cause |
| original | command/readlink/no-newline | just-bash | stdout, stderr, exitCode | Exact native profile mismatch; no waiver or assumed cause |
| original | command/realpath/existing | just-bash | stdout, stderr, exitCode | Baseline command absent from installed union |
| original | command/realpath/missing-tail | just-bash | stdout, stderr, exitCode | Baseline command absent from installed union |
| original | command/realpath/relative | just-bash | stdout, stderr, exitCode | Baseline command absent from installed union |
| original | command/cat/binary-stdin | just-bash | stdout | Returned byte API mismatch consistent with UTF8 re-encoding; NOT internal pipe/file corruption proof |
| original | command/head/negative | just-bash | stdout, stderr, exitCode | Exact native profile mismatch; no waiver or assumed cause |
| original | command/tail/bytes | just-bash | stdout | Returned byte API mismatch consistent with UTF8 re-encoding; NOT internal pipe/file corruption proof |
| original | command/wc/words-lines | just-bash | stdout | Exact native profile mismatch; no waiver or assumed cause |
| original | command/wc/unicode | just-bash | stdout | Exact native profile mismatch; no waiver or assumed cause |
| original | command/tee/file | just-bash | stdout | Returned byte API mismatch consistent with UTF8 re-encoding; NOT internal pipe/file corruption proof |
| original | command/sort/nul-unique | just-bash | stdout, stderr, exitCode | Exact native profile mismatch; no waiver or assumed cause |
| original | command/uniq/counts | just-bash | stdout | Exact native profile mismatch; no waiver or assumed cause |
| original | command/cut/bytes | just-bash | stdout, stderr, exitCode | Exact native profile mismatch; no waiver or assumed cause |
| original | command/cut/complement | just-bash | stdout, stderr, exitCode | Exact native profile mismatch; no waiver or assumed cause |
| original | command/env/clean | just-bash | stdout | Exact native profile mismatch; no waiver or assumed cause |
| original | command/env/unset | just-bash | stdout | Exact native profile mismatch; no waiver or assumed cause |
| original | command/env/nested | just-bash | stdout | Exact native profile mismatch; no waiver or assumed cause |
| original | command/xargs/batch | just-bash | stdout, stderr, exitCode | Exact native profile mismatch; no waiver or assumed cause |
| original | command/xargs/replace | just-bash | stdout, stderr, exitCode | Exact native profile mismatch; no waiver or assumed cause |
| original | command/find/nul | just-bash | stdout, stderr, exitCode | Exact native profile mismatch; no waiver or assumed cause |
| original | command/rg/fixed | just-bash | stdout, exitCode | Exact native profile mismatch; no waiver or assumed cause |
| original | command/base64/decode | just-bash | stdout | Returned byte API mismatch consistent with UTF8 re-encoding; NOT internal pipe/file corruption proof |
| original | command/base32/encode | just-bash | stdout, stderr, exitCode | Baseline command absent from installed union |
| original | command/base32/decode | just-bash | stdout, stderr, exitCode | Baseline command absent from installed union |
| original | command/base32/wrap | just-bash | stdout, stderr, exitCode | Baseline command absent from installed union |
| original | command/xxd/plain | just-bash | stdout, stderr, exitCode | Baseline command absent from installed union |
| original | command/xxd/reverse | just-bash | stdout, stderr, exitCode | Baseline command absent from installed union |
| original | command/xxd/layout | just-bash | stdout, stderr, exitCode | Baseline command absent from installed union |
| original | command/od/hex | just-bash | stdout | Exact native profile mismatch; no waiver or assumed cause |
| original | command/od/decimal | just-bash | stdout | Exact native profile mismatch; no waiver or assumed cause |
| original | command/od/skip-count | just-bash | stdout | Exact native profile mismatch; no waiver or assumed cause |
| original | command/cksum/stdin | just-bash | stdout, stderr, exitCode | Baseline command absent from installed union |
| original | command/cksum/files | just-bash | stdout, stderr, exitCode | Baseline command absent from installed union |
| original | command/cksum/algorithm | just-bash | stdout, stderr, exitCode | Baseline command absent from installed union |
| original | command/gzip/roundtrip | just-bash | stdout | Returned byte API mismatch consistent with UTF8 re-encoding; NOT internal pipe/file corruption proof |
| original | command/gunzip/stdin | just-bash | stdout | Returned byte API mismatch consistent with UTF8 re-encoding; NOT internal pipe/file corruption proof |
| original | command/zcat/stdin | just-bash | stdout | Returned byte API mismatch consistent with UTF8 re-encoding; NOT internal pipe/file corruption proof |
| original | command/diff/unified | just-bash | stdout, stderr | Exact native profile mismatch; no waiver or assumed cause |
| original | command/diff/ignore-space | just-bash | stderr, exitCode | Exact native profile mismatch; no waiver or assumed cause |
| original | command/patch/apply | just-bash | stderr, exitCode, entries | Baseline command absent from installed union |
| original | command/patch/dry-run | virtual-bash | entries | Documented original scratch profile defect retained as exact mismatch |
| original | command/patch/dry-run | just-bash | stderr, exitCode, entries | Baseline command absent from installed union |
| original | command/patch/reverse | just-bash | stderr, exitCode, entries | Baseline command absent from installed union |
| original | command/chmod/recursive-reference | just-bash | stderr, exitCode, entries | Exact native profile mismatch; no waiver or assumed cause |
| original | command/stat/follow | just-bash | stdout, stderr, exitCode | Exact native profile mismatch; no waiver or assumed cause |
| original | command/stat/timestamp | just-bash | stdout | Exact native profile mismatch; no waiver or assumed cause |
| original | command/mktemp/file | just-bash | stdout, stderr, exitCode | Baseline command absent from installed union |
| original | command/mktemp/directory | just-bash | stdout, stderr, exitCode | Baseline command absent from installed union |
| original | command/mktemp/suffix-dry-run | just-bash | stdout, stderr | Baseline command absent from installed union |
| original | command/paste/nul-shared | just-bash | stdout, stderr, exitCode | Exact native profile mismatch; no waiver or assumed cause |
| original | command/comm/totals | just-bash | stdout, stderr, exitCode | Exact native profile mismatch; no waiver or assumed cause |
| original | command/join/outer | just-bash | stdout, stderr, exitCode | Exact native profile mismatch; no waiver or assumed cause |
| original | command/join/duplicate | just-bash | stdout, stderr, exitCode | Exact native profile mismatch; no waiver or assumed cause |
| original | kernel/type/type | virtual-bash | stdout | Architectural introspection profile mismatch: command/command/function versus builtin/file/function |
| original | composition/text-filter/text-filter | just-bash | stdout | Exact native profile mismatch; no waiver or assumed cause |
| original | composition/binary-roundtrip/binary-roundtrip | just-bash | stdout | Returned byte API mismatch consistent with UTF8 re-encoding; NOT internal pipe/file corruption proof |
| original | composition/patch-hash/patch-hash | just-bash | stdout, stderr, entries | Exact native profile mismatch; no waiver or assumed cause |
| original | composition/find-xargs/find-xargs | just-bash | stdout, stderr | Exact native profile mismatch; no waiver or assumed cause |
| original | network/curl/get | just-bash | stdout | Returned byte API mismatch consistent with UTF8 re-encoding; NOT internal pipe/file corruption proof |
| original | network/curl/post-stdin | just-bash | stdout, exitCode | Exact native profile mismatch; no waiver or assumed cause |
| original | network/curl/post-file | just-bash | stdout | Exact native profile mismatch; no waiver or assumed cause |
| original | network/curl/json | just-bash | stdout, stderr, exitCode | Exact native profile mismatch; no waiver or assumed cause |
| original | network/curl/redirect | just-bash | stdout | Returned byte API mismatch consistent with UTF8 re-encoding; NOT internal pipe/file corruption proof |
| original | network/curl/fail-body | just-bash | stdout, stderr, exitCode | Exact native profile mismatch; no waiver or assumed cause |
| scratch-aligned | command/dirname/nul | just-bash | stdout | Exact native profile mismatch; no waiver or assumed cause |
| scratch-aligned | command/printf/binary | just-bash | stdout | Returned byte API mismatch consistent with UTF8 re-encoding; NOT internal pipe/file corruption proof |
| scratch-aligned | command/mkdir/mode | just-bash | stderr, exitCode, entries | Exact native profile mismatch; no waiver or assumed cause |
| scratch-aligned | command/touch/reference | just-bash | stdout | Exact native profile mismatch; no waiver or assumed cause |
| scratch-aligned | command/cp/preserve-link | just-bash | stdout, stderr, exitCode, entries | Exact native profile mismatch; no waiver or assumed cause |
| scratch-aligned | command/rm/empty-directory | just-bash | stderr, exitCode, entries | Exact native profile mismatch; no waiver or assumed cause |
| scratch-aligned | command/ln/hardlink | just-bash | stdout, entries | Exact native profile mismatch; no waiver or assumed cause |
| scratch-aligned | command/readlink/no-newline | just-bash | stdout, stderr, exitCode | Exact native profile mismatch; no waiver or assumed cause |
| scratch-aligned | command/realpath/existing | just-bash | stdout, stderr, exitCode | Baseline command absent from installed union |
| scratch-aligned | command/realpath/missing-tail | just-bash | stdout, stderr, exitCode | Baseline command absent from installed union |
| scratch-aligned | command/realpath/relative | just-bash | stdout, stderr, exitCode | Baseline command absent from installed union |
| scratch-aligned | command/cat/binary-stdin | just-bash | stdout | Returned byte API mismatch consistent with UTF8 re-encoding; NOT internal pipe/file corruption proof |
| scratch-aligned | command/head/negative | just-bash | stdout, stderr, exitCode | Exact native profile mismatch; no waiver or assumed cause |
| scratch-aligned | command/tail/bytes | just-bash | stdout | Returned byte API mismatch consistent with UTF8 re-encoding; NOT internal pipe/file corruption proof |
| scratch-aligned | command/wc/words-lines | just-bash | stdout | Exact native profile mismatch; no waiver or assumed cause |
| scratch-aligned | command/wc/unicode | just-bash | stdout | Exact native profile mismatch; no waiver or assumed cause |
| scratch-aligned | command/tee/file | just-bash | stdout | Returned byte API mismatch consistent with UTF8 re-encoding; NOT internal pipe/file corruption proof |
| scratch-aligned | command/sort/nul-unique | just-bash | stdout, stderr, exitCode | Exact native profile mismatch; no waiver or assumed cause |
| scratch-aligned | command/uniq/counts | just-bash | stdout | Exact native profile mismatch; no waiver or assumed cause |
| scratch-aligned | command/cut/bytes | just-bash | stdout, stderr, exitCode | Exact native profile mismatch; no waiver or assumed cause |
| scratch-aligned | command/cut/complement | just-bash | stdout, stderr, exitCode | Exact native profile mismatch; no waiver or assumed cause |
| scratch-aligned | command/env/clean | just-bash | stdout | Exact native profile mismatch; no waiver or assumed cause |
| scratch-aligned | command/env/unset | just-bash | stdout | Exact native profile mismatch; no waiver or assumed cause |
| scratch-aligned | command/env/nested | just-bash | stdout | Exact native profile mismatch; no waiver or assumed cause |
| scratch-aligned | command/xargs/batch | just-bash | stdout, stderr, exitCode | Exact native profile mismatch; no waiver or assumed cause |
| scratch-aligned | command/xargs/replace | just-bash | stdout, stderr, exitCode | Exact native profile mismatch; no waiver or assumed cause |
| scratch-aligned | command/find/nul | just-bash | stdout, stderr, exitCode | Exact native profile mismatch; no waiver or assumed cause |
| scratch-aligned | command/rg/fixed | just-bash | stdout, exitCode | Exact native profile mismatch; no waiver or assumed cause |
| scratch-aligned | command/base64/decode | just-bash | stdout | Returned byte API mismatch consistent with UTF8 re-encoding; NOT internal pipe/file corruption proof |
| scratch-aligned | command/base32/encode | just-bash | stdout, stderr, exitCode | Baseline command absent from installed union |
| scratch-aligned | command/base32/decode | just-bash | stdout, stderr, exitCode | Baseline command absent from installed union |
| scratch-aligned | command/base32/wrap | just-bash | stdout, stderr, exitCode | Baseline command absent from installed union |
| scratch-aligned | command/xxd/plain | just-bash | stdout, stderr, exitCode | Baseline command absent from installed union |
| scratch-aligned | command/xxd/reverse | just-bash | stdout, stderr, exitCode | Baseline command absent from installed union |
| scratch-aligned | command/xxd/layout | just-bash | stdout, stderr, exitCode | Baseline command absent from installed union |
| scratch-aligned | command/od/hex | just-bash | stdout | Exact native profile mismatch; no waiver or assumed cause |
| scratch-aligned | command/od/decimal | just-bash | stdout | Exact native profile mismatch; no waiver or assumed cause |
| scratch-aligned | command/od/skip-count | just-bash | stdout | Exact native profile mismatch; no waiver or assumed cause |
| scratch-aligned | command/cksum/stdin | just-bash | stdout, stderr, exitCode | Baseline command absent from installed union |
| scratch-aligned | command/cksum/files | just-bash | stdout, stderr, exitCode | Baseline command absent from installed union |
| scratch-aligned | command/cksum/algorithm | just-bash | stdout, stderr, exitCode | Baseline command absent from installed union |
| scratch-aligned | command/gzip/roundtrip | just-bash | stdout | Returned byte API mismatch consistent with UTF8 re-encoding; NOT internal pipe/file corruption proof |
| scratch-aligned | command/gunzip/stdin | just-bash | stdout | Returned byte API mismatch consistent with UTF8 re-encoding; NOT internal pipe/file corruption proof |
| scratch-aligned | command/zcat/stdin | just-bash | stdout | Returned byte API mismatch consistent with UTF8 re-encoding; NOT internal pipe/file corruption proof |
| scratch-aligned | command/diff/unified | just-bash | stdout, stderr | Exact native profile mismatch; no waiver or assumed cause |
| scratch-aligned | command/diff/ignore-space | just-bash | stderr, exitCode | Exact native profile mismatch; no waiver or assumed cause |
| scratch-aligned | command/patch/apply | just-bash | stderr, exitCode, entries | Baseline command absent from installed union |
| scratch-aligned | command/patch/dry-run | just-bash | stderr, exitCode | Baseline command absent from installed union |
| scratch-aligned | command/patch/reverse | just-bash | stderr, exitCode, entries | Baseline command absent from installed union |
| scratch-aligned | command/chmod/recursive-reference | just-bash | stderr, exitCode, entries | Exact native profile mismatch; no waiver or assumed cause |
| scratch-aligned | command/stat/follow | just-bash | stdout, stderr, exitCode | Exact native profile mismatch; no waiver or assumed cause |
| scratch-aligned | command/stat/timestamp | just-bash | stdout | Exact native profile mismatch; no waiver or assumed cause |
| scratch-aligned | command/mktemp/file | just-bash | stdout, stderr, exitCode | Baseline command absent from installed union |
| scratch-aligned | command/mktemp/directory | just-bash | stdout, stderr, exitCode | Baseline command absent from installed union |
| scratch-aligned | command/mktemp/suffix-dry-run | just-bash | stdout, stderr | Baseline command absent from installed union |
| scratch-aligned | command/paste/nul-shared | just-bash | stdout, stderr, exitCode | Exact native profile mismatch; no waiver or assumed cause |
| scratch-aligned | command/comm/totals | just-bash | stdout, stderr, exitCode | Exact native profile mismatch; no waiver or assumed cause |
| scratch-aligned | command/join/outer | just-bash | stdout, stderr, exitCode | Exact native profile mismatch; no waiver or assumed cause |
| scratch-aligned | command/join/duplicate | just-bash | stdout, stderr, exitCode | Exact native profile mismatch; no waiver or assumed cause |
| scratch-aligned | kernel/type/type | virtual-bash | stdout | Architectural introspection profile mismatch: command/command/function versus builtin/file/function |
| scratch-aligned | composition/text-filter/text-filter | just-bash | stdout | Exact native profile mismatch; no waiver or assumed cause |
| scratch-aligned | composition/binary-roundtrip/binary-roundtrip | just-bash | stdout | Returned byte API mismatch consistent with UTF8 re-encoding; NOT internal pipe/file corruption proof |
| scratch-aligned | composition/patch-hash/patch-hash | just-bash | stdout, stderr, entries | Exact native profile mismatch; no waiver or assumed cause |
| scratch-aligned | composition/find-xargs/find-xargs | just-bash | stdout, stderr | Exact native profile mismatch; no waiver or assumed cause |
| scratch-aligned | network/curl/get | just-bash | stdout | Returned byte API mismatch consistent with UTF8 re-encoding; NOT internal pipe/file corruption proof |
| scratch-aligned | network/curl/post-stdin | just-bash | stdout, exitCode | Exact native profile mismatch; no waiver or assumed cause |
| scratch-aligned | network/curl/post-file | just-bash | stdout | Exact native profile mismatch; no waiver or assumed cause |
| scratch-aligned | network/curl/json | just-bash | stdout, stderr, exitCode | Exact native profile mismatch; no waiver or assumed cause |
| scratch-aligned | network/curl/redirect | just-bash | stdout | Returned byte API mismatch consistent with UTF8 re-encoding; NOT internal pipe/file corruption proof |
| scratch-aligned | network/curl/fail-body | just-bash | stdout, stderr, exitCode | Exact native profile mismatch; no waiver or assumed cause |
