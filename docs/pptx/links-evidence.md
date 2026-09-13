# Links implementation evidence

This is a bounded F47 receipt, not a whole SDK/API parity certificate.

The [case ledger](links-case-map.json) retains 64 relevant unit variants and 80
expanded BDD examples individually. The [API ledger](links-api-map.json) retains
50 members, including inherited action properties, enum aliases and metadata,
and the documented underscore-prefixed text hyperlink interfaces. Reference
identities remain in these research receipts only. Original tests use authored
XML and memfs; no corpus bytes or source fixtures are product/unit assets.
Existing standalone notices remain in `upstream-license-notice.txt`,
`test-case-map-notice.txt` and the package legal notices.

## Format and language decisions

The [action attribute reference](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oe376/7ff3db24-b7b9-4ffe-aa78-3ec47cab2489)
distinguishes hyperlink, slide, custom-show, launch and other action spellings.
Relationship IDs are resolved in the owning part, never globally. An external
relative URL stays an external reference; an internal named-slide target uses a
slide relationship plus the slide-jump action attribute. Targetless navigation
does not create a fabricated relationship target.

Ordinary links and first/last/next/previous/end-show/last-viewed navigation remain
inert. Last-viewed and end-show have no concrete `target_slide`. Custom shows
retain exact id/return data and are not silently rebound during graph import.
Launch, macro, OLE and other unsupported actions are read-only data until explicit
sanitization. This intentionally differs from source assignments that clear
active actions as a side effect of assigning a URL or null.

Direct model properties remain synchronous through an owner capability; the
package admission/save boundary is asynchronous. `null` means absence; empty
address means remove. One-based operation target positions map to same-owner
live slide objects in model properties. Cross-owner identities fail. Inherited
`part` is a validated XML capability, never implicit host access. Underscore names
are not a reason to exclude returned public interfaces.

## Original evidence

`links-actions.test.ts` covers 24 XML/package cases: six targetless navigation
spellings, seven unsupported action spellings, custom-show attributes, two exact
external/relative URL targets and a table-cell hover link. Read inputs remain
byte-identical. `links-model.test.ts` covers action metadata, stable hyperlink
views, nullable/empty address removal, slide ownership/navigation boundaries,
unsafe assignment rejection and the complete 16-entry action classification
matrix with original wording.

Initial red checks failed because the new modules were absent. The empty-link
versus absent-link classification received an additional failing assertion before
its fix. Session integration passes synchronous assignment, serialization, run/table ownership, group access and foreign namespace/duplicate identity regressions. Final maintained package checks and manifest QA are recorded by the root integration owner.

## Remaining obligations

LinkShape.click_action and LinkRun.hyperlink provide session-backed access across
shape/picture/connector/graphic-frame and table text, including group rejection.
They do not automatically wire every older isolated shape/placeholder/text class. The ledgers preserve these
obligations rather than hiding them as private or counting detached records as
live model implementation. Model construction remains owner-bound; arbitrary
raw-XML package construction is not a promised public constructor.

The run-property hover element is `a:hlinkMouseOver`; shape nonvisual properties
use `a:hlinkHover`. The original table fixture was corrected against the schema,
then failed inspection with zero links before the domain fix. Its live hover
assignment is checked with an independent XML parser to verify the element name,
not merely a read/write round trip.

Model `Hyperlink.address` also exposes a named slide relationship's literal
`targetReference` (for example `slide3.xml`) while operation `url` stays null for
slide navigation. A real session assertion failed with null before this mapping
was fixed. No relationship target is fetched or normalized by that accessor.
The DrawingML [run hover element](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.hyperlinkonmouseover)
is independently distinct from shape hover markup.
