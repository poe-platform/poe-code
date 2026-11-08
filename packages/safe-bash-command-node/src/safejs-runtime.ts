export const DEFAULT_NODE_VERSION = "v22.0.0";

/** Load the SafeJS engine only when the default Node command executes code. */
export async function createDefaultSafeJsRuntime() {
  const { Budget, run, makeFsModule, declareHostOperation, parseSourceModule } = await import("@poe-code/safe-js/core");
  return {
    run, makeFsModule, declareHostOperation, parseSourceModule,
    createBudget: (options: ConstructorParameters<typeof Budget>[0]) => new Budget(options),
    node: { version: DEFAULT_NODE_VERSION },
  };
}
