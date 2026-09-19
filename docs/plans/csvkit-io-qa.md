# csvkit injected I/O QA

Use the frozen reference recorded in docs/csvkit/reference-profile.json. Reproduce
each issue before fixing code. Canonical tests use injected in-memory streams and
filesystems; reference captures are separate research, never native test fallbacks.

1. Compare named text bulk reads and physical-line iteration with stdin, including
   NUL, CR, LF, CRLF, split UTF-8, skip-lines and a final unterminated line.
2. Verify delayed open: help/parser errors acquire no positional input; errno
   errors on actual reading retain the original argv filename in stderr.
3. Verify cwd-relative and absolute virtual paths, named-file reopening and one
   stdin cursor. Do not perform POSIX shell expansion a second time.
4. Exercise csvstack's header pass and second pass, repeated named sources and
   repeated stdin, filename labels and headerless grouping reference quirks.
5. Pause sinks and iterator returns. Cancel with falsey reasons; confirm completed
   output/file effects remain, producers close once, and settlement waits for
   registered cooperative cleanup. Break early from a named reader and confirm
   closure before reopening.
6. Run the csvkit workspace test/lint/build routes and actual safe-bash csvkit
   invocation tests; rebuild exported declarations before consumer type checks.
7. Record unsupported and unmeasured profiles explicitly, including Windows
   filename expansion, optional codecs/drivers/interpreters, TTY transport and
   workbook/multi-sheet paths. Purge only this task's temporary out evidence after
   reducing observations. No README updates, commits, pushes or publication.
