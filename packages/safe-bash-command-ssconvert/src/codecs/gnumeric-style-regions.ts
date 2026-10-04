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
