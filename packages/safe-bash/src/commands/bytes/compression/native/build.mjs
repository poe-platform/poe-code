import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { transform, version as esbuildVersion } from 'esbuild';

// Explicit maintenance tool. Normal builds copy authenticated committed artifacts.
const directory = dirname(fileURLToPath(import.meta.url));
const [sourceRoot, zig, wasm2js] = process.argv.slice(2);
if (!sourceRoot || !zig || !wasm2js || process.argv.length !== 5) {
  throw new Error('Usage: node build.mjs PINNED_SOURCE_CHECKOUT ZIG WASM2JS');
}
const manifest = JSON.parse(await readFile(join(directory, 'sources.json'), 'utf8'));
if (execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot, encoding: 'utf8' }).trim() !== manifest.upstream.commit) throw new Error('Source revision mismatch');
if (execFileSync(zig, ['version'], { encoding: 'utf8' }).trim() !== manifest.tools.zig) throw new Error('Zig version mismatch');
const binaryenVersion = execFileSync(process.execPath, [wasm2js, '--version'], { encoding: 'utf8' }).trim();
if (binaryenVersion !== 'wasm2js version 132 (version_132)') throw new Error('Binaryen version mismatch');
if (esbuildVersion !== manifest.tools.esbuild || ts.version !== manifest.tools.typescript) throw new Error('JavaScript build tool version mismatch');
const temporary = await mkdtemp(join(tmpdir(), 'safe-bash-codecs-'));
const artifacts = [];
try {
  for (const [name, codec] of Object.entries(manifest.codecs)) {
    const root = join(sourceRoot, 'third_party', name);
    const files = [];
    async function visit(relative) {
      for (const entry of await readdir(join(root, relative), { withFileTypes: true })) {
        const path = relative ? relative + '/' + entry.name : entry.name;
        if (entry.isDirectory()) await visit(path);
        else if (entry.isFile()) files.push(path);
        else throw new Error('Nonregular codec source');
      }
    }
    await visit('');
    const hash = createHash('sha256');
    for (const file of files.sort()) hash.update(file).update(await readFile(join(root, file)));
    if (hash.digest('hex') !== codec.tree_sha256) throw new Error('Codec source tree mismatch: ' + name);
    const wasm = join(temporary, name + '.wasm');
    const js = join(temporary, name + '.mjs');
    const exports = ['create', 'destroy', 'step', 'consumed', 'produced', 'input', 'output', 'used', 'peak'];
    execFileSync(zig, ['cc', '-target', 'wasm32-wasi', '-mexec-model=reactor', '-O2', '-fno-sanitize=all', '-Wl,--max-memory=134217728', '-Wl,-z,stack-size=1048576', ...exports.map(value => '-Wl,--export=bridge_' + value), '-D' + ({ bz2: 'BZ', xz: 'XZ', zstd: 'ZS' })[name], ...codec.defines.map(value => '-D' + value), ...codec.include_dirs.map(value => '-I' + join(root, value)), join(directory, 'bridge.c'), ...codec.sources.map(value => join(root, value)), '-o', wasm], { stdio: 'inherit' });
    execFileSync(process.execPath, [wasm2js, wasm, '-O2', '-o', js], { stdio: 'inherit' });
    const source = await readFile(js, 'utf8');
    const tree = ts.createSourceFile(js, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const edits = [];
    for (const statement of tree.statements) {
      if (ts.isImportDeclaration(statement) || statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) edits.push([statement.getFullStart(), statement.end, '']);
    }
    let growthFunctions = 0;
    function inspect(node) {
      if (ts.isFunctionDeclaration(node) && node.name?.text === '__wasm_memory_grow') {
        const branch = node.body.statements.find(ts.isIfStatement);
        if (!branch || branch.elseStatement) throw new Error('Unexpected Binaryen memory growth shape');
        // Binaryen 132 omits the WASM grow failure return. Keep the fixed maximum,
        // and return -1 so the native allocator cannot mistake refusal for success.
        edits.push([branch.thenStatement.end, branch.thenStatement.end, ' else { return -1; }']);
        growthFunctions++;
      }
      ts.forEachChild(node, inspect);
    }
    inspect(tree);
    if (growthFunctions !== 1) throw new Error('Missing unique memory growth function');
    let wrapped = source;
    for (const [start, end, replacement] of edits.sort((a, b) => b[0] - a[0])) wrapped = wrapped.slice(0, start) + replacement + wrapped.slice(end);
    wrapped = 'export default function createCodec(wasi_snapshot_preview1) {\n' + wrapped + '\nreturn retasmFunc;\n}\n';
    const result = await transform(wrapped, { loader: 'js', format: 'esm', target: 'es2022', minify: true, legalComments: 'inline', banner: '/*! Native codec: ' + name + ' ' + codec.tag + '. See ../LICENSES.txt and ../sources.json. */' });
    const bytes = Buffer.from(result.code);
    const path = 'generated/' + name + '.mjs';
    await writeFile(join(directory, path), bytes);
    artifacts.push({ path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  manifest.artifacts = artifacts;
  await writeFile(join(directory, 'sources.json'), JSON.stringify(manifest, null, 2) + '\n');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
