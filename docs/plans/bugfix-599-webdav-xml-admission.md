# Issue #599: independent WebDAV XML admission

## Validated issue

Baseline: `25b940bd7293e3725cbb25f6ae3f776c0147feb4`, September 4, 2026.

Public WebDavFileSystem fixtures reproduced three failures: 100,001 elements
and 10,001 attributes were accepted because the adapter replaced the parser's
independent defaults with the XML byte limit; with constructor `maxEntries: 1`,
the parser reached malformed descendants in a second direct DAV response.
Exact-limit node and attribute controls passed. Clean RED: 3 failed / 2 passed
(`/tmp/poe-599-red.log`). These are bounded, memory-only fixtures, not evidence
for the issue's reported RSS, amplification ratio, OOM, or wall-clock figures.

## Implementation decisions

- Restore the parser's independent defaults: 100,000 elements, 10,000 attributes
  and depth 64. Increasing `maxXmlBytes` does not increase these counts.
- Preserve the existing XML byte cap, encoding handling, per-element attribute
  limit and namespace-scope limit. No new public configuration is introduced.
- Pass constructor `maxEntries` into multistatus parsing. Count only direct
  expanded-name `{DAV:}response` children of `{DAV:}multistatus`, including its
  self response. Do not count foreign names, nested responses, or other roots.
- Refuse an excess identified response before constructing/attaching its element
  or parsing descendants. Namespace/name/attribute validation can precede this
  decision. Node admission also precedes element construction.
- Translate the internal response-limit error to the existing `EFBIG` profile
  with the existing method/path. Other parser failures retain their `EIO`
  mapping. Preserve caller cancellation and earlier malformed XML errors.
- The per-call `ReadDirectoryOptions.maxEntries` listing limit is distinct from
  this constructor-level response cap. It is not converted into an XML budget.
- Body buffering, decoding, normalization and character validation still occur
  before tree parsing. This is not streaming XML, a total-memory/RSS bound,
  hostile-host isolation, a CPU deadline, or arbitrary-work preemption.

The changed production files are confined to SafeFS's WebDAV adapter and parser.
No README, public export, package configuration, Bash implementation, or user
staged file is changed.

## Verification ledger

- Initial corrected implementation plus existing XML tests: 51 passed / 1 failed
  (`/tmp/poe-599-green-initial.log`). The remaining failure was an over-specific
  new test expecting path `/`: the existing complete-response overflow uses
  path `""`. The test was corrected and an explicit legacy-profile control added;
  production error metadata was not broadened or changed to satisfy the test.
- Expanded WebDAV cohort: 311 passed across six files
  (`/tmp/poe-599-webdav.log`). Includes exact count boundaries, early refusal,
  namespace identity, malformed-prefix priority, UTF-16, byte admission, falsey
  cancellation, invalid internal limits, and existing protocol behavior.
- All SafeFS tests: 1,141 passed across 50 files initially and after the final
  type correction (`/tmp/poe-599-safe-fs.log`, `...-safe-fs-final.log`).
- Initial root build failed on exact optional-property typing: explicit undefined
  was passed to an optional-only property. The call now omits the limits object
  when no response limit is requested. The initial in-flight lint was stopped;
  `/tmp/poe-599-build.log` is failed and `/tmp/poe-599-lint.log` is incomplete.
- Maintained SafeFS source typecheck and focused new-test TypeScript check passed.
- Normal root build passed (`/tmp/poe-599-build-final.log`), including the declared
  workspace build graph and root bundle stages. No-declared-build is not a pass.
- Rebuilt Bash/WebDAV and directory-admission cohort: 140 passed
  (`/tmp/poe-599-bash-webdav.log`).
- Maintained current consumers passed: historical build-first consumer, three
  source groups, 25 current public groups, and three expected negative controls
  (`/tmp/poe-599-consumers.log`, `/tmp/poe-599-consumers-report/report.json`).
- Runtime smoke through rebuilt `@poe-code/safe-fs/fs/webdav` and `poe-code/safe-fs`
  imports passed both node and early-response refusals.
- Guarded lint attempt `/tmp/poe-599-lint-final.log` exited 2, incomplete, after
  observing Toolcraft directory size drift (480 to 512). It reported zero lint
  findings, but is not a pass. The build was running concurrently; rerun after
  all build activity finishes without changing guard policy.
- Stable rerun `npm run lint` passed (`/tmp/poe-599-lint-stable.log`): all 9,672
  admitted files checked, zero errors/warnings, 25 receipts, then successful root
  type and workflow lint. `git diff --check` also passed.
- Full repository units and screenshots are not claimed: the change is confined
  to nonvisual WebDAV parsing, with the adapter and downstream checks above.

Frozen SHA-256:

```text
fa12cba93a8ce44e1ac45efc1cfd124ead50d68445a9cad40ea234a52a4e855b  src/fs/webdav/xml.ts
962859d835253546cd7da7f7d64dae1acf914d41c6440598b0072cbd32707c80  src/fs/webdav/webdav.ts
2bdf22318282c9eb1dfacb9863886706de9b8f2aadab00dcfb086f0e40ad4539  tests/webdav-xml-admission.test.ts
```

## Delivery

Local validation is complete; exact-path commit is next. Verify remote-main delivery before
closing #599, then monitor actual publication while progressing to the next
validated issue. Local commits, pushes and releases remain separate milestones.
