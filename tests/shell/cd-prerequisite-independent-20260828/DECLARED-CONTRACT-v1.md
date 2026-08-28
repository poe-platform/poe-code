# Independent cd prerequisite PRECODE contract v1

## Authority and admission

This different delegated reviewer is not the Poincare author. ROOT's August 28,
2026 instruction ratifies ALL admission/accounting/search/publication rules in
`7728401ccb7bfa8f1961ffe100ca5617f3a6b553` (v3 details) and
`882085678862a23cfeef6505fa41a03891743439` (v2), and resolves their diagnostic
question as **cd-owned payload**, including any cd-owned `cd: ` prefix, excluding
the existing shell-origin prefix and newline. Their historical proposal labels
remain untouched; this routed ROOT approval is normative here.

This is a freeze for a future routed candidate, NOT permission to implement or
execute it. Author runtime awaits this freeze AND explicit ROOT go. Directory
stack remains separate and held. Only this new directory is owned by this review.

Fixed future execution inputs:

- Full baseline `5137a74ec855a32d8a8860eb66b62eb44d11e290`.
- Only `src/fs/webdav/webdav.ts` and `src/fs/webdav/README.md` overridden from
  `ca1d33424b94a21ae0f40a36412fd8191611e2df`; SHA256 respectively
  `cf65b82429bd92ca52b73490e1d6c1070545b5912fbddaba7037e01c57cc21f5` and
  `b931ac0545c709d3be2bd7d8e328fe9b1137cdb6514dfd8e9975c64c1fecb7bd`.
- Derived composition tree `7c68831a81fc49c94ad9177e58ca9fd7d0aca352`, accepted
  through independent `2ec9bcdafce7964769e87ed6fe681ea0936f266a`. This is an
  archived tree identity, not a required loose local commit. Its binding records
  265 source/package/build files and archive SHA256
  `2968a36621be269f49d53f1d13222440987d0472ae3b6882086722254127e42e`.
- Future candidate changes only the authorized runtime and candidate-owned tests/
  documentation, not providers, contracts, shell.ts, public limits, root exports,
  package metadata, parser, command inventory or stack state. Never moving HEAD.

`INPUTS-v1.json` records initial hashes; `EXPOSURES-v1.json` is the complete final
consulted-input/commit-metadata binding. Package declarations used ONLY for static
baseline type binding have package SHA256
`13fe54de1cf900d587855e276375fdf72ed1ed0d0e0625cf7ef00730f2bb74c9`.

## Preserved native and project distinctions

Original preseal `317128ddbce8ac9d321870f46957c33bca257612`, evidence
`d0b2557e1cb443b94d595c8a4cdd468f94c2601c`, and every original script/observation
remain unchanged. GNU Bash 5.3.0(1), aarch64-apple-darwin25.4.0, UID501: 28
retained observations, 21 successful cd operations and seven status1 outcomes,
NOT 28 newly passing virtual tests. Their final snapshot command's status is not
the cd result. The compressed observation SHA256 is
`b9f81d6f6507a5d110d0a196cabebe5d4ea1e803994d817485ed0c71520df592`.
No new native, Linux, host-permission, service or full-cohort evidence is claimed.

Native C01-C27 inform ordered search, empties, fallback, logical spelling and
relative HOME/OLDPWD. Original D22 is not a sole oracle. Directory-stack0/34 and
followups remain historical and are not rescored. Explicit `cd ''` retains dot
conversion despite native C28 status1; empty HOME/OLDPWD also retain dot conversion
without claiming native measurements. `cd -P`/`cd -L` remain literal operands;
there is no new option parser, physical cd or physical path rewrite.

Only actual public `FsError` ENOENT/ENOTDIR/EACCES are search misses. EPERM/ELOOP
are fatal intentional project gaps, NOT newly measured Bash continuation rules.
Readonly OLDPWD stops before cwd intentionally, stronger than native. Do not copy
native readonly-attribute removal quirks. Provider X_OK is delegated virtual
traversal, not ACL/search/listing/child/next-operation authorization.

## Admission and search

After unchanged expansion, command admission, prefix/redirection processing and
runtime-signal check:

1. More than one operand: existing status1 `cd: too many arguments`, zero private
   scans/probes. Resolve omission via visible HOME and dash via visible OLDPWD.
   Missing variables emit existing named status1 diagnostics before any cap scan,
   even with oversized CDPATH. Empty resolved target becomes `.` first.
2. Scan effective target; scan original logical cwd only for relative resolution.
   Search eligibility is relative target whose first component is not `.`/`..`.
   Absolute/dot/dot-dot targets bypass CDPATH validation AND charging completely.
3. Eligible unset/empty CDPATH has zero search slots. Nonempty CDPATH starts with
   one slot, each literal colon adds one including empties/trailing empty. Scan
   boundedly before split/allocation or first probe. At simultaneous first byte
   and slot overflow, byte violation wins; otherwise first encountered wins.
4. In order, form each raw candidate; no deduplication/cached failures. A returned
   non-directory is an ENOTDIR miss without access. Directory stat is followed
   by provider `access(path, 1, {signal})`. Only the three typed misses continue.
   All other typed/untyped failures terminate; no ENOTSUP bypass or mode inference.
5. After all misses, make a FRESH cwd fallback, even if identical to an earlier
   empty/repeated slot. Its failure supplies final diagnostic precedence. Stop at
   first directory stat AND successful X_OK. Nonempty component success prints
   the selected absolute logical path. Empty/fallback does not print unless dash;
   dash plus nonempty match prints once. Relative HOME/OLDPWD participate.

