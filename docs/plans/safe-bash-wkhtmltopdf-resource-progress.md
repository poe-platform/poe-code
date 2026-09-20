# wkhtmltopdf resource acceptance increment

Task: `behavior-wkhtmltopdf`. Overall status: **open**. This increment adds byte
resource loading to the existing private command workspace, not an HTML renderer
or completed CLI command. The package remains `safe-bash-command-wkhtmltopdf`,
private, TypeScript ESM, with no external runtime dependencies.

## Acceptance cells

| Cell | Status | Evidence or remaining requirement |
| --- | --- | --- |
| Percent-encoded data bytes, NUL/invalid UTF-8, literal plus | Unit accepted | `resources.test.ts`; percent escapes are bytes, not form text |
| Strict padded base64, canonical trailing bits, malformed input | Unit accepted | Original failing resource-module test followed by passing decode/rejection cases |
| Data URL and fetch fragments | Unit accepted | Failing fragment tests reproduced fragment bytes being decoded/fetched; fixed by excluding the fragment |
| Relative resources against explicit VFS bases | Unit accepted | Failing relative-reference test followed by explicit URL resolution; no host base inferred |
| VFS resource and supplied-font capability routing | Component accepted; provider gate open | Mocked byte capabilities only; actual identity-aware VFS adapter remains required |
| Ambient file/font and implicit network denial | Unit accepted | Capability-free cases reject before acquisition |
| Explicit network capability | Routing accepted; transport gate open | Mock network only; no built-in transport, redirect, credential or TLS implementation qualified |
| Input/decoded/retained byte accounting | Unit accepted | Exact input boundary, decoded limit, retained limit and peak stream-assembly copies covered |
| Work/resource bounds | Unit accepted | Reference scans, chunk copies/assembly, resource count and unbounded empty chunks are bounded |
| Cancellation and invocation cleanup | Unit accepted | Explicit signal; stalled reads interrupted; exactly-once lease close; pre-entry cancellation; unfinished reads rejected and cleaned up |
| Cleanup failure accounting | Unit accepted | Failing test reproduced retained-byte reservation for unreturned output after close failure; reservation now released |
| Default document-script execution denial | Component accepted; document gate open | Resource bytes are never executed; renderer/document admission still absent |
| Separately authorized script runtime | Open | No script harness is admitted or implemented |
| First-party HTML5/CSS/box/font/shaping/image/paged/PDF engines | Open | See engine prerequisite document; resource bytes do not establish rendering support |
| Ordered documents, anchor geometry and stable TOC layout | Open | Existing pure page sequencing is not rendered pagination; bounded TOC fixed-point engine still needed |
| Output bytes, staging and atomic VFS/stdout publication | Open | Resource loader emits no PDF; future output stage must separately bound output bytes and publication |
| CLI/raw argv encoding and SDK parity | Open | No executable command yet; existing Unicode parser is not a raw-byte CLI profile |
| Public Safe Bash subpath and bundled installed declarations/runtime | Open | Prerequisite engine and package-contract gates have not passed; no export or packaging completion claimed |
| Pinned patched-Qt compatibility | Open | Source-derived research only; no native renderer used as implementation or comparator |

The existing 122-switch matrix is retained in `src/switches.ts`. Its parser
admission/rejection decisions are unchanged. Capability-bearing CLI flags remain
rejected; supplying resource capabilities to this SDK does not silently enable
those flags or document execution.

## Resource profile and next gates

Resource URLs use explicit bases only. Fragments are excluded from fetched/decoded
bytes, while percent-encoded `#` remains data. The first data-byte profile rejects
raw non-ASCII/whitespace, malformed percent escapes, unpadded or noncanonical
base64, and percent-encoded base64. MIME metadata is not validated or interpreted.
These are explicit checked-profile choices, not native/WebKit equivalence claims.

The supplied VFS capability must authorize canonical virtual identities, including
aliases and symlinks. It may not interpret `vfs:` as permission for ambient host
access. A supplied network capability must authorize every redirect, protect
credentials, preserve TLS verification and bound transport buffering. The loader
does not create either capability. Font access uses a separate supplied capability
and never falls back to an installed font.

Input accounting includes supplied references/bases, normalized URL text when a
base is supplied, and streamed bytes. Decoded accounting is cumulative, including
consumed bytes on failure. Retained accounting includes owned resource arrays and
temporary assembly copies, then resets at scope completion as arrays transfer to
caller ownership. This is byte-allocation accounting, not total JS heap accounting.
External capability buffering must have its own bound. Stream reads must be
sequential and finish before callback completion. Work limits cover scanning,
validation, byte copies and reads even when chunks are empty. No recursion or
rendered output occurs here.

Opens/closes must cooperate with the supplied cancellation signal and settle
promptly. Stalled iterator reads can be interrupted and the owning lease is then
closed. A separately supplied deadline signal bounds cooperative wait duration;
there is no implicit native delay or indefinite window-status wait. Close failure
rejects a successful read; primary failure preserves its original reason.

Next increments must qualify actual identity-aware adapters, pass the first-party
engine cells, then implement command composition and isolated packed consumers
through the maintained package build. Keep all open cells open until their own
tests and evidence pass. No publication of this command package is authorized.

## Verification routes

- `npm run test:unit --workspace=safe-bash-command-wkhtmltopdf`
- `npm run lint --workspace=safe-bash-command-wkhtmltopdf`
- `npm run build:workspaces -- --workspace=safe-bash-command-wkhtmltopdf`

Tests use memory byte streams and mocked capabilities, never host files, native
renderers, network requests or an LLM. No visual CLI behavior has changed.
