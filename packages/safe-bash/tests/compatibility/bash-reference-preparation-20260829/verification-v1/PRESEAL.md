# Verifier closure and publisher-authority preparation

New ROOT grant25min/48ALL starts/peak3/64MiB capture/256MiB work including
publication. No local Bash repeat, extraction, build, downloaded-code execution,
private paths/config/keyrings, agent or keyserver. This directory is the only
write scope; acquisition-v1 inputs remain immutable.

First controller: zero children. Inspect/hash exactly the public installed paths
listed in prepare.mjs, at most256MiB per binary with64KiB hash chunks. Capture only
bounded regular recognized-text metadata/manual bodies. No binary decoding by
JavaScript. The separately authorized trusted `otool` will inspect load-command
metadata only after its path/hash/mode has been captured; never dump code bytes.

Five exact publisher URLs, one GET each, no redirects/retries,20s each,6MiB total:

1. https://savannah.gnu.org/maintenance/GpgKeyrings/ (128KiB)
2. https://savannah.gnu.org/projects/bash/ (128KiB)
3. https://savannah.gnu.org/p/release-gpgkeys.php?group=bash (128KiB)
4. https://savannah.gnu.org/p/release-gpgkeys.php?group=bash&download=1 (4MiB)
5. https://savannah.gnu.org/maintenance/UsingGpg/ (128KiB)

The `/p/` spelling is independently identified in current official GpgKeyrings
documentation via primary web search, not a mirror or retry of the preserved
`/project/`404 captures. Do not silently promote arbitrary key/issuer identity.
All responses are opaque `.data` until bounded public text inspection. No archive
or previous successful object is fetched again. No verifier has authority to run
merely because this preparation succeeds: signer attribution and closure are
separate gates, followed by a committed exact argv/input seal.

Process reservation:1metadata preparation controller,1closure controller with
at most4batched trusted metadata children,1optional public-key inspection,
16gpgv children and24administrative/controller starts =47maximum (<=48), serial
children, peak outer+controller+child3. Future phases use the same25min deadline,
not fresh allowances. Each child<=10s,256KiB stdout/stderr; unknown retirement or
capture/identity violation stops. The16verification children are conditional,
not yet dispatched. Proof claims distinguish platform-owned system-cache trust
from independently hashed external dylibs and never imply a general OS fence.
