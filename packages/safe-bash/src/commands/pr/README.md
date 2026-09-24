# pr

Paginate byte streams, print numbered lines, or arrange input into columns with
`pr`, for example `pr -t -2 input.txt`.

Layouts default to at most 256 columns, 16,384 characters of page width, and
8 MiB of retained buffers. Oversized layouts fail before reading input. Output
padding and page headers are checked against the command's remaining output
budget before construction.

Applications can configure these limits through
`prCommands({ limits: { maxColumns, maxPageWidth, maxBufferedBytes, maxOutputBytes } })`
or the standard command plugin's `pr.limits` option. Trusted applications can
explicitly set individual limits to `Infinity`.
