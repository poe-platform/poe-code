import type {NativeSqliteModule} from '../types.js';
export default function initialize(options: {instantiateWasm(imports: WebAssembly.Imports, ready: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void): WebAssembly.Exports}): Promise<NativeSqliteModule>;
