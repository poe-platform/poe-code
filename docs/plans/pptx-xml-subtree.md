# Bounded XML subtree views

Extend the existing immutable XML domain primitive with subtree(element), used by
live owner-bound text models. Preserve original namespaces and resource ceilings;
reject nodes from other parsed documents. Do not add host I/O or new limits.

## Agent QA

1. Write an original empty child XML example with explicit parser ceilings.
2. Observe failure before subtree exists, then verify child edits can grow within
   the admitted ceiling and fail beyond it. Reject a foreign child handle.
3. Run xml-subtree.test.ts, existing XML tests and maintained PPTX lint/unit checks.
4. Stage only xml.ts, xml-subtree.test.ts and this plan; commit locally, no push.

The original test failed before implementation and passed afterward. Text model
bindings reuse this primitive; the outer owner's splice validates publication.
