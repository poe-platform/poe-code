# pptx application entry campaign

Status: Blocked at application access. Documentation and bookkeeping completed;
application acceptance and product regressions are not run.

## Scope and authority

Execute only the entry and application portions of [the Markdown QA procedure](pptx-qa.md),
under root AGENTS.md and the shared [CLI](../specs/office-cli.md),
[SDK](../specs/office-sdk.md) and [format](../specs/pptx.md) contracts.
No scoped AGENTS.md applies beneath docs. No product code, README, downloads,
native product dependencies, pipeline execution, push or release is authorized here.

Entry revision: `566b942ad1318584e62707acb67e70c62fadccdc`, branch `main`.
The workspace already contained unrelated modified and untracked files, including
product changes and research inputs. None belongs to this campaign. Evidence
hashes identify the actual working inputs rather than claiming a clean revision.
Owned files are this plan, the custom-show/entry addition to `pptx-qa.md`, and
`docs/pptx/application-entry-evidence-20260913.json`.

## Executed entry checks

1. Read the test/API audits, inventories, target registers and J01–J10 mappings.
   Join every unit and BDD inventory pointer to exactly one ledger row and compare
   kind, source file, line and full expanded identity. Join each API identity to
   one target row, and every target row to its acceptance obligation by pointer
   and identity. All joins passed. This is bookkeeping, not semantic equivalence.
2. Resolve all 14 fixture paths from the manifest. Read and compare exact bytes
   and SHA-256 and check Git ignore status. All matched and are ignored. Rights
   remain local disposable QA only; no blanket redistribution right is inferred.
   No copy, render, extraction, application save or download was created.
3. Identify `/Applications/Keynote.app`, version 14.4 from its Info.plist, on
   macOS 26.4.1 (25E253). PowerPoint and LibreOffice were not present in the
   inspected `/Applications` listing; this is not an exhaustive host search.
4. Attempt `cua.getApp("Keynote")`. Computer Use returned exactly:
   `Computer Use was not approved to use Keynote`.
   No application session, document open or screenshot was obtained. Do not
   bypass that access boundary with another automation mechanism. No installation
   or codec change was attempted. Application support and codecs remain unknown.

The [machine-readable receipt](../pptx/application-entry-evidence-20260913.json)
records input hashes, exact counts, fixture hashes and the access result.

## Application result matrix

| Check                               | Result  | Evidence boundary                                                               |
| ----------------------------------- | ------- | ------------------------------------------------------------------------------- |
| Repair prompts and import warnings  | Not run | No document opened; absence of observed warnings is not a clean open            |
| Slide order and hidden slides       | Not run | No application navigator or slideshow inspected                                 |
| Speaker notes and association       | Not run | No notes view inspected                                                         |
| Custom shows and ordered membership | Not run | Availability of custom-show UI/playback unassessed                              |
| Hyperlinks                          | Not run | No target metadata or internal navigation inspected; no external link activated |
| Transitions                         | Not run | No paired timed playback                                                        |
| Animations and triggers             | Not run | No click/automatic sequence observed                                            |
| Audio                               | Not run | Codec, output and audible playback unassessed                                   |
| Video and poster                    | Not run | Codec, frames and start/stop behavior unassessed                                |
| Captions and tracks                 | Not run | Presence, application support and display unassessed                            |
| Render comparison                   | Not run | No current renders or screenshots                                               |
| Schema/structural preservation      | Not run | File integrity alone does not prove either track                                |

## Accounting and drift disposition

All 2,700 unit variants and 973 expanded BDD examples retain separate TypeScript
adaptation rows. Central statuses remain 2,585 semantic reviews required, 43
historically recorded TypeScript passes, 167 specified designs, 877 provisional
designs and one deferred public behavior. The additional 391 shared-package
obligations remain separate. No test ran in this campaign, and no unresolved
variant receives a success or architecture-only exemption.

All 2,409 API inventory records map into 2,426 target rows and acceptance
obligations. The 1,072 obligations without candidate upstream cases remain
required. Inherited members, underscore-prefixed public interfaces, helpers,
enums, collections and untested APIs are retained. These joins do not establish
correct signatures or complete original tests for every member.

The historical test audit says adaptation has not started; the central ledger
and later bounded receipts describe subsequent work. Interpret that audit as
its pinned historical checkpoint, not current package status. Do not overwrite
historical labels with a package-wide claim or silently count proposed designs
as executed cases. Existing standalone legal notices are retained unchanged;
this campaign adds no copied source assertions or assets.

Exact language/security mappings remain in
[api-language-mappings.md](../pptx/api-language-mappings.md): neutral model
spelling and trailing keyword options (J01), live ownership/creating getters
(J02), checked positional versus sparse keyed collections (J03), immutable
enum aliases/XML values (J04), safe EMU rounding/null/UTC values (J05), always-async
byte admission/save (J06), supplied metrics/time and inert links (J07), typed
neutral errors (J08), bounded owner-aware views (J09), and destructive setters
versus literal replacement with closed typed commands (J10). This campaign
changes none of those mappings. CLI paths remain plural resources, `text replace`,
common selectors/flags, versioned JSON, ordinary exits 0/1/2/3/4/130 and diff
exits 0/1/2/130, with explicit schema/capabilities. No new command support is claimed.

One procedure omission is corrected: custom-show order and playback now have
explicit checks separate from the ordinary slide order. No product defect was
observed, so inventing a failing TypeScript regression would misrepresent evidence.

## Resume and regression obligations

After application access is available, select immutable manifest inputs with
the relevant features and recheck hashes before allocating ignored owned copies.
Record original and edited package hashes and exact operation/selector/context.
Execute the matrix above against each baseline and output independently, using
the existing QA procedure. Do not assume Keynote supports a feature until observed.
Unsupported application features require explicit limited evidence and a capable
application for acceptance; missing codecs remain unrun.

For a custom-show finding, the proposed original TypeScript reduction is an
in-memory three-slide deck with stable identities A/B/C and explicit show order
C/A. Moving ordinary slide B first must yield ordinary B/A/C while the custom
show remains C/A, with notes and inert internal links attached to their original
owners. Include repeated show members and a separate deletion-policy case when
causal. This is a proposed acceptance design, not a reproduced defect or new test.
For all meaningful findings, follow the existing reduction/red/green gate before
closing a regression. No fixture becomes a shipped asset or download dependency.

## Validation and delivery

Identity/pointer checks and all 14 fixture byte/hash/ignore checks passed.
The maintained Prettier check scoped to the three owned documentation files
and `git diff --check` passed after formatting the new plan. No code tests are necessary for these
documentation-only changes. Preserve unrelated work and stage exactly the three
owned files. Record the local commit separately; do not push or release.
