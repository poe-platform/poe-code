# Issue 695: bounded prefix-name expansion

## Validated problem and scope

The current parser rejects `${!prefix*}` and `${!prefix@}` before runtime
expansion. The initial maintained test run recorded 12 failing positive cases
and five passing controls for unsupported indirect forms in
`/tmp/poe-695-parser-red.log`. The root's built public-package reproduction also
failed with `Unsupported parameter expansion`.

Support nonempty shell-identifier prefixes only. `${!var}`, `${!*}`, `${!@}`,
indirect array selectors and combined indirect operators remain unsupported.
No process, job-control or other shell-syntax capability is added.

## Semantics

- Enumerate initialized variable names in the current dynamic scope, including
  initialized enclosing bindings shadowed by an unset local. Deduplicate names
  and sort them lexically. Function names, bare uninitialized declarations and
  environment entries that are not shell identifiers are excluded.
- Quoted `@` yields separate fields; quoted `*` joins with the first IFS
  character, using a space when IFS is unset and no separator when it is empty.
  Unquoted expansion retains normal IFS splitting; with empty IFS, `@` retains
  separate names while `*` concatenates them.
- Zero matching names yield zero fields for quoted `@` and one empty field for
  quoted `*`. In a shared double-quoted group, an empty `@` also suppresses empty
  contributions from adjacent parameters. Separate or explicit empty quotes
  retain their independent field presence.
- Assignment and here-string contexts join with IFS. Here-documents join both
  forms with spaces; conditional `@` joins with spaces, while conditional `*`
  uses IFS. Command substitutions receive their own expansion context.
- Assigned empty arrays are initialized names. Bare local array declarations
  are not. A small `IndexedBinding.assigned` marker is set on successful explicit
  assignment, copied with bindings, retained when elements are unset and removed
  by whole-binding deletion. Empty append initializes a previously bare array.
  Local restoration and failed staged assignments retain the existing ownership
  and publication paths.

These rules were qualified against GNU Bash 5.2.37 on Darwin. Oracle records are
`/tmp/poe-695-prefix-oracle.json` and
`/tmp/poe-695-prefix-context-oracle.json`; native Bash is not a product dependency.

## Bounds and implementation

The parser adds a marker to the existing variable word part. Quote-group metadata
is admitted by the parse budget and copied with existing word metadata. Runtime
enumeration charges all visited names, including nonmatching/invalid ones, then
admits matching name bytes and field counts before retaining them. Identifier
validation and shared in-place lexical sorting are charged and cooperative.
The new enumeration uses the existing expansion byte/field budget and original
cancellation signal, without introducing another configuration surface.

Array initialization state remains inside the existing binding ownership model.
Name enumeration holds its scratch allocation through generator consumption and
releases it in `finally`. Existing source, parse, command, loop, output and
filesystem constraints remain in force.

## Validation and delivery

Independent review found mixed empty quote-group behavior; its failing tests are
preserved in `/tmp/poe-695-mixed-red.log`. A public environment probe found invalid
identifier names leaking into the list; the focused RED is
`/tmp/poe-695-invalid-name-red.log`. Both were corrected without changing
environment ingestion or unrelated indirect expansion.

The final maintained exact-file cohort passes **295/295** in 1.06 seconds and
covers prefix names, globstar, indexed
array syntax/foundation/regressions, byte values, parameter operators and brace
expansion. Evidence is `/tmp/poe-695-final-green.log`. Strict NodeNext source/test
checking passes in `/tmp/poe-695-final-types.log`; exact integration admission
passes 100/100 in `/tmp/poe-695-admission.log`.

The root coordinator owns the final normal build, installed public-package
Node/Bun/browser/workerd qualification, guarded lint, atomic commit and remote
release monitoring. Focused local passes do not establish those delivery stages.

## Final integration qualification

The final normal `npm run build` passed after the identifier correction,
including 71 declared workspaces, 70 build tasks and the root generation,
TypeScript and bundle stages (`/tmp/poe-695-final-build.log`). The earlier build
in `/tmp/poe-695-build.log` predates that correction and is not final evidence.

Installed candidate consumers passed 20 checks each in Node, Bun, the browser
bundle and actual workerd. These include GNU-qualified behavior, invalid
environment-name exclusion, two expansion limits and false/object cancellation
with no command dispatch and subsequent invocation recovery. Evidence is in
`/private/tmp/poe-695-public-e8sbre2t`; the root visually inspected its
`screenshots/node-demo.mjs.png`. Independent review approved the final source.

All three strict public-consumer TypeScript profiles passed; browser/workerd
graphs contained 44/43 inputs respectively. Final `npm run lint` passed in
306.07 seconds: all 10,514 configured files were linted, with zero errors or
warnings and 25 receipts, followed by passing TypeScript and workflow checks
(`/tmp/poe-695-lint.log`). These local checks do not establish publication.
