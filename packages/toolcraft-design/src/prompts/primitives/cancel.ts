import { color } from "../../components/color.js";
export { isCancel } from "../interactive/cancel-symbol.js";
import { resolveOutputFormat } from "../../internal/output-format.js";

export function cancel(msg = ""): void {
  if (resolveOutputFormat() !== "terminal") {
    return;
  }

  process.stdout.write(`${color.gray("└")}  ${color.red(msg)}\n\n`);
}