Signal checks precede/follow every provider await, precede classification and
publication, and bracket cooperative yields. Actual caller/shared cancellation,
including errno-shaped reasons, retains baseline precedence and must not become
a miss/private-cap status. Unknown ECANCELED without live cancellation is fatal.

## Inclusive private bounds and exact accounting

| Quantity | Inclusive rule |
| --- | --- |
| Effective target; used logical cwd | 65,536 UTF-8 bytes each |
| Eligible raw CDPATH | 65,536 UTF-8 bytes; 4096 slots including empty slots |
| Raw joined candidate R; normalized candidate N | 65,536 UTF-8 bytes each |
| Probes | 4097, counted immediately before stat |
| Public VFS calls | At most 8194: stat and conditional X_OK per probe |
| Local logical byte-work | 8,388,608 units per cd invocation |
| Cooperative yield | At EVERY reached 128-unit boundary, including exact last |
| cd-owned diagnostic payload | 65,792 UTF-8 bytes, inclusive of suffix/prefix |

UTF-8, not UTF-16 units or URI bytes. Lone UTF-16 surrogates count as three encoded
replacement bytes for accounting only; preserve original path strings and existing
provider validation. This is not a new malformed-path interoperability promise.

Raw joins have NO separator elision: absolute target itself; absolute component
`component + '/' + target`; relative nonempty component
`cwd + '/' + component + '/' + target`; empty/fallback `cwd + '/' + target`.
Determine R from bounded lengths BEFORE allocation; reject overlong R even when
normalization could shorten it. Then reserve 2R, construct/lexically normalize,
and scan/charge N before provider admission. No host cwd/chdir/realpath query.

Charge exactly input-scan UTF-8 bytes (target + used cwd + eligible CDPATH), plus
2R per attempted construction/normalization, plus N per normalized scan, plus one
immediately before stat and one immediately before admitted access. Input and
normalized scans reserve one scalar's encoded bytes before advancing. No refund.
Each reservation first checks `charge <= 8,388,608 - spent`; reject the entire
reservation before charging/yielding/allocating its associated operation if it
does not fit. Admitted reservations advance to each 128 boundary and await the
existing interruptible setImmediate. The bounded normalization call itself is
not preemptible. No extra Budget tick/loop or byte-command charge/reset.

Private failures are ordinary status1, with exact payloads:

```
cd: CDPATH exceeds 65536 UTF-8 bytes
cd: CDPATH exceeds 4096 components
cd: path exceeds 65536 UTF-8 bytes
cd: probe limit exceeded
cd: helper work limit exceeded
```

No fabricated `ShellLimitError` key, public option or shared-controller abort.
Actual existing shared limits retain their own identities and monotonic accounting.
Probe4098 and normalized-over-raw overflow are defensive source invariants, not
fabricated publicly reachable negative cases after successful earlier admission.

## P1: checked state, output and baseline error boundary

Selected stat/access success precedes checked OLDPWD write of original cwd, then
cwd publication, checked PWD write, export PWD, export OLDPWD, then awaited print.
Readonly OLDPWD leaves everything unchanged. Readonly PWD retains OLDPWD/cwd but
not later export additions or print. Prefix restoration still runs in finally;
thus successful prefix PWD/OLDPWD assignments can restore their old values while
cwd remains changed. Function locals, middleware overlays, subshell/invoke clones
and shared budgets retain baseline behavior. No new persistent Shell state API.

Successful writes are not rolled back on sink failure/abort. Baseline capture
writes occur before external sink writes: stdout may be captured even when the
external sink throws. EPIPE maps to141; ordinary sink failure generally status1;
diagnostic-sink errors are swallowed unless actual cancellation/control wins.
Do not assert every sink exception rejects exec. Actual root rejection follows
existing caller/control/cleanup precedence. No cooperative-cleanup preemption
guarantee for opaque host promises.

## Diagnostic boundary

Build bounded cd-owned text incrementally; do NOT first concatenate/encode an
unbounded owned error/target/provider message. At payload size <=65,792 retain
all bytes. Otherwise retain the LONGEST complete-Unicode-scalar prefix of at most
65,780 UTF-8 bytes, then EXACT 12-byte ASCII ` [truncated]`. A scalar that does
not fit can leave unused bytes; never split it. The payload includes `cd: ` when
that prefix is present. Preserve short legacy diagnostics and their categories.
Existing shell-origin prefix and newline are outside this cap but inside parent
output accounting. This is not a full-line, global stderr, RSS or allocation-total
cap; do not add a diagnostic envelope or truncate other commands by prefix matching.

## Frozen denominators and evidence status

`cases-v1.mjs`: 82 independently declared command cases: behavior16, permissions14,
adapters6, state9, output5, cancellation5, limits27. Four additional diagnostic
boundary cases D01-D04 make **86 future semantic cases**. Twelve separately named
invariants and seven future integration controls are not extra runtime passes.
Ten positive and ten negative type controls bind actual baseline public types.
No cross-product of adapters/layouts is silently added to these unique counts.

Static arithmetic confirms the max-call fixture needs only61,456 work units;
4097 probes/8194 calls are jointly attainable under the work cap. The exact-work
fixture totals8,388,608 and65,536 yields. A one-unit-over fixture reaches the cap
at fallback stat admission, then rejects access before its call. Full calculations,
static type-binding status and preliminary tooling corrections are in validation
artifacts. All product cases/layouts/services remain NOT RUN pending ROOT go.
