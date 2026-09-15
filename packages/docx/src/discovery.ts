import { styleModelBatchOperations } from "./style-model-batch-operations.js";
import { imageBatchActions } from "./image-batch-operations.js";
import { styleModelBatchResultSchema, styleModelOperationResultSchema } from "./style-model-result-schema.js";
import metadata from "../package.json" with { type: "json" };
import { escapeTerminalText } from "toolcraft-design/escape-terminal-text";
import { documentValidationProfile } from "./validation.js";
import { DocumentBudget } from "./budget.js";
import { docxInvocationBudgets, validateDocxInvocation, type DocxInvocation } from "./command.js";
import { docxCommonOptions, docxOperationSchemas, type DocxOperationSchema } from "./operation-schema.js";
import { getDocxOperationSchema, type DocxJsonSchema } from "./operation-json-schema.js";
import { discoveryFailureSchema, imageOperationContracts, inspectionOperationMetadata, propertyOperationContracts, rasterInsertionOperationContracts } from "./discovery-result-schema.js";

export interface DocxHelpData {
  readonly name: "docx";
  readonly paths: readonly { readonly path: readonly string[]; readonly usage: string; readonly description: string; readonly operationIds: readonly string[] }[];
}
export interface DocxSchemaData {
  readonly schemaVersion: 1;
  readonly validationProfiles: readonly (typeof documentValidationProfile)[];
  readonly operations: readonly { readonly id: string; readonly path: readonly string[]; readonly input: DocxJsonSchema;
    readonly result: DocxJsonSchema; readonly featureIds: readonly string[]; readonly support: "read" | "edit" | "reject" }[];
}
export interface DocxCapabilitiesData {
  readonly features: readonly { readonly id: string; readonly level: "read" | "edit" | "preserve" | "reject"; readonly subsets: readonly { readonly name: string; readonly level: "read" | "edit" | "preserve" | "reject"; readonly reason: string }[]; readonly detected: null }[];
  readonly host: { readonly read: false; readonly atomicReplace: false; readonly transactions: false; readonly binaryStdout: true };
  readonly limits: readonly { readonly name: string; readonly ceiling: number }[];
  readonly validationProfiles: readonly (typeof documentValidationProfile)[];
}
export interface DocxVersionData { readonly name: "docx"; readonly version: string; readonly schemaVersion: 1 }
export interface DocxDiscovery {
  readonly data: DocxHelpData | DocxSchemaData | DocxCapabilitiesData | DocxVersionData;
  readonly human: string;
}

