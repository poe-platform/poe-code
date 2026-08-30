# Artifact handoff preparation history — August 28, 2026

The first `node --check extract.mjs` returned status1 before any extraction:

```text
extract.mjs:286
SyntaxError: missing ) after argument list
```

The source-coverage reducer lacked its initial accumulator and closing
parenthesis. The syntax-only preparation defect was corrected before the source
preseal. No old artifact program, product, compiler or cohort ran.

A subsequent read-only inspection shell returned status127 after its zsh loop
used the special variable `path`, changing command lookup:

```text
zsh:1: command not found: sed
zsh:1: command not found: rg
```

Inspection continued in bash with an ordinary loop variable. This was a shell
inspection error, not an artifact-authentication or product result. Neither
failure changes the immutable original actual-review FAIL.
