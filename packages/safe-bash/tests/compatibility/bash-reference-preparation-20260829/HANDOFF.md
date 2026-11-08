# GNU Bash reference feasibility — 2026-08-29

## Decision

**No qualified local GNU5.3 runtime found by this finite survey.** Source-build
preparation is feasible, but acquisition/signature verification, build-tool
closure, execution/version admission and the oracle fence remain separate GO
steps. Faraday owns the provider; this sidecar does not implement or duplicate it.
No Bash, compiler, configure, make, patch, GPG, package manager, product, engine or
native oracle was executed. No source archive body was fetched. Other held work
was not resumed. Product runtime dependencies and live source are unchanged.

## Local availability

`DATA-01/RESULT.json` records32 explicit locations, including13 Bash locations.
Only `/bin/bash` is present among those13:1293840bytes,0555,
SHA256 `35536aea9733aa345b61134a98d00232380898e55b2ea2a07c497011f7dfc7a3`.
This matches ROOT's pin; **version and patch level are UNKNOWN**, not inferred
as3.2 or5.3. The other12 named locations are absent. No directory enumeration,
private/home crawl or exhaustive installation claim. The survey took279.909ms,
stream-hashed145260336bytes, and started no children. Numeric inode observations
are contextual metadata, not lossless inode identity assertions.

| Candidate tooling | Metadata-only observation / remaining qualification |
| --- | --- |
| Xcode toolchain clang |141373024bytes,0755; SHA256 `7def90dd8829726686213a747fc5bff1583df933dae5edc55d755479e0bfe00a`; no invocation/dependency proof |
| CLT clang |290664032bytes: exceeds survey256MiB per-file hash bound; **not hashed/admitted** |
| CLT make |403216bytes,0755; SHA256 `1cb12712fad2ccd6f67c05b73e8dece382f14bfef3be7550bc814eb7975c555b` |
| `/usr/bin/cc`, clang, make |Same118928bytes/SHA256 `12bed4523661307059b879b9b54e77a73176e9d27d27a0e40363271d8f0668ba`; executable targets/behavior not inferred |
| `/usr/bin/patch` |220608bytes,0755; SHA256 `ca8aaa5fa4bd9dfaf4b3be251b18372f25f07483946e7d06b505e5a5fb0a6a84` |
| Existing Homebrew gpgv |Resolves to `/opt/homebrew/Cellar/gnupg/2.5.21/bin/gpgv`,538432bytes,0555; SHA256 `d9eb7bc783a1a0f1f39bb1f12ff0c94d7c2aac3b25aac2a7909a647d60be7bd4`; path is not a version probe |
| SDK locations |Both observed; CLT link resolves to `MacOSX26.5.sdk`; contents and library/header closure **not inspected** |

All32 exact paths/observations, including gpg and absent tools, are retained in
numbered records. Binary reads were bounded streams, never decoded.

## Official source and authenticity

Four direct, serial official HTTPS requests all returned200 on2026-08-29 at
04:34:05UTC: base listing, patch listing, and **HEAD only** for base archive and
signature. `HTTP-01/RESULT.json` records dates, headers and hashes; no redirects.
This supplements cached primary web search results and empty direct web-tool
responses, which are not missing-release or security findings.

- Current captured GNU listing's latest stable release is **5.3**; patch listing
  contains exactly001–015 plus their detached signatures. Latest patch015 is
  dated2026-06-09. Proposed fixed target: **GNU Bash5.3 + official001–015**.
- Base archive HEAD reports11355854bytes, last-modified2025-07-30T14:07:20Z;
  signature95bytes. Archive SHA256 and signing fingerprint are **NOT established**.
  ETag/size/TLS/listing hashes are not archive signature verification.
- Base listing SHA256 `f21ff7373237cec92a11396ead0a53065d6795b9fa54df835e6ab86bc3c9fd20`;
  patch listing SHA256 `e33744fd95ad3ba7cd1112f780074a0be3fa7406b8b0905ba94c1c9a9c48d4fa`.
- GNU's July5,2025 release announcement identifies the5.3 source distribution.
  Its announcement date differs from the current archive timestamp; future
  authenticated inspection must check `patchlevel.h`, not assume timestamps
  establish base patch level. Do not double-apply or skip official patches.
- GNU publishes a release-verification procedure using detached signatures and
  its official keyring. No verifier/keyring/signature body was executed/loaded
  here. Full primary-key and signing-subkey fingerprints, signer authorization,
  expiration/revocation interpretation and each actual verification remain open.
  Search hits quoting another correspondent's fingerprint do **not** identify
  Chet Ramey's key and were not adopted.
- No official macOS prebuilt was identified in the reviewed GNU release listing
  and installation references. This is not a universal absence claim. Avoid
  adding trust in third-party binaries merely to avoid an isolated source build.

## Minimal next grant

Route `NEXT-GRANT.md` to Faraday: bounded quarantined acquisition and provenance
completion first; **not an execution grant for configure or the40 cases**.
The concrete missing inputs are authenticated archive/patch/key fingerprints,
bootstrap shell/utilities/compiler/linker/SDK/dynamic-library closure, a sealed
build process budget, and demonstrated process/fence observation. Existing
metadata hashes do not resolve these. Preserve default upstream features and
use bundled Readline; do not disable core syntax to fit fixtures.

## Boundaries / retained evidence

ROOT's30min/64all-start/peak3/128MiBcapture/256MiBworking ceiling is unchanged.
Only metadata controllers and development metadata/publication commands ran;
controllers declare no spawned children, and all tool calls returned. There are
no outstanding owned sessions or temporary build trees to reap/delete. These
facts are **not kernel-level descendant/peak/RSS or fence qualification**.
Per-controller timing, original stdout/stderr (including empty files),0600
capture modes and hashes are retained; Git100644 is not substituted as historic
capture-mode authority. `SEAL.json` records final owned-file sizes/modes/hashes.
Instruction reads were context-only and were not copied into evidence.

Public runtime and all40 differential cases remain **UNRUN**. No compatibility,
performance, ordinary-repository readiness or source-version=executed-version
claim follows. Source-build plans preserve GPLv3-or-later notices and corresponding
source obligations if redistribution occurs; this separately licensed oracle is
not shipped as a product dependency.
