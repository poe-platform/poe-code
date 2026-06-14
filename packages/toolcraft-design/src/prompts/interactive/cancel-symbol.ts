export const CANCEL = Symbol.for("poe.cancel");

export function isCancel(value: unknown): value is typeof CANCEL {
  return value === CANCEL;
}
