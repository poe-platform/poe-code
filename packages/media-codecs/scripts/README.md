# Reproducing the codec runtime

Normal builds verify source and artifact hashes without downloading anything or
running a C compiler:

```sh
node packages/media-codecs/scripts/verify.mjs
```

To reproduce the frozen runtime, supply an installed Emscripten 4.0.13 compiler:

```sh
node packages/media-codecs/scripts/build.mjs /absolute/path/to/emcc
```

The recipe validates the compiler version and all pinned sources and owned build
inputs, extracts the vendored source archives into a fresh repository `out`
directory, builds the static libraries and owned ABI, and checks that the result
matches the committed runtime byte for byte. It uses isolated compiler settings,
cache and temporary files; it neither installs a toolchain nor changes global
configuration. The build requires Node, Python compatible with Emscripten,
make, tar and pkg-config. Logs remain under `out` for inspection.

Changing codec sources, the ABI, compiler flags or normalization requires renewed
native differential and browser/Worker validation before updating `sources.json`.
