import {
  ascii,
  integer,
  parseMap,
  metadataText,
  glyphName,
  macRoman,
  standardEncoding,
  winAnsi
} from "./font-mapping.js";
import type { PdfUnicodeMap, PdfUnicodeSource } from "./font-mapping.js";
export { parseToUnicode } from "./font-mapping.js";
export type { PdfUnicodeMap, PdfUnicodeSource } from "./font-mapping.js";
import { embeddedUnicodeCmap } from "./font-cmap.js";
import { SyntaxReader, resolvePdfReference } from "./syntax.js";
import type { PdfObject, PdfParseOptions } from "./syntax.js";

export type PdfMatrix = [number, number, number, number, number, number];
export interface PdfTextOptions extends PdfParseOptions {
  lookup?: (reference: PdfObject) => PdfObject;
  stream?: (reference: PdfObject) => Uint8Array;
  maxMappings?: number;
  normalization?: "preserve" | "NFC" | "NFKC";
}
export interface PdfTextDiagnostic {
  code:
    | "UNKNOWN_GLYPH"
    | "UNKNOWN_WIDTH"
    | "UNSUPPORTED_FONT"
    | "UNSUPPORTED_OPERATOR"
    | "UNCLOSED_MARKED_CONTENT";
  offset: number;
  detail: string;
}
export interface PdfGlyph {
  rawCode: number;
  codeBytes: Uint8Array;
  cid: number | undefined;
  glyphId: number | undefined;
  width: number | undefined;
  unicode: string | undefined;
  unicodeSource: PdfUnicodeSource | undefined;
  glyphName: string | undefined;
  renderingMode: number;
  mapping: "ToUnicode" | "encoding" | "glyph-name" | "embedded-cmap" | "unknown";
  origin: [number, number] | undefined;
  advance: [number, number] | undefined;
  matrix: PdfMatrix | undefined;
  font: PdfObject;
  source: {
    string: PdfObject;
    operator: string;
    start: number;
    end: number;
    stringStart: number;
    byteOffset: number;
    formPath: PdfObject[];
    contentStream?: PdfObject;
    streamStringStart?: number;
  };
}
export interface PdfTextResult {
  text: string;
  glyphs: PdfGlyph[];
  replacements: {
    text: string;
    glyphStart: number;
    glyphEnd: number;
    start: number;
    end: number;
    raw: PdfObject;
  }[];
  diagnostics: PdfTextDiagnostic[];
  normalization: "preserve" | "NFC" | "NFKC";
  contentStreams: { reference: PdfObject; start: number; end: number }[];
}
const identity = (): PdfMatrix => [1, 0, 0, 1, 0, 0];
function multiply(a: PdfMatrix, b: PdfMatrix): PdfMatrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5]
  ];
}
interface Font {
  glyphIds: boolean;
  metricsKnown: boolean;
  raw: PdfObject;
  map: PdfUnicodeMap | undefined;
  cid: boolean;
  vertical: boolean;
  names: Map<number, string>;
  encoding: string;
  widths: Map<number, number>;
  defaultWidth: number | undefined;
  embedded: Map<number, string | undefined> | undefined;
  gidBytes: Uint8Array | undefined;
  codeMap: PdfUnicodeMap | undefined;
  verticalWidths: Map<number, [number, number, number]>;
  defaultVertical: [number, number];
}
interface State {
  positionKnown: boolean;
  lineKnown: boolean;
  ctm: PdfMatrix;
  tm: PdfMatrix;
  line: PdfMatrix;
  font: Font | undefined;
  size: number;
  char: number;
  word: number;
  scale: number;
  leading: number;
  rise: number;
  rendering: number;
}
/** Source-order extraction. No host fonts, assets, bidi or layout guessing. */
export function interpretPdfText(
  bytes: Uint8Array,
  resources: PdfObject | undefined,
  options: PdfTextOptions = {}
): PdfTextResult {
  const owner = new SyntaxReader(bytes, options, undefined, true);
  return interpretPdfTextOwned(owner, resources, options);
}
export function interpretPdfTextOwned(
  owner: SyntaxReader,
  resources: PdfObject | undefined,
  options: PdfTextOptions
): PdfTextResult {
  const normalization = options.normalization ?? "preserve";
  if (!["preserve", "NFC", "NFKC"].includes(normalization))
    owner.fail("ARGUMENT", "invalid normalization policy");
  if (
    options.maxMappings !== undefined &&
    (!Number.isSafeInteger(options.maxMappings) || options.maxMappings < 0)
  )
    owner.fail("ARGUMENT", "invalid mapping limit");
  const result: PdfTextResult = {
    text: "",
    glyphs: [],
    replacements: [],
    diagnostics: [],
    normalization,
    contentStreams: []
  };
  const resolve = (o: PdfObject): PdfObject =>
    resolvePdfReference(
      o,
      (ref) => {
        owner.charge();
        owner.reserve(80);
        if (!options.lookup) owner.fail("REFERENCE", "missing object capability");
        return options.lookup(ref);
      },
      { maxReferences: owner.limits.nesting, ...(options.signal ? { signal: options.signal } : {}) }
    );
  const name = (o: PdfObject | undefined): string =>
    o?.kind === "name" ? ascii(o.bytes!, owner) : "";
  const field = (o: PdfObject | undefined, k: string): PdfObject | undefined => {
    if (!o) return undefined;
    o = resolve(o);
    for (const e of o.entries ?? []) {
      owner.charge();
      if (name(e.key) === k) return e.value;
    }
    return undefined;
  };
  const number = (o: PdfObject | undefined, fallback?: number): number => {
    if (!o && fallback !== undefined) return fallback;
    if (o) o = resolve(o);
    if (o?.kind !== "number" || typeof o.value !== "number" || !Number.isFinite(o.value))
      owner.fail("SYNTAX", "expected text number");
    return o.value;
  };
  const list = (o: PdfObject | undefined): PdfObject[] => {
    if (!o) return [];
    o = resolve(o);
    if (o.kind !== "array") owner.fail("SYNTAX", "expected array");
    return o.items!;
  };
  const stream = (ref: PdfObject): Uint8Array => {
    owner.check();
    if (!options.stream) owner.fail("REFERENCE", "missing stream capability");
    const data = options.stream(ref);
    owner.check();
    return data;
  };
  const diagnostic = (code: PdfTextDiagnostic["code"], offset: number, detail: string) => {
    owner.reserve(100 + detail.length * 2);
    result.diagnostics.push({ code, offset, detail });
  };
  const fonts = new Map<PdfObject, Font>();
  const loadFont = (ref: PdfObject): Font => {
    const raw = resolve(ref);
    const cached = fonts.get(raw);
    if (cached) return cached;
    owner.reserve(512);
    const subtype = name(field(raw, "Subtype"));
    const cid = subtype === "Type0";
    let metrics = raw;
    if (cid) {
      metrics = resolve(
        list(field(raw, "DescendantFonts"))[0] ?? owner.fail("SYNTAX", "missing CID font")
      );
    }
    const enc = field(raw, "Encoding");
    if (cid && !enc) owner.fail("SYNTAX", "missing Type0 Encoding");
    let encoding = name(enc ? resolve(enc) : undefined);
    if (!enc && !cid) {
      const base = name(field(raw, "BaseFont"));
      encoding =
        subtype === "Type1" &&
        [
          "Helvetica",
          "Helvetica-Bold",
          "Helvetica-Oblique",
          "Helvetica-BoldOblique",
          "Times-Roman",
          "Times-Bold",
          "Times-Italic",
          "Times-BoldItalic",
          "Courier",
          "Courier-Bold",
          "Courier-Oblique",
          "Courier-BoldOblique"
        ].includes(base)
          ? "StandardEncoding"
          : "Unknown";
    }
    if (
      cid &&
      enc &&
      resolve(enc).kind === "name" &&
      encoding !== "Identity-H" &&
      encoding !== "Identity-V"
    )
      owner.fail("UNSUPPORTED", "unbundled CID CMap");
    if (!["Type1", "TrueType", "Type0"].includes(subtype))
      diagnostic("UNSUPPORTED_FONT", raw.start, subtype);
    const f: Font = {
      glyphIds: cid && name(field(metrics, "Subtype")) === "CIDFontType2",
      metricsKnown: ["Type1", "TrueType", "Type0"].includes(subtype),
      codeMap: undefined,
      verticalWidths: new Map(),
      defaultVertical: [880, -1000],
      embedded: undefined,
      gidBytes: undefined,
      raw,
      map: undefined,
      cid,
      vertical: encoding === "Identity-V",
      names: new Map(),
      encoding,
      widths: new Map(),
      defaultWidth: cid ? number(field(metrics, "DW"), 1000) : undefined
    };
    const unicode = field(raw, "ToUnicode");
    if (unicode) f.map = parseMap(owner.fork(stream(unicode), true), options.maxMappings ?? 65536);
    const descriptor = field(metrics, "FontDescriptor");
    const fontFile = field(descriptor, "FontFile2");
    if (fontFile && f.glyphIds && !f.map)
      f.embedded = embeddedUnicodeCmap(stream(fontFile), owner, options.maxMappings ?? 65536);
    if (f.glyphIds) {
      const gid = field(metrics, "CIDToGIDMap");
      if (gid && resolve(gid).kind !== "name") {
        const data = owner.fork(stream(gid)).data;
        if (data.length % 2) owner.fail("SYNTAX", "CIDToGIDMap length");
        f.gidBytes = data;
      } else if (gid && name(resolve(gid)) !== "Identity") owner.fail("SYNTAX", "CIDToGIDMap name");
    }
    const missingWidth = field(descriptor, "MissingWidth");
    if (!cid && missingWidth) f.defaultWidth = number(missingWidth);
    if (cid && enc && resolve(enc).kind !== "name") {
      f.codeMap = parseMap(owner.fork(stream(enc), true), options.maxMappings ?? 65536);
      f.vertical = f.codeMap.vertical;
    }
    if (
      !cid &&
      !["", "StandardEncoding", "WinAnsiEncoding", "MacRomanEncoding"].includes(f.encoding)
    )
      diagnostic("UNSUPPORTED_FONT", raw.start, "unsupported base encoding " + f.encoding);
    if (!cid) {
      if (enc && resolve(enc).kind === "dictionary") {
        f.encoding = name(field(enc, "BaseEncoding")) || "Unknown";
        let code = -1;
        for (const item of list(field(enc, "Differences"))) {
          owner.charge();
          if (item.kind === "number") {
            code = number(item);
            if (!Number.isSafeInteger(code) || code < 0 || code > 255)
              owner.fail("SYNTAX", "Differences index");
          } else {
            if (item.kind !== "name" || code < 0 || code > 255)
              owner.fail("SYNTAX", "Differences glyph");
            owner.reserve(80);
            f.names.set(code++, name(item));
          }
        }
      }
      let code = number(field(raw, "FirstChar"), 0);
      for (const w of list(field(raw, "Widths"))) {
        owner.charge();
        if (!Number.isSafeInteger(code) || code < 0 || code > 255)
          owner.fail("SYNTAX", "width index");
        owner.reserve(40);
        f.widths.set(code++, number(w));
      }
    } else {
      const ws = list(field(metrics, "W"));
      for (let i = 0; i < ws.length; ) {
        const start = number(ws[i++]);
        if (!Number.isSafeInteger(start) || start < 0 || start > 65535)
          owner.fail("SYNTAX", "CID width index");
        const v = ws[i++];
        if (!v) owner.fail("SYNTAX", "CID widths");
        if (v.kind === "array") {
          if (v.items!.length > 65536 - start) owner.fail("SYNTAX", "CID width range");
          for (let j = 0; j < v.items!.length; j++) {
            owner.charge();
            owner.reserve(40);
            f.widths.set(start + j, number(v.items![j]));
          }
        } else {
          const end = number(v),
            width = number(ws[i++]);
          if (!Number.isSafeInteger(end) || end < start || end > 65535)
            owner.fail("SYNTAX", "CID width range");
          for (let j = start; j <= end; j++) {
            owner.charge();
            owner.reserve(40);
            f.widths.set(j, width);
          }
        }
      }
    }
    if (f.vertical) {
      const defaults = list(field(metrics, "DW2"));
      if (defaults.length) {
        if (defaults.length !== 2) owner.fail("SYNTAX", "DW2 length");
        f.defaultVertical = [number(defaults[0]), number(defaults[1])];
      }
      const ws = list(field(metrics, "W2"));
      for (let i = 0; i < ws.length; ) {
        const start = number(ws[i++]);
        if (!Number.isSafeInteger(start) || start < 0 || start > 65535)
          owner.fail("SYNTAX", "W2 index");
        const next = ws[i++];
        if (!next) owner.fail("SYNTAX", "W2 missing");
        if (next.kind === "array") {
          if (next.items!.length % 3 || next.items!.length / 3 > 65536 - start)
            owner.fail("SYNTAX", "W2 array");
          for (let j = 0; j < next.items!.length; j += 3) {
            owner.charge();
            owner.reserve(64);
            f.verticalWidths.set(start + j / 3, [
              number(next.items![j]),
              number(next.items![j + 1]),
              number(next.items![j + 2])
            ]);
          }
        } else {
          const end = number(next),
            w = number(ws[i++]),
            x = number(ws[i++]),
            y = number(ws[i++]);
          if (!Number.isSafeInteger(end) || end < start || end > 65535)
            owner.fail("SYNTAX", "W2 range");
          for (let c = start; c <= end; c++) {
            owner.charge();
            owner.reserve(64);
            f.verticalWidths.set(c, [w, x, y]);
          }
        }
      }
    }
    fonts.set(raw, f);
    return f;
  };
  let state: State = {
    positionKnown: true,
    lineKnown: true,
    ctm: identity(),
    tm: identity(),
    line: identity(),
    font: undefined,
    size: 0,
    char: 0,
    word: 0,
    scale: 1,
    leading: 0,
    rise: 0,
    rendering: 0
  };
  let inText = false;
  const scopes: {
    actual: string | undefined;
    raw: PdfObject | undefined;
    start: number;
    glyphStart: number;
    textStart: number;
  }[] = [];
  const emit = (s: string) => {
    owner.reserve(s.length * 2);
    result.text += s;
  };
  const translate = (x: number, y: number) => {
    owner.reserve(48);
    state.tm = multiply(state.tm, [1, 0, 0, 1, x, y]);
  };
  const moveLine = (x: number, y: number) => {
    state.positionKnown = state.lineKnown;
    state.line = multiply(state.line, [1, 0, 0, 1, x, y]);
    state.tm = [...state.line];
    owner.reserve(96);
  };
  const draw = (o: PdfObject, operator: string, start: number, end: number, path: PdfObject[]) => {
    if (!inText || !state.font) owner.fail("SYNTAX", "text shown without BT/font");
    if (o.kind !== "string") owner.fail("SYNTAX", "expected text string");
    const f = state.font;
    const b = o.bytes!;
    for (let i = 0; i < b.length; ) {
      owner.charge();
      const byteOffset = i;
      let length = f.cid ? 2 : 1;
      const spaces = f.codeMap?.codeSpaces;
      if (spaces?.length) {
        length = 0;
        for (const space of spaces) {
          owner.charge();
          if (i + space.length > b.length) continue;
          let v = 0;
          for (let j = 0; j < space.length; j++) {
            owner.charge();
            v = v * 256 + b[i + j]!;
          }
          if (v >= space.low && v <= space.high) {
            length = space.length;
            break;
          }
        }
        if (!length) owner.fail("SYNTAX", "code outside ToUnicode code space");
      }
      if (i + length > b.length) owner.fail("SYNTAX", "truncated font code");
      owner.reserve(320 + length + path.length * 8);
      const codeBytes = b.slice(i, i + length),
        code = integer(codeBytes, owner);
      i += length;
      const cid = f.cid
        ? f.codeMap
          ? f.codeMap.cidMapping.get(`${length}:${code}`)
          : code
        : undefined;
      const glyphId =
        f.glyphIds && cid !== undefined
          ? f.gidBytes
            ? cid * 2 + 1 < f.gidBytes.length
              ? f.gidBytes[cid * 2]! * 256 + f.gidBytes[cid * 2 + 1]!
              : 0
            : cid
          : undefined;
      let unicode: string | undefined;
      let mapping: PdfGlyph["mapping"] = "unknown";
      if (f.map) {
        unicode = f.map.mapping.get(`${length}:${code}`);
        if (unicode !== undefined) mapping = "ToUnicode";
      } else if (f.embedded && f.cid && cid !== undefined) {
        unicode = glyphId !== undefined ? f.embedded.get(glyphId) : undefined;
        if (unicode !== undefined) mapping = "embedded-cmap";
      } else if (f.names.has(code)) {
        unicode = glyphName(f.names.get(code)!, owner);
        if (unicode !== undefined) mapping = "glyph-name";
      } else if (
        !f.cid &&
        ["", "StandardEncoding", "WinAnsiEncoding", "MacRomanEncoding"].includes(f.encoding)
      ) {
        if (
          (f.encoding === "StandardEncoding" || f.encoding === "") &&
          standardEncoding[code] !== undefined
        )
          unicode = standardEncoding[code];
        else if (code >= 32 && code <= 126) unicode = String.fromCharCode(code);
        else if (f.encoding === "MacRomanEncoding" && code >= 128) unicode = macRoman[code - 128];
        else if (f.encoding === "WinAnsiEncoding")
          unicode = winAnsi[code] ?? (code >= 160 ? String.fromCharCode(code) : undefined);
        if (unicode !== undefined) mapping = "encoding";
      }
      if (unicode === undefined) diagnostic("UNKNOWN_GLYPH", o.start, `unmapped code ${code}`);
      const width =
        f.metricsKnown && (!f.cid || cid !== undefined)
          ? (f.widths.get(cid ?? code) ?? f.defaultWidth)
          : undefined;
      if (width === undefined)
        diagnostic("UNKNOWN_WIDTH", o.start, `missing width for code ${code}`);
      const vertical = f.verticalWidths.get(cid ?? code) ?? [
        f.defaultVertical[1],
        (width ?? 0) / 2,
        f.defaultVertical[0]
      ];
      const dx =
        (((width ?? 0) / 1000) * state.size +
          state.char +
          (length === 1 && code === 32 ? state.word : 0)) *
        state.scale;
      const matrix = multiply(
        state.ctm,
        multiply(state.tm, [
          state.size * state.scale,
          0,
          0,
          state.size,
          f.vertical ? ((-vertical[1]! * state.size) / 1000) * state.scale : 0,
          state.rise - (f.vertical ? (vertical[2]! * state.size) / 1000 : 0)
        ])
      );
      if (!matrix.every(Number.isFinite) || !Number.isFinite(dx))
        owner.fail("SYNTAX", "text geometry overflow");
      const basis = multiply(state.ctm, state.tm);
      const dy =
        (vertical[0]! / 1000) * state.size +
        state.char +
        (length === 1 && code === 32 ? state.word : 0);
      const advance: [number, number] = f.vertical
        ? [basis[2] * dy + 0, basis[3] * dy + 0]
        : [basis[0] * dx + 0, basis[1] * dx + 0];
      if (!advance.every(Number.isFinite)) owner.fail("SYNTAX", "text advance overflow");
      result.glyphs.push({
        rawCode: code,
        codeBytes,
        cid,
        glyphId,
        width,
        unicode,
        unicodeSource: f.map?.sources.get(`${length}:${code}`),
        glyphName: f.names.get(code),
        renderingMode: state.rendering,
        mapping,
        origin: state.positionKnown ? [matrix[4], matrix[5]] : undefined,
        advance: width !== undefined ? advance : undefined,
        matrix: state.positionKnown ? matrix : undefined,
        font: f.raw,
        source: {
          string: o,
          operator,
          start,
          end,
          stringStart: o.start,
          byteOffset,
          formPath: [...path]
        }
      });
      if (unicode !== undefined) emit(unicode);
      translate(f.vertical ? 0 : dx, f.vertical ? dy : 0);
      if (width === undefined) state.positionKnown = false;
    }
  };
  const active = new Set<PdfObject>();
  const execute = (
    r: SyntaxReader,
    res: PdfObject | undefined,
    path: PdfObject[],
    depth: number
  ) => {
    if (depth > owner.limits.nesting) owner.fail("LIMIT", "XObject recursion limit");
    const stack: State[] = [];
    const scopeBase = scopes.length;
    const operands: PdfObject[] = [];
    while (r.peek().type !== "EOF") {
      owner.charge();
      const t = r.peek();
      if (t.object || t.type === "[" || t.type === "<<") {
        owner.reserve(8);
        operands.push(r.object());
        continue;
      }
      r.take();
      const op = t.type;
      const count = (n: number) => {
        if (operands.length !== n) r.fail("SYNTAX", `invalid ${op} operands`);
      };
      const nums = (n: number): number[] => {
        count(n);
        return operands.map((o) => number(o));
      };
      switch (op) {
        case "q":
          count(0);
          if (stack.length >= owner.limits.nesting) r.fail("LIMIT", "graphics stack limit");
          owner.reserve(320);
          stack.push({ ...state, ctm: [...state.ctm], tm: [...state.tm], line: [...state.line] });
          break;
        case "Q":
          count(0);
          if (!stack.length) r.fail("SYNTAX", "graphics stack underflow");
          {
            const tm = state.tm,
              line = state.line,
              positionKnown = state.positionKnown,
              lineKnown = state.lineKnown;
            state = stack.pop()!;
            state.tm = tm;
            state.line = line;
            state.positionKnown = positionKnown;
            state.lineKnown = lineKnown;
          }
          break;
        case "gs": {
          count(1);
          const gs = field(field(res, "ExtGState"), name(operands[0]));
          if (!gs) r.fail("REFERENCE", "missing graphics state");
          const selection = field(gs, "Font");
          if (selection) {
            const values = list(selection);
            if (values.length !== 2) r.fail("SYNTAX", "graphics font selection");
            state.font = loadFont(values[0]!);
            state.size = number(values[1]);
          }
          break;
        }
        case "cm":
          state.ctm = multiply(state.ctm, nums(6) as PdfMatrix);
          break;
        case "BT":
          count(0);
          if (inText) r.fail("SYNTAX", "nested BT");
          inText = true;
          state.tm = identity();
          state.line = identity();
          state.positionKnown = true;
          state.lineKnown = true;
          break;
        case "ET":
          count(0);
          if (!inText) r.fail("SYNTAX", "ET outside BT");
          inText = false;
          break;
        case "Tf":
          count(2);
          {
            const ref = field(field(res, "Font"), name(operands[0]));
            if (!ref) r.fail("REFERENCE", "missing font resource");
            state.font = loadFont(ref);
            state.size = number(operands[1]);
          }
          break;
        case "Tm":
          state.tm = nums(6) as PdfMatrix;
          state.line = [...state.tm];
          state.positionKnown = true;
          state.lineKnown = true;
          break;
        case "Td":
          {
            const [x, y] = nums(2);
            moveLine(x!, y!);
          }
          break;
        case "TD":
          {
            const [x, y] = nums(2);
            state.leading = -y!;
            moveLine(x!, y!);
          }
          break;
        case "T*":
          count(0);
          moveLine(0, -state.leading);
          break;
        case "Tc":
          state.char = nums(1)[0]!;
          break;
        case "Tw":
          state.word = nums(1)[0]!;
          break;
        case "Tz":
          state.scale = nums(1)[0]! / 100;
          break;
        case "TL":
          state.leading = nums(1)[0]!;
          break;
        case "Ts":
          state.rise = nums(1)[0]!;
          break;
        case "Tr":
          state.rendering = nums(1)[0]!;
          if (!Number.isInteger(state.rendering) || state.rendering < 0 || state.rendering > 7)
            r.fail("SYNTAX", "text rendering mode");
          break;
        case "Tj":
          count(1);
          draw(operands[0]!, op, t.start, t.end, path);
          break;
        case "'":
          count(1);
          moveLine(0, -state.leading);
          draw(operands[0]!, op, t.start, t.end, path);
          break;
        case '"':
          count(3);
          state.word = number(operands[0]);
          state.char = number(operands[1]);
          moveLine(0, -state.leading);
          draw(operands[2]!, op, t.start, t.end, path);
          break;
        case "TJ":
          count(1);
          for (const item of list(operands[0])) {
            owner.charge();
            if (item.kind === "number") {
              const offset = (-number(item) / 1000) * state.size;
              translate(
                state.font?.vertical ? 0 : offset * state.scale,
                state.font?.vertical ? offset : 0
              );
            } else draw(item, op, t.start, t.end, path);
          }
          break;
        case "BMC":
        case "BDC": {
          count(op === "BMC" ? 1 : 2);
          if (operands[0]?.kind !== "name") r.fail("SYNTAX", "marked content tag");
          if (scopes.length >= owner.limits.nesting) r.fail("LIMIT", "marked content stack limit");
          let prop = operands[1];
          if (prop?.kind === "name") prop = field(field(res, "Properties"), name(prop));
          const actual = field(prop, "ActualText");
          let text: string | undefined;
          if (actual) {
            const a = resolve(actual);
            if (a.kind === "string") text = metadataText(a.bytes!, owner);
          }
          owner.reserve(80);
          scopes.push({
            raw: actual ? resolve(actual) : undefined,
            actual: text,
            start: t.start,
            glyphStart: result.glyphs.length,
            textStart: result.text.length
          });
          break;
        }
        case "EMC": {
          count(0);
          if (scopes.length <= scopeBase) r.fail("SYNTAX", "marked content stack underflow");
          const s = scopes.pop()!;
          if (s.actual !== undefined && result.glyphs.length > s.glyphStart) {
            result.text = result.text.slice(0, s.textStart);
            emit(s.actual);
            owner.reserve(80);
            result.replacements.push({
              text: s.actual,
              glyphStart: s.glyphStart,
              glyphEnd: result.glyphs.length,
              start: s.start,
              end: t.end,
              raw: s.raw!
            });
          }
          break;
        }
        case "Do": {
          count(1);
          const ref = field(field(res, "XObject"), name(operands[0]));
          if (!ref) r.fail("REFERENCE", "missing XObject");
          const raw = resolve(ref);
          if (name(field(raw, "Subtype")) !== "Form") break;
          if (active.has(raw)) r.fail("LIMIT", "recursive XObject cycle");
          const saved = state,
            savedText = inText;
          owner.reserve(320 + path.length * 8);
          state = { ...state, ctm: [...state.ctm], tm: [...state.tm], line: [...state.line] };
          const m = field(raw, "Matrix");
          if (m) {
            const values = list(m);
            if (values.length !== 6) r.fail("SYNTAX", "form matrix");
            state.ctm = multiply(state.ctm, values.map((o) => number(o)) as PdfMatrix);
          }
          active.add(raw);
          inText = false;
          execute(
            owner.fork(stream(ref), true),
            field(raw, "Resources") ?? res,
            [...path, ref],
            depth + 1
          );
          if (inText) r.fail("SYNTAX", "unclosed BT in form");
          active.delete(raw);
          state = saved;
          inText = savedText;
          break;
        }
        case "BI":
          r.fail("UNSUPPORTED", "inline image tokenization is a separate gate");
          break;
        default:
          if (
            ![
              "w",
              "J",
              "j",
              "M",
              "d",
              "ri",
              "i",
              "m",
              "l",
              "c",
              "v",
              "y",
              "h",
              "re",
              "S",
              "s",
              "f",
              "F",
              "f*",
              "B",
              "B*",
              "b",
              "b*",
              "n",
              "W",
              "W*",
              "CS",
              "cs",
              "SC",
              "SCN",
              "sc",
              "scn",
              "G",
              "g",
              "RG",
              "rg",
              "K",
              "k",
              "MP",
              "DP",
              "BX",
              "EX",
              "d0",
              "d1"
            ].includes(op)
          )
            diagnostic("UNSUPPORTED_OPERATOR", t.start, op);
      }
      owner.reserve(48);
      if (!state.ctm.every(Number.isFinite) || !state.tm.every(Number.isFinite))
        r.fail("SYNTAX", "matrix overflow");
      operands.length = 0;
    }
    if (operands.length) r.fail("SYNTAX", "trailing content operands");
    if (stack.length) r.fail("SYNTAX", "unclosed graphics stack");
    while (scopes.length > scopeBase) {
      const s = scopes.pop()!;
      diagnostic("UNCLOSED_MARKED_CONTENT", s.start, "unclosed scope; glyph text retained");
    }
  };
  execute(owner, resources, [], 0);
  if (inText) owner.fail("SYNTAX", "unclosed BT");
  if (normalization !== "preserve") {
    owner.charge(result.text.length);
    owner.reserve(result.text.length * 36);
    result.text = result.text.normalize(normalization);
  }
  return result;
}

export interface PdfContentOperator {
  operator: string;
  operands: PdfObject[];
  start: number;
  end: number;
}
export function tokenizePdfContent(
  bytes: Uint8Array,
  options: PdfParseOptions = {}
): PdfContentOperator[] {
  const r = new SyntaxReader(bytes, options, undefined, true);
  const operators: PdfContentOperator[] = [];
  let operands: PdfObject[] = [];
  while (r.peek().type !== "EOF") {
    r.charge();
    const t = r.peek();
    if (t.object || t.type === "[" || t.type === "<<") {
      r.reserve(8);
      operands.push(r.object());
      continue;
    }
    r.take();
    if (t.type === "BI") r.fail("UNSUPPORTED", "inline image tokenization is a separate gate");
    r.reserve(80);
    r.countObject();
    operators.push({ operator: t.type, operands, start: t.start, end: t.end });
    operands = [];
  }
  if (operands.length) r.fail("SYNTAX", "trailing content operands");
  return operators;
}
