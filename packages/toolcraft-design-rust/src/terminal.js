import { createRequire } from "node:module";
import { types } from "node:util";
const native = createRequire(import.meta.url)("./toolcraft-design-rust.node"),
  segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" }),
  originalCharCodeAt = String.prototype.charCodeAt;
function simpleGraphemes(value) {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if ((code < 32 || code > 126) && code !== 9 && code !== 10 && (code < 0x4e00 || code > 0x9fff))
      return false;
  }
  return true;
}
export function graphemes(value) {
  return simpleGraphemes(value)
    ? value.split("")
    : Array.from(segmenter.segment(value), ({ segment }) => segment);
}
export const graphemeWidth = native.designGraphemeWidth;
export function displayWidth(value, start = 0) {
  return native.designDisplayWidth(graphemes(value), start);
}
export function expandTabs(value, start = 0) {
  return value.includes("\t") ? native.designExpandTabs(graphemes(value), start) : value;
}
export function truncateToWidth(value, width) {
  if (width <= 0) return "";
  if (native.designDisplayWidth(graphemes(value), 0) <= width) return value;
  return native.designTruncateWidth(graphemes(value), width);
}
export function plainTerminalText(value) {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if ((code < 32 && code !== 9) || (code >= 127 && code <= 159)) {
      let failed = false,
        failure;
      const segment = (text) => {
        try {
          return { segments: graphemes(text), error: false };
        } catch (error) {
          failed = true;
          failure = error;
          return { segments: [], error: true };
        }
      };
      try {
        return native.designPlainTerminalText(value, segment);
      } catch (error) {
        if (failed) throw failure;
        throw error;
      }
    }
  }
  return value;
}
export function formatAgentPlan(entries) {
  let failed = false,
    failure;
  const read = (index, content) => {
      try {
        return { text: content ? entries[index].content : entries[index].status, error: false };
      } catch (error) {
        failed = true;
        failure = error;
        return { text: "", error: true };
      }
    },
    segment = (text) => {
      try {
        return { segments: graphemes(text), error: false };
      } catch (error) {
        failed = true;
        failure = error;
        return { segments: [], error: true };
      }
    };
  try {
    if (
      Object.getOwnPropertyDescriptor(String.prototype, "charCodeAt")?.value ===
        originalCharCodeAt &&
      Array.isArray(entries) &&
      !types.isProxy(entries) &&
      Object.getPrototypeOf(entries) === Array.prototype &&
      !["filter", "findIndex", "entries"].some((name) => Object.hasOwn(entries, name))
    ) {
      const snapshots = [];
      let plain = true;
      for (let i = 0; i < entries.length; i++) {
        const slot = Object.getOwnPropertyDescriptor(entries, String(i));
        const entry = slot?.value;
        if (
          !slot ||
          !Object.hasOwn(slot, "value") ||
          !entry ||
          typeof entry !== "object" ||
          types.isProxy(entry)
        ) {
          plain = false;
          break;
        }
        const status = Object.getOwnPropertyDescriptor(entry, "status"),
          content = Object.getOwnPropertyDescriptor(entry, "content");
        if (
          typeof status?.value !== "string" ||
          typeof content?.value !== "string" ||
          !simpleGraphemes(content.value)
        ) {
          plain = false;
          break;
        }
        snapshots.push({ status: status.value, content: content.value });
      }
      if (plain) return native.designAgentPlanSnapshot(snapshots, segment);
    }
    return native.designAgentPlan(entries.length, read, segment);
  } catch (error) {
    if (failed) throw failure;
    throw error;
  }
}
