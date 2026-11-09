# Portable media codec sources

`runtime.js` contains FFmpeg 7.1.1 (LGPL-3.0-or-later), libogg 1.3.5,
libvorbis 1.3.7, libopus 1.5.2 (BSD licenses), LAME 3.100 (LGPL-2.0-or-later), OpenCORE AMR 0.1.6 and VisualOn AMR-WB 0.1.3 (Apache-2.0), compiled to static
JavaScript with Emscripten 4.0.13. Their complete, unmodified corresponding
sources are included in `sources/`; license texts are beside this notice.
The owned ABI and all build/normalization instructions are in `../scripts/`.

Corresponding source and build instructions for bundled distributions:
https://github.com/poe-platform/poe-code/tree/main/packages/media-codecs

The build includes only H.264, AAC, MP3, Vorbis, Opus and AMR-NB/AMR-WB decoding, RGBA conversion, Vorbis encoding,
Opus, AAC, MP3, AMR-NB and AMR-WB encoding. It disables native assembly, threads, network and file I/O.
The generated factory's unnecessary `async` modifier is removed after verifying
that initialization has no await. The tracked `../scripts/mp3-simd-rounding.patch` matches x86 SIMD MP3
transform coefficients and floating-point accumulation order in portable scalar
code; the source archives remain unmodified. FFmpeg's shared film-grain cleanup source is explicitly linked
because its H.264-only configuration omits that object from the archive.

The generated runtime is replaceable: rebuild it from these sources with the
same ABI, or replace the public codec module. Normal package builds only verify
and bundle the frozen artifact; they do not download sources or invoke a C compiler.

`x264-encoder.js` contains x264 revision c24e06c2e184345ceb33eb20a15d1024d9fd3497 (GPL-2.0-or-later), compiled to static JavaScript with Emscripten 4.0.13. Its complete corresponding source is `sources/x264-c24e06c.tar.gz`; the license is `LICENSE.x264`. The owned ABI, pinned hashes and reproducible build recipe are `../scripts/x264-encoder.c`, `../scripts/x264-sources.json` and `../scripts/build-x264.mjs`. Assembly, threads, OpenCL and host file I/O are disabled.
