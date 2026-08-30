# Setup admission failure before compilation/product execution

Initial setup run01 stopped at the original-author-test hash equality assertion.
It incorrectly used2272feb9 as the four-file119-test baseline. io.test.ts gained
two already documented supplemental tests in21ca7b8c; all four files are unchanged
between21ca7b8c and3ef5811f. The mismatch was2f198fdbac76352616ad7e005d3753b4139d298d76a61d283ccd3ba5c41c9277
versusd9d190a6aa0f677e73e82c5ba13d6f659d6e267db54e44b57fa40fd3f33f61c6.
The initial script/input materialization is retained in the attempt archive.
There was no build, pack, install or candidate execution in this failed attempt.
The baseline binding is corrected to the actual pre-repair119-test revision;
no original test bytes, expectations or product input changed. A misspelled old
abort case selector was also corrected before any candidate run.
