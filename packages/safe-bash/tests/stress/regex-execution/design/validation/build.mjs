import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const base = fileURLToPath(new URL('.', import.meta.url));
export const root = resolve(base, '../../../../..');
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(resolve(directory, entry.name)) : [resolve(directory, entry.name)]).sort();
}
if (!existsSync('/tmp/regex-revision-author-ready.txt')) throw new Error('WAIT_FOR_AUTHOR_READY');
const scratch = resolve(base, '.scratch');
if (existsSync(scratch)) throw new Error('NO_BUILD_OVERWRITE');
mkdirSync(scratch);
const source = resolve(scratch, 'source');
mkdirSync(source);
cpSync(resolve(root, 'src'), resolve(source, 'src'), { recursive: true });
writeFileSync(resolve(source, 'package.json'), '{"type":"module"}\n');
const design = 'tests/stress/regex-execution/design';
mkdirSync(resolve(source, design, 'validation'), { recursive: true });
for (const name of ['client.ts', 'worker.ts', 'matching.ts', 'protocol.ts']) cpSync(resolve(base, '..', name), resolve(source, design, name));
cpSync(resolve(base, 'adapter.ts'), resolve(source, design, 'validation/adapter.ts'));
const before = Object.fromEntries([...files(resolve(root, 'src')), ...['client.ts', 'worker.ts', 'matching.ts', 'protocol.ts'].map(name => resolve(base, '..', name))].map(path => [relative(root, path), hash(readFileSync(path))]));
function replace(text, needle, replacement) {
  if (text.split(needle).length !== 2) throw new Error('ADAPTER_ANCHOR_CHANGED ' + needle);
  return text.replace(needle, replacement);
}
let grep = readFileSync(resolve(source, 'src/commands/grep.ts'), 'utf8');
grep = 'import { workerHits } from "../../tests/stress/regex-execution/design/validation/adapter.js";\n' + grep;
grep = replace(grep, 'const matches = (text: string) => {', 'const matches = async (text: string) => {');
grep = replace(grep, 'let match: RegExpExecArray | null;\n        while ((match = matcher.exec(text)) !== null) {', 'for (const hit of await workerHits(matcher, text, parsed.flags.has("o") || parsed.flags.has("w"))) {\n          const match = Object.assign(hit.captures, { index: hit.start }) as RegExpExecArray;');
grep = replace(grep, 'const found = matches(', 'const found = await matches(');
grep = replace(grep, '          if (match[0] === "") matcher.lastIndex++;\n', '');
writeFileSync(resolve(source, 'src/commands/validation-grep.ts'), grep);
let matcher = readFileSync(resolve(source, 'src/commands/search/matcher.ts'), 'utf8');
matcher = 'import { workerHits } from "../../../tests/stress/regex-execution/design/validation/adapter.js";\n' + matcher;
matcher = replace(matcher, 'matches(bytes: Uint8Array, all = true, terminated = true): Match[]', 'async matches(bytes: Uint8Array, all = true, terminated = true): Promise<Match[]>');
matcher = replace(matcher, 'while (true) {\n        const match = regex.exec(fragment);\n        if (!match) break;', 'for (const hit of await workerHits(regex, fragment, all)) {\n        const match = Object.assign(hit.captures, { index: hit.start }) as RegExpExecArray;');
matcher = replace(matcher, '        if (match[0].length === 0) {\n          if (regex.lastIndex === fragment.length) break;\n          regex.lastIndex += fragment.codePointAt(regex.lastIndex)! > 0xffff ? 2 : 1;\n        }\n', '');
writeFileSync(resolve(source, 'src/commands/search/validation-matcher.ts'), matcher);
let rg = readFileSync(resolve(source, 'src/commands/search/rg.ts'), 'utf8');
rg = replace(rg, 'from "./matcher.js"', 'from "./validation-matcher.js"');
rg = replace(rg, 'const matches = matcher.matches(', 'const matches = await matcher.matches(');
writeFileSync(resolve(source, 'src/commands/search/validation-rg.ts'), rg);
const config = { compilerOptions: { target: 'ES2023', lib: ['ES2023'], module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true, skipLibCheck: true, types: ['node'], typeRoots: [resolve(root, 'node_modules/@types')], rootDir: source, outDir: resolve(scratch, 'built'), declaration: true }, include: [source + '/**/*.ts'] };
writeFileSync(resolve(scratch, 'tsconfig.json'), JSON.stringify(config, null, 2));
const compileArgs = [resolve(root, 'node_modules/typescript/bin/tsc'), '-p', resolve(scratch, 'tsconfig.json')];
const result = spawnSync(process.execPath, compileArgs, { encoding: 'utf8', timeout: 90000, maxBuffer: 2 ** 20 });
mkdirSync(resolve(base, 'evidence'), { recursive: true });
writeFileSync(resolve(base, 'evidence/build.json'), JSON.stringify({ command: [process.execPath, ...compileArgs], config, status: result.status, stdout: result.stdout, stderr: result.stderr }, null, 2) + '\n');
if (result.status !== 0) throw new Error('COMPILE_FAILED');
writeFileSync(resolve(scratch, 'built/package.json'), '{"type":"module"}\n');
const harness = Object.fromEntries(files(base).filter(path => !path.includes('/.scratch/') && !path.includes('/evidence/')).map(path => [relative(root, path), hash(readFileSync(path))]));
const built = Object.fromEntries(files(resolve(scratch, 'built')).map(path => [relative(root, path), hash(readFileSync(path))]));
const generatedCopies = Object.fromEntries(files(source).filter(path => path.includes('/validation-')).map(path => [relative(root, path), hash(readFileSync(path))]));
writeFileSync(resolve(base, 'evidence/frozen.json'), JSON.stringify({ at: new Date().toISOString(), authorReady: readFileSync('/tmp/regex-revision-author-ready.txt', 'utf8'), head: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim(), dirty: spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).stdout, node: process.version, versions: process.versions, platform: process.platform, arch: process.arch, typescript: JSON.parse(readFileSync(resolve(root, 'node_modules/typescript/package.json'))).version, source: before, harness, built, generatedCopies }, null, 2) + '\n');
