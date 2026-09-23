# Issue 292: scoped GNU UnRTF personalities

Keep standards-strict extraction as the default. Admit `gnu-0.21.10`
explicitly through CLI `--profile=gnu-0.21.10`, registration or SDK `profile`.
Use only static scoped official templates/aliases; no configuration lookup,
native runtime fallback or picture exports. Full native parser/rendering parity
is outside this profile; strict Unicode and malformed-input behavior remain.

## Manual QA

1. Download the official GNU UnRTF 0.21.10 archive into owned ignored
   `out/issue-292`; verify SHA256
   `b49f20211fa69fff97d42d6e782a62d7e2da670b064951f14bbff968c93734ae`.
   Build the native oracle with configure and make. Pass its official outputs
   directory explicitly with `-P`; use `--nopict`, LC_ALL=C and TZ=UTC.
2. Compare `{\\rtf1\\ansi Hello}` under text, HTML and LaTeX, each with
   default banner, quiet and noremap. Compare exact stdout/status/stderr.
3. Compare `<&%_>`, nested bold/italic and paragraph/line breaks under all
   three personalities with quiet, with and without noremap. Preserve differences
   in strict Unicode handling rather than adopting legacy parser defects.
4. Run the same minimal document through an actual memory-backed Shell and
   inspect a terminal screenshot of all three output personalities. Check the
   existing Shell pipeline, redirection, SDK and authority-boundary tests.
5. Run command workspace unit tests and lint/typechecks, and the maintained
   selected Safe Bash build closure. Purge owned temporary evidence afterward.

## Executed results

The archive hash matched. Native minimal document: all nine format/option cells
returned status 0 and empty stderr. Explicit virtual GNU profile reproduces the
issue's complete text/HTML/LaTeX bytes, including the banner, separator and final
newlines. Native special-character, nested emphasis and line-break controls
confirmed the scoped templates and noremap behavior. Exact expectations are
retained in command tests; unit tests do not execute the native oracle.

Command tests: 82 passed, including CLI/SDK parity, strict malformed Unicode,
inert fields/pictures and output quota failures. Existing actual Shell integration
tests: 4 passed. Workspace lint and production/test typechecks passed.
The selected Safe Bash build closure passed, including its postbuild stage.
The first run completed build stages but failed to write its sandbox-restricted
shared-cache receipt; the rerun with cache access passed. The terminal screenshot
of actual Shell text/HTML/LaTeX output was inspected and temporary output purged.
The profile does not qualify native font/color/table rendering, legacy Unicode
projection, arbitrary personalities/configuration or recovery behavior.

The templates/aliases are derived from official GPL-3.0-or-later assets.
The complete license and source provenance are in the command package NOTICE,
which the existing Safe Bash packaging route includes alongside LICENSE.
