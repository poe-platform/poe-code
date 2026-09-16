# Pending package README copy (not installed; permission required)

## @poe-code/pdf

Private TypeScript PDF engine. `renderPdf(layout, context)` returns owned PDF bytes; `pdfCapabilities()` describes the supported profile. `suppliedDefaultFont()` supplies packaged JetBrains Mono Regular, licensed under SIL OFL (package OFL.txt). No system fonts are discovered. Fonts can instead be supplied as explicit byte resources with unique IDs.

PDF reference: Adobe PDF Reference, sixth edition, November 2006, PDF 1.7. Profile PDF-1.7-supplied-fonts-ltr prohibits encryption, JavaScript, attachments. Latin (ASCII/Latin-1), Greek and Cyrillic horizontal LTR text only; combining sequences, bidi and complex scripts rejected. Missing glyphs rejected after ordered supplied font fallback. Scalar wrapping; explicit newlines. No hyphenation, word shaping across runs or justification. Embedded complete fonts, no subsetting. PNG/JPEG images, rectangular unspanned tables with indivisible rows, HTTP/HTTPS/mailto URI links. No PDF/A or accessibility conformance claim.

Layout is separate from any document AST. PageBox width/height/margin are points (default A4 595.28 x 841.89, margin 48). Paragraph runs select font ID (fallback in supplied order), size (default 12, max 144), URI link. Paragraph spaceAfter defaults to 8. Images specify media, bytes and explicit point dimensions. Tables specify positive fractional widths summing to 1 and rows of paragraph cells. breakBefore and keepTogether constrain pagination; oversized indivisible content fails.

Context: signal, yield scheduler, shared charge callback and limits. Defaults: fontBytes 4,000,000; fonts 8; glyphs 100,000; pages 200; objects 100,000; images 100; imageBytes 8,000,000; layoutWork 500,000; outputBytes 16,000,000. PNG additionally capped at 4,000,000 pixels. Output ceiling is checked after library serialization; synchronous library font parsing/serialization cannot be preempted. Object budget conservatively counts engine operations rather than every library internal allocation. These are trusted bounded primitives, not a memory-isolation boundary.

Dependencies: pdf-lib 1.17.1, @pdf-lib/fontkit 1.1.1, both MIT JavaScript/TypeScript; exact transitive dependency versions/integrities in package-lock.json. Neither is a native/WASM compiler or runtime fallback.

Environment variables: none.
