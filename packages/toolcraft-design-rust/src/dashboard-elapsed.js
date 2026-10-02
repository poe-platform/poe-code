import {createRequire} from "node:module";
import {createComponentPolicy} from "./component-host.js";

const native = createRequire(import.meta.url)("./toolcraft-design-rust.node");
const invoke = createComponentPolicy(native.designDashboardElapsed, {
  finite: value => !!Number.isFinite(value),
  floor: value => Math.floor(value),
  max: (a, b) => Math.max(a, b),
  divide: (a, b) => a / b,
  remainder: (a, b) => a % b,
  format: (hours, minutes, seconds, padding, fill, separator) =>
    [hours, minutes, seconds].map(value => value.toString().padStart(padding, fill)).join(separator)
});

export function formatElapsed(ms) {
  return invoke("format", [ms]);
}
