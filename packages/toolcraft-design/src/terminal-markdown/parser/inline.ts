import type { MdNode, MdRange } from "../ast.js";

type ParsedInlineNode = {
  node: MdNode;
  end: number;
};

type OffsetMap = readonly number[];
type InlineTextNode = Extract<MdNode, { type: "text" }>;
type DelimiterMarker = "*" | "_" | "~";

type Delimiter = {
  marker: DelimiterMarker;
  length: number;
  canOpen: boolean;
  canClose: boolean;
  node: InlineTextNode;
  position: number;
};

type DelimiterPair = {
  opener: Delimiter;
  closer: Delimiter;
  kind: "emphasis" | "strong" | "strikethrough";
  sequence: number;
};

const INLINE_HTML_TAGS = new Set([
  "a",
  "abbr",
  "address",
  "article",
  "aside",
  "b",
  "base",
  "basefont",
  "bdi",
  "bdo",
  "blockquote",
  "body",
  "br",
  "button",
  "caption",
  "center",
  "cite",
  "code",
  "col",
  "colgroup",
  "data",
  "dd",
  "del",
  "details",
  "dfn",
  "dialog",
  "div",
  "dl",
  "dt",
  "em",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "head",
  "header",
  "hr",
  "html",
  "i",
  "img",
  "input",
  "ins",
  "kbd",
  "label",
  "legend",
  "li",
  "link",
  "main",
  "mark",
  "menu",
  "nav",
  "ol",
  "option",
  "p",
  "param",
  "pre",
  "q",
  "rp",
  "rt",
  "rtc",
  "ruby",
  "s",
  "samp",
  "search",
  "section",
  "small",
  "span",
  "strong",
  "sub",
  "summary",
  "sup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "time",
  "title",
  "tr",
  "u",
  "ul",
  "var",
  "wbr"
]);

export type ParseInlineOptions = {
  footnoteLabels?: ReadonlySet<string>;
  allowLiteralAutolinks?: boolean;
  offset?: number;
  offsets?: OffsetMap;
};

export function parseInline(raw: string, options: ParseInlineOptions = {}): MdNode[] {
  const nodes: MdNode[] = [];
  const delimiters: Delimiter[] = [];
  const footnoteLabels = options.footnoteLabels;
  const allowLiteralAutolinks = options.allowLiteralAutolinks ?? true;
  const offsets = options.offsets ?? createOffsetMap(raw, options.offset ?? 0);
  let textBuffer = "";
  let textStart = 0;
  let index = 0;

  const appendText = (value: string, start: number) => {
    if (textBuffer.length === 0) {
      textStart = start;
    }

    textBuffer += value;
  };

  const flushText = (end = index) => {
    if (textBuffer.length === 0) {
      return;
    }

    nodes.push(createTextNode(textBuffer, createRange(offsets, textStart, end)));
    textBuffer = "";
  };

  while (index < raw.length) {
    const char = raw[index];

    if (char === "\\" && index + 1 < raw.length && isEscapable(raw[index + 1])) {
      appendText(raw[index + 1], index);
      index += 2;
      continue;
    }

    if (char === "`") {
      const code = parseInlineCode(raw, index, offsets);

      if (code !== null) {
        flushText();
        nodes.push(code.node);
        index = code.end;
        continue;
      }
    }

    if (char === "!" && index + 1 < raw.length && raw[index + 1] === "[") {
      const image = parseImage(raw, index, offsets);

      if (image !== null) {
        flushText();
        nodes.push(image.node);
        index = image.end;
        continue;
      }
    }

    if (char === "[") {
      const footnoteReference = parseFootnoteReference(raw, index, footnoteLabels, offsets);

      if (footnoteReference !== null) {
        flushText();
        nodes.push(footnoteReference.node);
        index = footnoteReference.end;
        continue;
      }

      const link = parseLink(raw, index, footnoteLabels, offsets);

      if (link !== null) {
        flushText();
        nodes.push(link.node);
        index = link.end;
        continue;
      }
    }

    if (char === "<") {
      const autolink = parseAutolink(raw, index, offsets);

      if (autolink !== null) {
        flushText();
        nodes.push(autolink.node);
        index = autolink.end;
        continue;
      }

      const html = parseInlineHtmlTag(raw, index, offsets);

      if (html !== null) {
        flushText();
        nodes.push(html.node);
        index = html.end;
        continue;
      }
    }

    if (char === "\n") {
      if (textBuffer.endsWith("\\")) {
        textBuffer = textBuffer.slice(0, -1);
        flushText(index - 1);
        nodes.push(withRange({ type: "break" }, createRange(offsets, index, index + 1)));
        index += 1;
        continue;
      }

      const trailingSpaceStart = findTrailingHardBreakSpaceStart(textBuffer);

      if (trailingSpaceStart !== -1) {
        const trailingSpaceCount = textBuffer.length - trailingSpaceStart;
        textBuffer = textBuffer.slice(0, trailingSpaceStart);
        flushText(index - trailingSpaceCount);
        nodes.push(withRange({ type: "break" }, createRange(offsets, index, index + 1)));
        index += 1;
        continue;
      }
    }

    if (allowLiteralAutolinks) {
      const literalAutolink = parseLiteralAutolink(raw, index, offsets);

      if (literalAutolink !== null) {
        flushText();
        nodes.push(literalAutolink.node);
        index = literalAutolink.end;
        continue;
      }
    }

    if (char === "*" || char === "_" || char === "~") {
      const delimiter = parseDelimiter(raw, index, char);

      if (delimiter !== null) {
        flushText();

        const node = createTextNode(raw.slice(index, index + delimiter.length), {
          start: offsets[index] ?? 0,
          end: offsets[index + delimiter.length] ?? offsets[offsets.length - 1] ?? 0
        });

        nodes.push(node);
        delimiters.push({
          ...delimiter,
          node,
          position: nodes.length - 1
        });
        index += delimiter.length;
        continue;
      }
    }

    appendText(char, index);
    index += 1;
  }

  flushText();

  if (delimiters.length === 0) {
    return normalizeInlineNodes(nodes);
  }

  const pairs = matchDelimiterPairs(delimiters);

  if (pairs.length === 0) {
    return normalizeInlineNodes(nodes);
  }

  return buildInlineNodes(nodes, delimiters, pairs);
}

