import { runBash } from 'poe-code';
import { MemoryFileSystem } from 'poe-code/safe-bash';

const fs = new MemoryFileSystem();
await fs.mkdir('/work', { recursive: true });
await fs.writeFile('/work/report.py', new TextEncoder().encode(
  'from pathlib import Path\n'
  + 'Path("report.txt").write_text("hello from Python\\n", encoding="utf-8")\n'
  + 'print(Path("report.txt").read_text(encoding="utf-8"), end="")\n'
));
const result = await runBash({
  fs, cwd: '/work', source: 'python report.py',
  python: {
    trustedPython: true,
    runtimeModuleURL: new URL(
      './packages/safe-bash/tests/integration/pyodide-runtime/node_modules/pyodide/pyodide.mjs',
      import.meta.url,
    ).href,
  },
});
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
process.exitCode = result.exitCode;
