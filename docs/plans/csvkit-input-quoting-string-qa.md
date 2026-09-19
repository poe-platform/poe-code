# Typed input quoting: bounded string-record QA

1. Activate sealed raw-operation-reference csvcut case 37. Reproduce its failure:
   the product returns unsupported status 78 instead of original float conversion
   ValueError, status 1 and empty stdout.
2. First reproduce failing in-memory cases for input quoting 2, 4 and 5 through
   raw csvcut/csvformat/csvclean and typed csvsort. Use entirely quoted string
   headers and rows; compare exact stdout/stderr/status without native programs
   in canonical unit tests.
3. Run the existing typed CSV parser before operation type admission. Admit
   string-valued records only; numeric/null records must retain an explicit
   unsupported status 78 rather than being stringified or counted as passes.
4. Check an invalid unquoted header in modes 2 and 4. Check first numeric/null
   record after a string header, preserving the already-written header. Compare
   the native reference's complete successful float/null result separately;
   this intentional mismatch remains a documented compatibility blocker.
5. Verify awaiting header output before the later blocker settles and finalize
   the borrowed producer's invocation iterator. Run maintained workspace test
   and lint. Root rebuilds the dependency closure before shell integration QA.
6. Execute actual safe-bash csvcut with a quoted string header then unquoted
   numeric data in mode 2. Inspect both unstyled partial CSV stdout and redirected
   unsupported stderr in root-owned terminal captures using view_image. Purge
   owned scratch evidence after retaining honest findings in docs/csvkit.
