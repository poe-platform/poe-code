# Custom XML, glossary and ancillary resources

Task65 has passed original TypeScript implementation checks. This usage draft
follows the sole [format contract](../specs/docx.md) and
[ordered procedure](../plans/docx-custom-xml-glossary.md); it does not claim
installed availability, product completion or whole-model/corpus parity.

```bash
docx custom-xml list form.docx --json
docx glossary list form.docx --json
docx xml get form.docx --part /customXml/item.xml --raw
docx controls bind form.docx --all --binding name --value-json '"Harbor"' --output synchronized.docx
```

The two inventories are package-global, with json/limit options only. They report
canonical internal root parts, readonly metadata, current part locations and OPC
references. Custom XML exposes declared store properties, namespace bindings and
inert schema URIs. Glossary exposes building-block metadata and element paths.
Associated internal ancillary parts include unknown types; cycles are visited
once and external targets remain inert metadata. Unedited member/relationship
payloads must remain byte-identical and no resource is deleted by body reachability.

Binding is the admitted typed synchronization route. A same-target unsupported
glossary recipient rejects instead of permitting a stale cache or semantic import.
Raw XML changes to bound stores/properties or Word parts with binding declarations
reject; selected unbound custom XML payloads use bounded whole-part replacement
with root/package/protection/resource validation. This is not custom-schema
certification, glossary import, schema fetching or ancillary execution.

The public utility is inspectDocumentPackageResources(input, operation, options,
context), operation custom-xml.list/glossary.list, returning PackageResourceListData.
Input/output capabilities, cancellation and limits are explicit. No environment
variables, ambient host I/O, native runtime or implicit network are added.
Real protection/signature declaration guards remain; inert customXML using Word
or signature-shaped names is not such a package declaration. Existing unaffected
control-lock baseline admission remains separate from package protection.

Inventories have no dedicated upstream case/API assignments for F41. Original
memfs operations and tests must qualify this additive utility; generic package
API/model obligations remain separately accounted for. Corpus/reference
preparation does not provide product evidence. Original TypeScript qualification after resource source freeze passes maintained
DOCX: 93 files/2,131 tests, public SDK/engine: 11 cases and focused literal integration
registration: 108 cases. Independent domain/control: 208 cases and all11 DOCX Shell
files: 73 cases pass without skips. Guarded safe-bash typecheck includes 26 current
consumer groups; this qualifies types, not full runtime parity. Root inspected
faithful100-column terminal PNGs for inventories and actual VFS script/pipeline/
redirect/refusal workflows. Raw output and earlier overwide rasters are preserved.

The selected maintained five-workspace DOCX build now uses explicitly declared
safe-fs build:portable. Original injected supported-Linux tests verify no host/
compiler/header discovery in that mode. Default full/direct/unit native events
remain unchanged. Broader maintained uncached npm test (including root posttest) and repository
lint both pass. Safe-bash runtime records 38,141 passes and 823 skips; safe-js
records 28,932 passes and 47 skips. Skips and no-declared-test workspaces do not
qualify missing behavior. Atomic local delivery/status verification follows. Exact chronological evidence and limitations are retained
in the linked procedure and docs/plans/docx-portable-dependency-build.md.
No README edits, downloaded inputs, cache cleanup, push or release are authorized.
