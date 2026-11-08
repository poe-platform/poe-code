import { createRequire } from "node:module";
import { types } from "node:util";
import {graphemes,simpleGraphemes} from "./graphemes.js";
import {invokeTextCells} from "./text-cells.js";
export {graphemes} from "./graphemes.js";
const native = createRequire(import.meta.url)("./toolcraft-design-rust.node"),
  originalCharCodeAt = String.prototype.charCodeAt;
export function graphemeWidth(segment) {return invokeTextCells("grapheme",[segment]);}
export function displayWidth(value, start = 0) {
  return invokeTextCells("display",[value,start]);
}
export function expandTabs(value, start = 0) {
  return invokeTextCells("expand",[value,start]);
}
export function truncateToWidth(value, width) {
  return invokeTextCells("truncate",[value,width]);
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
