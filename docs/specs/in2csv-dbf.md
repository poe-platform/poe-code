# in2csv DBF reading

The DBF format descriptor delegates to the domain engine. `in2csv FILE.dbf` and `in2csv -f dbf FILE` use the same reader as SDK `run({command: 'in2csv', settings: {filetype: 'dbf', input_path: FILE}}, context)`. The fourteen original executable names and argument grammar remain unchanged.

The reader reopens the binary filename through injected filesystem capabilities. It never consumes stdin or interprets the common text reader's bytes. Named files first require the exact input name, matching LazyFile's opening before `.name` is accessed. Missing named files return FileNotFoundError before encoding validation. Known common encoding names are ignored by the binary decoder; unknown names fail after a successful named open. Missing input and `-` attempt the reference name `<stdin>` and normally return DBFNotFound. No writer, native subprocess, Python fallback, network, database or interactive capability is introduced.

Headers and descriptors follow dbfread 2.0.7: version bytes are not rejected merely for being unfamiliar, count is ignored, C length includes its high byte, and only I/L lengths are eagerly validated. Records follow physical order, stop at EOF/0x1a, and parse active records before a separate deleted-record validation pass. Scalar values retain their native integer/float/currency/date/datetime/bytes identities during default Agate inference. Common inference/locale/encoding flags do not change DBF parsing; encoding still labels csvkit's Unicode diagnostic.

Date components and textual memo indexes use Python's byte-integer semantics: ASCII whitespace and legal underscores are accepted, while non-ASCII whitespace bytes are rejected. Four-byte memo indexes remain binary unsigned integers. The additional 69 measured user cases and validation are recorded in docs/csvkit/in2csv-dbf-user-edge-validation.md.

Memo lookup prefers FPT over DBT. FPT uses its big-endian header/block size and typed memo headers; DB3 is selected only for version 0x83, with all other DBT versions using DB4. Missing, truncated and invalid pointers have measured diagnostics. A positive memo index or multiplied offset outside JavaScript's exact integer range returns status 78 instead of silently treating the memo as empty.

`CsvkitFileSystem.listDirectory` optionally supplies ordered entry names for case-insensitive sibling lookup. The safe-bash adapter binds it to the injected VFS `readdir`. Hosts omitting it qualify only exact filename reads; mixed-case lookup/preference is unqualified in that configuration. Filesystem and codec providers remain explicit host bindings. Input, retained bytes, decoded codepoints, fields, rows, columns, work and output are bounded. Stream bytes are copied before producers advance, sinks are awaited, and invocation cleanup is registered before stream acquisition.

Qualification uses the frozen CPython 3.14.2 profile, csvkit 2.2.0 source SHA-256 `147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b`, Agate 1.14.2, agate-dbf 0.2.4, dbfread 2.0.7 and SQLAlchemy 2.0.54, C locale and UTC. See docs/csvkit/in2csv-dbf-reference.json and in2csv-dbf-stress-reference.json for exact reference output/status/effects. Single-byte driver mappings are compared for every byte against the frozen decoder.

## Explicit blockers

- Native traceback/deployment identity for verbose errors remains unqualified.
- Filename glob syntax returns status 78; unusual Unicode glob matching and multiple case-colliding sibling selection are unmeasured.
- Multi-byte driver codecs require an injected provider and have no DBF qualification in this change; absent providers return status 78.
- Invalid non-progressing record layouts return status 78. Native potentially unbounded backward-seek layouts were not run.
- Concurrent source mutation between native header/record/memo reopenings, compressed filenames, filesystem permission/glob filtering races, exotic timestamp/float boundaries and service-backed filesystems are unmeasured.
- Broader csvkit database/interactive support and existing skipped/TODO cases are outside this DBF milestone and are not passes.
