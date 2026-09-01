export type Entry = { readonly kind: "directory" } | { readonly kind: "file"; readonly hex: string } | { readonly kind: "symlink"; readonly target: string };
export type Namespace = Record<string, Entry>;
export interface Observation { readonly args: readonly string[]; readonly status: number; readonly stdout: string; readonly stderr: string; readonly namespace: Namespace }
export interface Evidence { readonly version: string; readonly binary: string; readonly binarySha256: string; readonly fixtureSha256: string; readonly cases: Record<string, readonly Observation[]> }
