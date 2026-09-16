# Live XML view

Implement the J09 owner-bound XML view over the existing immutable XmlPart engine.
Use original in-memory examples, first demonstrating absent public traversal and
mutation behavior. Retain qualified attribute names and leaf text, move existing
owned children without cloning, reject cycles and stale/foreign handles, and
retain the engine's byte/node/depth limits. Owner commit validates package graph
before publishing the candidate; view state changes only after successful commit.

QA: run the focused XML view tests, existing XML engine tests, and maintained
package lint/test checks. No host files, network or native runtime are needed.

Verification completed: the initial 75 focused XML cases pass; maintained pptx
lint and the selected three-workspace build closure pass. The full maintained
pptx test route passed 5,977 tests in 210 files at integration checkpoint.
The view/parser implementation is one atomic local improvement; owner/CLI
integration and its additional regression checks are committed separately.
