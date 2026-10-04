import type {XmlElement, XmlAttribute} from "@poe-code/safe-fs/xml";

/** XML v3-v5 applies only specified style fields, including individual font fields. */
export function applyGnumericStyle(previous: XmlElement, patch: XmlElement, tick: () => void): XmlElement {
  const attributes = new Map<string, XmlAttribute>();
  for (const attribute of [...previous.attributes, ...patch.attributes]) {
    tick();
    attributes.set(JSON.stringify([attribute.namespace, attribute.localName]), attribute);
  }
  const children = new Map<string, XmlElement>();
  for (const child of previous.children) {
    tick();
    children.set(JSON.stringify([child.namespace, child.localName]), child);
  }
  for (const child of patch.children) {
    tick();
    if (patch.localName === "StyleBorder" && child.namespace === patch.namespace) {
      const style = child.attributes.find(attribute => {tick(); return attribute.namespace === "" && attribute.localName === "Style";});
      // Native ignores a side without a nonnegative border style, including color-only patches.
      if (!style || style.value.trim() === "" || !Number.isInteger(Number(style.value)) || Number(style.value) < 0) continue;
    }
    const key = JSON.stringify([child.namespace, child.localName]), prior = children.get(key);
    // Borders are independent sides; each side replaces its complete border.
    // Other complex style fields (validation, hyperlinks, conditions) replace as a unit.
    children.set(key, prior && child.namespace === patch.namespace &&
      (child.localName === "Font" || child.localName === "StyleBorder")
      ? applyGnumericStyle(prior, child, tick) : child);
  }
  const text = patch.localName === "Font" && patch.text === "" ? previous.text : patch.text;
  return {...patch, attributes: [...attributes.values()], children: [...children.values()], text,
    content: [...(text ? [{kind: "text" as const, text}] : []), ...children.values()]};
}

/** Native X11 names set weight/slant hints, never the font family. */
export function normalizeGnumericStyle(style: XmlElement, tick: () => void): XmlElement {
  const children = style.children.map(font => {
    tick();
    if (font.localName !== "Font" || font.namespace !== style.namespace || !font.text.startsWith("-")) return font;
    const offset = (component: number) => {
      let at = 0, separators = 0;
      while (at < font.text.length && separators < component) {
        tick();
        if (font.text[at++] === "-") separators++;
      }
      if (font.text[at] === "-") {tick(); at++;}
      return at;
    };
    const hints = new Set<string>();
    if (font.text.startsWith("bold", offset(2))) hints.add("Bold");
    const slant = offset(3);
    if (font.text.startsWith("i", slant) || font.text.startsWith("o", slant)) hints.add("Italic");
    const attributes = font.attributes.filter(attribute => {
      tick();
      return attribute.namespace !== "" || !hints.has(attribute.localName);
    });
    for (const name of hints) attributes.push({name, localName: name, namespace: "", value: "1"});
    return {...font, text: "", attributes, content: font.children};
  });
  return {...style, children, content: [...(style.text ? [{kind: "text" as const, text: style.text}] : []), ...children]};
}
