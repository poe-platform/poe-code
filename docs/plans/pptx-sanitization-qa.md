# Selected sanitization integration and QA

## Scope and ownership

Implement F56 selected notes, comments, properties, external links and embedded
objects through the package SDK and existing virtual command adapter. Domain,
command/tests and research accounting are delegated with separate file ownership.
Root owns public export/discovery integration, QA and selective local commits.
Preserve unrelated working-tree edits, including image/media changes. Do not push,
release, run the whole pipeline, edit READMEs or stage disposable corpus assets.

## Acceptance procedure

1. Reproduce absent selected-family support with original in-memory unit tests.
2. Verify independent XML and graph expectations for selected-only changes,
   shared resources, modern comments, actions, signatures and retained formatting.
3. Verify the SDK and actual Shell routes, JSON schemas, failure status,
   dry-run, allow-empty and absence of publication on failure.
4. Run maintained pptx workspace tests/lint/build and focused safe-bash checks.
5. For disposable QA, verify corpus manifest hashes before reading cached bytes.
   Use the small notes template, the external-link deck and an embedding/chart
   deck. Operate on supplied bytes/injected memory filesystems. Compare retained
   slide/master/theme/media/chart bytes independently and reopen package output.
   Retain cached inputs; do not download or ship QA bytes. Reduce meaningful
   findings into small original regressions before declaring them fixed.
6. Capture and inspect actual command terminal output using the maintained
   screenshot tool. This checks terminal presentation, not slide rendering.
7. Review exact owned diffs and stage only those edits plus related plans and
   evidence. Make atomic Conventional Commits on main, without push or release.

## Evidence

Pending implementation and verification. Whole public model coverage and broad
clean-file claims are not established by this bounded feature.
