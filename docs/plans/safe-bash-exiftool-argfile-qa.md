# Argument-file increment QA

Status: incomplete E22 qualification. No PDF/parser, import, protocol or full
format acceptance group is closed by these controls.

1. Download the supplied ExifTool 13.59 source revision into task-owned `out/`.
   Verify archive SHA256 before extracting or executing any development oracle.
   Product code never uses Perl or searches the executable directory.
2. Execute native `-config '' -@ <file>` controls with PERL5OPT/PERL5LIB cleared.
   Use `-echo` and `-ver` to observe argument bytes independently of image parsing.
   Include initial BOM, CRLF, leading whitespace, inline hashes, quoted strings,
   trailing spaces, assignment-space normalization, CSTR recognized/unknown
   escapes, empty CSTR and nested files. Record exact output and status.
3. Execute the same reviewed physical-line controls against memory VFS SDK
   command invocations and actual Shell composition. Check insertion order,
   last assignment, binary output, literal `--`, and option-value consumption.
4. Exercise invalid UTF-8, regular-file authority, cycles, deep nesting, repeated
   inclusion, input/decoded/retained/work exhaustion and canceled/failed reads.
   Verify input and backup namespaces stay unchanged after expansion failure;
   producer finalization and registered cleanup must complete before settlement.
5. Run maintained command-package lint/unit and selected workspace build closure.
   Run safe-bash Shell integration and maintained package-artifact checks. Capture
   and inspect visible Shell output through the maintained screenshot route.
6. Purge only task-owned `out/exiftool-behavior` sources and evidence after durable
   results are recorded. Do not publish, push, or count unavailable cells as passes.

Deliberate bounded deviations: only UTF-8 argument files, current-directory VFS
resolution, no executable-directory fallback, no symlink argument-file inputs,
no stdin `-@ -`, no polling, depth at most 15 included files and 4096 expanded
arguments. Config/common_args in an argument file fail explicitly. Execute and
stay_open remain unsupported. Native arbitrary nesting is not a safe budget.
