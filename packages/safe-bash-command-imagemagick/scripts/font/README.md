`src/font/runtime.js` is FreeType 2.14.1 compiled to synchronous JavaScript with
Emscripten 4.0.13. It includes the TrueType, CFF, SFNT, autofit and grayscale raster
modules, with no host file I/O. Each caption owns its font instance and a heap
bounded to 64 MiB. The build removes Emscripten's unnecessary `async` factory
modifier after parsing and checking for top-level awaits. License notices are
embedded in the generated artifact and retained beside it.

Rebuild from the unmodified [FreeType 2.14.1 source archive](https://download.savannah.gnu.org/releases/freetype/freetype-2.14.1.tar.xz)
and an installed Emscripten 4.0.13 compiler:

```sh
node packages/safe-bash-command-imagemagick/scripts/font/build.mjs path/to/freetype-2.14.1.tar.xz path/to/emcc
```

The script checks the archive SHA-256 and compiler version. Temporary build files
stay under the repository's `out` directory. Normal package builds bundle the
committed artifact without downloading or compiling C sources.
