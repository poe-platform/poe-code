# Bounded image admission

Owner: image_admission. Owned source/test files: packages/pptx/src/image-admission.ts
and image-admission.test.ts. Root owns insertion integration and commits.

1. Establish red original byte-array tests for new admission behavior; no host I/O
   or files needed, so no filesystem mock is needed for this pure component.
2. Reuse shared CRC32 and bounded image metadata. Check PNG chunks, GIF frame and
   sub-block bounds, and JPEG markers/segments before allocating any media parts.
3. Enforce encoded and pixel budgets before decompression; never decode pixels.
4. Validate supported MIME/signature pairing, dimensions, depth/color constraints,
   CRC and truncation, alpha-byte immutability, extreme aspect ratio and byte views.
5. Retain unknown JPEG dimensions for explicit sizing at the integration boundary.
6. Consult test/API research inventories; retain each selected case in the separate
   research receipt with partial/adjacent statuses and no unsupported parity claim.
7. Run focused tests/lint; root runs maintained package checks and verifies SDK/CLI.

Evidence: initial run failed on absent module. Additional red cases reproduced
invalid PNG chunk names and unsafe post-scan JPEG frames. All 38 focused cases
passed in 6 ms; source/test ESLint passed. No README changes, downloads, native
runtime, product network, commits or pushes from this delegated component.

Complete machine-readable accounting: [image insertion case map](../pptx/image-insertion-case-map.json). Every original image case ID remains visible, and all whole-row parity flags remain false.

Root integration verification: maintained PPTX test route passed 3,102 tests;
maintained package lint and selected PPTX build closure passed. Header validation
is committed independently from the picture/CLI insertion integration.
