import { createRequire } from "node:module";
const native = createRequire(import.meta.url)("./toolcraft-design-rust.node"),
  segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
export function graphemes(value) {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if ((code < 32 || code > 126) && code !== 9 && code !== 10 && (code < 0x4e00 || code > 0x9fff))
      return Array.from(segmenter.segment(value), ({ segment }) => segment);
  }
  return value.split("");
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
    return native.designAgentPlan(entries.length, read, segment);
  } catch (error) {
    if (failed) throw failure;
    throw error;
  }
}
