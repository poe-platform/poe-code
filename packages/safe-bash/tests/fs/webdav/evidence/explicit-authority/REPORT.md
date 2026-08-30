# Explicit authority compatibility after the operation-binding safety fix

The source-loss correction is committed as a0e598b6cc023a1ee6e95cf8f67903a74e8a2b7e.
This small follow-up preserves explicit external comparison semantics without
relaxing original-method/private-store qualification. It does not replace or
rewrite the independent evidence or the preceding unsafe/fixed captures.

## Reproduced compatibility defect

After fixing inherited authority, a pre-construction subclass override or
post-construction replacement of compareEntry was still hidden by the shared
registered base callback. Three focused author regressions failed (521/524 owned
passes): subclass explicit authority ignored; instance explicit authority ignored;
two conflicting explicit callbacks ignored instead of queried and rejected EIO.
The independent destructive case and16 WebDAV review tests still passed at this
baseline; this is a compatibility defect, not a reappearance of source loss.

The WebDAV terminal dispatcher now detects explicit compareEntry replacements
against the original base comparison function. It queries each distinct operand
once, validates literals/conflicts before effects, propagates actual errors and
cancellation, and does not recursively negotiate. Forwarding into the base method
returns unknown through the shared recursion guard. An explicit provider's answer
is separate external authority, not inherited metadata/private-store authority:
modified implementations still have no getOwnedWebDavEntry descriptor and no
automatic protocol proof. Generic external peer authority remains independently
handled by the shared helper. No helper/contracts/other-backend code changed.

## Exact final result

Pinned37edad87db8050de8f57db2e17e31fe000b5dcb1 contains core0bee8e7 (checked by
runner), plus only owned WebDAV source/backend-test overlay. No uncommitted Memory,
S3 or wrapper implementation enters this snapshot.

- All owned WebDAV:526/526 =324 existing +33 protocol/transport +169 operation
  binding/explicit-authority tests. Five added explicit controls include malformed
  result EIO, conflicting results EIO, exact cancellation reason and recursion.
- Unchanged independent destructive repro:1/1; unknown, ENOTSUP, zero effects and
  exact source sentinel, included in independent WebDAV selection16/16.
- WebDAV conformance:52/52 (50 backend +2 provenance); strict scoped types exit0.
- Original unchanged compatibility WebDAV selection:13/15 =12/14 positives plus
  one alias guard. Same two existing-target mixed Memory/WebDAV inputs remain red.
- Zero skips/cancellations/TODOs. No full38/43/53 or fullrepo/allFS rerun/closure.

All source manifests stayed stable; exact pins/argv/raw/status/hashes and replay
patches are retained. Source/test whitespace checks exclude immutable raw TAP and
patch context, whose original whitespace is intentionally preserved.

Final resource-id.ts SHA256:
869e5f4ea8210f9c088f32906f063a373da2e36392b9a1d95f4f5e2193c2d7fc.
Final webdav.ts SHA256:
3c4c14ecf9f789794d44ea50ca3a1880a859745f7ccf69ee9caeefd96d310f6a.
Operation tests SHA256:
2c73713fae33736d0bca4c7cbfc45e0086000d707306745cb9a47489098272e9.
Original compatibility fixture SHA256 remains
9d11741fd9b37757046c1278fdaa00c734633bfd9a1fc58ae479415c2f5a6734.

## Remaining qualification gap

Only actual full provider-owned MockDav.fetch/createFetch plus intact original
operations can expose a closed-store descriptor. Genuine metadata returned by an
arbitrary manual fetch wrapper remains insufficient. A protocol UUID is not proof
of disjoint Memory/native storage. ROOT approval is still needed for any explicit
independent input-factory delta; qualified Memory recognition is a separate owner
integration. No historical input/assertion was edited here. Old MockDav capability
delta and raw source hashes remain documented in resource-authority-5076b32;
operation-override-fix retains the actual original data-loss reproduction and fix.
Remote rmdir, ABA/pathname races and generic provider interop limits remain.

Replay: archive each recorded pin with run.mjs's paths; apply input.patch at the
archive root, link existing tooling and execute commands.json in a fresh TMPDIR.
Verify manifest-before.json first; do not overwrite any earlier output directory.
