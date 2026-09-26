# pr

Paginate byte streams, print numbered lines, or arrange input into columns with
`pr`, for example `pr -t -2 input.txt`.

Column count, page width, retained buffers, and output are unlimited by default
(`Infinity`). Configured layout limits are checked before reading input. Output
padding and page headers are checked against any remaining output budget
before construction.

Applications can configure these limits through
`prCommands({ limits: { maxColumns, maxPageWidth, maxBufferedBytes, maxOutputBytes } })`
or the standard command plugin's `pr.limits` option. Set positive safe integers
to opt in, or explicit `Infinity` to disable individual limits.
