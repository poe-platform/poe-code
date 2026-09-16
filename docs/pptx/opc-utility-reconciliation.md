# OPC utility reconciliation receipt

The [row ledger](opc-utility-reconciliation.json) accounts for 178 presentation
unit rows, 169 shared-package unit rows and all nine presentation open/save and
core-property BDD scenarios. Every row retains its source identity, selected
parameter binding or pinned fixture table, named original test and explicit
observable mapping. Research identities remain outside product code and tests.
The original MIT research notices remain in `upstream-license-notice.txt` and
`test-case-map-notice.txt`; no reference assets or implementation were copied.

The three new original suites contain 76 cases: 25 URI/relationship/serializer
cases, 17 package allocation/ownership cases and 34 core-property field cases.
All file activity uses memfs or supplied byte arrays. Unit tests neither inspect
research checkouts nor download fixtures. Independent ZIP member assertions and
namespace-aware SAX assertions compare concrete expected bytes, fields and
cardinality; no dependency mock call counts are reproduced.

The exact sparse occupancy vectors are now exercised through actual slide,
image and movie insertion. All earlier occupied payloads must remain intact.
The property suite retains all eleven string field mappings, three date getters,
three date setters, the -05:30 timezone offset, absent/invalid revisions and the
42 revision setter. Descriptive strings are original; numeric/date boundaries
are retained. Typed property access is synchronous, file admission/save async,
and caller Date values replace naive host-local datetimes.

The following intentional differences are explicitly supported by evidence:

- Part and relationship names use the lowest free positive suffix. Sparse
  presentation source vectors use a different backwards search; uniqueness and
  owner locality are preserved. Shared-package vectors agree with lowest-free
  allocation. Placeholder extensions are replaced by admitted GIF/MP4 formats.
- Identical movie bytes with the same MIME type reuse one resource; unequal
  bytes allocate another. Picture insertion owns a fresh media part even when
  the bytes agree, preventing unrequested sharing between independently editable
  pictures. Both equal/unequal branches have exact member/byte assertions.
- XML serialization retains supplied whitespace, unused namespace declarations
  and declaration bytes. It does not compact unknown XML or pretty-print it.
  Multibyte UTF-8 text is checked independently by byte length and full equality.
- Model save canonicalizes ZIP member ordering. A deliberately reverse-ordered
  original archive changes ZIP bytes on a no-op save while every decoded part
  remains exactly equal. This is a current deviation from the specification's
  SHOULD preference for returning original archive bytes, not a part-loss bug.
- Empty relationship streams are supported; an empty content-type stream fails
  package metadata validation. Validated JS strings replace URI string subclasses,
  and external targetPart is explicit null rather than an exception or a fetched
  resource. Missing internal bindings fail before graph traversal can succeed.
- Native file/directory discovery maps to explicit VFS byte capabilities and
  hashed extract/pack manifests. J09 owner-aware part views replace arbitrary
  package-loader callbacks and dependency class factories. Unsupported private
  callback mechanics do not create new public APIs; documented returned views
  remain subject to their own complete API register.

The package binding of `image/jpg` is preserved. Actual JPEG image-value access for
that BDD scenario is verified by `image-mime-alias.test.ts` — “accesses an imported
JPEG picture with a legacy MIME alias while preserving its package”: canonical
image/jpeg, jpg extension, 42 × 24 header dimensions, original bytes and saved
member equality. This is bounded image-value access, not pixel decoding.

Read-only part-name security mapping includes a runtime Reflect.set rejection,
unchanged live package names and exact saved-byte equality. It is not a claim
that an unrestricted part rename or loader-registration API exists. Existing public PartView tests
prove stable owner identity, immutable graph metadata, bounded blob reads/writes,
transaction rejection and save/reload behavior.

Validation: the original 10-suite utility check passed 349 cases before the final
new allocation/property additions; each additional new suite passed its focused
run. The parent task runs final maintained package/adapter checks and records
commits. No pipeline, push, release, README change or host-product I/O occurred.

The ledger also reconciles all **16 direct CoreProperties API inventory records**:
the returned type and its fifteen properties. The historical
[properties API mapping](properties-tags-api-map.json),
[language mappings](api-language-mappings.md) and
[metadata CLI evidence](properties-tags-evidence.md) supply the broader contract.
Their earlier statement that whole `Presentation` integration was unsupported is
now stale: `Presentation().core_properties` is covered by the current model and
property save/reload tests. The old documented module path is D01 documentation
drift, not an extra public constructor promise.

| Public members                                                                                                                              | JS value and absent default | Validation and side effects                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `CoreProperties`                                                                                                                            | Owned returned interface    | Missing part created on model getter; original neutral metadata; synchronous getter, async factory/save         |
| `author`, `category`, `comments`, `content_status`, `identifier`, `keywords`, `language`, `last_modified_by`, `subject`, `title`, `version` | `string`, `""`              | At most 255 Unicode code points; wrong types/coercion rejected with `invalid-value`                             |
| `created`, `modified`, `last_printed`                                                                                                       | `Date \| null`, `null`      | Valid supplied Date only; UTC whole-second serialization; copied Date reads; malformed imported date reads null |
| `revision`                                                                                                                                  | `number`, `0`               | Nonnegative safe integer; invalid imported lexical value reads zero; save does not increment                    |

Duplicate imported fields fail `ambiguous-selection`; cancellation, limits and
stale-publication errors remain applicable to owner operations. `properties
list/get/set/remove --name <neutral field>` uses the common SDK engine, with
explicit UTC strings for CLI dates and declared scalar types. CLI queries do not
create a missing part. Invalid writes preserve the previous model bytes. These
exact defaults, errors and boundaries are covered by `properties.test.ts`, the
new `package-properties-variants.test.ts`, and the existing maintained metadata
command/adapter tests linked in the metadata evidence.
