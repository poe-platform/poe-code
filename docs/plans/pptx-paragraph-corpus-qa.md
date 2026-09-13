# Paragraph corpus verification

Root owns this integration procedure and its verification receipt. Domain,
command, and audit workers own their assigned implementation files. This is an
agent-executed QA procedure, not a product or unit-test script.

1. Select the cached presentation template recorded in
   `docs/pptx/corpus-manifest.json`; verify its size and SHA-256 before admission.
   Read host bytes only as explicit QA setup. Do not download or ship fixtures.
2. Load those admitted bytes through the public package SDK. Select a paragraph
   using its slide and shape owner. Apply right alignment, zero left margin,
   negative hanging indent, zero before spacing, an explicit line multiple,
   numbered bullets, RTL and a decimal tab. Keep output in memory.
3. Apply equivalent direct flags through the actual safe-bash Shell with an
   explicit memory filesystem and injected command engine. Compare SDK and CLI
   archive bytes, expected XML attributes and child order. Compare each untouched
   package member and the complete text projection with the original.
4. Clear selected local values. Confirm unrelated local properties and inherited
   definitions remain unchanged. No line wrapping or slide rendering is claimed.
5. Reduce meaningful findings into small original in-memory regression cases.
   Run the maintained selected workspace build, package tests/lint, and scoped
   adapter checks. Review the separate terminal screenshot receipt.
6. Stage only explicitly owned source, tests, usage/research, and plan files.
   Record local commits independently; do not push or release.

## Receipt

The cached template was admitted at 1,202,514 bytes, SHA-256
`885e923f148cdf4680372abe54496c824ab3a2a2d8a59fd9703d66e0aeb1164c`.
The built public SDK and actual registered Shell selected slide 2, shape
`Content Placeholder 2`, paragraph 0 (SDK) / 1 (CLI). They applied right
alignment, 0pt left margin, -6pt indent, 0pt before spacing, 1.5 line spacing,
level 2, RTL, lower Roman period numbering and a decimal tab at 36pt.

Both produced exactly equal 1,202,671-byte archives, SHA-256
`48fa71cbe8f74e85ab2898e7177b15e06c79dd41ddd9954b3a60192df139a937`.
All 38 package members remained present. The 37 members other than
`/ppt/slides/slide2.xml` were byte-equal, including inherited definitions.
An independent SAX inspection found `algn="r"`, `marL="0"`, `indent="-76200"`,
`lvl="2"`, `rtl="1"` and child order `lnSpc, spcBef, buAutoNum, tabLst`.
The complete text projection stayed equal. Clearing alignment, margin, bullet
and tabs retained the negative indent and RTL override; all other parts still
matched. The cached input and memory input remained unchanged.

Two QA recipe corrections preceded the successful result: package inspection
uses its internal read-only helper because it is not a public SDK export; ZIP
member sets are compared independently of physical archive order because the
existing deterministic writer sorts members. Neither required a product change.
Output stayed in memory. No fixture, QA driver or generated binary is staged.
