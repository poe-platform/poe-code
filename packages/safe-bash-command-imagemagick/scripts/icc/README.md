`src/icc/runtime.js` is LittleCMS 2.17 (MIT) compiled to synchronous JavaScript
with Emscripten 4.0.13, using the same portable build as the font runtime.
Each conversion owns a heap capped at 64 MiB, processes at most 512 pixels at a
time, and closes profiles, transforms and buffers even on errors or cancellation.
No host I/O or WebAssembly compilation is required.

Rebuild from the checksum-verified [LittleCMS 2.17 archive](https://github.com/mm2/Little-CMS/releases/download/lcms2.17/lcms2-2.17.tar.gz):

```sh
node packages/safe-bash-command-imagemagick/scripts/icc/build.mjs path/to/lcms2-2.17.tar.gz path/to/emcc
```

The script verifies the source SHA-256 and compiler version, embeds the LittleCMS
and compiler runtime notices, and keeps temporary build files under `out`.
Normal builds bundle the committed artifact without compiling or downloading C.
Compiler source paths are normalized to `lcms2-2.17` for reproducible output.

The build applies `type2-boundary.patch` before compilation. ICC type 2 must
return the offset `c` at `a*x+b=0`; its inverse must return `-b/a` at `Y=c`.
LittleCMS 2.17 returns zero at those two boundaries. The patch corrects the
curve evaluator itself and requires the standard `patch` build tool. Regression
tests check both directions, 8/16-bit output, adjacent inputs and the other
parametric curve types against their equations.
