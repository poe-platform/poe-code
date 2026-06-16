import { parse, type MdNode } from "toolcraft-design";

export interface Section {
  depth: number;
  title: string;
  number: string | null;
  headingStart: number;
  bodyStart: number;
  bodyEnd: number;
  bodyEndNoChildren: number;
}

type StackEntry = { depth: number; childCount: number; numberParts: number[] };

export function scanMarkdown(source: string): Section[] {
  const ast = parse(source).ast;

  if (ast.type !== "root") {
    return [];
  }

  const htmlCommentRanges = collectHtmlCommentRanges(source);
  const headings = ast.children
    .filter(isHeadingNode)
    .filter((heading) => !isInsideHtmlComment(getRequiredRange(heading).start, htmlCommentRanges));

  if (headings.length === 0) {
    return [];
  }

  const endOfSource = Buffer.byteLength(source, "utf8");
  const baselineDepth = resolveBaselineDepth(headings);
  const sections: Section[] = headings.map((heading, index) => {
    const range = getRequiredRange(heading);

    return {
      depth: heading.depth,
      title: extractText(heading.children).trim(),
      number: null,
      headingStart: range.start,
      bodyStart: range.end,
      bodyEnd: findBodyEnd(headings, index, endOfSource),
      bodyEndNoChildren: headings[index + 1]?.range?.start ?? endOfSource
    };
  });

  applyNumbers(sections, baselineDepth);

  return sections;
}

type HtmlCommentRange = { start: number; end: number };

function collectHtmlCommentRanges(source: string): HtmlCommentRange[] {
  const ranges: HtmlCommentRange[] = [];
  let searchStart = 0;

  while (searchStart < source.length) {
    const commentStart = source.indexOf("<!--", searchStart);
    if (commentStart === -1) {
      return ranges;
    }

    const commentEndMarker = source.indexOf("-->", commentStart + "<!--".length);
    const commentEnd =
      commentEndMarker === -1 ? source.length : commentEndMarker + "-->".length;

    ranges.push({
      start: byteOffset(source, commentStart),
      end: byteOffset(source, commentEnd)
    });
    searchStart = commentEnd;
  }

  return ranges;
}

function isInsideHtmlComment(offset: number, ranges: HtmlCommentRange[]): boolean {
  return ranges.some((range) => offset >= range.start && offset < range.end);
}

function byteOffset(source: string, index: number): number {
  return Buffer.byteLength(source.slice(0, index), "utf8");
}

function isHeadingNode(node: MdNode): node is Extract<MdNode, { type: "heading" }> {
  return node.type === "heading";
}

function getRequiredRange(node: MdNode): NonNullable<MdNode["range"]> {
  if (node.range === undefined) {
    throw new Error(`Expected markdown ${node.type} node to include a range.`);
  }

  return node.range;
}

function extractText(children: MdNode[]): string {
  return children
    .map((node) => {
      switch (node.type) {
        case "text":
        case "inlineCode":
          return node.value;
        case "image":
          return node.alt;
        case "break":
          return " ";
        default:
          return "children" in node ? extractText(node.children) : "";
      }
    })
    .join("");
}

function resolveBaselineDepth(headings: Array<Extract<MdNode, { type: "heading" }>>): number {
  const shallowestDepth = headings.reduce<number>(
    (currentDepth, heading) => Math.min(currentDepth, heading.depth),
    headings[0]?.depth ?? 6
  );

  const isSingleLeadingDepthOneHeading =
    headings[0]?.depth === 1 && headings.filter((heading) => heading.depth === 1).length === 1;

  if (!isSingleLeadingDepthOneHeading) {
    return shallowestDepth;
  }

  const nextShallowestDepth = headings.slice(1).reduce<number | null>((currentDepth, heading) => {
    if (heading.depth === 1) {
      return currentDepth;
    }

    return currentDepth === null ? heading.depth : Math.min(currentDepth, heading.depth);
  }, null);

  return Math.max(2, nextShallowestDepth ?? 2);
}

function findBodyEnd(
  headings: Array<Extract<MdNode, { type: "heading" }>>,
  startIndex: number,
  endOfSource: number
): number {
  const currentDepth = headings[startIndex]!.depth;

  for (let index = startIndex + 1; index < headings.length; index += 1) {
    const nextHeading = headings[index]!;

    if (nextHeading.depth <= currentDepth) {
      return getRequiredRange(nextHeading).start;
    }
  }

  return endOfSource;
}

function applyNumbers(sections: Section[], baselineDepth: number): void {
  const stack: StackEntry[] = [];
  let rootCount = 0;

  for (const section of sections) {
    if (section.depth < baselineDepth) {
      continue;
    }

    while (stack.length > 0 && stack.at(-1)!.depth >= section.depth) {
      stack.pop();
    }

    const parent = stack.at(-1);
    let numberParts: number[];

    if (parent === undefined) {
      rootCount += 1;
      numberParts = [rootCount];
    } else {
      parent.childCount += 1;
      numberParts = [...parent.numberParts, parent.childCount];
    }

    section.number = numberParts.join(".");
    stack.push({ depth: section.depth, childCount: 0, numberParts });
  }
}
