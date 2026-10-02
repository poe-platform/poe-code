# Pandoc issue 2677

Make the document converter a dedicated private `safe-bash-command-pandoc`
workspace and expose its command factories through Safe Bash's core and Node
entrypoints. Registration remains explicit through `shell.use(pandocCommands())`.

The converter defaults every resource budget to `Infinity`, accepts explicit
nonnegative safe integer limits, and preserves cancellation, overflow detection,
and finite filesystem read bounds. XLSX input places the first row in the table
head, represents literal spaces and newlines as AST nodes, and calculates missing
formula results. The `markdown` alias selects the supported GFM profile.

The PDF renderer owns synthetic bold/oblique text, strikeout/underline, horizontal
rules, and aligned paragraphs and table cells. The Pandoc writer only adapts AST
nodes to those layout primitives. Alignment survives wrapping and pagination.

Verification covers regression tests that first fail on the reported behavior,
package lint and type checks, public command identity and registration, private
workspace build and package admission, the maintained full unit/lint routes, and
an independently rasterized PDF screenshot. Deliver all changes to remote main
and close 2677 only after every requirement passes. Release completion is outside
this issue's requested delivery gate.


## Command ownership and distribution verification

The command workspace migration is present in `c06b3f90df`. The current consumer
inventory has Safe Bash's lazy command loader and public command facade importing
Pandoc; no other runtime workspace imports its conversion implementation. Keep
`cli.ts`, `safe-bash.ts`, and `command.ts` in the command workspace. The existing
Markdown, DOCX, PPTX, PDF, image AST and office-package dependencies retain their
shared engine identities. Do not create a second conversion owner or restore an
unpublished package as an installation requirement.

The supported conversion facade is
`@poe-platform/safe-bash/commands/pandoc`; it re-exports the conversion, format,
Lua and standalone callback APIs along with command factories. Root and core
command factories retain their shared lazy registration implementation. The
workspace is private, explicitly admitted by Safe Bash, and bundled through the
generic packager with its existing portable export conditions and assets.

The maintained boundary test guards real frontend ownership, exact manifest
admission, canonical contracts, unit build prerequisites and the thin public
facade. The isolated packed consumer covers public factory identity, explicit
registration and replacement, VFS script pipelines, invalid byte argv, canonical
filesystem errors, cancellation, explicit output limits, conversion APIs, Lua,
PDF and XLSX. Run its strict NodeNext companion without private workspaces.
These checks preserve current default registration, limits and output behavior;
they do not qualify additional formats or alter help output.
