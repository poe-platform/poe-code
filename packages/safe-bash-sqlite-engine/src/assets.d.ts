declare module "*.wasm" { const module: WebAssembly.Module; export default module; }
declare module "#sqlite-assets" { export const modules: [WebAssembly.Module, WebAssembly.Module]; }
