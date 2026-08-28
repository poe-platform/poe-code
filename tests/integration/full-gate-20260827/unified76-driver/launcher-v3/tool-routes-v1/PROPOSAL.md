# Developer-tool routes: read-only diagnosis and approval boundary

2026-08-28. **No replacement tool executed, shipping patch applied, A10 rerun or
full gate launched.** The route controls are prospective, not product passes.

## Fixed scope and observed cause

The product remains `f5e9fc49b6abb38e180cc9de16c95fced102ff75`, expected full
pack `c109372f90b1bd19bcf756cf993bb2976fb52b75fe0c92a1cf96dab4c229b5cd`.
The exact-six metadata projection, fourteen phases, one-production-build/type
reuse and existing permission/private/source/network/process fences remain.

Independent `resolved-write-v9/SAFETY-RESULTS.json` records PID39225 executing
`/usr/bin/otool -L /usr/bin/sandbox-exec`, then its child PID39226 executing
`/Applications/Xcode.app/Contents/Developer/usr/bin/xcodebuild -license check`.
This establishes that observed parent/child route, not a guess from a basename.
The independent `(otool-classic)` observation still has no absolute origin.
Finding a currently installed binary does **not** retroactively resolve it.

The current `/usr/bin/git` and `/usr/bin/otool` files have identical bytes
(`12bed4523661307059b879b9b54e77a73176e9d27d27a0e40363271d8f0668ba`).
The selected developer-directory symlink targets Xcode. Read-only inspection
finds `libxcselect.dylib` in both shims' arm64 load commands. Apple documents
the `/usr/bin` shim selection mechanism; the installed xcrun manual also
documents `DEVELOPER_DIR`, `TOOLCHAINS`, SDK and cache/environment selection.
Neither documentation nor strings prove a complete installed process graph.

Frozen `scripts/typecheck-inputs.mjs:27` invokes bare `git ls-files -z`.
Shipping setup uses the already-bound direct Xcode Git, but its inherited PATH
can send this helper through `/usr/bin/git`. A literal scan of all632 canonical
entry files and `scripts` finds no explicit `/usr/bin/git`, `/usr/bin/otool`,
`xcrun` or `xcodebuild`. This is **not** a transitive helper reachability proof;
helpers, generated programs and explicit cleared environments remain controls.

## Minimal proposed route, requiring the exact approval below

1. Replace shipping linkage-inspection calls to the shim with the direct regular
   file `/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/otool-classic`.
   Its current bytes472320, mode0755 and SHA256 are
   `6beb1ad9c4fb7edafd59fddcb093f358f9a250bfe1db2db9f04ed1aacd523a69`.
   Do **not** route through the `otool` symlink/`llvm-otool` wrapper, `xcrun`,
   `xcodebuild`, or ambient developer selection.
2. Prebind that exact binary before its first invocation. Limit this use to
   `-L` and the existing four absolute inspection targets: Node24, direct Git,
   native tar and sandbox-exec. Retain exact expected linkage output and all
   existing readable dependency identities. No provenance inspection is removed.
3. Prepend an owned, identity-checked `git` route to the already-bound direct
   `/Applications/Xcode.app/Contents/Developer/usr/bin/git`, not the entire Xcode
   bin directory. Preserve source bodies and observe actual required Git work.
   Bind argv/env; reject ambient developer/toolchain/loader selection. Explicit
   cleared-env descendants must receive a declared absolute route, not a silent
   `/usr/bin` fallback. Required historical helpers that cannot use that route
   must be reported rather than skipped or rewritten.
4. Probe actual execution and meaningful unknown-route/missing/hash/selection
   negatives before proposing a new shipping admission seal. Process polling
   remains evidence, not universal short-lived-exec or library-load attestation.

**Root decision requested:** permit only these two additional tool/reference
pairs on the already-pinned macOS26.4.1/build25E253 profile:

- direct `otool-classic` → `/usr/lib/libc++.1.dylib`;
- direct `otool-classic` → `/usr/lib/libSystem.B.dylib`.

Both paths currently return ENOENT. These would be trusted OS-metadata pairs,
**not readable-file hashes**. They are not the existing two sandbox-exec pairs
or eleven original pairs, so this packet does not silently authorize them.
The direct tool's arm64 Mach-O load commands name these two libraries and dyld;
there are no `LC_RPATH` commands. This is direct-load metadata, not complete
dynamic-load closure. `libLTO`/`libxcselect` strings also occur in the binary;
they are not direct load commands, and actual `-L` execution is still untested.
Any newly observed executable/non-system image remains HOLD pending a binding,
not a wildcard exception. No approval is requested for xcodebuild's frameworks.

If these pairs are not approved, a possible alternative is a narrowly validated
non-executing Mach-O load-command reader using the existing pinned Node. That
would introduce a new inspection implementation needing separate design and
negative controls; the diagnostic reader here is **not** proposed as shipping
admission and does not replace the existing inspection.

## Accepted resolved-write policy qualification

Root accepts independent `38a4e7b08f47139328f3a4ac5b4b50d83a6544b3` for five
write-safety phases plus actual A10 and real duplicate-build refusal, not a
complete release binding. Fresh initial root admission rejects preexisting
aliases; **runtime inert outside symlink creation is allowed**. Such a reference
is not physical import. Resolved writes through outside/instruction aliases,
chains and renamed links are denied; outside hardlinks and physical-directory
rename/import are denied. Eleven protected-name operations and two historical
Git/archive/native-tar member attempts were denied in the recorded cohorts.
The successful tar refusal left216 ordinary neighboring files extracted: no
rollback claim. Preopened writable-FD limits remain; shipping descriptor isolation
was tested. Prior creation-proxy2pass/1fail, original inside-ps failures and all
earlier gate scores stay unchanged.

`OS-INSTRUCTION-FENCE.json`'s old cedd preseal text is historical, not the current
review verdict. This sidecar qualifies that metadata without changing kernel
profile bytes, the fixed product/profile or silently fabricating a new release.
A rebound shipping tool/profile packet and different Dirac review are still
required after the narrow decision. Full gate remains HOLD.

## Primary references and reproducibility

- Apple TN2339, “Building from the Command Line with Xcode FAQ”:
  <https://developer.apple.com/library/archive/technotes/tn2339/_index.html>.
- Installed primary manual:
  `/Applications/Xcode.app/Contents/Developer/usr/share/man/man1/xcrun.1`,
  SHA256 `9237a9b41d4baaaa40ae24e728c00818634e0dde7c108608a86933867396c1e1`.
- Apple cctools `otool/main.c` (current source, **not** an authenticated match to
  the installed binary):
  <https://github.com/apple-oss-distributions/cctools/blob/main/otool/main.c>.
- Apple Mach-O load-command definitions:
  <https://github.com/apple-oss-distributions/xnu/blob/main/EXTERNAL_HEADERS/mach-o/loader.h>.

`inspect-routes.mjs` performs bounded file/metadata reads and already-bound direct
Git inspection only. It never invokes an inspected developer wrapper, copies
instruction bodies, builds a candidate or edits private state. Its output records
input hashes and the limited canonical-entry scan separately from unproved closure.