function commandPath(id: string, declaration: DocxOperationSchema): string[] {
  return declaration.transport === "typed-batch" ? ["batch"] : id.split(".");
}
function usage(id: string, declaration: DocxOperationSchema): string {
  const path = commandPath(id, declaration).join(" ");
  const input = declaration.transport === "typed-batch" ? " INPUT" :
    declaration.profile === "discovery" && Object.hasOwn(declaration.fields, "operation") ? " [COMMAND PATH]" :
    declaration.inputArity === "0|1" ? " [INPUT]" : declaration.inputArity === 2 ? " LEFT RIGHT" : declaration.inputArity === 1 ? " INPUT" : "";
  return `docx ${path}${input} [OPTIONS]`;
}
function description(declaration: DocxOperationSchema): string {
  const id = Object.keys(docxOperationSchemas).find(key => docxOperationSchemas[key] === declaration)!;
  if (id === "batch") return "Execute style, font, paragraph-format and tab operations through document-owned views and await immutable Image batch values; other model operations remain unsupported.";
  if (imageBatchActions.has(id)) return "Read an immutable Image value through invocation-local batch handles without document mutation authority.";
  if (styleModelBatchOperations.includes(id)) return "Implemented style model operation with checked document-owned receivers and typed values.";
  return inspectionOperationMetadata[id]?.description ?? imageOperationContracts[id]?.description ?? rasterInsertionOperationContracts[id]?.description ?? propertyOperationContracts[id]?.description ?? declaration.discovery?.description ?? "Declared contract; document operation not implemented by this engine.";
}
function details(id: string, declaration: DocxOperationSchema): string {
  const lines = [usage(id, declaration), "", description(declaration)];
  if (id === "images.add") lines.push("",
    "Select a whole paragraph, admitted block container, or the unique body.",
    "Header/footer and note containers require an explicit owner.",
    "There is no all, run, caret or range insertion.",
    "Use explicit physical units: emu, in, cm, mm or pt. Pixels are not accepted.",
    "Omitted dimensions use native DPI independently per axis, with 72 DPI fallback.",
    "One dimension preserves native aspect ratio; two dimensions use contain/cover/stretch.",
    "Decorative defaults false; true conflicts with nonempty alt text.",
    "Known PNG/JPEG/GIF/BMP/TIFF source suffixes must match the actual bytes.",
    "Floating placement, supplied fallback and other raster insertion are unsupported.");
  if (declaration.transport === "typed-batch") {
    lines.push("", `Batch operation: ${id}`, `Receiver: ${declaration.receiver ?? "none"}`, "Arguments:");
    for (const [key, field] of Object.entries(declaration.batchFields ?? {})) lines.push(`  ${key}: ${field.type}${field.required ? " (required)" : ""}`);
  } else {
    lines.push("", "Options:");
    const fields = { ...Object.fromEntries(declaration.commonOptions.map(key => [key, docxCommonOptions[key]!])), ...declaration.fields };
    for (const [key, field] of Object.entries(fields)) {
      if (id.startsWith("tables.") && id !== "tables.add" &&
        (["paragraph", "run", "image", "link", "control", "revision", "shape", "field", "bookmark"].includes(key) ||
          id.split(".").length === 3 && (key === "cell" || key === "all"))) continue;
      if (["lists.add", "lists.set", "tables.add"].includes(id) && (["run", "image", "link", "control", "revision", "shape", "field", "bookmark"].includes(key) || ["lists.add", "tables.add"].includes(id) && key === "all")) continue;
      const flag = [...key].map(c => c >= "A" && c <= "Z" ? "-" + c.toLowerCase() : c).join("");
      lines.push(`  --${flag}${key === "output" ? ", -o" : ""}  ${field.type}${field.required ? " (required)" : ""}`);
    }
    lines.push("  --help, -h  Show help without acquiring input.");
    if (Object.hasOwn(fields, "occurrence") && Object.hasOwn(fields, "first")) lines.push("", "Choose exactly one: --first | --all | --occurrence NUMBER.");
    if (Object.hasOwn(fields, "output") && Object.hasOwn(fields, "inPlace")) lines.push("", "Publication: --output PATH | --in-place | --dry-run.");
    if (Object.hasOwn(fields, "scope")) lines.push("", id.startsWith("notes.") && id !== "notes.add" ? id === "notes.list" ? "Scope defaults to both footnotes and endnotes; --kind or --scope narrows it." : "Selection defaults to footnotes; --kind or --scope selects the note kind." : `Scope defaults to ${id.startsWith("comments.") && id !== "comments.add" ? "comments" : id.startsWith("headers.") ? "headers" : id.startsWith("footers.") ? "footers" : "body"}; positions are one-based within their owner.`);
    if (Object.hasOwn(fields, "select")) lines.push("Use either --select TOKEN or simple selectors; do not combine them.");
    if (id === "text.replace") lines.push("", "--track-changes true requires explicit --author and --timestamp; an empty author is allowed.", "Ordinary replacement rejects author/time. Deleted text retains its formatting; insertion inherits the first match with explicit bold/italic overrides.", "Tracking preserves original/final/all text. Affected existing review, field/control and compound boundaries reject.");
    if (["controls.list", "controls.set"].includes(id)) lines.push("", "Controls are indexed individually, including nested and unsupported kinds; ordinals are one-based inside the selected owner.", "Inspection returns stored IDs/tags/aliases, lock mode, placeholder/binding descriptors, typed values, declared choices and picture relationships.", "No controls get route is declared. Binding synchronization, live owners and ordered batches remain unsupported.");
    if (id === "controls.set") lines.push("", "Choose exactly one: --text STRING | --checked true/false | --choice VALUE | --date YYYY-MM-DD | --file PATH.", "Choose one control ordinal or whole token; use --all explicitly inside the scope. Text-range tokens do not select controls.", "Successful filling, including empty text, clears showingPlcHdr and preserves unrelated properties. Parent replacement erasing nested controls rejects.", "Selected controls and ancestors must be unlocked. Bound filling rejects; it does not detach dataBinding.", "Choices use declared values and render their labels. Checkbox glyph/font mappings must be declared.", "Dates use admitted numeric Gregorian formats and explicit en-US/en-GB or absent language; no host locale is consulted.", "Pictures replace one admitted existing internal DrawingML occurrence with bounded PNG; preserve geometry/crop/alt and shared old resources.", "Validate every all-selected candidate before staging. Kind mismatches and unsupported structures fail atomically.");
    if (["revisions.accept", "revisions.reject"].includes(id)) lines.push("", "Choose one: --revision NUMBER in its scoped owner, a whole --select revision token, or --all inside the selected scope.", "Text-range tokens do not select revisions. No match rejects unless --allow-empty; reruns resolve against the new input.", "Validate every selected revision before mutation. Preserve unselected changes, required owners and faithful annotation/bookmark/field ranges.", "Only admitted inline text and exposed-field run/paragraph property history are editable; unsupported nested, compound, move/table/section and opaque review rejects atomically.", "Reports retain before identities; removed review tokens are not live. Live owners and ordered batches remain unsupported.");
    if (id === "revisions.add") lines.push("", "--kind insert requires --text; empty insertion requires --allow-empty.", "Insert at a collapsed paragraph/run token or append to selected paragraph/run text. --kind delete forbids --text and requires nonempty selected text.", "Provide explicit --author and UTC --timestamp. Use --all for scoped creation; affected unsafe structures reject before mutation.", "Acceptance/rejection is a separate bounded subset; live review owners and ordered batches remain unsupported.");
    if (id === "create") lines.push("", "Content: version 1 blocks; optional page, styles and theme settings for new packages.", "Defaults: DOCX, Transitional, US Letter portrait, one-inch margins and Normal style.", "Template blocks append before final section properties; kind/dialect and existing settings are retained.", "No executable templates, field evaluation, font discovery or automatic timestamps.");
    if (id === "inspect") lines.push("", "Theme/font inventory: fontResources contains schemes, table entries, embedding bindings and reference diagnostics.", "Resolved references identify stored package slots; availability and licensing remain unknown.", "Use runs set or styles set/defaults set for typed font/theme references. Embedded font mutation is unsupported.");
    if (id === "tables.add") lines.push("", "Rows and cols are required. Default: container width, equal columns, autofit true.",
      "Append to a story or cell; a paragraph anchor inserts after it, or use --before.",
      "A collapsed paragraph token inserts at a Unicode caret and retains the suffix section.",
      "--repeat-header true repeats the first row; --header-rows selects a leading count.",
      "--content-json/--content-file supplies one typed table matching rows and cols.",
      "Formatting may be direct or in that table; duplicate sources reject. Nested blocks retain terminal paragraphs.",
      "Use tables set for cell values/formatting and tables rows/columns add/remove for explicit structural edits. Use tables merge/split for spans. Live table model operations remain pending.");
    if (["tables.get", "tables.set"].includes(id)) lines.push("", "Coordinates are 1-based: --table 1 --cell B2, or an unambiguous --select TOKEN.");
    if (id === "tables.get") lines.push("Read each physical anchor once, with logical spans, omitted slots and exact text.");
    if (id === "tables.merge") lines.push("", "Select a table and top-left --from A1 / bottom-right --to B2 corners.", "--join paragraphs preserves rich blocks in row order; --join reject accepts only empty cells.", "Partial overlaps, omitted slots and range markers reject before publication.");
    if (id === "tables.split") lines.push("", "Select a logical cell. Rows/cols must divide its existing merged grid slots exactly.", "--distribute anchor retains all blocks in the first cell; paragraphs requires exactly one paragraph per resulting cell.", "Covered coordinates identify the whole owner for this explicit operation.");
    if (id === "tables.set") lines.push("Set changes values or formatting only; growth and deletion require explicit row/column operations.",
      "Text requires a cell. Covered coordinates reject writes unless --covered owner is explicit. Fields, nested tables and opaque content reject destructive replacement.");
    if (["tables.rows.add", "tables.rows.remove", "tables.columns.add", "tables.columns.remove"].includes(id)) lines.push("",
      "Select one table using --table or --select. Indexes are 1-based.",
      "Add inserts before the given index; count+1 appends. Omitted add index appends.",
      "Remove requires an existing index and leaves at least one row and column.",
      "Insertion and column removal require an unmerged rectangular grid. Row removal through vertical spans requires --join paragraphs and preserves surviving owner content.");
    if (id.startsWith("bookmarks.")) {
      lines.push("", "Inspect paired ranges and structural issues; markers preserve unrelated fields and annotations.");
      if (id === "bookmarks.add") lines.push("Use --select TOKEN for a nonempty paragraph range with half-open Unicode scalar offsets.", "Obtain the range with document.range(paragraphToken, start, end); multi-run and table-cell paragraphs are supported.");
      if (id === "bookmarks.set") lines.push("--references update rewrites supported internal links and REF/PAGEREF fields; reject refuses referenced names.");
      if (id === "bookmarks.remove") lines.push("--references remove unwraps supported references while preserving visible results; reject refuses referenced names.");
      lines.push("Unsupported reference structures and unsafe range boundaries reject before publication.");
    }
    if (["fields", "toc", "captions"].includes(id.split(".")[0]!)) lines.push("", "Never execute field instructions or recalculate pagination. Results are stored caches.", "Add appends to a selected paragraph. TOC defaults to levels 1-3 and update true; fields default to update false.", "Captions default to a dirty SEQ field; --static true emits label/text only. Existing sequence names require explicit --sequence reuse.", "Set preserves omitted flags and existing contents. --text replaces only the selected TOC/SEQ cache; nested outer cache replacement rejects.", "Typed instruction edits require explicit target for REF/PAGEREF/SEQ. Shared stories and live field models remain unsupported.");
    if (id.startsWith("notes.")) {
      lines.push("", "Note positions are one-based; stored IDs are separate from display numbering.", "Preserve document and section numbering/restart rules; no pagination or displayed-number calculation.");
      if (id === "notes.add") lines.push("--kind is required; text defaults empty. Insert into a selected body paragraph.");
      if (id === "notes.set") lines.push("Replacing a multiply referenced body requires --shared true. Text replacement retains required note markers.");
      if (id === "notes.remove") lines.push("Use --reference N for one shared reference or --references all for every reference.", "Remove a body only when no references remain. Required separators survive.");
      if (id === "notes.add" || id === "notes.remove") lines.push("--renumber preserve is the default; document-order reallocates storage IDs and updates their references.");
    }
    if (id.startsWith("links.")) {
      lines.push("", "Never fetch links. External targets allow absolute https/http/mailto URLs.");
      if (["links.add", "links.set"].includes(id)) lines.push("Use exactly one of --target URL or --bookmark NAME (an internal anchor).", id === "links.add" ? "Append --text to a selected paragraph; existing runs stay unchanged." : "Retarget the selected link; preserve label runs and formatting.");
      if (id === "links.remove") lines.push("Unwrap the visible label by default; --delete-content explicitly deletes it.");
      lines.push("Shared header/footer edits and the live hyperlink model remain pending.");
    }
    if (id === "lists.add") lines.push("", "Append to the body or a selected cell; a paragraph anchor inserts after it.",
      "Defaults: level 0, start 1, empty text. Levels are 0-8.",
      "Without --start, a compatible anchor continues its existing list.",
      "An explicit --start creates a separate instance, including when it is 1.",
      "A different kind can extend an unused simple level into a mixed list.",
      "Existing items keep their formats; other definitions create a separate list.");
    if (id === "lists.set") lines.push("", "Select existing list paragraphs; --all stays inside the chosen scope.",
      "--restart true isolates selected items; --start requires restart true.",
      "An omitted restart start uses the level definition's starting value.");
    if (["lists.add", "lists.set"].includes(id)) lines.push("", "Picture bullets and unsupported numbering schemes remain unchanged.",
      "Edits requiring their interpretation are rejected. Model batches remain pending.");
    if (id === "xml.get") lines.push("", "Select one absolute OPC name with --part; no basename or wildcard matching.",
      "--raw is byte-exact, including BOM and encoding. Default JSON uses base64.",
      "--pretty is UTF-8 display serialization, not byte-exact XML; existing text whitespace is retained.");
    if (id === "xml.set") lines.push("", "--file supplies a complete XML document, never a fragment or expression.",
      "Root expanded name, document kind/dialect and package references must remain valid.",
      "Opaque content must retain its structural position and namespace context; protected/signed inputs reject.");
    if (id === "text.get") lines.push("", "Alias: docx text INPUT [OPTIONS]. View defaults to final.",
      "Hidden text is included; formatting is direct context, without style resolution.",
      "Field instructions and drawing/equation text are omitted.",
      "Order: body, headers, footers, footnotes, endnotes, comments, text boxes.",
      "Shared parts appear once. Notes/comments: canonical part, then numeric ID.",
      "Paragraph/row: LF; cell/tab: TAB; story: two LFs; page: FF; column: VT.",
      "Cached page breaks add nothing. No extra trailing separator is appended.");
  }
  return lines.map(escapeTerminalText).join("\n") + "\n";
}

