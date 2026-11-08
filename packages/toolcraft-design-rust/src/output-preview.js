import {createRequire} from "node:module";
const native=createRequire(import.meta.url)("./toolcraft-design-rust.node");

const previewPolicy = native.outputPreviewPolicy();
export const MAX_OUTPUT_PREVIEW_CHARS = previewPolicy.maxChars;
export const OUTPUT_TRUNCATION_NOTICE = previewPolicy.notice;
function hasTerminalStrings(text) {
  return previewPolicy.controls.some((control) => text.includes(control));
}
export function createTerminalStringFilter() {
  let filter,
    active = false;
  return {
    push(text) {
      if (!active && !hasTerminalStrings(text)) return text;
      filter ??= new native.NativeTerminalStringFilter();
      const result = filter.push(text);
      active = result.active;
      return result.text;
    }
  };
}
export function limitOutputPreview(text) {
  if (text.length <= MAX_OUTPUT_PREVIEW_CHARS && !hasTerminalStrings(text)) return text;
  return native.outputPreviewLimit(text);
}
export function retainOutputTail(text, maxChars) {
  return native.outputPreviewRetainStart(text, text.length - maxChars);
}
export function createOutputPreviewBuffer() {
  const buffer = new native.NativeOutputPreviewBuffer();
  return { push: buffer.push.bind(buffer), text: buffer.text.bind(buffer) };
}
