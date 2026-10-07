import {toByteSource} from 'safe-bash-contracts';
import type {LlmPackageManager} from 'safe-bash-command-llm';
import {createPythonExecutorCommands, type PythonCommandsOptions, type PythonPackageEnvironment} from './executor.js';
import {createPythonExecutorPool} from './executor-pool.js';
import type {PythonHostCapability} from './host-capabilities.js';

/** Parse with the pinned LLM CLI, then retire it before mutating the shared
 * caller-owned package environment in a separate interpreter. */
export function createPythonLlmPackageManager(options: PythonCommandsOptions & {environment: PythonPackageEnvironment}): LlmPackageManager {
  if (!options.createExecutor || !options.environment || options.provisioning) throw new TypeError('LLM package management requires an asynchronous executor and a shared Python environment');
  const planners = new WeakMap<readonly string[], PythonHostCapability>();
  const pool = createPythonExecutorPool({createExecutor:options.createExecutor,
    ...(options.maxConcurrentWorkers === undefined || options.maxConcurrentWorkers === Infinity ? {} : {maxConcurrentExecutors:options.maxConcurrentWorkers})});
  const configuration: PythonCommandsOptions = {...options,createExecutor:pool.createExecutor,createCapabilities(context) {
    const capabilities = options.createCapabilities?.(context) ?? {};
    if (capabilities.llm_packages) throw new Error('Python package capability is reserved');
    const capability = planners.get(context.args);
    return capability ? {...capabilities,llm_packages:capability} : capabilities;
  }};
  const installer = createPythonExecutorCommands(configuration)[0]!;
  // Parsing only needs the pinned LLM runtime, never caller-installed packages.
  const {environment:ignoredEnvironment,packages:ignoredPackages,requirements:ignoredRequirements,packageProfile:ignoredProfile,...planning} = configuration;
  const command = createPythonExecutorCommands(planning)[0]!;
  return async ({context,args}) => {
    if (!Array.isArray(args) || !['install','uninstall'].includes(args[0]!) || args.some(value=>typeof value!=='string')) throw new TypeError('Invalid LLM package command');
    context.signal.throwIfAborted();
    let planned: string[] | undefined;
    const {registerCleanup: ignoredCleanup, argumentValues: ignoredArguments, ...isolated} = context;
    const invocation = {...isolated,command:'python',args:['-c',pythonLlmPackageProgram,...args],stdin:toByteSource('')};
    planners.set(invocation.args,{async call(value) {
      if (planned || !Array.isArray(value) || value.some(item=>typeof item!=='string') || value[0]!=='pip' || value[1]!==args[0]) throw new Error('Invalid native LLM package request');
      planned=value.slice(1) as string[];
      return null;
    }});
    let result;
    try {result=await command.execute(invocation);}
    finally {planners.delete(invocation.args);}
    if (result.exitCode || !planned) return result;
    context.signal.throwIfAborted();
    return installer.execute({...isolated,command:'python',args:['-m','pip',...planned]});
  };
}

const pythonLlmPackageProgram = `
import sys
import safe_host
import llm.cli

def _safe_package_request(module, run_name):
    if module != 'pip' or run_name != '__main__':
        raise RuntimeError('Unexpected LLM package entrypoint')
    safe_host.call('llm_packages', list(sys.argv))

llm.cli.run_module = _safe_package_request
llm.cli.cli.main(args=sys.argv[1:], prog_name='llm')
`;
