import {execFileSync} from 'node:child_process';
import {readFile, writeFile, mkdir, copyFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {build} from 'esbuild';
const root = fileURLToPath(new URL('..', import.meta.url));
const target = resolve(root, process.env.CARGO_TARGET_DIR ?? 'target');
execFileSync('cargo', ['rustc', '--lib', '--crate-type', 'cdylib', '--manifest-path', resolve(root, 'Cargo.toml'), '--offline', '--locked', '--release', '--target', 'wasm32-unknown-unknown', '--target-dir', target], {stdio:'inherit'});
await mkdir(resolve(root, 'dist'), {recursive:true});
const wasm = await readFile(resolve(target, 'wasm32-unknown-unknown/release/document_converter_rust.wasm'));
await writeFile(resolve(root,'dist/document_converter_rust.wasm'), wasm);
await writeFile(resolve(root,'dist/wasm.js'), `export const wasmBase64 = ${JSON.stringify(wasm.toString('base64'))};\n`);
await writeFile(resolve(root,'dist/wasm.d.ts'), 'export declare const wasmBase64: string;\n');
await copyFile(resolve(root,'src/runtime.js'), resolve(root,'dist/runtime.js'));
await copyFile(resolve(root,'src/runtime.d.ts'), resolve(root,'dist/runtime.d.ts'));
for (const name of ['module.js', 'module.workerd.js']) await copyFile(resolve(root,'src',name), resolve(root,'dist',name));
await build({entryPoints:[resolve(root,'src/index.ts')],outdir:resolve(root,'dist'),format:'esm',platform:'browser',target:'es2022'});
await writeFile(resolve(root,'dist/index.d.ts'), 'export * from "./runtime.js";\nexport declare const convert: ReturnType<typeof import("./runtime.js").createConverter>;\n');

for (const [source,name] of [
  ['../pdf-ast-rust/src/fonts/LICENSE.Liberation','LICENSE.Liberation'],
  ['../pdf-ast-rust/src/fonts/LICENSE.DejaVu','LICENSE.DejaVu'],
  ['../pdf-ast-rust/src/fonts/LICENSE.NotoSansSC','LICENSE.NotoSansSC'],
  ['../terminal-png-rust/LICENSE.FONT','LICENSE.JetBrainsMono'],
  ['../mcp-protocol-rust/UNICODE-LICENSE.txt','LICENSE.Unicode'],
  ['../poe-agent-rust/PYTHON-LICENSE.txt','LICENSE.Python']
]) await copyFile(resolve(root,source),resolve(root,'dist',name));
