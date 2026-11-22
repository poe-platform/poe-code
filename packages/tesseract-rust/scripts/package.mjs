import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const native = process.argv[2] === 'native';
if (!native && process.argv[2] !== 'js') throw new Error('Expected native or js');
const platforms = ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'];
const platform = `${process.platform}-${process.arch}`;
if (!platforms.includes(platform)) throw new Error(`Unsupported platform: ${platform}`);
const directory = path.resolve(root, '../../out/tesseract-release', native ? platform : 'js');
await mkdir(directory, { recursive: true });
const common = {
  version: source.version, license: source.license,
  repository: { type: 'git', url: 'git+https://github.com/poe-platform/poe-code.git', directory: 'packages/tesseract-rust' },
  engines: source.engines, publishConfig: { access: 'public' },
};
let manifest;
if (native) {
  manifest = { ...common, name: `${source.name}-${platform}`, description: `${source.description} (${platform})`,
    main: 'poe-tesseract.node', os: [process.platform], cpu: [process.arch],
    ...(process.platform === 'linux' ? { libc: ['glibc'] } : {}),
    files: ['poe-tesseract.node', 'THIRD_PARTY_NOTICES.txt', 'LICENSE', 'NOTICE', 'licenses'] };
  await cp(path.join(root, 'dist/poe-tesseract.node'), path.join(directory, 'poe-tesseract.node'));
  await cp(path.join(root, 'dist/THIRD_PARTY_NOTICES.txt'), path.join(directory, 'THIRD_PARTY_NOTICES.txt'));
} else {
  manifest = { ...common, name: source.name, description: source.description, type: 'module',
    main: source.main, types: source.types, exports: source.exports, sideEffects: source.sideEffects,
    bin: source.bin, files: ['dist', 'README.md', 'LICENSE', 'NOTICE', 'licenses'],
    optionalDependencies: Object.fromEntries(platforms.map(target => [`${source.name}-${target}`, source.version])) };
  await mkdir(path.join(directory, 'dist'), { recursive: true });
  for (const name of ['index.js', 'index.d.ts', 'cli-io.js', 'tesseract-cli.js', 'ocrmypdf-cli.js']) {
    await cp(path.join(root, 'dist', name), path.join(directory, 'dist', name));
  }
  await cp(path.join(root, 'README.md'), path.join(directory, 'README.md'));
}
for (const name of ['LICENSE', 'NOTICE', 'licenses']) await cp(path.join(root, name), path.join(directory, name), { recursive: true });
await writeFile(path.join(directory, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(directory);
