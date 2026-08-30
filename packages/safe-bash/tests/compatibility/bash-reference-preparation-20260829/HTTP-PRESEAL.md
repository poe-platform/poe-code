# Official HTTP metadata supplement

This is a single SOURCE/METADATA-only controller, not an oracle or build.
It is within the original 30-minute/64-start ceiling, not a renewed budget.
Outer stdout/stderr exist before loading the helper; STARTUP precedes requests.
Four serial requests, 15 seconds each, 70 seconds total, no redirects, no
credentials, no children. GET bodies are capped128KiB each; HEAD bodies are
not consumed. Capture reservation1MiB, working reservation2MiB. URLs are literal
official GNU HTTPS paths: two directory listings and HEAD-only archive/signature
metadata. No source archive body, program, patch, or keyring is fetched.
Network errors remain captured availability limitations. A response/ETag is not
a signature check or a cryptographic source pin. No request is retried.
