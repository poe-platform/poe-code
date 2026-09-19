# Independent DBF scalar and memo user QA

Use the actual safe-bash Shell and injected MemoryFileSystem, with all fixtures created as in-memory byte arrays. Use the frozen CPython 3.14.2/hash-required csvkit 2.2.0 reference only in separate ad hoc tooling under out; canonical tests must never invoke it.

1. Compare exact stdout, stderr and status for malformed byte whitespace in numeric, float, memo-index and date fields. Python byte integer conversion must not inherit Unicode string whitespace.
2. Confirm ASCII star padding, underscore integer syntax and negative memo indexes retain the measured inference/null behavior.
3. Verify the binary source and companion remain byte-identical and the virtual directory gains no files.
4. Reproduce disagreements in a failing actual-Shell regression before editing the owned field codec. Rebuild the selected csvkit workspace closure and rerun the tests uncached.
5. Report measured cases separately from unsupported or unmeasured codecs, corrupt seek layouts, exotic numerical boundaries and service-backed filesystem behavior. Root owns integration inventory, maintained broader checks and screenshots.