function parseDelimiter(
  input: string,
  start: number,
  marker: DelimiterMarker
): Omit<Delimiter, "node" | "position"> | null {
  const length = readRunLength(input, start, marker);
  const before = start === 0 ? null : input[start - 1];
  const after = start + length >= input.length ? null : input[start + length];
  const leftFlanking =
    !isDelimiterWhitespace(after) &&
    (!isDelimiterPunctuation(after) ||
      isDelimiterWhitespace(before) ||
      isDelimiterPunctuation(before));
  const rightFlanking =
    !isDelimiterWhitespace(before) &&
    (!isDelimiterPunctuation(before) ||
      isDelimiterWhitespace(after) ||
      isDelimiterPunctuation(after));

  if (marker === "~") {
    if (length < 2) {
      return null;
    }

    return {
      marker,
      length,
      canOpen: leftFlanking,
      canClose: rightFlanking
    };
  }

  if (marker === "_") {
    return {
      marker,
      length,
      canOpen: leftFlanking && (!rightFlanking || isDelimiterPunctuation(before)),
      canClose: rightFlanking && (!leftFlanking || isDelimiterPunctuation(after))
    };
  }

  return {
    marker,
    length,
    canOpen: leftFlanking,
    canClose: rightFlanking
  };
}

function matchDelimiterPairs(delimiters: Delimiter[]): DelimiterPair[] {
  const pairs: DelimiterPair[] = [];
  const previous = delimiters.map((_, index) => index - 1);
  const next = delimiters.map((_, index) => (index + 1 < delimiters.length ? index + 1 : -1));
  const active = delimiters.map(() => true);
  let sequence = 0;
  let closerIndex = 0;

  const unlinkDelimiter = (index: number) => {
    if (!active[index]) {
      return;
    }

    const previousIndex = previous[index];
    const nextIndex = next[index];

    if (previousIndex !== -1) {
      next[previousIndex] = nextIndex;
    }

    if (nextIndex !== -1) {
      previous[nextIndex] = previousIndex;
    }

    active[index] = false;
  };

  const pruneDelimiter = (index: number) => {
    const delimiter = delimiters[index];

    if (delimiter.length === 0) {
      unlinkDelimiter(index);
      return;
    }

    if (delimiter.marker === "~" && delimiter.length < 2) {
      delimiter.canOpen = false;
      delimiter.canClose = false;
      unlinkDelimiter(index);
    }
  };

  while (closerIndex !== -1) {
    const closer = delimiters[closerIndex];

    if (!closer.canClose || closer.length === 0) {
      closerIndex = next[closerIndex];
      continue;
    }

    const openerIndex = findMatchingOpener(delimiters, previous, closerIndex);

    if (openerIndex === null) {
      const nextCloserIndex = next[closerIndex];

      if (!closer.canOpen) {
        unlinkDelimiter(closerIndex);
      }

      closerIndex = nextCloserIndex;
      continue;
    }

    const opener = delimiters[openerIndex];
    const pairLength = getPairLength(opener, closer);

    if (pairLength === 0 || opener.position + 1 >= closer.position) {
      closerIndex = next[closerIndex];
      continue;
    }

    pairs.push({
      opener,
      closer,
      kind: getPairKind(opener.marker, pairLength),
      sequence
    });

    opener.length -= pairLength;
    closer.length -= pairLength;

    let trappedIndex = next[openerIndex];

    while (trappedIndex !== -1 && trappedIndex !== closerIndex) {
      const nextTrappedIndex = next[trappedIndex];
      unlinkDelimiter(trappedIndex);
      trappedIndex = nextTrappedIndex;
    }

    pruneDelimiter(openerIndex);
    pruneDelimiter(closerIndex);

    if (!active[closerIndex] || !closer.canClose || closer.length === 0) {
      closerIndex = next[closerIndex];
    }

    sequence += 1;
  }

  return pairs;
}