/** Read-only discovery over the maintained grammar; never acquires document inputs. */
export function getDocxDiscovery(invocation: DocxInvocation, budget = new DocumentBudget()): DocxDiscovery | undefined {
  const parsedBudget = docxInvocationBudgets.get(invocation);
  if (parsedBudget) budget = budget.lower(Object.fromEntries(Object.entries(budget.limits)
    .map(([name, ceiling]) => [name, Math.min(ceiling, parsedBudget.limits[name as keyof typeof parsedBudget.limits])])), parsedBudget.signal);
  invocation = validateDocxInvocation(invocation, budget);
  if (!docxOperationSchemas[invocation.operation]?.discovery || invocation.inputs.length) return undefined;
  if (invocation.options.limit !== undefined) budget = budget.lower(Object.fromEntries(
    (invocation.options.limit as readonly { name: string; value: number }[]).map(item => [item.name, item.value])
  ));
  const bounded = (discovery: DocxDiscovery): DocxDiscovery => {
    const wire = invocation.options.json === true || invocation.operation === "schema" ?
      JSON.stringify({ version: 1, operation: invocation.operation, ok: true, data: discovery.data, warnings: [], errors: [], affected: 0, locations: [] }) + "\n" : discovery.human;
    const bytes = new TextEncoder().encode(wire).byteLength;
    budget.check("serializedOutput", bytes);
    budget.charge("retainedBytes", bytes);
    return discovery;
  };
  if (invocation.operation === "version") return bounded({
    data: { name: "docx", version: metadata.version, schemaVersion: 1 }, human: `docx ${escapeTerminalText(metadata.version)}\n`
  });
  if (invocation.operation === "capabilities") {
    const limits = Object.entries(budget.limits).map(([name, ceiling]) => ({ name, ceiling }));
return bounded({ data: { features: [{ id: "F32", level: "edit", subsets: [{ name: "inline-png-jpeg-insertion", level: "edit", reason: "Original bounded utility insertion of admitted PNG/JPEG bytes into one whole paragraph or admitted body/cell/explicit header/note block container. Native per-axis DPI with independent 72 fallback, explicit physical units, checked contain/cover/stretch and decorative/alt intent. Known suffixes must match bytes; retained exact media and capability publication. Five-format header metadata characterization does not imply insertion of GIF/BMP/TIFF. Replacement, floating/SVG authoring, pixel decoding, rendering and image-part, drawing and collection models remain unsupported." }, { name: "standalone-image-values", level: "read", reason: "Immutable PNG, JPEG, GIF, BMP and TIFF values with bounded headers, effective DPI, native and scaled lengths, owned bytes and compatibility SHA-1. No image-part, shape or collection authority; insertion support remains separate." }], detected: null }, { id: "F31", level: "read", subsets: [{ name: "image-inventory-extraction", level: "read", reason: "Bounded selected occurrence/resource inventory and exact original-byte VFS extraction with explicit manifest-inclusive publication intent. Unknown geometry/media stays null or opaque preserve-only; linked resources remain inert. No pixel decoding, DPI/native-size, rendering, live model or full image parity." }], detected: null }, { id: "F33", level: "read", subsets: [{ name: "stored-image-layout", level: "read", reason: "Read admitted native extents, crop, rotation, flips, wrap, z-order, separate axis positions and alt/decorative metadata. Unsupported or invalid metadata stays null with warnings; no rendering or layout edits." }], detected: null }, { id: "F34", level: "read", subsets: [{ name: "inert-image-alternatives", level: "read", reason: "Selected core-v1 carrier references and exact admitted internal alternate/fallback bytes; raw selected VML remains preserve-only. Inactive MCE evidence stays preserved; no Choice activation, unsupported decoding or external acquisition." }], detected: null }, { id: "F35", level: "read", subsets: [{ name: "shared-image-owners", level: "read", reason: "Occurrence-local geometry and exact selected-owner references remain distinct from shared byte hashes. Unique groups after selection with first selected representative and no null-hash grouping; shared media editing is unsupported." }], detected: null }, { id: "F30", level: "edit", subsets: [{ name: "typed-document-properties", level: "edit", reason: "Read and explicitly set/remove admitted core, extended and custom scalar metadata. Exact qualified or unambiguous stored names; UTC whole-second utility strings and retained custom variants/IDs. Missing-part creation is explicit and collision-safe. Cached, opaque, invalid and ambiguous metadata stays read/preserve-only; unrelated timestamps, counts and XML remain unchanged. No live CoreProperties/model, automatic clocks, recalculation or corpus conformance claim." }], detected: null }, { id: "F28", level: "edit", subsets: [{ name: "control-values", level: "edit", reason: "Bounded plain/rich scalar text, declared checkbox glyphs, stored choice values, numeric Gregorian dates and existing internal PNG picture replacement. Indexed nested/unsupported controls remain inspected. Locked or bound filling, parent replacement erasing nested controls and unsupported affected structures reject atomically. Declared binding synchronization uses the separate controls bind route. Live model owners and ordered batches remain unsupported." }], detected: null }, { id: "F29", level: "edit", subsets: [{ name: "native-repetition", level: "edit", reason: "Bounded native block and unmerged grid-row repetition from exact scalar records, including empty reusable placeholders. Remap contained IDs, bookmarks, classic comments and admitted inline PNG drawings while retaining shared media. Affected bindings, locks, review, opaque structures and crossing ownership reject. Template apply, live owners and ordered batches remain pending." }, { name: "binding-synchronization", level: "edit", reason: "Declared tag keys identify one internal custom XML singleton and all complete scoped recipients, including aliases. Root-inclusive namespace-resolved child paths and explicit string/boolean/integer/double types preserve false, zero and empty values. Unresolved same-store recipients, incomplete scope, ambiguity and locks reject before publication. No binding detachment or resource fetch." }], detected: null }, { id: "F26", level: "edit", subsets: [{ name: "revision-decisions", level: "edit", reason: "Direct acceptance/rejection of ordinary inline text wrappers and supported exposed-field run/paragraph property history. Scoped ordinal, whole revision token or explicit all; validate every selected candidate before edits, preserving unselected review and required owners. Nested/compound/move/table/section/opaque review and affected field/control/range boundaries reject. Live owners and ordered batches remain unsupported." }, { name: "tracked-text-creation", level: "edit", reason: "Explicit-author/time insertion, deletion and literal replacement on admitted scalar text ranges. Preserve original/final/all views and run properties; affected existing review and compound boundaries reject. Acceptance/rejection is a separate bounded subset; live owners and ordered batches remain unsupported." }, { name: "revision-read-views", level: "read", reason: "Final/original/all text and run/paragraph property snapshots; IDs, authors and stored timestamps. Ordinary unrelated edits preserve review markup. Tracked creation and acceptance/rejection are separately bounded editing subsets." }], detected: null }, { id: "F27", level: "read", subsets: [{ name: "complex-revision-inventory", level: "read", reason: "Move wrappers/range markers and opaque table, section and extension revisions; affected complex edits reject." }], detected: null }, { id: "F25", level: "edit", subsets: [{ name: "classic-comments", level: "edit", reason: "Explicit author/time and run-boundary body anchors; list/get/set/remove comments, preserving unrelated annotations. Rich block replacement, comment batches and live model owners remain pending." }, { name: "comment-extension-synchronization", level: "edit", reason: "Inventories extension parts and IDs; single-paragraph text edits retain thread links and resolution. Removal synchronizes verified IDs and people; surviving replies, opaque affected metadata and unverified structures reject. Thread authoring remains unsupported." }], detected: null }, { id: "F24", level: "edit", subsets: [{ name: "footnotes-endnotes", level: "edit", reason: "Read, insert, edit and remove notes and references with reserved separator preservation, scoped IDs and explicit shared-reference policies. Document and section numbering/restart rules remain intact; storage renumbering does not calculate pagination or displayed numbers. Live document model remains pending." }], detected: null }, { id: "F23", level: "edit", subsets: [{ name: "toc-caption-structures", level: "edit", reason: "Bounded TOC levels, inert caption sequences and static labels. Explicit cached text and dirty flags; no layout or sequence evaluation. Existing sequence collisions require explicit reuse." }], detected: null }, { id: "F22", level: "edit", subsets: [{ name: "cached-fields", level: "edit", reason: "List simple, complex and nested fields; edit supported plain cached results without execution. Preserve instructions, formatting and omitted flags. Create bounded fields and edit typed instructions. Nested-result replacement, shared-story editing and live model remain pending." }], detected: null }, { id: "F21", level: "edit", subsets: [{ name: "bookmark-ranges", level: "edit", reason: "List, create, rename and remove checked ranges; explicit reference policy for internal links and REF/PAGEREF fields. Multi-run paragraph and table-cell boundaries; stale, missing, duplicate and crossing structures checked. Complex reference removal, shared-story edits and general field/model APIs remain unsupported." }, { name: "hyperlinks", level: "edit", reason: "Create, list, retarget and unwrap direct paragraph hyperlinks; explicit label deletion. Inert HTTP/HTTPS/mailto and internal anchors, owner-scoped relationship cleanup. Shared story edits and live hyperlink model remain pending." }], detected: null }, { id: "F20", level: "edit", subsets: [{ name: "logical-grid", level: "edit", reason: "Inspect logical owners and spans. Explicit rectangular merges join blocks in row order; split restores existing grid slots with anchor or paragraph distribution. Covered writes require owner intent. Row deletion preserves surviving spans. Omitted/wrapped grids, legacy merges and span insertion/column removal remain unsupported." }], detected: null }, { id: "F19", level: "edit", subsets: [{ name: "table-construction", level: "edit", reason: "Bounded rectangular grids, nested typed blocks, repeated leading headers, borders/shading, margins and row height/splitting. Selected cell values and table/row/cell formatting, explicit rectangular row/column insertion and deletion. Merged grids support explicit merge/split and row removal; omitted grids remain readable. Span insertion, column removal and live table owners remain pending." }], detected: null }, { id: "F18", level: "edit", subsets: [{ name: "multilevel-numbering", level: "edit", reason: "Bounded list add/set, levels 0-8, scoped IDs and start/restart overrides; resolve paragraph and numbering style links. Preserve mixed levels and unrelated opaque schemes/picture resources. Advanced level-definition setters and live numbering model remain pending." }], detected: null }, { id: "F17", level: "edit", subsets: [{ name: "header-footer-stories", level: "edit", reason: "Noncreating reads of every variant; explicit shared edits, local clone/rebind and removal. Preserve cached fields and outgoing resources; scoped paragraph/text operations reuse story ownership. Whole-story text rejects fields, tables and opaque blocks. Live document model and general image/table editing remain pending." }], detected: null }, { id: "F16", level: "edit", subsets: [{ name: "section-page-settings", level: "edit", reason: "Edit owner-local geometry, columns, section starts, page-number and first-page metadata; append sections and inventory inherited header/footer bindings. Even/odd policy is document-wide and requires explicit all-section scope. No pagination claim." }], detected: null }, { id: "F41", level: "preserve", subsets: [{ name: "package-resource-inventories", level: "read", reason: "Package-global customXML and glossary metadata, whole-part locations, ancillary closure and inert external references. Missing or ambiguous metadata remains preserved with bounded warnings; no content dump, import, schema fetch or semantic editing." }, { name: "opaque-package-retention", level: "preserve", reason: "Retain unedited ancillary payloads and relationship XML across admitted mutations. Bound raw replacements and unsupported same-store recipients reject rather than detach or partially synchronize." }], detected: null }, { id: "F42", level: "read", subsets: [{ name: "theme-and-font-resources", level: "read", reason: "Inspect theme colors, major/minor/script fonts, font tables, embedding metadata and reference diagnostics. Preserve embedded bytes and language metadata; embedded font mutation is unsupported. No installation, availability, licensing or rasterization inference." }], detected: null }, { id: "F15", level: "edit", subsets: [{ name: "title-and-heading-creation", level: "edit", reason: "Level 0 creates Title; levels 1-9 create paragraph headings through creation and paragraph insertion. Deterministic style IDs preserve conflicting user definitions and reuse compatible built-ins. Model methods remain pending." }], detected: null }, { id: "F14", level: "edit", subsets: [{ name: "style-definitions", level: "edit", reason: "Paragraph, character and table styles; defaults, inheritance, linked styles and heading definitions. Latent defaults and individual visibility, priority, locking and gallery metadata are editable. Live style collections, inherited font/paragraph objects, latent entries and owned typed batches are implemented; document content model operations remain pending." }], detected: null }, { id: "F13", level: "edit", subsets: [{ name: "paragraph-editing", level: "edit", reason: "Direct paragraph properties and whole text; block and inline caret insertion with suffix retention. Explicit breaks, sorted tab stops, border sides and shading; style-owned paragraph model handles are implemented." }], detected: null }, { id: "F12", level: "edit", subsets: [{ name: "scoped-direct-run-formatting", level: "edit", reason: "Run or paragraph scalar ranges; nullable direct properties, explicit font/theme references and half-point sizes. No style resolution, font loading, whole-text assignment or whole document model execution." }], detected: null }, { id: "F11", level: "edit", subsets: [{ name: "structured-creation", level: "edit", reason: "DOCX/DOTX, Strict/Transitional; original paragraphs/tables and explicit new-package settings; append-only supplied templates." }], detected: null }, { id: "F06", level: "read", subsets: [{ name: "inventory", level: "read", reason: "No rendering, linked-resource access or signature verification." }], detected: null }, { id: "F49", level: "read", subsets: [{ name: "core-v1", level: "read", reason: "Partial core-v1 validation only." }], detected: null }, { id: "F08", level: "read", subsets: [{ name: "logical-story-text", level: "read", reason: "Explicit story scopes and review views; hidden text included, cached field results only; no drawing/equation text or rendering." }], detected: null }, { id: "F09", level: "read", subsets: [{ name: "logical-unicode", level: "read", reason: "Unicode order and direct language/RTL/font properties; no shaping or style cascade." }], detected: null }, { id: "F07", level: "edit", subsets: [{ name: "explicit-xml-part", level: "edit", reason: "Validated whole-part replacement; immutable opaque content, no protection bypass; raw bytes or bounded display serialization." }], detected: null }, { id: "F10", level: "edit", subsets: [{ name: "literal-paragraph-text", level: "edit", reason: "Nonoverlapping original-text matches, run formatting preservation, explicit cardinality and bold/italic overrides; structural barriers, protected and shared parts guarded." }], detected: null }], host: { read: false, atomicReplace: false, transactions: false, binaryStdout: true }, limits, validationProfiles: [documentValidationProfile] },
      human: "docx capabilities\n\nInspection and partial core-v1 validation are implemented.\nDocument reads require explicit filesystem or stdin authority.\n\nLimits:\n" + limits.map(item => `  ${item.name}: ${item.ceiling}`).join("\n") + "\n" });
  }
  const selected = invocation.options.operation as string | undefined;
  const declarations = selected ? [[selected, docxOperationSchemas[selected]!] as const] :
    Object.entries(docxOperationSchemas).filter(([id, declaration]) => declaration.discovery !== undefined || inspectionOperationMetadata[id] !== undefined || imageOperationContracts[id] !== undefined || rasterInsertionOperationContracts[id] !== undefined || id === "batch" || invocation.operation === "schema" && styleModelBatchOperations.includes(id));
  if (invocation.operation === "help") {
    const data: DocxHelpData = { name: "docx", paths: declarations.map(([id, declaration]) => ({
      path: commandPath(id, declaration), usage: usage(id, declaration), description: description(declaration), operationIds: [id]
    })) };
    return bounded({ data, human: selected ? details(selected, declarations[0]![1]) :
      "docx — document utility\n\nImplemented commands:\n" + data.paths.map(item => `  ${item.usage}\n    ${item.description}`).join("\n") +
      "\n\nUse docx help COMMAND PATH for a declared contract.\nInspection, validation and text extraction are read-only. Text replace preserves run formatting; XML set replaces one validated part. Later document operations remain pending.\nAliases: --help, -h; --version.\n" });
  }
  const data: DocxSchemaData = { schemaVersion: 1, validationProfiles: [documentValidationProfile], operations: declarations.map(([id, declaration]) => ({
    id, path: commandPath(id, declaration), input: getDocxOperationSchema(id, declaration.transport === "typed-batch" ? "batch" : "sdk"),
    result: id === "batch" ? styleModelBatchResultSchema() : styleModelBatchOperations.includes(id) ? styleModelOperationResultSchema(id) : inspectionOperationMetadata[id]?.result ?? imageOperationContracts[id]?.result ?? rasterInsertionOperationContracts[id]?.result ?? propertyOperationContracts[id]?.result ?? declaration.discovery?.result ?? { ...discoveryFailureSchema(id), description: "Only failures are specified here; operation not implemented." },
    featureIds: imageBatchActions.has(id) ? ["F32"] : id === "batch" || styleModelBatchOperations.includes(id) ? ["F12", "F13", "F14"] : inspectionOperationMetadata[id]?.featureIds ?? imageOperationContracts[id]?.featureIds ?? rasterInsertionOperationContracts[id]?.featureIds ?? declaration.discovery?.featureIds ?? [], support: id === "batch" || rasterInsertionOperationContracts[id] ? "edit" : styleModelBatchOperations.includes(id) ? declaration.mutates ? "edit" : "read" : ["properties.set", "properties.remove", "controls.set", "controls.repeat", "controls.bind", "revisions.accept", "revisions.reject", "revisions.add", "comments.add", "comments.set", "comments.remove", "notes.add", "notes.set", "notes.remove", "fields.add", "fields.set", "toc.add", "toc.set", "captions.add", "captions.set", "bookmarks.add", "bookmarks.set", "bookmarks.remove", "links.add", "links.set", "links.remove", "tables.merge", "tables.split", "tables.set", "tables.rows.add", "tables.rows.remove", "tables.columns.add", "tables.columns.remove", "tables.add", "lists.add", "lists.set", "headers.set", "headers.remove", "footers.set", "footers.remove", "styles.latent.add", "styles.latent.set", "styles.latent.remove", "styles.latent.defaults.set", "styles.add", "styles.set", "styles.defaults.set", "xml.set", "create", "text.replace", "runs.set", "paragraphs.set", "paragraphs.add", "runs.add"].includes(id) ? "edit" : declaration.discovery || inspectionOperationMetadata[id] || imageOperationContracts[id] ? "read" : "reject"
  })) };
  return bounded({ data, human: JSON.stringify(data) + "\n" });
}
