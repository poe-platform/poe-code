# Toolcraft lint fixture after SafeJS eval support

The merged repository test run fails because the lint-error fixture executes
`eval('1')`, which SafeJS now supports and correctly returns successfully.
Use syntactically invalid source to continue checking AS001 diagnostics and
add an independent assertion that supported eval execution returns its value.
Validate with the Toolcraft codemode execute suite and the repository test route.
