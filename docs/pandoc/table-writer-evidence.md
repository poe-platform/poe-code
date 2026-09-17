# Original writer verification

Initial writer cases: nine failures against the existing implementation (lossy
option and built-in writer capabilities absent); existing 515 tests passed.
Additional original boundary cases reproduced unescaped lossy HTML, missing
default column alignment on HTML cells and acceptance of unsupported rich GFM.
These cases now pass along with literal projection, parse5 DOM, diagnostic-path,
publication-budget and generated span text/order checks.

Current package tests: 531 passed in 14 files. Package lint/typecheck and selected
@poe-code/pandoc workspace build passed. These are scoped checks, not a
repository-wide gate or upstream conformance claim. No unit test filesystem
mutation, LLM, downloaded fixture or external executable was used.

The policy is in table-policy.md. Geometry rejects invalid data rather than repair;
GFM uses a declared plain-text rectangular single-header subset and Plain uses a
documented physical-row projection. Byte-only CLI adaptation is the next milestone.
