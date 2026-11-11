`src/icc/runtime.js` is LittleCMS 2.17 (MIT) compiled to synchronous JavaScript
with Emscripten 4.0.13, using the same portable build as the font runtime.
Each conversion owns a heap capped at 64 MiB, processes at most 512 pixels at a
time, and closes profiles, transforms and buffers even on errors or cancellation.
No host I/O or WebAssembly compilation is required.

Rebuild from the unmodified [LittleCMS 2.17 archive](https://github.com/mm2/Little-CMS/releases/download/lcms2.17/lcms2-2.17.tar.gz):

```sh
node packages/safe-bash-command-imagemagick/scripts/icc/build.mjs path/to/lcms2-2.17.tar.gz path/to/emcc
```

The script verifies the source SHA-256 and compiler version, embeds the LittleCMS
and compiler runtime notices, and keeps temporary build files under `out`.
Normal builds bundle the committed artifact without compiling or downloading C.
