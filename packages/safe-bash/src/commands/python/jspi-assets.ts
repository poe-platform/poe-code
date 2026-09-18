export interface PythonJspiAssetsOptions {
  readonly main: object;
  readonly stdlib: Uint8Array;
  readonly modules: readonly {readonly bytes: Uint8Array; readonly module: object}[];
}

export function createPythonJspiAssets(options: PythonJspiAssetsOptions): {
  readonly WebAssembly: any;
  readonly location: string;
  fetch(url: string | URL): Promise<Response>;
} {
  const engine = (globalThis as any).WebAssembly;
  const main = options.main;
  const registry = options.modules.map(entry => ({module:entry.module, bytes:Uint8Array.from(entry.bytes)}));
  if (![main, ...registry.map(entry => entry.module)].every(module => module instanceof engine.Module)) throw new TypeError('Expected precompiled Python Wasm modules');
  const stdlib = Uint8Array.from(options.stdlib);
  const responses = new WeakMap<Response, object>();
  const approved = new Set([main, ...registry.map(entry => entry.module)]);
  const select = (source: ArrayBuffer | ArrayBufferView): object => {
    const bytes = ArrayBuffer.isView(source) ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength) : new Uint8Array(source);
    const entry = registry.find(candidate => candidate.bytes.length === bytes.length && candidate.bytes.every((byte, index) => byte === bytes[index]));
    if (!entry) throw new engine.CompileError('Unapproved Python runtime Wasm bytes');
    return entry.module;
  };
  const WebAssembly = Object.create(engine);
  WebAssembly.Module = function (source: ArrayBuffer | ArrayBufferView) { return select(source); };
  Object.setPrototypeOf(WebAssembly.Module, engine.Module);
  WebAssembly.Module.prototype = engine.Module.prototype;
  WebAssembly.compile = async (source: ArrayBuffer | ArrayBufferView) => select(source);
  WebAssembly.compileStreaming = async () => { throw new engine.CompileError('Unapproved Python streaming compilation'); };
  WebAssembly.instantiate = async (source: object, imports: unknown) => {
    if (source instanceof engine.Module) {
      if (!approved.has(source)) throw new engine.CompileError('Unapproved Python Wasm module');
      return new engine.Instance(source, imports);
    }
    const module = select(source as ArrayBuffer);
    return {module, instance:new engine.Instance(module, imports)};
  };
  WebAssembly.instantiateStreaming = async (response: Response | Promise<Response>, imports: unknown) => {
    const module = responses.get(await response);
    if (!module) throw new engine.CompileError('Unapproved Python Wasm response');
    return {module, instance:new engine.Instance(module, imports)};
  };
  const location = 'https://safe-python.invalid/';
  return {WebAssembly, location, async fetch(url) {
    const target = new URL(url, location).href;
    if (target === location + 'python_stdlib.zip') return new Response(stdlib);
    if (target === location + 'pyodide.asm.wasm') {
      const response = new Response(null, {headers:{'Content-Type':'application/wasm'}});
      responses.set(response, main);
      return response;
    }
    throw new Error('Unapproved Python runtime asset');
  }};
}
