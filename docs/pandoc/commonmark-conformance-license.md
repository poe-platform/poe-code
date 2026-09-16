# CommonMark normative corpus provenance

`commonmark-0.31.2-examples.json` is the unmodified 652-example normative corpus
from https://spec.commonmark.org/0.31.2/spec.json, retrieved 2026-09-16.
SHA-256: `d431b29d97b6f73e69d547109cf5081578fac931e72afe95639ebe766c1b2a20`.
Author: John MacFarlane and CommonMark contributors. Specification version
0.31.2, dated 2024-01-28: https://spec.commonmark.org/0.31.2/.

The corpus is licensed **CC-BY-SA-4.0**, separately from the repository's MIT
code. Attribution and share-alike apply to this data and adaptations of it.
License: https://creativecommons.org/licenses/by-sa/4.0/; the complete legal
text accompanies it in `commonmark-CC-BY-SA-4.0.txt`. No parser or upstream
test implementation is imported. The newly authored TypeScript parser and
original unit tests remain repository code under MIT.

The separate conformance lane consumes this local corpus with no fetches or
external executables. Original workspace unit tests never import this data.
Its HTML projection examines typed AST constructors and does not parse Markdown.
Every mismatch fails the lane; there is no example exclusion or dialect waiver.
