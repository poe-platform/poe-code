const surface = specifier => `import { createTimeoutCommand, createTimeoutCommands, timeoutCommands, type TimeoutScheduler, type TimeoutCommandOptions, type TimeoutCommandsOptions } from '${specifier}';
const scheduler: TimeoutScheduler = { now: () => 0, setTimeout: () => undefined, clearTimeout: () => {} };
const single: TimeoutCommandOptions = { scheduler, invoke: async () => ({ exitCode: 7 }), maxTimerMilliseconds: 2 };
const family: TimeoutCommandsOptions = { ...single, replace: true };
const definition = createTimeoutCommand(single);
const definitions = createTimeoutCommands(family);
const plugin = timeoutCommands(family);
const name: string = definition.name;
const count: number = definitions.length;
const pluginName: string = plugin.name;
void [name, count, pluginName];
`;

export const compilerOptions = {
  target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true,
  exactOptionalPropertyTypes: true, noEmit: true, skipLibCheck: false,
  types: ['node'],
};

export const consumers = [
  { id: 'T01', entrypoint: 'root', expected: 'accept', source: surface('virtual-bash') },
  { id: 'T02', entrypoint: 'timeout-leaf', expected: 'accept', source: surface('virtual-bash/commands/timeout') },
  { id: 'T03', entrypoint: 'root', expected: 'accept', source: `import { agentCommands, createAgentCommands, type AgentCommandsOptions, type TimeoutCommandsOptions, type CommandInvoker } from 'virtual-bash';
type Equal<Left, Right> = (<Value>() => Value extends Left ? 1 : 2) extends (<Value>() => Value extends Right ? 1 : 2) ? true : false;
const exact: Equal<NonNullable<AgentCommandsOptions['timeout']>, Omit<TimeoutCommandsOptions, 'replace'>> = true;
const invoke: CommandInvoker = async () => ({ exitCode: 7 });
const options: AgentCommandsOptions = { replace: true, timeout: { invoke, maxTimerMilliseconds: 2, scheduler: { now: () => 0, setTimeout: () => false, clearTimeout: () => {} } }, text: { maxBufferBytes: 1 } };
agentCommands(options); createAgentCommands(options); void exact;
` },
  { id: 'T04', entrypoint: 'root', expected: 'reject', code: 2353, line: 2, property: 'replace', messageTerms: ['Object literal may only specify known properties', "'replace'", 'Omit<TimeoutCommandsOptions'], source: `import type { AgentCommandsOptions } from 'virtual-bash';
const options: AgentCommandsOptions = { timeout: { replace: true } };
void options;
` },
  { id: 'T05', entrypoint: 'timeout-leaf', expected: 'reject', code: 2322, line: 2, property: 'value', messageTerms: ["Type 'number' is not assignable", 'CommandInvoker'], source: `import type { TimeoutCommandOptions } from 'virtual-bash/commands/timeout';
const value: TimeoutCommandOptions['invoke'] = 1;
void value;
` },
  { id: 'T06', entrypoint: 'timeout-leaf', expected: 'reject', code: 2322, line: 2, property: 'value', messageTerms: ["Type 'number' is not assignable", '() => number'], source: `import type { TimeoutScheduler } from 'virtual-bash/commands/timeout';
const value: TimeoutScheduler['now'] = 1;
void value;
` },
  { id: 'T07', entrypoint: 'root', expected: 'reject', code: 2322, line: 2, property: 'value', messageTerms: ["Type 'string' is not assignable", 'number'], source: `import type { TimeoutCommandOptions } from 'virtual-bash';
const value: TimeoutCommandOptions['maxTimerMilliseconds'] = '2';
void value;
` },
  { id: 'T08', entrypoint: 'root', expected: 'reject', code: 2353, line: 2, property: 'invoker', messageTerms: ['Object literal may only specify known properties', "'invoker'", 'Omit<TimeoutCommandsOptions'], source: `import type { AgentCommandsOptions } from 'virtual-bash';
const options: AgentCommandsOptions = { timeout: { invoker: async () => ({ exitCode: 7 }) } };
void options;
` },
  { id: 'T09', entrypoint: 'timeout-leaf', expected: 'reject', code: 2353, line: 2, property: 'replace', messageTerms: ['Object literal may only specify known properties', "'replace'", 'TimeoutCommandOptions'], source: `import { createTimeoutCommand } from 'virtual-bash/commands/timeout';
createTimeoutCommand({ replace: true });
` },
  { id: 'T10', entrypoint: 'timeout-leaf', expected: 'accept', source: `import { createTimeoutCommand, createTimeoutCommands, timeoutCommands, type TimeoutCommandOptions, type TimeoutCommandsOptions } from 'virtual-bash/commands/timeout';
const single: TimeoutCommandOptions = { invoke: undefined, scheduler: undefined, maxTimerMilliseconds: undefined };
const family: TimeoutCommandsOptions = { ...single, replace: undefined };
createTimeoutCommand(); createTimeoutCommand(single); createTimeoutCommands(family); timeoutCommands(family);
` },
];
