import { PdfDocument, encodePng } from "@poe-code/pdf-ast";
import type {
  Alignment,
  Attr,
  Block,
  Cell,
  ColSpec,
  Inline,
  MetaValue,
  Row,
  TableBody,
  TableHead,
} from "./ast-types.js";
import { PandocError } from "./errors.js";
import type { AdapterContext, Document, Input, ReaderCapability, Resource } from "./types.js";

const EMPTY_ATTR: Attr = ["", [], []];

function textToInlines(text: string): Inline[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const tokens = trimmed.split(/(\s+)/);
  const inlines: Inline[] = [];
  for (const token of tokens) {
    if (!token) continue;
    if (/^\s+$/.test(token)) {
      if (inlines.length > 0 && inlines[inlines.length - 1]?.t !== "Space") {
        inlines.push({ t: "Space" });
      }
    } else if (/^https?:\/\/\S+$/.test(token)) {
      inlines.push({
        t: "Link",
        c: [EMPTY_ATTR, [{ t: "Str", c: token }], [token, ""]],
      });
    } else {
      inlines.push({ t: "Str", c: token });
    }
  }
  return inlines;
}

function buildPandocTable(
  headers: readonly string[],
  rows: readonly (readonly string[])[]
): Block {
  const allRows = headers.length > 0 ? [headers, ...rows] : rows;
  const colCount = Math.max(1, ...allRows.map((r) => r.length));
  const colSpecs: ColSpec[] = Array.from({ length: colCount }, () => [
    "AlignDefault" as Alignment,
    { t: "ColWidthDefault" as const },
  ]);

  const toRow = (cells: readonly string[]): Row => {
    const builtCells: Cell[] = [];
    for (let c = 0; c < colCount; c++) {
      const cellText = (cells[c] ?? "").trim();
      const inlines = textToInlines(cellText);
      builtCells.push([
        EMPTY_ATTR,
        "AlignDefault",
        1,
        1,
        inlines.length > 0 ? [{ t: "Plain", c: inlines }] : [],
      ]);
    }
    return [EMPTY_ATTR, builtCells];
  };

  const headRows: Row[] = headers.length > 0 ? [toRow(headers)] : [];
  const bodyRows: Row[] = rows.map(toRow);

  const tableHead: TableHead = [EMPTY_ATTR, headRows];
  const tableBody: TableBody = [EMPTY_ATTR, 0, [], bodyRows];

  return {
    t: "Table",
    c: [
      EMPTY_ATTR,
      [null, []],
      colSpecs,
      tableHead,
      [tableBody],
      [EMPTY_ATTR, []],
    ],
  };
}

export const pdfReader: ReaderCapability = Object.freeze({
  format: "pdf",
  async read(input: Input, context: AdapterContext): Promise<Document> {
    context.checkpoint(1);
    context.charge("binaryBytes", input.bytes.byteLength);

    let doc: PdfDocument;
    try {
      doc = PdfDocument.load(input.bytes);
    } catch (err) {
      throw new PandocError(
        "E_PARSE",
        "read",
        err instanceof Error ? err.message : "Invalid PDF input",
        "pdf"
      );
    }

    const meta = doc.getMetadata();
    const metadata: Record<string, MetaValue> = {};
    if (meta.title) {
      metadata.title = { t: "MetaString", c: meta.title };
    }
    if (meta.author) {
      const authors = meta.author.split(/;\s*/).filter(Boolean);
      metadata.author =
        authors.length > 1
          ? { t: "MetaList", c: authors.map((a) => ({ t: "MetaString", c: a })) }
          : { t: "MetaString", c: meta.author };
    }
    if (meta.subject) {
      metadata.subject = { t: "MetaString", c: meta.subject };
    }
    if (meta.keywords) {
      const kws = meta.keywords.split(/[,;]\s*/).filter(Boolean);
      if (kws.length > 0) {
        metadata.keywords = {
          t: "MetaList",
          c: kws.map((k) => ({ t: "MetaString", c: k })),
        };
      }
    }

    const semantic = doc.toSemanticAst();
    const blocks: Block[] = [];

    for (const block of semantic) {
      await context.cooperate(1);
      context.checkpoint(1);
      if (block.kind === "heading") {
        const inlines = textToInlines(block.text);
        if (inlines.length > 0) {
          blocks.push({
            t: "Header",
            c: [Math.min(6, Math.max(1, block.level)), EMPTY_ATTR, inlines],
          });
        }
      } else if (block.kind === "paragraph") {
        const inlines = textToInlines(block.text);
        if (inlines.length > 0) {
          blocks.push({ t: "Para", c: inlines });
        }
      } else if (block.kind === "code-block") {
        if (block.text.trim().length > 0) {
          blocks.push({
            t: "CodeBlock",
            c: [EMPTY_ATTR, block.text],
          });
        }
      } else if (block.kind === "list") {
        const items = block.items
          .map((item: string) =>
            textToInlines(item.replace(/^(?:\d+[.)]|[•\-*])\s*/, ""))
          )
          .filter((inlines: Inline[]) => inlines.length > 0)
          .map((inlines: Inline[]): readonly Block[] => [{ t: "Plain", c: inlines }]);
        if (items.length > 0) {
          if (block.ordered) {
            blocks.push({
              t: "OrderedList",
              c: [[1, "Decimal", "Period"], items],
            });
          } else {
            blocks.push({
              t: "BulletList",
              c: items,
            });
          }
        }
      } else if (block.kind === "table") {
        if (block.headers.length > 0 || block.rows.length > 0) {
          blocks.push(buildPandocTable(block.headers, block.rows));
        }
      } else if (block.kind === "link") {
        const label = textToInlines(block.text || block.uri);
        blocks.push({
          t: "Para",
          c: [
            {
              t: "Link",
              c: [EMPTY_ATTR, label, [block.uri, ""]],
            },
          ],
        });
      }
    }

    const resources: Resource[] = [];
    let imgCounter = 0;
    for (const page of doc.getPages()) {
      const dl = page.getDisplayList();
      for (const img of dl.images) {
        if (img.decodedRgba && img.width > 0 && img.height > 0) {
          imgCounter++;
          const resId = `pdf-image-${imgCounter}.png`;
          const pngBytes = encodePng({
            width: img.width,
            height: img.height,
            data: img.decodedRgba,
          });
          resources.push({
            id: resId,
            bytes: pngBytes,
          });
          blocks.push({
            t: "Para",
            c: [
              {
                t: "Image",
                c: [
                  EMPTY_ATTR,
                  [{ t: "Str", c: `Image ${imgCounter}` }],
                  [resId, ""],
                ],
              },
            ],
          });
        }
      }
    }

    return {
      blocks,
      metadata,
      resources,
    };
  },
});
