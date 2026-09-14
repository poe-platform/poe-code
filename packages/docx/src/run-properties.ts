import { xmlValue } from "./create-content.js";
import type { DocxOperationArguments } from "./operation-types.js";
import type { XmlElement } from "./package-xml.js";
import { UnsupportedEditError, type DocumentXmlEditor } from "./xml-write.js";

const underline = { NONE: "none", SINGLE: "single", WORDS: "words", DOUBLE: "double", DOTTED: "dotted", THICK: "thick", DASH: "dash", DOT_DASH: "dotDash", DOT_DOT_DASH: "dotDotDash", WAVY: "wave", DOTTED_HEAVY: "dottedHeavy", DASH_HEAVY: "dashedHeavy", DOT_DASH_HEAVY: "dashDotHeavy", DOT_DOT_DASH_HEAVY: "dashDotDotHeavy", WAVY_HEAVY: "wavyHeavy", DASH_LONG: "dashLong", WAVY_DOUBLE: "wavyDouble", DASH_LONG_HEAVY: "dashLongHeavy" };
const highlights = { AUTO: "none", BLACK: "black", BLUE: "blue", BRIGHT_GREEN: "green", DARK_BLUE: "darkBlue", DARK_RED: "darkRed", DARK_YELLOW: "darkYellow", GRAY_25: "lightGray", GRAY_50: "darkGray", GREEN: "darkGreen", PINK: "magenta", RED: "red", TEAL: "darkCyan", TURQUOISE: "cyan", VIOLET: "darkMagenta", WHITE: "white", YELLOW: "yellow" };
const themes = { ACCENT_1: "accent1", ACCENT_2: "accent2", ACCENT_3: "accent3", ACCENT_4: "accent4", ACCENT_5: "accent5", ACCENT_6: "accent6", BACKGROUND_1: "background1", BACKGROUND_2: "background2", DARK_1: "dark1", DARK_2: "dark2", FOLLOWED_HYPERLINK: "followedHyperlink", HYPERLINK: "hyperlink", LIGHT_1: "light1", LIGHT_2: "light2", TEXT_1: "text1", TEXT_2: "text2" };
const order = "rStyle rFonts b bCs i iCs caps smallCaps strike dstrike outline shadow emboss imprint noProof snapToGrid vanish webHidden color spacing w kern position sz szCs highlight u effect bdr shd fitText vertAlign rtl cs em lang eastAsianLayout specVanish oMath rPrChange".split(" ");
const toggles = new Set("b bCs i iCs caps smallCaps strike dstrike outline shadow emboss imprint noProof snapToGrid vanish webHidden rtl cs specVanish oMath".split(" "));
const xmlns = "http://www.w3.org/2000/xmlns/";

/** Self-contained namespace context for a run fragment moved beside its source. */
export function runElementOpen(node: XmlElement): string {
  return `<${node.name}${[...node.namespaces].filter(([prefix]) => prefix !== "xml").map(([prefix, uri]) => ` ${prefix ? "xmlns:" + prefix : "xmlns"}="${xmlValue(uri)}"`).join("")}${node.attributes.filter(a => a.namespace !== xmlns).map(a => ` ${a.name}="${xmlValue(a.value)}"`).join("")}>`;
}

