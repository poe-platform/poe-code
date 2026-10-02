# Portable media codec sources

`runtime.js` contains FFmpeg 7.1.1 (LGPL-2.1-or-later), libogg 1.3.5,
libvorbis 1.3.7, and libopus 1.5.2 (BSD licenses), compiled to static
JavaScript with Emscripten 4.0.13. Their complete, unmodified corresponding
sources are included in `sources/`; license texts are beside this notice.
The owned ABI and all build/normalization instructions are in `../scripts/`.

Corresponding source and build instructions for bundled distributions:
https://github.com/poe-platform/poe-code/tree/main/packages/media-codecs

The build includes only H.264 decoding, RGBA conversion, Vorbis encoding,
and Opus encoding. It disables native assembly, threads, network and file I/O.
The generated factory's unnecessary `async` modifier is removed after verifying
that initialization has no await. No codec algorithms or upstream source files
are patched. FFmpeg's shared film-grain cleanup source is explicitly linked
because its H.264-only configuration omits that object from the archive.

The generated runtime is replaceable: rebuild it from these sources with the
same ABI, or replace the public codec module. Normal package builds only verify
and bundle the frozen artifact; they do not download sources or invoke a C compiler.
