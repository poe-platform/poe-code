import native from './native/native.wasm';
import callback from './native/callback.wasm';
export const modules: [WebAssembly.Module, WebAssembly.Module] = [native, callback];
