import { S, defineCommand, defineGroup } from "toolcraft-rust";
import { runCLI, executeCLICommand, type RunCLIOptions, type CLIInvocationRuntime } from "toolcraft-rust/cli";
import type * as Original from "toolcraft/cli";

const run: typeof Original.runCLI = runCLI;
const execute: typeof Original.executeCLICommand = executeCLICommand;
const options: RunCLIOptions<{ marker: string }> = {
  services: { marker: "present" },
  argv: ["node", "app", "run", "--name", "value"],
  controls: { output: { formats: { compact: ({result}) => String(result) } }, yes: true }
};
const schema = S.Object({ name: S.String() });
const command = defineCommand<{ marker: string }, "run", typeof schema>({
  name: "run",
  params: schema,
  handler: ({ params, marker }) => ({ name: params.name, marker })
});
const root = defineGroup<{ marker: string }>({ name: "app", children: [command] });
const invocation: CLIInvocationRuntime = {
  signal: new AbortController().signal,
  write: () => undefined,
  flush: async () => undefined,
  exitCode: 0,
  capabilities: {}
};
void run(root, options);
void execute(root, options, invocation);
// @ts-expect-error service types must remain checked
void run(root, { services: { marker: 123 } });
