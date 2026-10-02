import {createRequire} from "node:module";
import {createComponentPolicy} from "./component-host.js";
import {resolveOutputFormat} from "./logging.js";

const native = createRequire(import.meta.url)("./toolcraft-design-rust.node");
const invoke = createComponentPolicy(native.designDashboardMode, {
  format: resolveOutputFormat,
  truthy: value => Boolean(value)
});

export function shouldUseInteractiveDashboard(enabled, io = process) {
  return invoke("shouldUse", [enabled, io]);
}
