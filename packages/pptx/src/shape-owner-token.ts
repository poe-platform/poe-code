import type { XmlPart } from "./xml.js";

// Internal object identity associates a bounded subtree with its owning drawing.
export const shapeOwnerTokens = new WeakMap<XmlPart, object>();
