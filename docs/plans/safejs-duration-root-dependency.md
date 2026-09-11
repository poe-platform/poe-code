# DurationFormat root publication dependency

Release 34242549797 and schema run 34242549266 for e520de3f8 both failed the
root bundle publication policy with
`@formatjs/intl-durationformat: undeclared-dependency`. This is a verified
integration defect introduced by the DurationFormat dependency, not the camera
timeout. All 70 declared workspace builds completed before the root bundle
policy rejected the output.

The root bundle leaves workspace third-party dependencies external and requires
them in the published root manifest. The other FormatJS runtime dependencies
already appear there. Add the same pinned DurationFormat dependency to root
package.json and synchronize the lockfile. Preserve the policy and workflow
checks; no workflow test or exception is needed for this configuration fix.

Run the maintained root build, relevant bundle tests and package lint before
committing this fix independently of the uncommitted weak-collection work.

Verification: maintained npm run build completes all 70 declared workspace
builds and the root schema/type/bundle stages, including the previously failing
publication policy. All 39 focused bundle tests and all 17 package-lint rules
pass. The manifest and lockfile each gain exactly one dependency line; no
transitive versions or publication checks are changed. Scoped release
34242549371 also failed on the same missing declaration, so this repair is
required for both scoped and root publication. The weak-storage foundation
was present during local checks but is not part of this configuration commit.
