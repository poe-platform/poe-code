# Primary references and evidence roles

Date2026-08-29. Full raw local official directory bodies and response metadata are
in HTTP-01, captured by the sealed supplement13d43974. Web search results also
corroborated these references; several direct web-tool opens returned empty
responses. Cached snippets alone were not used to claim a fresh absence.

| Reference | Exact primary location | Role |
| --- | --- | --- |
| R1 | https://ftp.gnu.org/gnu/bash/ | Live GET: stable release membership; no crypto verification |
| R2 | https://ftp.gnu.org/gnu/bash/bash-5.3-patches/ | Live GET:001–015/signature membership |
| R3 | https://ftp.gnu.org/gnu/bash/bash-5.3.tar.gz | HEAD only:11355854bytes, timestamp, ETag; no source bytes/hash |
| R4 | https://ftp.gnu.org/gnu/bash/bash-5.3.tar.gz.sig | HEAD only:95bytes; no cryptographic verification |
| R5 | https://lists.gnu.org/archive/html/bug-bash/2025-07/msg00005.html | Chet Ramey's July5,2025 release announcement; primary web search text |
| R6 | https://ftp.gnu.org/pub/ | GNU detached-signature/keyring verification guidance; primary web search text |
| R7 | https://www.gnu.org/software/security/ | Signature/checksum and project-keyring provenance guidance; primary web search text |
| R8 | https://www.gnu.org/software/bash/manual/html_node/Basic-Installation.html | Source configure/make, out-of-tree build; primary web search text |
| R9 | https://www.gnu.org/software/bash/manual/html_node/Optional-Features.html | Default bundled Readline and explicit feature configuration; primary web search text |
| R10 | https://www.gnu.org/software/bash/ | GNU maintainer/licensing information; primary web search text |

Expected future keyring location: `https://ftp.gnu.org/gnu/gnu-keyring.gpg`.
Project-key authorization may be corroborated through official Savannah project
key metadata; its actual response and exact signer fingerprint remain unbound.
No global keyring fetch or signature verifier execution occurred in this review.

Existing project context: Curie commit
`5e7ca89d958c68504e410faf1dbc82e0a2525e2c`,
`tests/compatibility/bash-surface-20260829/REFERENCES.md` and `ORACLE-PROPOSAL.md`.
Context was read without edits; it is not substitute runtime evidence. No
third-party prebuilt was fetched or admitted. The40 native cases are UNRUN here.