function findMatchingOpener(
  delimiters: Delimiter[],
  previous: number[],
  closerIndex: number
): number | null {
  const closer = delimiters[closerIndex];
  let openerIndex = previous[closerIndex];

  while (openerIndex !== -1) {
    const opener = delimiters[openerIndex];

    if (
      opener.marker === closer.marker &&
      opener.canOpen &&
      opener.length > 0 &&
      !violatesMultipleOfThreeRule(opener, closer)
    ) {
      return openerIndex;
    }

    openerIndex = previous[openerIndex];
  }

  return null;
}

function violatesMultipleOfThreeRule(opener: Delimiter, closer: Delimiter): boolean {
  if (opener.marker === "~") {
    return false;
  }

  if (!opener.canClose || !closer.canOpen) {
    return false;
  }

  return (
    (opener.length + closer.length) % 3 === 0 &&
    (opener.length % 3 !== 0 || closer.length % 3 !== 0)
  );
}

function getPairLength(opener: Delimiter, closer: Delimiter): 0 | 1 | 2 {
  if (opener.marker === "~") {
    return opener.length >= 2 && closer.length >= 2 ? 2 : 0;
  }

  return opener.length >= 2 && closer.length >= 2 ? 2 : 1;
}

function getPairKind(
  marker: DelimiterMarker,
  pairLength: 1 | 2
): "emphasis" | "strong" | "strikethrough" {
  if (marker === "~") {
    return "strikethrough";
  }

  return pairLength === 2 ? "strong" : "emphasis";
}

function buildInlineNodes(
  nodes: MdNode[],
  delimiters: Delimiter[],
  pairs: DelimiterPair[]
): MdNode[] {
  const delimiterEntries = new Map<
    InlineTextNode,
    {
      delimiter: Delimiter;
      opens: DelimiterPair[];
      closes: DelimiterPair[];
    }
  >();

  for (const delimiter of delimiters) {
    delimiterEntries.set(delimiter.node, {
      delimiter,
      opens: [],
      closes: []
    });
  }

  for (const pair of pairs) {
    delimiterEntries.get(pair.opener.node)?.opens.push(pair);
    delimiterEntries.get(pair.closer.node)?.closes.push(pair);
  }

  const root: MdNode[] = [];
  const stack: Array<{ pair?: DelimiterPair; children: MdNode[] }> = [{ children: root }];

  const appendNode = (node: MdNode) => {
    stack[stack.length - 1]?.children.push(node);
  };

  for (const node of nodes) {
    if (node.type !== "text") {
      appendNode(node);
      continue;
    }

    const delimiterEntry = delimiterEntries.get(node);

    if (delimiterEntry === undefined) {
      appendNode(node);
      continue;
    }

    delimiterEntry.closes.sort((left, right) => left.sequence - right.sequence);

    for (const pair of delimiterEntry.closes) {
      const current = stack[stack.length - 1];

      if (current?.pair === pair) {
        stack.pop();
      }
    }

    if (delimiterEntry.delimiter.length > 0) {
      appendNode(
        createTextNode(
          delimiterEntry.delimiter.marker.repeat(delimiterEntry.delimiter.length),
          node.range
        )
      );
    }

    delimiterEntry.opens.sort((left, right) => right.sequence - left.sequence);

    for (const pair of delimiterEntry.opens) {
      const wrapper = withRange(createDelimiterNode(pair.kind), {
        start: pair.opener.node.range?.start ?? pair.opener.position,
        end: pair.closer.node.range?.end ?? pair.closer.position
      });
      appendNode(wrapper);
      stack.push({ pair, children: wrapper.children });
    }
  }

  return normalizeInlineNodes(root);
}

function createDelimiterNode(
  kind: DelimiterPair["kind"]
): Extract<MdNode, { type: "emphasis" | "strong" | "strikethrough" }> {
  return { type: kind, children: [] };
}

function createTextNode(value: string, range?: MdRange): InlineTextNode {
  return range === undefined ? { type: "text", value } : withRange({ type: "text", value }, range);
}

function withRange<T extends MdNode>(node: T, range: MdRange): T {
  Object.defineProperty(node, "range", {
    value: range,
    enumerable: false,
    configurable: true,
    writable: true
  });

  return node;
}

