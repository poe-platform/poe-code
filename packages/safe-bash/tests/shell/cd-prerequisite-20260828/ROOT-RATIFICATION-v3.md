# Ratified cd prerequisite packet for Locke

Status: ROOT-approved bounded profile; implementation remains HELD until the
different precode freeze and explicit ROOT GO. This is a policy decision, not
a native observation or a product acceptance result. Relay this packet through
root; no direct peer-delivery tool is available to the author.

## Immutable normative inputs

ROOT ratifies both documents, with the diagnostic boundary resolved below:

| Input | Commit | File SHA-256 |
| --- | --- | --- |
| `AUTHOR-POLICY-v2.md` | `882085678862a23cfeef6505fa41a03891743439` | `bbc2024017c6476b2f8c43af4a1088367303c86a4d894cd3ce6e57fda6bbc9ff` |
| `AUTHOR-POLICY-v3-DETAILS.md` | `7728401ccb7bfa8f1961ffe100ca5617f3a6b553` | `5268aeafff4878926931c8ccf80cf2234134ae0d1fc594b00e44b6d157211489` |

The earlier documents' pending-approval wording is historical. This additive
record resolves it without modifying their bytes or the original native data.

All admission ordering, inclusive caps, UTF-8 count units, eligibility, raw joins,
duplicate and empty-component charges, fresh fallback, and checked-state ordering
are ratified as specified there. In particular:

- Raw eligible CDPATH, effective target, used relative cwd, raw constructed path,
  and normalized path have the specified inclusive 65,536-byte limits.
- CDPATH has at most 4,096 components; duplicates and empty components are not
  elided. The final fallback is a fresh probe even for an equivalent path.
- At most 4,097 probes and 8,194 public provider calls are admitted. This is not
  a provider-internal RPC bound.
- The per-call helper budget is 8,388,608 logical units, using the exact initial
  scan, raw-join reservation, normalized scan, and provider-call charges in v3.
  Yield boundaries are every 128 admitted units. No shared-budget reset or
  additional command/loop charges are authorized.
- Only typed `FsError` ENOENT, ENOTDIR, and EACCES continue search. EPERM and ELOOP
  are fatal under this project profile, an explicit gap rather than native parity.
  Actual caller/control cancellation takes precedence, including errno-shaped
  reasons. The final fallback supplies its own diagnostic.
- Missing HOME/OLDPWD precedes private-limit scanning. The existing explicit
  `cd ''` to `.` divergence and accepted5137 prefix/error/abort semantics remain.
- Successful lookup performs stat-directory, delegated X_OK, checked OLDPWD,
  cwd publication, checked PWD, exports, and awaited logical-path output in the
  specified order. Checked-write/output failures do not roll back prior effects.
- Private-limit failures are ordinary status 1 with the exact v3 diagnostic texts,
  not new public limit keys or shared-budget controller failures.

## Resolved diagnostic boundary

ROOT chooses the **cd-owned diagnostic payload**, with an inclusive limit of
**65,792 UTF-8 bytes including cd-owned `cd: ` text**. The existing shell-origin
prefix and newline are excluded from this private payload limit.

If truncation is necessary, reserve exactly 12 bytes for the literal suffix
` [truncated]`. Keep the longest whole-scalar prefix fitting at most 65,780 bytes,
then append that suffix. Do not first assemble or encode unbounded cd-owned text.
Short existing diagnostics remain unchanged.

Existing parent output accounting still covers actual emitted bytes. This is
not a whole-line, global-stderr, or RSS cap. Do not introduce a cd-tagged
diagnostic envelope, new public limit, or changes to unrelated runtime exception
formatting. No diagnostic-boundary question remains open in this packet.

## Fixed source binding and reused evidence

The future candidate starts from accepted
`5137a74ec855a32d8a8860eb66b62eb44d11e290`, with only the two accepted WebDAV blobs
from `ca1d33424b94a21ae0f40a36412fd8191611e2df`:
`src/fs/webdav/webdav.ts` and `src/fs/webdav/README.md`.
The composed tree is `7c68831a81fc49c94ad9177e58ca9fd7d0aca352`.
Exact source hashes are retained in `AUTHOR-POLICY-v2-SEAL.json`.

Reuse provider acceptance `2ec9bcdafce7964769e87ed6fe681ea0936f266a` and unchanged
adapter qualifications; this packet does not rerun or rescore them. WebDAV's
accepted directory X_OK is logical-cwd navigation with injected-mock evidence,
not an ACL grant or an actual-service claim.

Original native28 freeze `317128ddbce8ac9d321870f46957c33bca257612` and observations
`d0b2557e1cb443b94d595c8a4cdd468f94c2601c` remain unchanged. No new native/provider
observations or runtime executions accompany this ratification.

Future authorized production scope remains `src/shell/runtime.ts` only, plus
owned cd tests/docs, after the separate freeze and ROOT GO. No shell.ts, stack
state/registration, parser, provider, public-limit, contract, or root-export
change is authorized by this packet. Directory-stack implementation stays HELD.
