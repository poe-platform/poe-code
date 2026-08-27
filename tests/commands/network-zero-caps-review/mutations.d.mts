export function runMutations(root: unknown, network: unknown): Promise<{
  mutations: number;
  detected: number;
  executions: number;
  receipts: unknown[];
}>;
