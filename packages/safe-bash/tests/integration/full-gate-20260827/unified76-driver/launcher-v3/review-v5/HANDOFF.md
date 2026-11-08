# Version5 author handoff — review-only build/type slice passes

Source sealed before execution:
`e062bcc1c79bf626541cc13ce35bad89e28dfe0a`.
Driver JSON SHA256:
`3d8d2a15214f12c07b64e3223f5e0088989845b8f60a74abb0a521dba32fa018`.
Product stays `f5e9fc49b6abb38e180cc9de16c95fced102ff75`, tree
`5687cbdebc46ec6d3618d32072c4de708118b9bb`. Expected package remains
`c109372f90b1bd19bcf756cf993bb2976fb52b75fe0c92a1cf96dab4c229b5cd`;
this review does not run npm pack or reproduce that tarball.

## Exact change and admission controls

Only transport admission changes among runtime files. `ARCHIVE_PATH_PROFILE`
pins `{platform:'darwin', arch:'arm64', syntax:'posix', separator:'/'}`.
`validateEntries(entries, bounds, pathProfile)` and `extractCommitted`'s
`pathProfile` option require that exact profile and matching actual host.
Backslash is a literal byte, never rewritten into a separator. NUL, absolute
and slash-traversal paths, .git, duplicate members, symlink ancestors/escapes,
exact modes, Git hashes and byte bounds retain their guards. The native,
cleanup, candidate and full profile files are byte-identical to2713.

Five presealed author groups pass. They cover the full37,397-member profile,
the exact two frozen backslash files, actual extraction without slash
reinterpretation, contained literal-backslash links, unsafe path/link/metadata
refusals and five foreign-profile refusals before extraction. Other OSes were
not executed; this is not Windows compatibility. No candidate inputs changed.

Group5 replays the unchanged four version4 groups: actual duplicate compiler
invocations in a separate tiny project, preload mutation, inert entrypoints
and the trusted outer read-only PID observer. The contained target still gets
ps EPERM and cannot write outside its allowed directory. Foreign PID/handle
requests fail; the bound Git child closes naturally with no surviving group.
Those nested four groups are not added to the five as a separate cohort, and
their tiny-project builds are not counted as product builds.

## One actual frozen-product attempt

The single authorized attempt runs from03:14:02.244Z to03:18:45.653Z on
2026-08-28. It returns exit0, `REVIEW_ONLY_BUILD_TYPES_PASS`:

- All37,397 declared entries /2,382,440,321 bytes extract and authenticate.
  This is the unchanged conservative streamed closure, not compact staging.
- Cold `typecheck` exits78 as required, with no production build.
- The shared real `typecheck:all` path exits0. The audit records exactly one
  actual `tsc -p tsconfig.build.json` invocation, not just a reported counter.
- Source/tests, the historical build-first consumer, three source-consumer
  groups and23 maintained consumer groups pass. Three exact negative-type
  groups exit2 as expected (1/2/5 diagnostics). Zero consumer runtime programs
  execute. These32 typing subprocess phases are not a runtime suite.
- Typing reuses the actual single-build binding:208 declarations; metadata
  SHA `513f26e135e7f499b8fb92b7981b2e82a2e91d512db88518f48daf81c1bbf74a`.
  The emitted receipt has832 files and normalized JSON SHA
  `f628eb40fdd27ec3980f98c6b026238b316d345fc0eb759584c0b82d22a675b4`.
- Before/after guards pass, permitting only the authorized dist build delta.
  The post-setup45,583-entry inventory SHA is
  `a2d7504efc83faa6f02d9fa41c7c72b8e29121501c999ca85b093c7ff470e441`.
  Both phases and the outer process close naturally: no timeout, forced signal,
  surviving owned process or cleanup failure is reported.

Pinned Node24.11.1 executable SHA:
`4255a388254ca4319e2f95f1da375d5deaddf25baf9c7c85070b67f9543b15d0`.
The shared build/type implementation, audit, observer and phase runner are
unchanged fromb0ee. Full execution and this review call the same implementation.
The sandboxed observer proof is the separate contained control above, not a
claim that the production type slice itself ran in that sandbox.

## Evidence and independent replay

`evidence/REPORT.json` gives the bounded summary. `evidence/RAW-INDEX.json`
hashes exact raw inner/type reports plus18 phase, launch, audit and control
files. The two large JSON reports use separate lossless gzip/base64 files;
`RAW.json.gz.base64` contains the smaller indexed envelope. Decode base64,
gunzip, and verify the listed uncompressed hashes before reading. The complete
compressed payload is5,779,816 bytes; no source archive/dependency tree/tarball
is embedded. Original temporary outputs are retained, not active resources.

For Dirac: review sourcee062 againstb0ee, the five frozen controls, the unchanged
duplicate-build/outer-observer proofs and this actual shared-phase receipt.
Any independent attempt uses a fresh unique directory and the same explicit
`--candidate f5e9fc49b6abb38e180cc9de16c95fced102ff75 --review-build-types PATH`
entrypoint. Imports stay inert and full `--run` remains root-release gated.

The prior dfcb zero-build admission failure, old19/3 and21/1 independent
results and optional transport failure remain immutable. This author result
does not independently close A10, rescore the old22 groups, execute canonical,
native, service, SafeJS or package phases, or authorize a full gate/release.
