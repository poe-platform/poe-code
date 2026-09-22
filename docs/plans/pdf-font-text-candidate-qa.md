# Font/text candidate manual QA

Execute these steps against the built private package. Fixtures stay in memory;
do not invoke native PDF tools, fetch assets or introduce filesystem authority
into the engine. This checks the current local source candidate, not remote main.

1. Run the maintained pdf-parser test, lint and selected workspace build routes.
   Require the entire package suite to pass after any regression fix.
2. Import the built portable entry and pass a foreign Node VM realm Uint8Array
   containing text content. Supply an explicit in-memory font dictionary with
   WinAnsiEncoding and widths. Verify text, raw code bytes and origins.
3. Supply a partial ToUnicode map with a four-byte source code to the standalone
   CMap API. Verify checked unsigned arithmetic and a supplementary destination.
   Verify that the same source width cannot change simple-font segmentation.
4. Reject an object imitating byte storage. Check an already-aborted signal's
   exact reason and a zero-work quota's fatal LIMIT error.
5. Inspect the portable production imports and private manifest. No runtime
   external dependency, host-font lookup, URL fetch, native oracle or default
   crypto platform acquisition is admitted by these text APIs.

No CLI implementation or visible output changes in this candidate. CLI/SDK
command parity, screenshots, SafeJS original/checkpoint/replay, installed command
bundling, browser, workerd and Bun are unverified independent integration cells.
Do not count this Node-hosted foreign-byte-realm control as executing the engine
inside another runtime or as a full authority-isolation audit.
