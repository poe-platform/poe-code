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