function mergeRanges(left?: MdRange, right?: MdRange): MdRange | undefined {
  if (left === undefined) {
    return right;
  }

  if (right === undefined) {
    return left;
  }

  return {
    start: Math.min(left.start, right.start),
    end: Math.max(left.end, right.end)
  };
}

function normalizeInlineNodes(nodes: MdNode[]): MdNode[] {
  const normalized: MdNode[] = [];

  for (const node of nodes) {
    const nextNode = normalizeInlineNode(node);

    if (nextNode === null) {
      continue;
    }

    const previousNode = normalized[normalized.length - 1];

    if (previousNode?.type === "text" && nextNode.type === "text") {
      previousNode.value += nextNode.value;
      const range = mergeRanges(previousNode.range, nextNode.range);

      if (range !== undefined) {
        withRange(previousNode, range);
      }

      continue;
    }

    normalized.push(nextNode);
  }

  return normalized;
}

function normalizeInlineNode(node: MdNode): MdNode | null {
  if (node.type === "text") {
    return node.value.length === 0 ? null : node;
  }

  if (
    node.type === "emphasis" ||
    node.type === "strong" ||
    node.type === "strikethrough" ||
    node.type === "link"
  ) {
    const nextNode = { ...node, children: normalizeInlineNodes(node.children) };
    return node.range === undefined ? nextNode : withRange(nextNode, node.range);
  }

  return node;
}

function parseInlineCode(
  input: string,
  start: number,
  offsets?: OffsetMap
): ParsedInlineNode | null {
  const fenceLength = readRunLength(input, start, "`");
  let index = start + fenceLength;

  while (index < input.length) {
    if (input[index] !== "`") {
      index += 1;
      continue;
    }

    const closingFenceLength = readRunLength(input, index, "`");

    if (closingFenceLength === fenceLength) {
      const value = normalizeInlineCodeValue(input.slice(start + fenceLength, index));
      return {
        node:
          offsets === undefined
            ? {
                type: "inlineCode",
                value
              }
            : withRange(
                {
                  type: "inlineCode",
                  value
                },
                createRange(offsets, start, index + fenceLength)
              ),
        end: index + fenceLength
      };
    }

    index += closingFenceLength;
  }

  return null;
}

