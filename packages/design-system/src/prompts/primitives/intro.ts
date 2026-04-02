import chalk from "chalk";
import { text } from "../../components/text.js";
import { resolveOutputFormat } from "../../internal/output-format.js";
import { stripAnsi } from "../../internal/strip-ansi.js";

export function intro(title: string): void {
  const format = resolveOutputFormat();
  if (format === "json") {
    return;
  }

  if (format === "markdown") {
    process.stdout.write(`# ${stripAnsi(title)}\n\n`);
    return;
  }

  process.stdout.write(`${chalk.gray("┌")}  ${text.intro(title)}\n`);
}
