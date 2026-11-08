import type { Hyperlink } from "./links-model.js";
export const textLinkCapabilities = new WeakMap<
  object,
  (path: () => readonly number[]) => Hyperlink<{ readonly part: string }>
>();
