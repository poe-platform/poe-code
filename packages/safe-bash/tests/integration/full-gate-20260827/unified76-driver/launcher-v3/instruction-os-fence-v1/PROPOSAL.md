# Instruction creation guard: precise policy decision before shipping changes

## Current state and observed mechanism

Projection reviewe584515f accepted the scoped six-entry projection. It does not
certify descendant materializers. Full gate remains held; no new full phase,
archive materialization or product change occurred in this investigation.

Installed `/usr/bin/sandbox-exec` is102560 bytes, SHA256
`d1ee30dbde955aaa75c7f801fdfea4df05b10129454d7982eb6453f771436d42`.
Host is macOS26.4.1/build25E253, arm64. One availability/parse probe ran this
profile with `/usr/bin/true`, exit0; no write-denial/control case executed yet:

```scheme
(version 1)
(allow default)
(deny file-write*
  (regex #"(^|/)[Aa][Gg][Ee][Nn][Tt][Ss][.][Mm][Dd]($|/)"))
```

This is only a parser/launch observation, NOT the proposed complete policy or a
claim that name-only filtering covers aliases. The installed Apple manual
`/usr/share/man/man7/sandbox.7` states that descendants inherit restrictions but
pre-opened writable descriptors can remain usable. Its SHA256 is
`9043d9296715714f95b4de6c5f88a5436c5cc3b83b62641327212078c5c69b04`.
The installed sandbox-exec manual labels the command deprecated; SHA256
`0d264f72dc6a8e0db5474840f33b512542c469beb109ed146c17055da287336b`.
The supported claim will therefore be pinned-host, measured behavior, not a
portable or future macOS API guarantee. Apple-installed QuickLook profile uses
`file-link` separately from default operations; link policy must be tested, not
assumed covered by `file-write*` alone.

Primary reference roles: installed Apple manuals/profile above; Apple's XNU
`security/mac_vfs.c` describes MAC hooks for vnode link/rename operations but is
not a proof of the closed-source policy compiler's path-filter behavior. Online
App Sandbox entitlement inheritance documentation addresses a different launch
mechanism and is not substituted for actual sandbox-exec descendant controls.

## Two exact root decisions required

1. **Extend the trusted OS exception only for two new tool/reference pairs.**
   `otool -L /usr/bin/sandbox-exec` reports
   `/usr/lib/libsandbox.1.dylib` and `/usr/lib/libSystem.B.dylib`. Both physical
   paths return ENOENT. Current `external-admission.mjs` authorizes exactly eleven
   other pairs, so the new guard cannot be admitted by silently adding them.
   Proposed exception: these two pairs on26.4.1/25E253 only, with readable
   sandbox-exec bytes and otool output bound. No library-file hash, full OS
   attestation, new non-system exception or ambient loader injection allowance.

2. **Close the target's writable namespace, not just one basename pattern.**
   Proposed writer universe: one fresh, outer-created, realpath-resolved private
   task directory plus the exact fresh requested evidence-output directory.
   Deny filesystem writes outside those roots, and deny hard-link imports whose
   source is outside them. Inside, deny instruction-name creation/writes/link
   targets with the ASCII case-insensitive full-component match above. Permit
   ordinary in-universe renames/hardlinks/symlinks, subject to existing policies.
   This avoids assuming that a basename rule recursively checks the contents of
   an existing directory moved inward, or follows every external hard-link
   alias. Neither such kernel behavior nor an actual bypass has been established
   here. Empty, authenticated initial roots plus denied external imports are
   the intended invariant; controls must establish the actual enforcement.

The second decision is a stronger external gate write boundary, not a utility
policy change. A canonical case requiring an outside write must produce an
honest refusal/HOLD with its exact path; no silent whitelist expansion, test
skip, output rebaseline or claimed unchanged host-write profile. Without this
decision, name-only enforcement cannot honestly be promoted as complete alias
coverage. An alternative is a complete reachable-materializer trace and repair,
not assuming the disclosed historical run-packed driver is canonical-reachable.

## Minimal implementation after approval

- New driver-local `os-instruction-fence.mjs`: exact host/tool/profile binding,
  fresh-root admission, path checks and sandbox argv construction. Pass profile
  text directly in argv so target code cannot replace a mutable profile file.
