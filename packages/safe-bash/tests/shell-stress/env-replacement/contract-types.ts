import type { CommandContext, CommandInvokeOptions } from '../../../src/contracts/index.js';
const replace: CommandInvokeOptions = { replaceEnv: true };
const merge: CommandInvokeOptions = { replaceEnv: false, env: { KEEP: 'value' } };
export async function typedRealInvoker(context: CommandContext): Promise<void> {
  if (!context.invoke) throw new Error('Real shell invocation required');
  await context.invoke('env', [], replace);
  await context.invoke('env', [], merge);
}
