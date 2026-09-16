import { docxOperationSchemas, docxEnumCanonicalNames } from "./operation-schema.js";
import { DocxUsageError } from "./argument-json.js";
import { Settings } from "./settings-model.js";
import { DocumentView } from "./document-model.js";
import { Paragraph, Run } from "./block-model.js";
import { Table, _Cell, _Row, _Column, _Rows, _Columns } from "./table-model.js";
import { Section, Sections, _Header, _Footer } from "./section-model.js";
import { Comment, Comments, Hyperlink, RenderedPageBreak } from "./review-model.js";
import { Length, isLength, enumFamilies, isEnumMember } from "./formatting-values.js";
import { paragraphUnits } from "./paragraph-properties.js";
import type { DocxLength } from "./operation-types.js";

type Action = (receiver: unknown, args: Readonly<Record<string, unknown>>) => unknown;
type Owner = abstract new (...args: never[]) => object;
type OwnerProvider = () => Owner;
export const structureModelBatchActions = new Map<string, Action>();
function register(key: string, owner: OwnerProvider, action: Action): void {
  if (!docxOperationSchemas[key]) return;
  structureModelBatchActions.set(key, (receiver, args) => {
    if (!(receiver instanceof owner()))
      throw new DocxUsageError("The receiver does not support this model operation.");
    return action(receiver, args);
  });
}
function surface(
  prefix: string,
  owner: OwnerProvider,
  read: readonly string[],
  write: readonly string[],
  methods: readonly string[]
): void {
  for (const name of [...read, "element", "part"])
    register(`${prefix}.${name}.get`, owner, (receiver) => Reflect.get(receiver as object, name));
  for (const name of write)
    register(`${prefix}.${name}.set`, owner, (receiver, args) => {
      if (!Reflect.set(receiver as object, name, args.value))
        throw new DocxUsageError("The property is not writable.");
    });
  for (const name of methods) {
    const key = `${prefix}.${name}.call`,
      fields = Object.keys(docxOperationSchemas[key]?.batchFields ?? {});
    register(key, owner, (receiver, args) => {
      const method = Reflect.get(receiver as object, name) as (...args: unknown[]) => unknown;
      const values = fields.map((field) => {
        const value = args[field];
        const type = docxOperationSchemas[key]!.batchFields![field]!.type;
        const family = enumFamilies[(docxEnumCanonicalNames[type] ?? type) as keyof typeof enumFamilies];
        if (family && value !== undefined && value !== null && !isEnumMember(value)) {
          const member = family.members[(value as { name: string }).name as keyof typeof family.members];
          if (!member) throw new DocxUsageError("Unknown enum value.");
          return member;
        }
        if (field === "width" && value !== undefined && value !== null && !isLength(value))
          return Length(paragraphUnits(value as DocxLength, 1));
        return value;
      });
      return Reflect.apply(method, receiver, values);
    });
  }
  for (const name of ["__eq__", "__ne__"])
    register(`${prefix}.${name}.call`, owner, (receiver, args) => {
      const equals = Reflect.get(receiver as object, "equals") as
        | ((other: unknown) => boolean)
        | undefined;
      const result = equals ? equals.call(receiver, args.other) : receiver === args.other;
      return name === "__eq__" ? result : !result;
    });
}
surface(
  "model.document.Document",
  () => DocumentView,
  ["paragraphs", "tables", "sections", "comments", "core_properties", "styles", "settings"],
  [],
  ["add_comment", "add_paragraph", "add_table", "add_heading", "add_page_break", "add_section", "iter_inner_content"]
);
surface(
  "model.settings.Settings",
  () => Settings,
  ["odd_and_even_pages_header_footer"],
  ["odd_and_even_pages_header_footer"],
  []
);
surface(
  "model.text.paragraph.Paragraph",
  () => Paragraph,
  [
    "alignment",
    "style",
    "text",
    "runs",
    "hyperlinks",
    "rendered_page_breaks",
    "contains_page_break",
    "paragraph_format"
  ],
  ["alignment", "style", "text"],
  ["add_run", "clear", "insert_paragraph_before", "iter_inner_content"]
);
surface(
  "model.text.run.Run",
  () => Run,
  ["text", "font", "style", "bold", "italic", "underline", "contains_page_break"],
  ["text", "style", "bold", "italic", "underline"],
  ["add_break", "add_tab", "add_text", "clear", "mark_comment_range"]
);
surface(
  "model.table.Table",
  () => Table,
  ["alignment", "autofit", "columns", "rows", "style", "table_direction"],
  ["alignment", "autofit", "style", "table_direction"],
  ["add_column", "add_row", "cell", "column_cells", "row_cells"]
);
surface(
  "model.table._Cell",
  () => _Cell,
  ["grid_span", "paragraphs", "tables", "text", "vertical_alignment", "width"],
  ["text", "vertical_alignment", "width"],
  ["add_paragraph", "add_table", "iter_inner_content", "merge"]
);
surface(
  "model.table._Row",
  () => _Row,
  ["cells", "grid_cols_before", "grid_cols_after", "height", "height_rule"],
  ["height", "height_rule"],
  []
);
surface("model.table._Column", () => _Column, ["cells", "width"], ["width"], []);
register(
  "model.table.Table.table.get",
  () => Table,
  (receiver) => (receiver as Table).table
);
for (const [name, owner] of [
  ["_Row", () => _Row],
  ["_Column", () => _Column],
  ["_Rows", () => _Rows],
  ["_Columns", () => _Columns]
] as const)
  register(`model.table.${name}.table.get`, owner, (receiver) =>
    Reflect.get(receiver as object, "table")
  );
