# Reviewer role correction r2

Initial REVIEW.capture.data retains STOP at CONTROLS-RESULTS.json; zero modules
were imported and zero controls/children ran. The reviewer incorrectly selected
the source-commit inventory for every seal row. The frozen PRESEAL explicitly
marks three rows author-evidence. Their bytes/hashes match the independently
authenticated evidence commit; no candidate-integrity failure was observed.

Versioned repair: accept exactly source-commit or author-evidence roles; choose
that already authenticated inventory, still require matching path/size/hash and
now explicit POSIX mode. Unknown roles fail; no HEAD/default/missing-row fallback.
Original review.mjs and capture remain unchanged. A generated review-r2.mjs
records exact before/after SHA256 and four substitutions before importing its
DATA controller. Same six author/six novel groups, no new case, deadline or
child. This is the authorized ordinary captured/retired helper correction,
not a product fix or rescore of v2/N08. The existing twenty-minute grant remains.