/** Only supplied direct properties change; absence never resolves the style cascade. */
export function formattedRunProperties(editor: DocumentXmlEditor, run: XmlElement, options: DocxOperationArguments<"runs.set">): string {
  const w = run.namespace;
  const containers = run.children.filter(c => c.namespace === w && c.localName === "rPr");
  if (containers.length > 1) throw new UnsupportedEditError("Duplicate run property containers cannot be edited.");
  const props = containers[0];
  const patches = new Map<XmlElement, string>();
  const added: { name: string; xml: string }[] = [];
  const property = (name: string, attrs: Record<string, string | null> | null): void => {
    const matches = props?.children.filter(c => c.namespace === w && c.localName === name) ?? [];
    if (matches.length > 1) throw new UnsupportedEditError("Duplicate direct properties cannot be edited.");
    const node = matches[0];
    if (attrs === null) { if (node) patches.set(node, ""); return; }
    const old = new Map(node?.attributes.filter(a => a.namespace === w).map(a => [a.localName, a.value]));
    if (node && Object.entries(attrs).every(([key, value]) => {
      const existing = old.get(key);
      if (value === null) return existing === undefined;
      if (key === "val" && toggles.has(name)) return value === "1" ? existing === undefined || ["1", "on", "true"].includes(existing) : ["0", "off", "false"].includes(existing ?? "");
      if (key === "val" && name === "sz") return existing !== undefined && Number(existing) === Number(value);
      return existing === value;
    })) return;
    const prefix = node?.name.includes(":") ? node.name.split(":")[0]! : "fmt";
    const qualified = `${prefix}:${name}`;
    const retained = node?.attributes.filter(a => a.namespace !== xmlns && !(a.namespace === w && Object.hasOwn(attrs, a.localName))).map(a => ` ${a.name}="${xmlValue(a.value)}"`).join("") ?? "";
    const bindings = new Map(node?.namespaces ?? run.namespaces); bindings.set(prefix, w);
    const declarations = [...bindings].filter(([p]) => p !== "xml").map(([p, uri]) => ` ${p ? "xmlns:" + p : "xmlns"}="${xmlValue(uri)}"`).join("");
    const values = Object.entries(attrs).filter(([, value]) => value !== null).map(([key, value]) => ` ${prefix}:${key}="${xmlValue(value!)}"`).join("");
    const content = node ? editor.sourceXml(node, new Map(), true) : "";
    const xml = !retained && !values && !content ? "" : `<${qualified}${declarations}${retained}${values}${content ? ">" + content + `</${qualified}>` : "/>"}`;
    if (node) patches.set(node, xml); else if (xml) added.push({ name, xml });
  };
  for (const [key, name] of [["bold", "b"], ["italic", "i"], ["strike", "strike"], ["hidden", "vanish"], ["rtl", "rtl"]] as const) {
    const value = options[key];
    if (value !== undefined) property(name, value === null ? null : { val: String(Number(value)) });
  }
  if (options.underline !== undefined) property("u", options.underline === null ? null : { val: typeof options.underline === "boolean" ? options.underline ? "single" : "none" : underline[options.underline.name as keyof typeof underline] });
  if (options.highlight !== undefined) property("highlight", options.highlight === null ? null : { val: highlights[options.highlight.name as keyof typeof highlights] });
  if (options.size !== undefined) {
    const units = { emu: 1, in: 914400, cm: 360000, mm: 36000, pt: 12700 };
    property("sz", options.size === null ? null : { val: String(Math.round(Math.round(options.size.value * units[options.size.unit]) / 6350)) });
  }
  const fonts: Record<string, string | null> = {};
  if (options.font !== undefined) Object.assign(fonts, { ascii: options.font, hAnsi: options.font });
  for (const [key, attr] of [["ascii", "ascii"], ["highAnsi", "hAnsi"], ["eastAsia", "eastAsia"], ["complexScript", "cs"], ["asciiTheme", "asciiTheme"], ["highAnsiTheme", "hAnsiTheme"], ["eastAsiaTheme", "eastAsiaTheme"], ["complexScriptTheme", "cstheme"]] as const)
    if (options[key] !== undefined) fonts[attr] = options[key];
  if (Object.keys(fonts).length) property("rFonts", fonts);
  if (options.language !== undefined) property("lang", { val: options.language });
  if (options.color !== undefined) property("color", options.color === null ? null : { val: options.color.toUpperCase(), themeColor: null, themeTint: null, themeShade: null });
  if (options.themeColor !== undefined) {
    const color = props?.children.find(c => c.namespace === w && c.localName === "color");
    property("color", options.themeColor === null ? { themeColor: null, themeTint: null, themeShade: null } : {
      ...(color?.attributes.some(a => a.namespace === w && a.localName === "val") ? {} : { val: "auto" }), themeColor: themes[options.themeColor.name as keyof typeof themes]
    });
  }
  const baseline = options.baseline !== undefined ? options.baseline : options.superscript === true ? "superscript" : options.subscript === true ? "subscript"
    : options.superscript === false || options.subscript === false ? "baseline" : options.superscript === null || options.subscript === null ? null : undefined;
  if (baseline !== undefined) property("vertAlign", baseline === null ? null : { val: baseline });
  if (!patches.size && !added.length) return props ? editor.sourceXml(props) : "";
  let tail = "";
  const insertions = new Map<XmlElement, string>();
  for (const addition of added.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name))) {
    const next = props?.children.find(child => child.namespace === w && order.indexOf(child.localName) > order.indexOf(addition.name));
    if (next) insertions.set(next, (insertions.get(next) ?? "") + addition.xml);
    else tail += addition.xml;
  }
  for (const [node, markup] of insertions) patches.set(node, markup + (patches.get(node) ?? editor.sourceXml(node)));
  const content = (props ? editor.sourceXml(props, patches, true) : "") + tail;
  if (!content && (!props || props.attributes.every(a => a.namespace === xmlns))) return "";
  return props ? runElementOpen(props) + content + `</${props.name}>` : `<fmt:rPr xmlns:fmt="${xmlValue(w)}">${content}</fmt:rPr>`;
}

/** Conservative direct-property identity; unknown content and lexical trivia prohibit merging. */
export function equivalentRunKey(run: XmlElement): string | undefined {
  const w = run.namespace;
  if (run.content.some(c => c.kind !== "element") || run.children.some(c => c.namespace !== w || !["rPr", "t", "tab", "br", "cr", "noBreakHyphen", "softHyphen"].includes(c.localName))) return undefined;
  if (run.children.some(c => c.localName !== "rPr" && c.content.some(child => child.kind !== "text"))) return undefined;
  const props = run.children.filter(c => c.localName === "rPr");
  if (props.length > 1 || props.some(p => p.content.some(c => c.kind !== "element") || p.children.some(c => c.namespace !== w || c.content.length || !order.includes(c.localName)))) return undefined;
  const attributes = (node: XmlElement, toggle = false) => {
    const attrs = node.attributes.filter(a => a.namespace !== xmlns).map(a => [a.namespace, a.localName, toggle && a.namespace === w && a.localName === "val" ? ["0", "off", "false"].includes(a.value) ? "0" : ["1", "on", "true"].includes(a.value) ? "1" : a.value : a.value]);
    if (toggle && !attrs.some(a => a[0] === w && a[1] === "val")) attrs.push([w, "val", "1"]);
    return attrs.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  };
  const children = props[0]?.children ?? [];
  if (new Set(children.map(c => c.localName)).size !== children.length) return undefined;
  return JSON.stringify([attributes(run), props[0] ? attributes(props[0]) : [], children.map(c => [c.localName, attributes(c, toggles.has(c.localName))]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))]);
}
