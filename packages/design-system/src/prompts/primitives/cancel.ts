import chalk from "chalk";
export { isCancel } from "@clack/prompts";
import { resolveOutputFormat } from "../../internal/output-format.js";

export function cancel(msg = ""): void {
  if (resolveOutputFormat() !== "terminal") {
    return;
  }

  process.stdout.write(`${chalk.gray("└")}  ${chalk.red(msg)}\n\n`);
}
