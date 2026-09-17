# Exact environment name verification

The original case in latex-environment-names-red.log demonstrated that an unknown
verbatim-prefixed environment was accepted in strict mode and mapped to only its
first child's text, deleting the remaining content and command arguments.

Only exact verbatim/verbatim* names now map to verbatim blocks or bypass macro
parameter substitution. Unknown names fail E_CAPABILITY in strict mode and retain
the complete RawBlock with W_RAW_CONTENT under raw-retain and lossy policies.
The test also verifies macro parameter expansion in an unknown environment.

Maintained verification: npm test --workspace=@poe-code/pandoc (47 files, 1050
tests), npm run lint --workspace=@poe-code/pandoc (ESLint and both typechecks), and
npm run build:workspaces -- --workspace=@poe-code/pandoc (declared build closure).
Logs use the latex-environment-names prefix. Inline original unit cases create no
host fixtures and call no LLMs, downloads or external executables.

QA procedure lives in docs/plans/pandoc-latex-reader.md. The built thin command's
strict/raw/lossy results are shown in the inspected
latex-environment-names-command.png: strict emits only an error; retained policies
preserve the whole environment and arguments with a warning. No native runtime
fallback or full TeX compatibility is claimed. Local delivery only.
