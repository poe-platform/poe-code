# Independent committed-archive admission verdict

**ACCEPT for the bounded admission policy: 18/18 frozen cases pass, zero skips;
all three guard mutants are detected. No execution blocker found.** This clears
this review's prerequisite for root's authorized whole-suite launch; it is not a
whole-suite result or product acceptance. No whole gate, compiler, package build,
private engine access or product command ran here.

## Fixed inputs and execution

- Author source: `6699804ace9f5522aa67be6a017a8008bfc09f30`.
- Author evidence: `05360c918c645031ff83680ba54f5049af91115a`.
- Unchanged 18-case specification: `85858fc37ecedf8d9fbcc3f753b957c362f4e44e`.
  `attempt-1/frozen-cases.json` is byte-identical to that Git object; its original
  planned status remains historical, while `RESULT.json` records execution.
- Product candidate: `8670ebe8f0d39966c2de2638780437398e5f8490`, not moving HEAD.
- Candidate tree: `2b5790d522f433778a3ba2364f24b7ae7b24216f`.
- Candidate `package.json` SHA256:
  `2127bbfed020aeb7873462ae65224e6ee73069425c878aa2ceee9816b2191245`.
  This identifies package configuration, **not** a newly packed tarball.
- Review harness commit: `d31637a3`; no production/configuration/author edits.
- Actual interval: August 27, 2026, 14:28:59–14:29:28 UTC; Node/runtime binary
  identity and each frozen harness input hash are in `attempt-1/RESULT.json`.

The fresh real `git archive` contains **24,879 entries / 17,765 unique blobs**,
1,464,107,067 committed payload bytes and 12 existing literal symlink fixtures.
Every path/directory set, kind, regular-file ownership, mode, length and Git blob
identity passed the actual verifier before and after bounded inspection. The
receipt is `attempt-1/ARCHIVE-MANIFEST.json`; its compact JSON SHA256 is
`e52d6a274955231c60eeaf6714cd8995550b7dd5a62889ea0c2b5665f6b2ef48`.
The source tar SHA256 is
`c507a91edd316a7bb891ac2d0ce4a173b755773206d1ff0593082e91791684d3`.
The tar and extracted tree were removed after checking; the authenticated receipt
is retained. There was no live source overlay, worktree or reused build output.

## Cases actually exercised

| Frozen cases | Independent observations |
| --- | --- |
| Strict clean / dirty | Unmodified frozen CLI admits clean miniature inputs; refuses tracked edits with exit78. |
| Archive dirty / untracked / moving HEAD | Explicit flag admits original committed inputs despite staged dirty contents, a shadow module/config and a later mini-repository commit. Actual imported miniature source returns the committed value; live canaries remain intact. |
| Changed / missing / overlay / wrong commit / mode | Same-length source, test and package corruption; missing inputs and Git object; extra source/config/empty directory; another revision and changed executable mode all refuse. Separate generated output outside source does not invalidate source. |
| File / directory escape | Active input symlinks outside the miniature archive refuse, even with identical outside bytes. Outside sentinels remain unchanged. Existing authenticated historical links in the actual archive are not blanket-excluded. |
| Post-phase immutability | Verbatim frozen runner `verifySource` detects separate source and tracked-evidence mutations against the Git-authenticated pre-phase receipt. |
| Cleanup envelope | Reconstructed directly from candidate Git objects; all220 match the actual archive, including exact compact hash below. Old revision, changed/missing input, single absent environment variable and mismatched commit refuse. |
| Native | Actual pinned49 authenticate; copied miniature mandatory tool missing/changed/nonexecutable refuses before output in both modes: six actual CLI exit78 routes. |
| Loader | Unchanged actual import guard records resolve/load hashes for both critical miniature source modules; old source, missing parser and compiled fallback reject with specific diagnostics. |
| Mode selection | Missing flag remains strict; invalid/extra flags and unrelated `IGNORE_DIRTY=1` do not admit a dirty repository. Shared strict guard bytes equal8670. |
| Mutants | Global dirty bypass is caught by strict refusal; removed SHA1 blob check by equal-length corruption; live-copy substitution by committed-value and blob checks. All three are temporary-only controls. |

Cleanup220 compact SHA256:
`d9309d27efd2e1e418f075f4f514efeeefa833e8b3dc5e061662289f8ecd67b6`.
Environment checks execute the exact current test pre-build fragment. Both absent
variables remain its documented ordinary-development profile, not qualified
committed acceptance; the frozen whole runner explicitly assigns both variables
and checks the envelope revision/tree/source hashes. No cleanup worker cohort was
repeated here; its separate independent migration review remains separate.

The CLI file and its statically imported author helpers are regular copies of
the exact source Git objects. Positive CLI routes use an explicit preload that
intercepts **only the requested output-directory mkdir** and exits after an
admission receipt. This runs the real flag parsing, preflight and discovery,
without allowing output creation or subsequent native/private/build/suite phases.
Negative routes never reach that sentinel. Miniature policy/CANDIDATE files bind
the owned miniature commits; actual8670 metadata/native/archive checks are
separate direct calls with the unchanged real policy. This is not a disguised
whole-gate execution or a claim that service prerequisites ran.

The archived-prerequisite helper was also inspected: both authority imports and
the byte identity data come from `source`; their external native payloads remain
explicit separately pinned tool inputs. The full prerequisite function (which
would access the private engine) was not invoked. No private-source assertion is
derived from this bounded review.

## Reproduction and preservation

```sh
node tests/integration/committed-archive-admission-review-20260827/run.mjs /tmp/NEW-EXCLUSIVE-REVIEW-OUTPUT
node tests/integration/committed-archive-admission-review-20260827/verify.mjs
```

The first command repeats only this bounded review, requires the original pinned
native assets, and will not launch the suite. It writes a fresh output directory;
do not target the sealed attempt. The second authenticates the retained evidence,
source Git objects, complete archive receipt, package and cleanup bindings.

All22 owned Node children settled synchronously without signal/timeout; owned
scratch, tar and archive were removed. Foreign edits/staging/untracked scopes were
not staged, deleted or ingested. Original strict-live86c63b39 refusal remains
unchanged. Both author22/22 captures are decoded and hash-authenticated by the
verifier, **not counted as independent executions or added to18**. The earlier
weaker author output-path negative remains preserved. This was the first review
execution; there was no failed attempt or expectation rewrite.
