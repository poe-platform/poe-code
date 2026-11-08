export const CANCEL=Symbol.for("poe.cancel");
export function isCancel(value){return value===CANCEL;}