function normalizeInlineCodeValue(value: string): string {
  if (
    value.length >= 2 &&
    value.startsWith(" ") &&
    value.endsWith(" ") &&
    (value[1] === "`" || value[value.length - 2] === "`") &&
    value.trim().length > 0
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function parseLink(
  input: string,
  start: number,
  footnoteLabels?: ReadonlySet<string>,
  offsets?: OffsetMap
): ParsedInlineNode | null {
  const label = parseBracketedLabel(input, start);

  if (label === null || label.end >= input.length || input[label.end] !== "(") {
    return null;
  }

  const destination = parseLinkDestination(input, label.end);

  if (destination === null) {
    return null;
  }

  return {
    node: withRange(
      {
        type: "link",
        url: destination.url,
        ...(destination.title === undefined ? {} : { title: destination.title }),
        children: parseInline(label.value, {
          footnoteLabels,
          allowLiteralAutolinks: false,
          ...(offsets === undefined
            ? {}
            : { offsets: sliceOffsetMap(offsets, label.contentStart, label.end - 1) })
        })
      },
      offsets === undefined
        ? { start, end: destination.end }
        : createRange(offsets, start, destination.end)
    ),
    end: destination.end
  };
}

function parseImage(input: string, start: number, offsets?: OffsetMap): ParsedInlineNode | null {
  const label = parseBracketedLabel(input, start + 1);

  if (label === null || label.end >= input.length || input[label.end] !== "(") {
    return null;
  }

  const destination = parseLinkDestination(input, label.end);

  if (destination === null) {
    return null;
  }

  return {
    node: withRange(
      {
        type: "image",
        url: destination.url,
        alt: decodeEscapes(label.value),
        ...(destination.title === undefined ? {} : { title: destination.title })
      },
      offsets === undefined
        ? { start, end: destination.end }
        : createRange(offsets, start, destination.end)
    ),
    end: destination.end
  };
}

function parseBracketedLabel(
  input: string,
  start: number
): { value: string; contentStart: number; end: number } | null {
  if (start >= input.length || input[start] !== "[") {
    return null;
  }

  let depth = 1;
  let index = start + 1;

  while (index < input.length) {
    const char = input[index];

    if (char === "\\" && index + 1 < input.length) {
      index += 2;
      continue;
    }

    if (char === "`") {
      const code = parseInlineCode(input, index);

      if (code !== null) {
        index = code.end;
        continue;
      }
    }

    if (char === "[") {
      depth += 1;
      index += 1;
      continue;
    }

    if (char === "]") {
      depth -= 1;

      if (depth === 0) {
        return {
          value: input.slice(start + 1, index),
          contentStart: start + 1,
          end: index + 1
        };
      }
    }

    index += 1;
  }

  return null;
}

function parseLinkDestination(
  input: string,
  openParenIndex: number
): { url: string; title?: string; end: number } | null {
  let depth = 1;
  let quote: '"' | "'" | null = null;
  let index = openParenIndex + 1;

  while (index < input.length) {
    const char = input[index];

    if (quote !== null) {
      if (char === "\\" && index + 1 < input.length) {
        index += 2;
        continue;
      }

      if (char === quote) {
        quote = null;
      }

      index += 1;
      continue;
    }

    if (char === "\\" && index + 1 < input.length && isEscapable(input[index + 1])) {
      index += 2;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      index += 1;
      continue;
    }

    if (char === "(") {
      depth += 1;
      index += 1;
      continue;
    }

    if (char === ")") {
      depth -= 1;

      if (depth === 0) {
        const content = input.slice(openParenIndex + 1, index);
        const parsed = parseLinkDestinationContent(content);

        return {
          ...parsed,
          end: index + 1
        };
      }
    }

    index += 1;
  }

  return null;
}

function parseLinkDestinationContent(content: string): { url: string; title?: string } {
  const trimmedEnd = trimAsciiWhitespaceEndIndex(content);

  if (trimmedEnd === 0) {
    return { url: "" };
  }

  const quote = content[trimmedEnd - 1];

  if (quote === '"' || quote === "'") {
    const titleStart = findTrailingQuotedSegmentStart(content, trimmedEnd, quote);

    if (titleStart !== -1) {
      let separatorStart = titleStart;

      while (separatorStart > 0 && isAsciiWhitespace(content[separatorStart - 1])) {
        separatorStart -= 1;
      }

      if (separatorStart < titleStart) {
        return {
          url: decodeEscapes(trimAsciiWhitespace(content.slice(0, separatorStart))),
          title: decodeEscapes(content.slice(titleStart + 1, trimmedEnd - 1))
        };
      }
    }
  }

  return { url: decodeEscapes(trimAsciiWhitespace(content.slice(0, trimmedEnd))) };
}

function findTrailingQuotedSegmentStart(content: string, end: number, quote: '"' | "'"): number {
  let index = end - 2;

  while (index >= 0) {
    if (content[index] === quote && !isEscaped(content, index)) {
      return index;
    }

    index -= 1;
  }

  return -1;
}

function parseAutolink(input: string, start: number, offsets?: OffsetMap): ParsedInlineNode | null {
  let index = start + 1;

  while (index < input.length && input[index] !== ">") {
    const char = input[index];

    if (char === "<" || char === "\n" || char === " " || char === "\t") {
      return null;
    }

    index += 1;
  }

  if (index >= input.length || index === start + 1) {
    return null;
  }

  const url = input.slice(start + 1, index);

  if (!isAutolinkUrl(url)) {
    return null;
  }

  return {
    node: withRange(
      {
        type: "link",
        url,
        children: [
          createTextNode(
            url,
            offsets === undefined
              ? { start: start + 1, end: index }
              : createRange(offsets, start + 1, index)
          )
        ]
      },
      offsets === undefined ? { start, end: index + 1 } : createRange(offsets, start, index + 1)
    ),
    end: index + 1
  };
}

function parseFootnoteReference(
  input: string,
  start: number,
  footnoteLabels: ReadonlySet<string> | undefined,
  offsets?: OffsetMap
): ParsedInlineNode | null {
  if (
    footnoteLabels === undefined ||
    start + 3 >= input.length ||
    input[start] !== "[" ||
    input[start + 1] !== "^"
  ) {
    return null;
  }

  let labelEnd = start + 2;

  while (labelEnd < input.length && input[labelEnd] !== "]") {
    if (!isFootnoteLabelChar(input[labelEnd])) {
      return null;
    }

    labelEnd += 1;
  }

  if (labelEnd === start + 2 || labelEnd >= input.length) {
    return null;
  }

  const label = input.slice(start + 2, labelEnd);

  if (!footnoteLabels.has(label)) {
    return null;
  }

  return {
    node: withRange(
      { type: "footnoteReference", label },
      offsets === undefined
        ? { start, end: labelEnd + 1 }
        : createRange(offsets, start, labelEnd + 1)
    ),
    end: labelEnd + 1
  };
}

function parseLiteralAutolink(
  input: string,
  start: number,
  offsets?: OffsetMap
): ParsedInlineNode | null {
  if (!isLiteralAutolinkBoundaryBefore(input, start)) {
    return null;
  }

  const urlLiteral = parseLiteralUrlAutolink(input, start);

  if (urlLiteral !== null) {
    return createLiteralAutolinkNode(
      urlLiteral.text,
      urlLiteral.url,
      start,
      urlLiteral.end,
      offsets
    );
  }

  const wwwLiteral = parseLiteralWwwAutolink(input, start);

  if (wwwLiteral !== null) {
    return createLiteralAutolinkNode(
      wwwLiteral.text,
      `http://${wwwLiteral.text}`,
      start,
      wwwLiteral.end,
      offsets
    );
  }

  const emailLiteral = parseLiteralEmailAutolink(input, start);

  if (emailLiteral !== null) {
    return createLiteralAutolinkNode(
      emailLiteral.text,
      `mailto:${emailLiteral.text}`,
      start,
      emailLiteral.end,
      offsets
    );
  }

  return null;
}

function createLiteralAutolinkNode(
  text: string,
  url: string,
  start: number,
  end: number,
  offsets?: OffsetMap
): ParsedInlineNode {
  return {
    node: withRange(
      {
        type: "link",
        url,
        children: [
          createTextNode(
            text,
            offsets === undefined ? { start, end } : createRange(offsets, start, end)
          )
        ]
      },
      offsets === undefined ? { start, end } : createRange(offsets, start, end)
    ),
    end
  };
}

function parseLiteralUrlAutolink(
  input: string,
  start: number
): { text: string; url: string; end: number } | null {
  const hasHttp = input.startsWith("http://", start);
  const hasHttps = input.startsWith("https://", start);

  if (!hasHttp && !hasHttps) {
    return null;
  }

  const end = scanLiteralAutolinkEnd(input, start);
  const text = trimLiteralAutolinkText(input.slice(start, end));
  const prefixLength = hasHttps ? "https://".length : "http://".length;

  if (text.length <= prefixLength) {
    return null;
  }

  return { text, url: text, end: start + text.length };
}

function parseLiteralWwwAutolink(
  input: string,
  start: number
): { text: string; end: number } | null {
  if (!input.startsWith("www.", start)) {
    return null;
  }

  const end = scanLiteralAutolinkEnd(input, start);
  const text = trimLiteralAutolinkText(input.slice(start, end));

  if (!hasDotAfterPrefix(text, 4)) {
    return null;
  }

  return { text, end: start + text.length };
}

function parseLiteralEmailAutolink(
  input: string,
  start: number
): { text: string; end: number } | null {
  if (!isEmailLocalPartChar(input[start] ?? "")) {
    return null;
  }

  const end = scanLiteralAutolinkEnd(input, start);
  const text = trimLiteralAutolinkText(input.slice(start, end));

  if (!isValidLiteralEmail(text)) {
    return null;
  }

  return { text, end: start + text.length };
}

function parseInlineHtmlTag(
  input: string,
  start: number,
  offsets?: OffsetMap
): ParsedInlineNode | null {
  if (input[start] !== "<") {
    return null;
  }

  let index = start + 1;
  let closing = false;

  if (index < input.length && input[index] === "/") {
    closing = true;
    index += 1;
  }

  if (index >= input.length || !isAsciiLetter(input[index])) {
    return null;
  }

  index += 1;

  while (index < input.length && isHtmlTagNameChar(input[index])) {
    index += 1;
  }

  const tagName = input.slice(start + (closing ? 2 : 1), index).toLowerCase();

  if (!INLINE_HTML_TAGS.has(tagName)) {
    return null;
  }

  if (closing) {
    index = skipHtmlWhitespace(input, index);

    if (index >= input.length || input[index] !== ">") {
      return null;
    }

    return {
      node: withRange(
        { type: "html", value: input.slice(start, index + 1) },
        offsets === undefined ? { start, end: index + 1 } : createRange(offsets, start, index + 1)
      ),
      end: index + 1
    };
  }

  while (index < input.length) {
    index = skipHtmlWhitespace(input, index);

    if (index >= input.length) {
      return null;
    }

    if (input[index] === ">") {
      return {
        node: withRange(
          { type: "html", value: input.slice(start, index + 1) },
          offsets === undefined ? { start, end: index + 1 } : createRange(offsets, start, index + 1)
        ),
        end: index + 1
      };
    }

    if (input[index] === "/") {
      const selfClosingEnd = skipHtmlWhitespace(input, index + 1);

      if (selfClosingEnd >= input.length || input[selfClosingEnd] !== ">") {
        return null;
      }

      return {
        node: withRange(
          { type: "html", value: input.slice(start, selfClosingEnd + 1) },
          offsets === undefined
            ? { start, end: selfClosingEnd + 1 }
            : createRange(offsets, start, selfClosingEnd + 1)
        ),
        end: selfClosingEnd + 1
      };
    }

    if (!isHtmlAttributeNameStartChar(input[index])) {
      return null;
    }

    index += 1;

    while (index < input.length && isHtmlAttributeNameChar(input[index])) {
      index += 1;
    }

    index = skipHtmlWhitespace(input, index);

    if (index >= input.length || input[index] !== "=") {
      continue;
    }

    index = skipHtmlWhitespace(input, index + 1);

    if (index >= input.length) {
      return null;
    }

    const quote = input[index];

    if (quote === '"' || quote === "'") {
      index += 1;

      while (index < input.length && input[index] !== quote) {
        index += 1;
      }

      if (index >= input.length) {
        return null;
      }

      index += 1;
      continue;
    }

    while (index < input.length && !isHtmlWhitespace(input[index]) && input[index] !== ">") {
      const char = input[index];

      if (char === '"' || char === "'" || char === "<" || char === "=" || char === "`") {
        return null;
      }

      index += 1;
    }
  }

  return null;
}

function decodeEscapes(value: string): string {
  let result = "";
  let index = 0;

  while (index < value.length) {
    if (value[index] === "\\" && index + 1 < value.length && isEscapable(value[index + 1])) {
      result += value[index + 1];
      index += 2;
      continue;
    }

    result += value[index];
    index += 1;
  }

  return result;
}

function findTrailingHardBreakSpaceStart(value: string): number {
  let start = value.length;

  while (start > 0 && (value[start - 1] === " " || value[start - 1] === "\t")) {
    start -= 1;
  }

  return value.length - start >= 2 ? start : -1;
}

function readRunLength(input: string, start: number, char: string): number {
  let index = start;

  while (index < input.length && input[index] === char) {
    index += 1;
  }

  return index - start;
}

function trimAsciiWhitespace(value: string): string {
  const start = trimAsciiWhitespaceStartIndex(value);
  const end = trimAsciiWhitespaceEndIndex(value);

  return value.slice(start, end);
}

function trimAsciiWhitespaceStartIndex(value: string): number {
  let index = 0;

  while (index < value.length && isAsciiWhitespace(value[index])) {
    index += 1;
  }

  return index;
}

function trimAsciiWhitespaceEndIndex(value: string): number {
  let index = value.length;

  while (index > 0 && isAsciiWhitespace(value[index - 1])) {
    index -= 1;
  }

  return index;
}

function isAutolinkUrl(value: string): boolean {
  if (value.length < 3 || !isAsciiLetter(value[0])) {
    return false;
  }

  let index = 1;

  while (index < value.length) {
    const char = value[index];

    if (char === ":") {
      return index >= 2;
    }

    if (!isAsciiLetter(char) && !isDigit(char) && char !== "+" && char !== "." && char !== "-") {
      return false;
    }

    index += 1;
  }

  return false;
}

function scanLiteralAutolinkEnd(input: string, start: number): number {
  let index = start;

  while (index < input.length) {
    const char = input[index];

    if (char === "\n" || isAsciiWhitespace(char) || char === "<") {
      break;
    }

    index += 1;
  }

  return index;
}

function trimLiteralAutolinkText(value: string): string {
  let end = value.length;

  while (end > 0) {
    const lastChar = value[end - 1];

    if (
      lastChar === "." ||
      lastChar === "," ||
      lastChar === ":" ||
      lastChar === ";" ||
      lastChar === "!" ||
      lastChar === "?"
    ) {
      end -= 1;
      continue;
    }

    if (
      (lastChar === ")" && hasMoreClosersThanOpeners(value.slice(0, end), "(", ")")) ||
      (lastChar === "]" && hasMoreClosersThanOpeners(value.slice(0, end), "[", "]")) ||
      (lastChar === "}" && hasMoreClosersThanOpeners(value.slice(0, end), "{", "}"))
    ) {
      end -= 1;
      continue;
    }

    break;
  }

  return value.slice(0, end);
}

function hasMoreClosersThanOpeners(value: string, opener: string, closer: string): boolean {
  let balance = 0;

  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === opener) {
      balance += 1;
      continue;
    }

    if (value[index] === closer) {
      balance -= 1;
    }
  }

  return balance < 0;
}

