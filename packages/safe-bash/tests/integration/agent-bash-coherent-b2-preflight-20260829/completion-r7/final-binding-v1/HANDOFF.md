# B2-r7 final binding — no activation

Independent PREEXEC acceptance is
`7ad82903e3269de5527c8308c755eb1b132bb58c`, receipt SHA256
`5f627990643cbb13943ee33be52f0bacb6e665d600d553326a01970f2f32a416`.
Candidate remains `5d60457781b73783eecdd61e34d33ec7916d891b`; packet is
6519 bytes, SHA256
`f97901065a7803f72edb92c19f219e66f35dc2f050917d10dd25cb411ba5f65a`.

## Exact unused grant and window

`/private/tmp/B2-R7-ROOT-GO.json`: **859 bytes, mode0600**, SHA256
`720bee1710c078eb4c9ee606ae69cb101fe5fc688f5a420d715ddfe4d793f7d1`.
The byte-identical copy is `GRANT.json`. Final binding receipt SHA256:
`6d247a13f14667af62629ac16ebc4eea65c61d3e024adbc229f3111726ef0f10`.

All timestamps are August 29, 2026 UTC:

| Boundary | Time |
| --- | --- |
| Issued at final binding readiness | 15:47:01.060 |
| Not before | 15:52:01.060 |
| ROOT external latest start | 15:57:01.060 |
| Active deadline | 16:19:01.060 |
| Publication expiry | 16:22:01.060 |

The existing validator permits issuedAt <= notBefore, with 1800 seconds from
notBefore to expiry and 180 seconds reserved for publication. No schema or guard
was changed. ROOT's external latest-start bound is additional orchestration
policy, not a new validator field. At latest start 1500 total seconds remain;
there is no runtime-clock reset or later 30-minute renewal.

## Exact prospective command

```sh
/bin/zsh /Users/kjopek/Workspace/safe-bash/tests/integration/agent-bash-coherent-b2-preflight-20260829/completion-r7/staged/new/launch.sh /private/tmp/B2-R7-ROOT-GO.json 6519
```

Cwd `/Users/kjopek/Workspace/safe-bash`, login:false. **Different final-slot review
and fresh ROOT actual GO are still required.** No scheduler or runtime launch ran.
The initial trusted host shell startup boundary is unchanged; login:false does
not establish suppression of every zsh startup file.

## Authority and fresh checks

Exact schema/authority strings remain `B2_RUNTIME_GO_R7`,
`ROOT_B2_672_EXPLICIT_FRESH_GO`, `INDEPENDENT_PREEXEC_REVIEW_ACCEPTED`.
ROOT previously approved fixed per-role file/hash loader admission and trusted
Node builtin delegation in this functional profile, not general host access or
OS containment. 34 async-loader admissions are not guest/Regex authority.

The helper freshly authenticated the 31 packet files, acceptance receipt,
compressed 930368-byte product package, pinned Node binary, compiler/npm
entrypoints and three actual StageA emissions. Package SHA256 remains
`2fe071e2bfac5ef5c81dc7e475e059091f6add65cd7411dfcfbf0ce7f51f2eca`.
The local `/bin/zsh` launcher hash/mode is separately recorded. No archive was
inflated. Authenticated 309-source/1012-emission/1014-member inventories are
reused, not falsely described as a fresh full source/tool census. The actual
coordinator retains its existing complete admission checks.

Runtime root `/private/tmp/safe-bash-b2-runtime-r7` and outer capture
`/private/tmp/safe-bash-b2-runtime-r7.outer.raw` were absent before issuance.
Grant creation was exclusive, checked complete write, owned close and byte-exact
readback. Helper PID31382 exited/closed0, no signal, empty stderr.

Prospective runtime: **64 known OS roles, peak3 = owner1 + children41 + admin22**;
34 loader admissions/one live; Regex0/guest0; 96MiB capture, 512MiB logical work;
1620 active +180 publication seconds anchored to notBefore. Native helper threads
and universal process census remain unobserved. All 672 cases/6 type roles/24
negative diagnostics/7 mutant-restoration pairs/2 bindings are still UNRUN in r7.

Original 43a1c3dc 0/672 FSYNC failure and scheduler/EEXIST history are unchanged.
This DATA-only phase does not rescore or execute them. Prepared-source traces
retain the independently accepted no-fsync/non-durability qualification.