const sectionValues = [
  "bottom_margin",
  "different_first_page_header_footer",
  "footer_distance",
  "gutter",
  "header_distance",
  "left_margin",
  "orientation",
  "page_height",
  "page_width",
  "right_margin",
  "start_type",
  "top_margin"
];
surface(
  "model.section.Section",
  () => Section,
  [
    ...sectionValues,
    "even_page_footer",
    "even_page_header",
    "first_page_footer",
    "first_page_header",
    "footer",
    "header"
  ],
  sectionValues,
  ["iter_inner_content"]
);
for (const [name, owner] of [
  ["_Header", () => _Header],
  ["_Footer", () => _Footer]
] as const)
  surface(
    `model.section.${name}`,
    owner,
    ["is_linked_to_previous", "paragraphs", "tables"],
    ["is_linked_to_previous"],
    ["add_paragraph", "add_table", "iter_inner_content"]
  );
surface(
  "model.comments.Comment",
  () => Comment,
  ["author", "comment_id", "initials", "paragraphs", "tables", "text", "timestamp"],
  ["author", "initials"],
  ["add_paragraph", "add_table", "iter_inner_content"]
);
surface("model.comments.Comments", () => Comments, [], [], ["add_comment", "get"]);
surface(
  "model.text.hyperlink.Hyperlink",
  () => Hyperlink,
  ["address", "fragment", "runs", "text", "url", "contains_page_break", "history"],
  [],
  []
);
surface(
  "model.text.pagebreak.RenderedPageBreak",
  () => RenderedPageBreak,
  ["preceding_paragraph_fragment", "following_paragraph_fragment"],
  [],
  []
);
for (const [prefix, owner] of [
  ["model.table._Rows", () => _Rows],
  ["model.table._Columns", () => _Columns],
  ["model.section.Sections", () => Sections],
  ["model.comments.Comments", () => Comments]
] as const) {
  register(`${prefix}.__len__.get`, owner, (receiver) => Reflect.get(receiver as object, "length"));
  register(`${prefix}.__iter__.call`, owner, (receiver) => [...(receiver as Iterable<unknown>)]);
  if (prefix !== "model.comments.Comments") {
    for (const suffix of ["get", "call"])
      register(`${prefix}.__getitem__.${suffix}`, owner, (receiver, args) =>
        (receiver as _Rows | _Columns | Sections).at(args.index as number)
      );
    register(`${prefix}.__getitem__.slice`, owner, (receiver, args) =>
      (receiver as _Rows | Sections).slice(
        args.start as number | undefined,
        args.end as number | undefined
      )
    );
  }
  register(`${prefix}.part.get`, owner, (receiver) => Reflect.get(receiver as object, "part"));
}
surface("model.section.Sections", () => Sections, [], [], ["count", "index"]);
register(
  "model.section.Sections.__contains__.call",
  () => Sections,
  (receiver, args) => (receiver as Sections).count(args.value) > 0
);
register(
  "model.section.Sections.__reversed__.call",
  () => Sections,
  (receiver) => [...(receiver as Sections)].reverse()
);
