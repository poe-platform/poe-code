# Real browser document qualification

This is an explicitly invoked integration fixture, outside unit discovery. It
downloads a pinned Pyodide runtime and wheels in a real browser Worker. Run from
the repository root with existing npm development dependencies installed.

1. Start `node packages/safe-bash/tests/integration/pyodide-runtime/browser-documents/server.mjs UNIQUE_CAPTURE_ID`.
   Use a new capture identifier every time; capture JSON is exclusive-create.
2. Open `http://127.0.0.1:8766/` in Chromium. The loopback server supplies COOP and
   COEP so Workers can synchronously await SharedArrayBuffer replies while the
   main browser thread services asynchronous canonical filesystem operations.
3. Wait for all four profiles: MEMFS control, canonical `/work` bridge, canonical
   `/work` bridge with 1ms backend delay, and experimental canonical root mount.
   The page reports progress and preserves independent profile failures.
4. Inspect each JSON capture, `priority_passed`, each workflow's assertions and
   failures, worker isolation, browser version, CDN index hash, operation counts,
   open handles, and parent-side canonical artifact equality. Inspect generated
   document/image artifacts and take a screenshot of the completed browser page.
5. Record results and unresolved requirements in `packages/safe-bash/docs/pyodide.md`.
   Stop the server and close only the browser session created for this run.

`worker.mjs` installs matching indexed lxml/Pillow and optional PyMuPDF, then uses
micropip with dependency resolution and exact pure-Python distribution pins.
The server inserts the existing experimental Node bridge source into the browser
Worker; its browser transport copies a shared reply before TextDecoder use.
The browser adaptation admits `O_NOFOLLOW` only when `O_CREAT|O_EXCL` already
requires canonical atomic rejection of every existing final entry. All other
nofollow opens remain unsupported. Exclusive opens skip the preliminary stat;
the canonical handle operation decides creation without following a final link.
Artifact collection uses Python `Path.read_bytes()` because the experimental
bridge returns legal short reads, while Emscripten's convenience `FS.readFile()`
does not loop to complete a file larger than one 64KiB bridge reply.

This fixture executes an ordinary staged Python file with `runpy.run_path()`.
It does not establish a public safe-bash `python FILE` command, a production
filesystem adapter, general root namespace correctness, or formula recalculation.
The canonical bridge uses safe-fs MemoryFileSystem, distinct from Pyodide MEMFS.
Temporary packaging is deliberately routed under the canonical `/work` tree;
the report also records the runtime's default temporary directory.
