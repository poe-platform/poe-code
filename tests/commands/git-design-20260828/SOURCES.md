# Primary-source register

Read on 2026-08-28 using the web tool. These are specification inputs, not executed
native oracles or a claim about the latest installed/released Git. No documentation
instructions to run Git were executed. Proposal restrictions are ours, not claims
that native Git rejects the same inputs. No third-party format descriptions used.

| ID | Official source | Used for |
| --- | --- | --- |
| S01 | `https://git-scm.com/docs/gitrepository-layout` (page says last changed2.49.0) | .git/gitfile/bare layout, common directory, objects, loose/packed refs and alternates |
| S02 | `https://git-scm.com/docs/git-status` | XY, short versus porcelain v1, root-relative porcelain paths and NUL output; no inference of all flags |
| S03 | `https://git-scm.com/docs/git-diff` | Working/index/tree comparisons, patch versus name output, exit-code/quiet and external conversion controls |
| S04 | `https://git-scm.com/docs/gitformat-index/2.55.0` | DIRC versions, field byte order, sorted names/stages, extensions, path rules, checksum |
| S05 | `https://git-scm.com/docs/gitformat-pack/2.54.0` | Pack/idx structure, checksums, offsets, OFS/REF delta reconstruction; not a promise to support every auxiliary format |
| S06 | `https://git-scm.com/book/en/v2/Git-Internals-Git-Objects` | Canonical object header/body/hash, zlib storage and tree/commit relationships |
| S07 | `https://git-scm.com/docs/gitignore` | Ignore precedence, directory negation/pruning, wildcard/escaping rules |
| S08 | `https://git-scm.com/docs/git-ls-files` | Index listing/stage and filename output contracts |
| S09 | `https://git-scm.com/docs/git-rev-parse` | Repository query flags and revision verification |
| S10 | `https://git-scm.com/docs/gitrevisions` | Ref/object/revision selectors; subset is deliberate |
| S11 | `https://git-scm.com/docs/git-log` | Explicit first-parent and bounded/format selections |
| S12 | `https://git-scm.com/docs/git-show` | Object/path retrieval versus presentation; not an alias for cat-file |
| S13 | `https://git-scm.com/docs/git-config` | Repository extensions, fileMode/transformation settings, linked-worktree config |
| S14 | `https://git-scm.com/docs/git-check-ref-format` | Ref syntax admission |

Git format documentation is primary; exact native CLI diagnostics/algorithms still
need independently pinned executions on a newly authorized fixture. Git is not a
GNU coreutils command: describe the tested Git/version/platform profile, not an
invented generic “GNU Git” dialect. No native Git version was queried here.

A Node22 zlib documentation fetch was attempted at
`https://nodejs.org/docs/latest-v22.x/api/zlib.html` but did not return a usable tool
source in this audit. No new Node codec API guarantee is based on that fetch.
Streaming codec design uses inspected local patterns and remains subject to
version-pinned implementation/cleanup/consumed-byte tests before acceptance.
