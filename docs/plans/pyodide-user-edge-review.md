# Pyodide user edge review

Status: review executed; the Python feature remains open.

Review the existing experiment as a shell user before admitting production
architecture. Preserve the supplied canonical filesystem and all earlier evidence.
No README edits, commits or pushes are part of this review.

## Manual checks

1. Construct `Shell` with a canonical memory filesystem and `agentCommands()`.
   Seed `/work/report.py` with `print("hello")`. Run both version aliases,
   `python report.py`, `python -c 'print("hello")'`, `python -m json.tool`,
   and source piped into `python -`. Record status, stdout and stderr.
2. Run the pinned ordinary-script integration with backend delays zero and one
   millisecond. Check imports, ZIP, temporary files, random access,
   read-after-write and retained objects after rename.
3. Run the filesystem cancellation proof and mount regressions. Extend focused
   failing cases before changing the experimental bridge. Check error classes,
   exclusive creation, identities, directories, read-only and quota refusals.
4. Run bounded-pipe regressions. Check incremental binary input/output,
   cancellation on each channel, EOF retirement and broken-pipe error identity.
5. Rerun stock runtime metadata/path, Promise-callback and host-capability
   characterizations. These document limitations; they are not passing
   full-contract acceptance tests.
6. Run the integration inventory check and syntax checks for edited JavaScript.
   Record exact outcomes in `packages/safe-bash/docs/pyodide.md`. Keep unsupported
   required behavior open, with no skipped acceptance assertions labeled passes.

## Initial observations

On Node v22.23.2 and Pyodide 314.0.6 (CPython 3.14.2), both ordinary-script
runs and blocked filesystem-read cancellation pass. The six actual Shell
invocations in step 1 all return 127 with `command not found`, confirming that
no product command is available. The initial mount suite passes 10 of 12 cases;
absolute symlink namespace and distinct identity scopes fail.

The stock-runtime characterizations still reproduce metadata wrapping, terminal
path normalization, unawaited Promise callbacks and ambient Node capabilities.
No production UI changed, so this review does not claim a CLI screenshot gate.

## Filesystem review results

Six additional mount cases cover errno translation, alias identity, exclusive
creation, duplicate descriptors, synchronization refusal and pre-truncation flag
admission. After reproduced failures and experimental fixes, the root rerun passes
17 of 18 tests with no skips. The absolute-symlink namespace assertion still fails.
Both ordinary-script profiles and blocked-read cancellation pass after these edits.
The exact opt-in inventory check and JavaScript syntax checks pass.

The final independent stdio rerun passes 11 of 11 cases, with no skips. Five
reproduced bugs were fixed: missing output EOF, errno loss on broken pipes,
lost accepted-prefix counts, missing final stdout flush, and buffered stderr
consumed by Pyodide's exception formatter. Flushing happens inside Python before
exceptions cross into JavaScript. Full process shutdown remains unqualified.

The remaining failing assertion is retained as required architecture evidence.
Resolving it requires a complete canonical namespace and qualified runtime asset
mapping; the earlier root-mount experiment also fails. No whole-tree copying,
MEMFS replacement, host Python fallback or weakened test substitutes for that work.
