import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { resolveCargoTargetDirectory } from '../../mcp-protocol-rust/scripts/cargo-target.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const cli = path.join(path.dirname(require.resolve('@napi-rs/cli/package.json')), 'dist/cli.js');
const target = resolveCargoTargetDirectory(path.resolve(root, '../..'));
mkdirSync(path.join(root, 'dist'), { recursive: true });
const result = spawnSync(process.execPath, [cli, 'build', '--cwd', root, '--manifest-path', 'bindings/Cargo.toml', '--target-dir', target, '--output-dir', 'dist', '--no-js', '--dts', 'native.d.ts', '--release', '--', '--locked'], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
for (const name of readdirSync(path.join(root, 'src'))) {
  if (name.endsWith('.js') || name.endsWith('.d.ts')) copyFileSync(path.join(root, 'src', name), path.join(root, 'dist', name));
  if (name.endsWith('-cli.js')) chmodSync(path.join(root, 'dist', name), 0o755);
}
const metadata = spawnSync('cargo', ['metadata', '--locked', '--format-version', '1', '--manifest-path', 'bindings/Cargo.toml'], { cwd: root, encoding: 'utf8', maxBuffer: 16 << 20 });
if (metadata.status !== 0) throw new Error(metadata.stderr);
const notices = JSON.parse(metadata.stdout).packages.map(pkg => {
  const directory = path.dirname(pkg.manifest_path);
  const licenses = readdirSync(directory).filter(name => name.toUpperCase().startsWith('LICENSE') || name.toUpperCase().startsWith('COPYING'));
  const texts = licenses.flatMap(name => {
    try { return [readFileSync(path.join(directory, name), 'utf8')]; }
    catch (error) { if (error.code === 'EISDIR') return []; throw error; }
  });
  return `${pkg.name} ${pkg.version}\n${pkg.repository ?? ''}\nLicense: ${pkg.license ?? 'See source'}\n${texts.join('\n')}\n`;
});
writeFileSync(path.join(root, 'dist/THIRD_PARTY_NOTICES.txt'), notices.join('\n---\n\n'));
