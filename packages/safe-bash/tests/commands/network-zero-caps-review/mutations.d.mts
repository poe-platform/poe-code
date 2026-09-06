export function runMutations(root: unknown, network: unknown, options?: {
  expectedDefaults?: Readonly<Record<string, number>>;
}): Promise<{
  mutations: number;
  detected: number;
  executions: number;
  receipts: unknown[];
}>;
