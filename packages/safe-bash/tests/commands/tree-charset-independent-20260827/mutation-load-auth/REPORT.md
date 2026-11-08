# Mutated-module load-time hash report

## Result

The exact load-time-hash gap recorded by final-audit evidence commit
`7a8e7bebc96156e511fc91389341d87e5aba317c` and its post-commit freeze
`a67ae4e81a728b198d181095f6ca7c87a138b25c` is closed for the eight declared
semantic mutants. Candidate `f1a90436c45208ca248e058a039893233c608daa`
passed the unchanged baseline 11/11. Each fresh installed-package mutant loaded
source whose SHA-256 equalled its on-disk after-mutation hash and differed from
the corresponding baseline loaded-source hash. All 8/8 then failed the intended
mapped unchanged check with `AssertionError`/`ERR_ASSERTION`; none was killed by
the loader, syntax, or module resolution.

This conclusion is narrow. It supplements mutation commit
`2748e2abbc2dc838e02b1d75ee7d967f0749e8ad`; it does not rewrite its original
attempts, mutation implementation, worker, assertions, positive oracle, or load
guards.

## Actual loaded-source attestations

The baseline loader recorded the four distinct target modules. Each baseline
loaded-source hash equalled that module's before/after disk hash. Repeated mutant
targets refer to the same corresponding baseline record.

| Case | Target | Baseline loaded SHA-256 | Mutant loaded/after SHA-256 | Mapped kill |
| --- | --- | --- | --- | --- |
| `environment-always-ascii` | `charset.js` | `695c5dd1d6321510799dd2293b56553190876904873ebbc2193bc5fa4de6af5b` | `1218c26fe9277b890ceb56dc0dcc6557c68500e865e64ff35941f9965abb8f68` | `environment-selection` |
| `explicit-precedence-ignored` | `arguments.js` | `1f8f6de091863922a2201ee4c49e808e11aefd59b23739c4cf4498f7a8789d69` | `4d41ef886a775532a419eb47baff6aeafc519158cada831b725692e2959beefa` | `explicit-precedence` |
| `ambient-host-environment` | `charset.js` | `695c5dd1d6321510799dd2293b56553190876904873ebbc2193bc5fa4de6af5b` | `098923419fe9b899eb66930d2443b73727ca94b1bd8630aae956cdf8d8503877` | `ambient-host-isolation` |
| `inherited-key-lookup` | `charset.js` | `695c5dd1d6321510799dd2293b56553190876904873ebbc2193bc5fa4de6af5b` | `334e8fe3827dce67283d2cc7aba51b68e169aa1a732c4871afe6fe5d4c809fc1` | `inherited-key-isolation` |
| `filename-unescaped` | `tree.js` | `cc2b539597b03dc6dca5c1fc31e27d771aeb49bc5ade318587ea934f99f8ec89` | `8bc3cc2b8f5164d1a980e5831804367361e304aec9c46f1790d2462b8c768cef` | `filename-escaping` |
| `output-code-units-not-utf8-bytes` | `io.js` | `3059aeb5ba8fdab1eff69bf8c8f15aa190f4659030e060cc2b56e5c92194c5c6` | `42718209a997300ca59c37685cd208dbeaae7f7c75098b7a6e4914be58c0925b` | `utf8-output-byte-cap` |
| `environment-work-undercharged` | `charset.js` | `695c5dd1d6321510799dd2293b56553190876904873ebbc2193bc5fa4de6af5b` | `17ce2b43c05761c32ad24136d31cc062856b61cbc75e6bd554a53387b0659510` | `environment-work-cap` |
| `sink-write-not-awaited` | `io.js` | `3059aeb5ba8fdab1eff69bf8c8f15aa190f4659030e060cc2b56e5c92194c5c6` | `5c7fe0105f8ff2f78631b967725aa5e1c4e0d072c95a708c10fceaf67854b6c3` | `awaited-backpressure` |

For every row, the committed manifest records the requested target URL,
realpath-canonical resolved URL, on-disk before hash, expected mutation hash,
on-disk after hash, on-disk-at-load hash, source bytes returned by `nextLoad`,
actual loaded-source hash and post-worker disk hash. All required equalities and
inequalities are asserted by the driver. The raw JSONL is synchronously written
before `load` returns the source for evaluation and is read only after child
`close`.

## Reused authentication, guards and closure

The derivative ran the committed driver rather than a reduced probe. It
authenticated all 28,505 fixed-candidate archive blobs before and after the
run, rejected unexpected postflight paths, ran `npm ci` from the authenticated
lockfile, built, packed and installed the actual package, and retained the
762-file package result. The baseline observed exactly 70 default commands and
one tree command. The candidate archive and tarball SHA-256 values remained
`fe133818ee69dcbdac7e2330e97fefa1dd07037ba73c6135ccf106b770e7f325`
and `2713175a12912952999c6e0e8d81cef2638692b573081bc281ba0e785d099bab`.

The unchanged guards produced their intended results:

- the genuine installed package matched root/manifest/entry, was allowed and
  loaded;
- the separately packed and installed `virtual-bash@9.9.9` was denied for both
  manifest and entry hashes and was not loaded;
- the genuine same-byte package copied outside the expected installation was
  denied only for its canonical root and was not loaded.

The inner driver recorded 51/51 children and POSIX process groups absent after
close: 49 exits were zero and the two guard denials were the expected status
77. The wrapper recorded another 15/15 bounded children and groups absent.
There were no timeouts or output overflows, all mutation-worker stderr streams
were empty, and owned runtime scratch was removed. The deferred-write mutant
recorded both late completions, then zero outstanding writes, before closure.

## Provenance and limits

The original committed `run.mjs` SHA-256 is
`557a17da7dddc3b631acc646ce366b1bbbfa124a3936730a967c1d278a9011d3`;
the executed derivative is
`1a2db1840e897fdf50938af24522264ace91f88122ee89e1f9aa897dba958d94`.
The mutation list, unchanged worker, unchanged load guard and consumer fixture
retain their authenticated committed hashes. The precise runtime diff has
SHA-256 `c1931552275a997f2bcf4fb8fed3181d7edf3114f43079c608b3f196d22ae1e3`.

This work followed inspection of the original driver and final-audit gap, so it
is not claimed as pre-inspection evidence. No new freeze is claimed. Historical
native freeze `55bd112804564605e397d3ee9948226d89efd457` preceded that freezer's
inspection; that fact is unchanged. The three known native differences and the
old strict-red result are unchanged. This report makes no full-native-parity,
whole-gate, score, product-repair, or superiority claim. Within the sole
assigned load-time-hash field, no remaining gap was observed.

