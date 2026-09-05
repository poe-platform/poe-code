# #625: remove the inaccurate browser ERE assertion

Issue 625 is authored by `kamilio`. Current browser/core shell code executes
`[[ value =~ pattern ]]` in the invoking realm, while README.md incorrectly
says that it always returns status 2. Working matching must not be disabled to
make an obsolete statement true.

## Minimal documentation-only correction

- Delete the inaccurate assertion and its preceding semicolon/newline from
  packages/safe-bash/README.md. Retain its existing period and Node-entry advice.
  The resulting README is exactly the original bytes with one range deleted;
  no new README text is introduced.
- Describe current status, realm, admission and cancellation distinctions in
  src/contracts/browser-ere.md, not in the README.
- Leave runtime regex, public helpers, browser/regex.mjs, and the bundle resolver
  unchanged. The override currently has no discovered public importer, but its
  callback still resolves its exact private target; removing it is unnecessary
  for this documentation defect and would be a separate cleanup.

## Validation

The frozen readonly investigation is
`/home/kjopek/kamilio-validation-569-575.RoFXyZ/625-readonly.aAqIto`.
Twenty controls passed across source, the existing bundle and injected ledger
failures: match/nonmatch, invalid/unsupported profile, captures, quoted literal,
pre-abort and admitted-state cancellation, tiny direct-helper allowance, and
status-3 mapping. The injected failures are not default-limit exhaustion.
The bounded public import graph examined 39 entry roots and 258 source files
without reaching ere/transport/root.ts. These are Node22/source-graph results,
not an actual browser or Workers deployment qualification.

Original README SHA256:
`79009926de03f635164bc32baebc4a44e928baf386281335ca738d0a3630a682`.
The private candidate additionally verifies exact deletion-only correspondence.
No production code, configuration, tests, dependencies or public API changes.

Root must check current identities, commit only these documentation paths, push
with normal hooks, and close the issue immediately after verified main delivery.
Release monitoring remains separate. Private evidence is not a completed push
or publication.