function isLiteralAutolinkBoundaryBefore(input: string, start: number): boolean {
  if (start === 0) {
    return true;
  }

  const previous = input[start - 1];

  if (previous === "(" && start >= 2 && input[start - 2] === "]") {
    return false;
  }

  return (
    !isAsciiLetter(previous) &&
    !isDigit(previous) &&
    previous !== "_" &&
    previous !== "." &&
    previous !== "+" &&
    previous !== "-" &&
    previous !== "@" &&
    previous !== "/"
  );
}

function hasDotAfterPrefix(value: string, prefixLength: number): boolean {
  if (value.length <= prefixLength) {
    return false;
  }

  for (let index = prefixLength; index < value.length; index += 1) {
    if (value[index] === ".") {
      return true;
    }
  }

  return false;
}

function isValidLiteralEmail(value: string): boolean {
  const atIndex = value.indexOf("@");

  if (atIndex <= 0 || atIndex === value.length - 1 || value.indexOf("@", atIndex + 1) !== -1) {
    return false;
  }

  const localPart = value.slice(0, atIndex);
  const domain = value.slice(atIndex + 1);

  if (domain[0] === "." || domain[domain.length - 1] === "." || !hasDotAfterPrefix(domain, 0)) {
    return false;
  }

  for (let index = 0; index < localPart.length; index += 1) {
    if (!isEmailLocalPartChar(localPart[index])) {
      return false;
    }
  }

  for (let index = 0; index < domain.length; index += 1) {
    if (!isEmailDomainChar(domain[index])) {
      return false;
    }
  }

  return true;
}

