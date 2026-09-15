# SafeJS MCP spawn argument validation

Two red normalization checks reproduced accepting sparse argument arrays and invoking accessor elements while validating spawn arguments. Read each array index through its own data descriptor, reject holes/accessors/nonstrings, and copy verified string values without invoking caller-provided array methods or iterators.

Run the complete managed MCP suite and scope lint/types. JSON configuration parsing already turns holes into null; the regressions cover the direct programmatic API as well.
