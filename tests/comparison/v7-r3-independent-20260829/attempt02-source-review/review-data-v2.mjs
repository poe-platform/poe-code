import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const home = path.dirname(fileURLToPath(import.meta.url));
const repository = '/Users/kjopek/Workspace/safe-bash';
const preparation = 'tests/comparison/breadth-continuation-20260828/executor-v7-r3/runs/admission-20260829-v7r3-02-preparation';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const requireThat = (condition, label) => { if (!condition) throw Error(label); };
const output = await fs.open(path.join(home, 'DATA-V2.json'), 'wx', 0o600);
async function read(file, cap = 262144) {
  const stat = await fs.lstat(file);
  requireThat(stat.isFile() && !stat.isSymbolicLink() && stat.size <= cap, 'DATA_ADMISSION');
  const bytes = await fs.readFile(file);
  requireThat(bytes.length === stat.size, 'DATA_SIZE');
  return { stat, bytes };
}
async function json(file) { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode((await read(file)).bytes)); }
let result;
try {
  const prior = await json(path.join(home, 'capture/DATA.json'));
  requireThat(prior.status === 'HOLD' && prior.error.message.endsWith('/DATA-RESULT.json'), 'ORIGINAL_LITERAL_HOLD');
  requireThat(prior.children.length === 3 && prior.children.every(row => row.exit.code === 0 && row.close.code === 0 && row.close.signal === null && row.stderr === 0), 'KNOWN_RETIREMENT');
  const inventories = [];
  for (const child of prior.children) {
    const { bytes } = await read(path.join(home, `capture/${child.commit}.stdout.raw`), 1048576);
    requireThat(bytes.length === child.stdout && bytes.at(-1) === 0, 'RAW_FRAMING');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, -1));
    const rows = new Map();
    for (const record of text.split('\0')) {
      const boundary = record.indexOf('\t');
      const metadata = record.slice(0, boundary).split(' ');
      const name = record.slice(boundary + 1);
      requireThat(boundary > 0 && metadata.length === 3 && metadata[1] === 'blob' && /^100(644|755)$/.test(metadata[0]) && /^[a-f0-9]{40}$/.test(metadata[2]) && name.startsWith(preparation + '/') && !rows.has(name), 'EXACT_NUL_DOMAIN');
      rows.set(name, { mode: metadata[0], oid: metadata[2] });
    }
    inventories.push(rows);
  }
  const sealFile = await read(path.join(repository, preparation, 'wrapper-v3/REPAIR-SEAL.json'));
  requireThat(digest(sealFile.bytes) === '00f8ad274e9f1b47c842bdc775db6c80d989634525c227a15aac20f18e4fdd46', 'ROOT_SEAL');
  const seal = JSON.parse(sealFile.bytes);
  const evidence = await json(path.join(repository, preparation, 'wrapper-v3/EVIDENCE-MANIFEST.json'));
  const final = await json(path.join(repository, preparation, 'wrapper-v3/FINAL-PUBLICATION.json'));
  const checked = [];
  for (const binding of prior.bindings) {
    const file = await read(path.join(repository, binding.path));
    requireThat(file.bytes.length === binding.bytes && digest(file.bytes) === binding.sha256 && (file.stat.mode & 511) === binding.mode, 'RETAINED_BINDING_DRIFT');
    const declared = seal.inputs.find(row => row.path === path.join(repository, binding.path));
    const record = evidence.files.find(row => row.path === path.join(repository, binding.path));
    const authority = declared ?? record;
    if (authority) requireThat(authority.bytes === binding.bytes && authority.sha256 === binding.sha256 && authority.mode === binding.mode, 'EXACT_PHYSICAL_MODE_AUTHORITY');
    if (binding.path.startsWith(preparation + '/')) {
      const stored = inventories[2].get(binding.path);
      const gitMode = (binding.mode & 0o111) === 0 ? '100644' : '100755';
      requireThat(stored && stored.oid === binding.gitBlob && stored.mode === gitMode, 'GIT_BLOB_EXECUTABLE_BIT');
      if (declared) requireThat(inventories[0].get(binding.path)?.oid === binding.gitBlob, 'PRESEAL_COMMIT');
    }
    checked.push({ path: binding.path, sha256: binding.sha256, mode: binding.mode, physicalAuthority: authority ? 'sealed-record' : 'final-commit-plus-retained-snapshot' });
  }
  const manifestFile = await read(path.join(repository, preparation, 'wrapper-v3/EVIDENCE-MANIFEST.json'));
  requireThat(digest(manifestFile.bytes) === final.evidenceManifest.sha256, 'FINAL_MANIFEST_BINDING');
  result = { schema: 'ATTEMPT02_DATA_ADJUDICATION_V2', status: 'DATA_BINDINGS_QUALIFIED', originalHelper: 'HOLD preserved; Git100644 does not encode physical0600 versus0644', originalSemanticSourceChecks: prior.checks, checked, children: 0, gitInventoriesReused: 3, authorControlReruns: 0, ownerEvaluations: 0, noAdmissionAuthority: true };
} catch (error) { result = { schema: 'ATTEMPT02_DATA_ADJUDICATION_V2', status: 'HOLD', error: { name: error?.name, message: error?.message }, children: 0 }; }
await output.writeFile(JSON.stringify(result, null, 2) + '\n'); await output.sync(); await output.close();
process.stdout.write(JSON.stringify({ status: result.status, bindings: result.checked?.length ?? 0, children: 0 }) + '\n');
process.exitCode = result.status === 'DATA_BINDINGS_QUALIFIED' ? 0 : 1;