function isEscaped(value: string, index: number): boolean {
  let slashCount = 0;
  let cursor = index - 1;

  while (cursor >= 0 && value[cursor] === "\\") {
    slashCount += 1;
    cursor -= 1;
  }

  return slashCount % 2 === 1;
}

function skipHtmlWhitespace(value: string, start: number): number {
  let index = start;

  while (index < value.length && isHtmlWhitespace(value[index])) {
    index += 1;
  }

  return index;
}

function isEscapable(value: string): boolean {
  return (
    value === "!" ||
    value === '"' ||
    value === "#" ||
    value === "$" ||
    value === "%" ||
    value === "&" ||
    value === "'" ||
    value === "(" ||
    value === ")" ||
    value === "*" ||
    value === "+" ||
    value === "," ||
    value === "-" ||
    value === "." ||
    value === "/" ||
    value === ":" ||
    value === ";" ||
    value === "<" ||
    value === "=" ||
    value === ">" ||
    value === "?" ||
    value === "@" ||
    value === "[" ||
    value === "\\" ||
    value === "]" ||
    value === "^" ||
    value === "_" ||
    value === "`" ||
    value === "{" ||
    value === "|" ||
    value === "}" ||
    value === "~"
  );
}

function isAsciiWhitespace(value: string): boolean {
  return value === " " || value === "\t";
}