- `run.mjs` and `review-build-types.mjs`: trusted outer supervisor opens only
  stdout/stderr pipes and ignored stdin, then launches the worker under the
  pinned OS guard before setup or any canonical/native descendant. Supply
  TMPDIR/TMP/TEMP/HOME beneath the fresh root; explicit descendant environments
  cannot remove an already inherited OS restriction. Existing Node permission
  flags, source/import/build audit, private guards, loopback/process observation,
  time/output bounds and release admission remain intact.
- Worker/phase receipt protocol records the bound sandbox invocation and exact
  write roots. Direct worker output without the guarded outer launch receipt
  cannot qualify a gate. No environment variable or JS preload is accepted as
  proof of OS enforcement. If a separate phase wrapper is necessary to close a
  real setup path, declare it and test it rather than silently duplicate guards.
- Keep existing outer read-only owned-PID/group/birth observer outside the
  restricted target. No unowned process signalling or new broad process access.
- `external-admission.mjs` and a new versioned guard-tool manifest bind only the
  explicitly approved additional pairs. Preserve the original eleven-pair
  receipt unchanged; do not rewrite its historical identity/observations.
- `admission.mjs`/`DRIVER.json`: require the new guard receipt and sealed module
  closure; old release receipt must fail for the new driver. Candidate f5,
  c109, six logical omissions, normalized product profile and14 phases unchanged.

Exact intended edit set: new guard module/tool manifest; run/review launchers;
worker/phase receipt code only if required; external admission; driver admission
and DRIVER seal; this versioned control/evidence directory. No product source,
canonical fixture, root export, dependency or existing historical report edits.

## Descriptor and pathname assumptions to prove

- The trusted outer launcher passes no inherited writable regular-file handles
  to the target: only stdin ignored, stdout/stderr pipes. Explicit IPC, if needed
  for the existing observer, is a pipe/socket capability, never a writable file.
  Actual native and Node descriptor observations must test this assumption.
- Use a non-instruction surrogate to demonstrate the known pre-opened-FD
  limitation; never create a plaintext instruction snapshot to test it. No claim
  that the OS retroactively revokes arbitrary descriptors or hard-preempts code.
- Realpath existing ancestors, reject symlinked write roots and path aliases,
  bind modes/inodes, and verify initially empty target roots. ASCII case variants
  of AGENTS.md and slash/dot normalization are explicit; Unicode parent and
  literal-backslash POSIX names get controls, not a portable-Windows guarantee.
- Existing protected content under outside names is not content-detected. This
  is a pathname/acquisition guard plus a clean namespace invariant, not arbitrary
  instruction-data-copy detection, hostile-host sandboxing or full OS security.

## Predeclared verification, not yet executed

`CONTROLS.json` freezes the bounded cases before guard implementation. They cover
ordinary writes/build, native Git/tar, cleared-environment Node/native descendants,
rename/link/symlink/case aliases, external imports, descriptor discipline,
guard-removal controls, observer cleanup and unchanged fences. Synthetic
instruction-name members use empty bodies; never checkout/copy actual instruction
bodies or use substituted instruction text. Original opaque authenticated Git
history/archive transport remains permitted; projection is still separately
required and does not become a broad name/data exclusion.

First execute isolated mechanism controls; only after they pass run one bounded
review-only actual build/type slice through the same guarded launcher. Any guard
gap, unsupported runtime/profile, unbound tool, unexpected fd, surviving child or
cleanup failure is nonzero/HOLD before a full run. Different Dirac review and
fresh root release remain required. No actual A10 rerun or full gate is authorized
by this proposal.

## Fixed historical bindings

Candidate `f5e9fc49b6abb38e180cc9de16c95fced102ff75`; expected pack
`c109372f90b1bd19bcf756cf993bb2976fb52b75fe0c92a1cf96dab4c229b5cd`.
Existing driver `2922ac6400ecccce808431952e3aaccc97e20c2b4b2acc93041b514f52818809`,
projection `b74e575644c9476b26d96b6863aa2a2078931e73fe3251862d713edd1d7bbefb`,
product profile `8c9363ea17f6a319acc783b1e7ec2a4d4dc0a00529692b9f2331f60571ab149f`
remain unchanged. The original five-plus-one copy defect/zero-phase stop and
all later historical refusals remain preserved.
