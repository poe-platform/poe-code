import { textFixture } from "./text.js";
import { box } from "./shapes.js";

export function deepCarrierInput(strict: boolean, boxed = false): Promise<Uint8Array> {
  const depth = 4096, text = `${boxed ? "Boxed" : "Isolated"} 日本 עברית ẹ́ 🌊 𠀀`;
  const namespace = boxed ? "urn:original:deep-native-box" : "urn:original:isolated-deep-carrier";
  const body = `<w:p xmlns:f="${namespace}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f" mc:ProcessContent="f:p">${"<f:p>".repeat(depth)}<w:r><w:rPr><w:rtl/></w:rPr><w:t>${text}</w:t></w:r>${"</f:p>".repeat(depth)}</w:p>`;
  return textFixture(boxed ? box(body, "native", strict) : body, {}, strict);
}
