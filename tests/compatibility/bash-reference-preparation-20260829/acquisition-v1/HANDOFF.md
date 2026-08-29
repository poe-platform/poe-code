# Quarantined GNU Bash acquisition — 2026-08-29

## Outcome / boundary

**Acquired, NOT signature-authenticated or execution-admitted.** The new ROOT
grant produced all32 requested source/signature objects and the official GNU
keyring;38 HTTP requests attempted,33 acquired,5 unavailable. No extraction,
patch application, configure/build/install, downloaded-code execution, product
execution or native differential case. This acquisition sidecar remains with
this worker; Faraday's provider remains separate. Old1aca8413 metadata-only
history is unchanged, including its then-UNKNOWN local version.

## Message for Faraday: exactly one local version probe

The admitted `/bin/bash` actually printed:

```
GNU bash, version 3.2.57(1)-release (arm64-apple-darwin25)
Copyright (C) 2007 Free Software Foundation, Inc.
```

Exact argv: `--noprofile --norc --version`, no script/file/`-c` operand. Exit0,
109stdout bytes,0stderr, no termination; exit observed13.591ms, close13.610ms
after spawn setup. One child start, observed closed, no second Bash invocation.
Fresh six-key env, owned empty cwd/HOME/TMPDIR/PATH are recorded in
`RUN-01/VERSION-ADMISSION.json`. Pre/post1293840bytes,0555,SHA256
`35536aea9733aa345b61134a98d00232380898e55b2ea2a07c497011f7dfc7a3`.
This is **metadata only**, not Faraday's nine fence controls, GNU5.3 admission,
the40-case oracle or a native43/other held-track resumption. The reported host
triplet is captured output, not independently proved platform equivalence.

## Opaque source / provenance

Controller ran2026-08-29T04:42:38.993Z–04:43:14.493Z,35499.321ms. Files were
streamed into exclusive0600 regular `.data` files, hashed, size-bounded and left
opaque. Total downloaded bytes15077424. `OBJECTS.json` enumerates exact URLs,
roles, byte counts, SHA256s, status/header metadata and acquisition dispositions.

| Object | Bytes | SHA256 |
| --- | ---: | --- |
| Official `bash-5.3.tar.gz` |11355854|`0d5cd86965f869a26cf64f4b71be7b96f90a3ba8b3d74e27e8e9d9d5550f31ba`|
| Official GNU keyring |3687794|`b136fbe57ade4ee5270ca66c402cae7b50349fd07646b5b3de7962d58d4df608`|

All15 official patches001–015 and all16 detached signatures are acquired.
HTTP200 from the fixed GNU origin establishes the captured publisher channel;
SHA256 establishes retained byte identity, **neither proves a valid signature**.
No archive member, `patchlevel.h`, license member or patch body was decoded.
The5.3+001–015 target remains a proposed composition, not an applied source tree
or measured5.3.15 executable. Archive member/path validation remains unrun.

The five unavailable endpoints are preserved, not retried or called invalid:

- `https://savannah.gnu.org/project/release-gpgkeys.php?group=bash`:404.
- Same URL with `&download=1`:404.
- `https://www.gnu.org/software/security/`:connect timeout.
- `https://www.gnu.org/software/bash/`:connect timeout.
- `https://www.gnu.org/licenses/gpl-3.0.txt`:connect timeout.

The published historical Savannah guidance used the `/project/` form; this run
does not assume a substitute path or authorize arbitrary mirror/keyserver lookup.
Full authorized primary/subkey fingerprints therefore remain **unestablished**.
The GNU global keyring was acquired through its official publisher channel but
was not parsed. No self-reported signature issuer or guessed fingerprint became
trust authority; no DIY cryptography or third-party binary fallback.

## Exact verifier gap

Existing gpgv still matches538432bytes,0555,SHA256
`d9eb7bc783a1a0f1f39bb1f12ff0c94d7c2aac3b25aac2a7909a647d60be7bd4`.
It is **present, not fully admitted**, not reported missing. No gpg/gpgv invocation
was made because executable identity alone does not bind its dynamic-library/
dyld closure. The read-only installed receipt and formula are retained in
`VERIFY-GAP-01`: receipt SHA256
`8e9a0e9f87428634f209f976f44a52d26b7840d2a687e700c1694f2f6df0f61a`,
formula SHA256 `749cde3b8a168a21c6c560fd51837afc349e0dc00b736db37249dc30a9f2acee`.
They declare18 package runtime dependencies; this is not a list of actual gpgv
loaded images. A referenced Homebrew user-cache pathname is inert metadata:
it was **not followed/read**. Ruby/Homebrew code was not executed.

Concrete next input: an authenticated verifier+loader/library closure, or a
separately admitted metadata-only dependency inspection route; then freeze exact
offline no-options gpg/gpgv commands with an owned empty GNUPGHOME/keyring, no
agents/private keys/user options/keyservers, and verify16 payload/signature pairs.
Resolve publisher fingerprint authorization independently of signature issuer
claims. Do not redownload the33 successful objects or repeat the local probe.

## Licensing / next build / cleanup

Prior official GNU references identify Bash5.3 as GPLv3-or-later. The new standalone
license request failed, and archive-contained notices were not inspected. The
archive is retained byte-exact; no claim that a license member was extracted or
audited. Before any redistribution/build artifact publication, retain the actual
upstream license/notices and corresponding source/build recipe, separately from
the product. No acquired source/binary enters runtime dependencies or root exports.

After successful provenance verification, a **separate** build grant would admit
bootstrap shell/utilities, compiler/linker/assembler, make/patch, SDK headers,
system libraries/dyld and actual observer tooling. Current metadata does not
close these. Use a fresh owned out-of-tree build/prefix, default upstream core
features and bundled Readline, isolated env, no global install and no network.
No configuration/feature changes to fit fixtures. Source inspection must establish
patch sequence/member safety and exact finite build schedule before execution;
configure conftests are executable children, not free metadata operations.
The prior proposed30min/4096starts/peak8/128MiBcapture/1GiBworking build ceiling
is only a proposal and is **not authorized by this acquisition grant**.

The single supervised child closed; all helpers returned, no owned sessions or
active work remain. Empty owned probe directories are harmless retained scratch,
not an active lease. All capture mode/byte/hash identities are in `SEAL.json`;
Git100644 does not replace recorded0600 runtime modes. No old archives were
cleaned. Root30min/64starts/peak3/64MiBcapture/256MiBworking was not renewed.
Controllers start only the one declared target child; metadata/Git/editor tool
dispatches are not a kernel descendant or hard-RSS/fence measurement. No overall
containment, all-repository readiness or Bash surface-parity claim.
