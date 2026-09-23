# HarfBuzz shaping asset

`data.ts` embeds HarfBuzz 14.5.0 as an immutable base64 string. It is compiled
from upstream commit `863d3f7787c6df18d20e4535c5906bf3eb803bd5` with Emscripten
4.0.13. The binary is 553,970 bytes; its SHA-256 is
`68569480a0b76c81040de1e8b5d441317d479ea07a629bc0ce75bbd0ac7c0258`.

The full OpenType, AAT, legacy kerning and script shaping implementations remain
enabled. The build disables host file access, environment and locale discovery,
threads, exit callbacks and diagnostic buffer verification. It does not use the
reduced `HB_TINY` configuration. The asset has no filesystem or network imports.

The owned completion patch preserves exhausted work before HarfBuzz resets its
counters, reports buffer failures through `hb_shape_full`, and records sanitizer
limits. The allocator hooks record failures that would otherwise become empty
font/table fallbacks. These are failure-reporting changes, not glyph substitution
rules. An exactly exhausted operation budget is conservatively refused.

`ssconvert_hb_failure(buffer)` returns a bitmask: 1 for allocator failure, 2 for
the supplied buffer's work/allocation failure, 4 for sanitizer work, 8 for the
sanitizer subtable limit, and 16 for sanitizer recursion. Zero checks only global
sticky failures. Callers must require a nonzero `hb_shape_full` result and a zero
failure mask before publishing glyphs; separately refused host memory growth
also invalidates the result. Inspect a buffer before destroying it. Global
failure flags cannot be reset. Discard an instance after a trap or failure.

The memory starts at 262,144 bytes and declares a 2,147,483,648-byte ceiling.
That ceiling is an ABI property, not permission to allocate that much: the host
must enforce its own resource budget. Shaping is synchronous; this asset does
not provide asynchronous cancellation.

The source identities, complete ABI, flags and licenses are authenticated by
[the source manifest](../../../../scripts/harfbuzz/sources.json). Normal builds
verify the frozen asset. [The maintenance recipe](../../../../scripts/harfbuzz/README.md)
rebuilds it using explicitly supplied pinned sources and toolchain, without
installing tools or changing global configuration.

HarfBuzz is distributed under its MIT-style license in `HARFBUZZ-LICENSE.txt`.
Emscripten and its linked runtime notices are retained in
`EMSCRIPTEN-LICENSE.txt`, `MUSL-LICENSE.txt`, `LIBCXX-LICENSE.txt` and
`LIBCXXABI-LICENSE.txt`. No harfbuzzjs JavaScript wrapper is embedded.
