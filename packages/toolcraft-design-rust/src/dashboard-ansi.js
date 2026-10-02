import {createRequire} from "node:module";
import {createTerminalStringFilter} from "./index.js";
import {graphemes} from "./graphemes.js";
export {plainTerminalText} from "./terminal.js";

const native = createRequire(import.meta.url)("./toolcraft-design-rust.node");
const fields = native.designAnsiStyleFields();

export function hasAnsi(text) {
  return text.includes("\u001b");
}

export function parseAnsi(text, baseStyle) {
  text = createTerminalStringFilter().push(text);
  const values = [], properties = [];
  for (const name of fields) {
    if (baseStyle?.[name] === undefined) continue;
    const value = baseStyle[name];
    values.push(value);
    const property = {name, kind: 4};
    if (value === undefined) property.kind = 0;
    else if (typeof value === "string") { property.kind = 1; property.text = value; }
    else if (typeof value === "boolean") { property.kind = 2; property.enabled = value; }
    else if (typeof value === "number") { property.kind = 3; property.number = value; }
    properties.push(property);
  }
  let failed = false, failure;
  const segment = text => {
    try { return {segments: graphemes(text), error: false}; }
    catch (error) { failed = true; failure = error; return {segments: [], error: true}; }
  };
  try {
    return native.designAnsiLines(text, properties, segment).map(line => ({
      segments: line.segments.map(segment => ({
        text: segment.text,
        style: Object.fromEntries(segment.properties.map(property => [property.name,
          property.baseIndex != null ? values[property.baseIndex] : property.text ?? property.enabled
        ]))
      }))
    }));
  } catch (error) {
    if (failed) throw failure;
    throw error;
  }
}
