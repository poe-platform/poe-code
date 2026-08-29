import { Shell } from "./candidate/dist/index.js";
import { evaluateConditional } from "./candidate/dist/shell/conditional.js";
declare const shell: Shell;
const status: Awaited<ReturnType<typeof evaluateConditional>> = true;
shell.exec("", { maxEreWork: 3 });
const options: NonNullable<Parameters<Shell["exec"]>[1]> = { ere: true };
void status; void options;
