# ERE native-reference preflight v2 — author controls PASS

Date: 2026-08-29. Ready for a DIFFERENT preexecution reviewer, **not native GO**.
This is the narrow correction authorized after `0463adbc`; no product, native
entry, fixture child, Worker, engine, version probe, or approval request ran.

## Exact bindings

| Artifact | SHA256 |
|---|---|
| Executable `materialized/PRESEAL.json` | `211483cbe1b12ad505345da5396a227c7da9931743d035ed365f7cc74bb4d457` |
| `CONTROL-PRESEAL.json` | `b73f207cb4dd7e5a8c903075f4219cd27635b03f3be16f947846c7ff42943b03` |
| Corrected `materialized/admission.mjs` | `5bb503cabae66da96f847697e34a9e8a19d954bc2137a2ce409fcba1aee265aa` |
| Parent executable preseal | `d002ec622f7668b0766216acd60d19330723d4552205f3049202898eccdbca2f` |
| Parent publication | `4c176106d6730c33c087c2fcf31b375edf206c61dc073ffed638993778dd7c00` |

Parent commit is `0463adbcee3601b2cdf43f44bf428eddc0cab2f1`. Every selected parent
member was hash/mode/size authenticated before decode, with the parent's entire
publication and control closures checked. All four tool identities were freshly
stream-hashed before controls; no executable bytes were decoded. The final
publication rechecks both new and historical selected inputs.

## Single runtime-source correction

Only `admission.mjs` differs among the nine runtime modules:

```js
operations.readSync(fd,Buffer.alloc(1),0,1,0);
```

It replaces the zero-length read at exactly one site. The existing regular-file,
type, named-path/device/inode, single-link, 0600-mode and canonical-path checks run
first. The file remains the owned capture bound to the expected descriptor; this
does not introduce a new file/descriptor capability. The check does not infer
read access from file permission bits. The positional read cannot advance the
file-description cursor; bytes read are discarded and no payload is written.
All eight other runtime modules and twelve Bash program files are byte-identical.
The four runtime JSON inputs are unchanged, including zero fixtures/empty stdin.

`SOURCE-DELTA.json` records exact transformations. The approval proposal changes
only the two owned module-prefix paths in its command (entry and future GO) to
this v2 materialization. It retains the sole unresolved grant-SHA slot, exact
`require_escalated`, `login:false`, no prefix rule and trusted-host startup scope.
No runtime GO or acceptance receipt is created. A new independent receipt and
fresh root grant must bind this preseal, not the old one.

## Exactly twelve controls, once

**12 PASS / 0 FAIL; 196 successful assertions.** The runtime result schema retains
its original `ere-preflight-controls-v1` format; the explicit control-seal SHA and
versioned directory distinguish this execution. No original result is rescored.

| ID | Result | Assertions | Scope |
|---|---|---:|---|
| C01 | PASS | 16 | Twelve identities/order/fixtures/program byte bindings |
| C02 | PASS | 5 | Hash, argv, executable and stdin refusal |
| C03 | PASS | 36 | Metadata/hash-before-decode, module imports and tool denial |
| C04 | PASS | 7 | Exact receipt data, missing/wrong authority, cross-realm values |
| C05 | PASS | 16 | Expiry/final deadline/late credit/false primary preservation |
| C06 | PASS | 8 | Sole slot and command-field/prefix/permission refusal |
| C07 | PASS | 48 | Real owned empty/nonempty descriptor matrix and old missing checks |
| C08 | PASS | 19 | Flush/size/hash-read/close failures and independent cleanup |
| C09 | PASS | 11 | Synthetic TERM/KILL timing, source linkage, exit/close/group gates |
| C10 | PASS | 9 | Exact child environment and trusted-host startup scope |
| C11 | PASS | 13 | Synthetic byte-exact NUL observation framing and refusal |
| C12 | PASS | 8 | Namespace, ledger, storage and unknown-retirement refusal |

C07's extensions were declared in `C07.mjs.fragment.data` and the control preseal
before execution; no new top-level case was added. Six real owned file-descriptor
combinations ran in the same DATA helper, not six child processes:

- Empty and nonempty read-write files admit; observed reads return 0 (EOF) and 1.
- Empty and nonempty write-only files reject with `EBADF` before the write check.
- Empty and nonempty read-only files read successfully but reject the required
  write check with `EBADF`; the capture contract still requires both capabilities.
- Wrong inode, mode, nonregular named target, wrong canonical path and refused
  descriptor reject before any read/write operation.
- A sequential read consumes `A`; admission reads position 0; the next sequential
  read is `B`. Files remain byte-identical. All descriptors close in `finally`.
- All three previously unrun C07 checks complete: unchanged bytes, valid provision
  and missing-parent refusal. The unchanged-bytes check now covers both files.

## Source confirmation and limits

`node-fs-readSync-source.txt.data` is bounded public-function source obtained from
the freshly pinned Node executable, **not a decoded binary**. Its `length === 0`
branch returns before `binding.read`; the nonzero call reaches that binding after
argument validation. See `NODE-READ-SOURCE-ANALYSIS.md`. The actual descriptor
matrix corroborates permission checking on this pinned Node/platform, without
claiming inspection of the native C++/kernel implementation or all Node versions.

The entry is syntax-parsed but never imported/executed. No child lifecycle pilot
or wrapper execution was repeated: C09 remains DATA/source-linked, and inherited
qualified lifecycle evidence retains its historical scope. The current helper
does exercise real descriptor operations only inside its owned scratch directory.

**N01–N12 remain 12 UNRUN.** Reference identity is historical local Bash 3.2.57,
not GNU 5.3. R01 capture choice stays HOLD. Hidden native match spans and native
nonparticipation cannot be inferred from identical empty strings. Initial tool-
shell startup remains trusted host outside child fresh-env/raw-capture guarantees;
`login:false` is not startup-file suppression. No startup files were inspected.

## Next reviewer and authority boundary

Review `SOURCE-DELTA.json`, both preseals, the 12-case result and raw captures,
updated approval proposal, tool pins and actual Node source. The future setup must
still bind fresh provisioning metadata and outer captures, then obtain a new
independent receipt/root GO, sole-slot DATA review and explicit tool approval.
This packet does not execute or qualify that future setup or native entry.

The proposed actual 600-second / 40-known-start / 13-managed / peak-three budget
and 32 MiB capture / 128 MiB work remain unchanged proposals, not this grant.
No old37 grant, containment claim, native parity, GNU build/P2 or held scope resumes.

Original v1 syntax refusal and 11-PASS/1-FAIL/three-unrun history remain immutable.
Final source integrity passed; scratch is removed; all owned processes retired.
See `PUBLICATION.json` and `PROCESS-ACCOUNTING.md` for exact captures/resources.
