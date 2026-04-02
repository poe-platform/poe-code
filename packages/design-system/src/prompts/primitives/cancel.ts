import chalk from "chalk";
import { resolveOutputFormat } from "../../internal/output-format.js";

export { isCancel } from "@clack/prompts";

export function cancel(msg = ""): void {
  if (resolveOutputFormat() !== "terminal") {
    return;
  }

  process.stdout.write(chalk.dim(`│\n└  ${msg}\n`));
}