function isDelimiterWhitespace(value: string | null): boolean {
  return value === null || /\s/u.test(value);
}

function isDelimiterPunctuation(value: string | null): boolean {
  return value !== null && /[\p{P}\p{S}]/u.test(value);
}

function isHtmlWhitespace(value: string): boolean {
  return value === " " || value === "\t";
}

function isAsciiLetter(value: string): boolean {
  return (value >= "a" && value <= "z") || (value >= "A" && value <= "Z");
}

function isDigit(value: string): boolean {
  return value >= "0" && value <= "9";
}

function isEmailLocalPartChar(value: string): boolean {
  return (
    isAsciiLetter(value) ||
    isDigit(value) ||
    value === "." ||
    value === "_" ||
    value === "%" ||
    value === "+" ||
    value === "-"
  );
}

function isEmailDomainChar(value: string): boolean {
  return isAsciiLetter(value) || isDigit(value) || value === "." || value === "-";
}

function isFootnoteLabelChar(value: string): boolean {
  return isAsciiLetter(value) || isDigit(value) || value === "-" || value === "_";
}

function isHtmlTagNameChar(value: string): boolean {
  return isAsciiLetter(value) || isDigit(value) || value === "-";
}

function isHtmlAttributeNameStartChar(value: string): boolean {
  return isAsciiLetter(value) || value === ":" || value === "_";
}

function isHtmlAttributeNameChar(value: string): boolean {
  return isHtmlAttributeNameStartChar(value) || isDigit(value) || value === "-" || value === ".";
}

function createRange(offsets: OffsetMap, start: number, end: number): MdRange {
  return {
    start: offsets[start] ?? offsets[offsets.length - 1] ?? 0,
    end: offsets[end] ?? offsets[offsets.length - 1] ?? 0
  };
}

function sliceOffsetMap(offsets: OffsetMap, start: number, end: number): number[] {
  return offsets.slice(start, end + 1);
}

function createOffsetMap(input: string, absoluteStart = 0): number[] {
  const offsets = new Array<number>(input.length + 1).fill(absoluteStart);
  let byteOffset = absoluteStart;
  let index = 0;

  while (index < input.length) {
    offsets[index] = byteOffset;
    const codePoint = input.codePointAt(index) ?? 0;
    const codeUnitLength = codePoint > 0xffff ? 2 : 1;
    const byteLength = codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;

    for (let offsetIndex = 1; offsetIndex < codeUnitLength; offsetIndex += 1) {
      offsets[index + offsetIndex] = byteOffset;
    }

    byteOffset += byteLength;
    index += codeUnitLength;
    offsets[index] = byteOffset;
  }

  offsets[input.length] = byteOffset;
  return offsets;
}
