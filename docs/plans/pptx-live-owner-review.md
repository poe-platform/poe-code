# PPTX live-owner review and agent QA

Scope: independently review presentation element/part and returned XML/package
views against the shared office contracts. Ownership for this review is limited
to this plan and `docs/pptx/live-owner-surface-map.md`; the implementing owner
controls product files, tests and commits. No README changes, reference runtime,
network, host fixtures or disposable publisher files are needed.

Completed: read root instructions, format/shared specs, both pinned audits and
inventories, exact target view rows, and existing Presentation/loadShared source.
Recorded source IDs, the 17 returned-view target IDs, language/security boundaries,
private-helper distinctions and concrete owner integration constraints in the
[evidence](../pptx/live-owner-surface-map.md). This is a source review, not a test
execution receipt or whole-public-surface claim.

Agent QA procedure for the implementation owner:

1. Reproduce absent members or incorrect observable behavior with fast original
   tests before implementation. Use an original minimal in-memory deck and memfs
   only when a filesystem adapter is involved.
2. Exercise every advertised view getter, setter and structural operation through
   Presentation. Verify nested view writes and existing canvas/property writes
   share state, survive save/reopen, and retain unrelated XML/package bytes.
3. Check qualified attributes, mixed text, child ordering, same-owner edits,
   foreign/stale handles, detached replacement and index errors. Do not treat a
   prototype mutation or raw XML assignment as an authorized edit route.
4. Check package membership and relationship reads after staged mutation; reject
   invalid XML, dangling relationships, content-type mismatch and limits before
   a supplied publication callback is invoked. Check cancellation and a concurrent
   mutation during serialization; preexisting memfs output must remain unchanged.
5. Verify actual SDK-backed command schemas/routes and reported support levels.
   Direct common commands retain plural resources and shared selectors, JSON and
   exit statuses. If CLI visuals change, inspect the maintained screenshot output;
   do not add screenshot unit tests.
6. Run the narrow maintained package lint/test/build checks appropriate to edited
   files, and document executed results separately from proposed test obligations.
   Commit only owned files plus relevant plan/evidence after checks. No push or
   release is authorized by this task.
