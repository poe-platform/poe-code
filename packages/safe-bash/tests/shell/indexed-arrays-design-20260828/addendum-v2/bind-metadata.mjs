import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const workspace = '/Users/kjopek/Workspace/safe-bash';
const directory = path.dirname(fileURLToPath(import.meta.url));
const observation = path.join(directory, '../native-observations-v1');
const original = '2cb939883a91b495bed7dadb8973cd1939b16e6a';
const preseal = 'abe53e03b654cd576dfa5f8f7a6cf435edc2b4d0';
const review = '0d70a9d4d30f4623a5ec2594e7f8568f5e2dbb43';
const evidenceCommit = '4e8f8a13590d489df5b5e7c70fe684de4abd2b5d';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const requireCondition = (condition, message) => { if (!condition) throw new Error(message); };
const git = (...args) => execFileSync('/usr/bin/git', args, { cwd: workspace, maxBuffer: 2000000, timeout: 10000 });
const relative = filename => path.relative(workspace, filename);
const readJson = filename => JSON.parse(fs.readFileSync(filename, 'utf8'));
const read = filename => fs.readFileSync(path.resolve(workspace, filename));
const record = filename => {
  const absolute = path.resolve(workspace, filename);
  const stat = fs.lstatSync(absolute);
  requireCondition(stat.isFile() && !stat.isSymbolicLink(), `nonregular: ${filename}`);
  const bytes = read(filename);
  return { path: relative(absolute), bytes: bytes.length, sha256: hash(bytes) };
};
const exclusive = (filename, bytes) => {
  const descriptor = fs.openSync(filename, 'wx', 0o600);
  try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
};
const seal = readJson(path.join(observation, 'SEAL.json'));
const evidence = readJson(path.join(observation, 'EVIDENCE.json'));
const verify = () => {
  const preserved = seal.authentication.protectedCensus.filter(entry => entry.kind === 'file').map(entry => {
    const filename = relative(entry.path);
    const revision = filename.includes('/indexed-arrays-independent-') ? review
      : filename.includes('/addendum-v1/') || filename.includes('/native-preseal-v1/') ? preseal : original;
    const bytes = read(filename);
    requireCondition(hash(bytes) === entry.sha256 && bytes.equals(git('show', `${revision}:${filename}`)), `original drift: ${filename}`);
    return { ...record(filename), revision };
  });
  for (const entry of seal.authentication.protectedCensus.filter(entry => entry.kind === 'directory')) {
    const expected = seal.authentication.protectedCensus.filter(child => path.dirname(child.path) === entry.path).map(child => path.basename(child.path)).sort();
    const actual = fs.readdirSync(entry.path).filter(name => !(entry.path === path.join(workspace, 'tests/shell/indexed-arrays-design-20260828') && ['native-observations-v1', 'addendum-v2'].includes(name))).sort();
    requireCondition(JSON.stringify(actual) === JSON.stringify(expected), `protected new entry: ${entry.path}`);
  }
  const evidenceFiles = [...evidence.bindings, ...evidence.capture.entries, record(path.join(observation, 'EVIDENCE.json'))];
  const committedFiles = git('ls-tree', '-r', '--name-only', evidenceCommit, '--', relative(observation)).toString().trim().split('\n').sort();
  requireCondition(JSON.stringify(evidenceFiles.map(entry => entry.path).sort()) === JSON.stringify(committedFiles), 'evidence inventory mismatch');
  for (const entry of evidenceFiles) {
    const bytes = read(entry.path);
    requireCondition(hash(bytes) === entry.sha256 && bytes.length === entry.bytes && bytes.equals(git('show', `${evidenceCommit}:${entry.path}`)), `evidence drift: ${entry.path}`);
  }
  for (const source of seal.authentication.sources) {
    const bytes = git('show', `${source.revision}:${source.path}`);
    requireCondition(hash(bytes) === source.sha256 && bytes.length === source.bytes, `source drift: ${source.path}`);
  }
  for (const entry of [seal.authentication.binary, seal.authentication.manual]) requireCondition(hash(read(entry.path)) === entry.sha256, `native identity drift: ${entry.path}`);
  requireCondition(!fs.existsSync(seal.fixture), 'fixture unexpectedly present');
  return { preserved, evidenceFiles };
};

if (process.argv[2] === 'bind') {
  const authenticated = verify();
  const report = read(path.join(directory, 'REPORT.md')).toString('utf8');
  const words = report.trim().split(/\s+/).length;
  requireCondition(words <= 700, 'report exceeds 700 words');
  const findingsPath = 'tests/shell/indexed-arrays-independent-20260828/FINDINGS.md';
  const findings = read(findingsPath).toString('utf8').split('\n').flatMap((line, index) => {
    const match = /^## (G[1-8]) — (.*)$/.exec(line);
    return match ? [{ id: match[1], title: match[2], path: findingsPath, line: index + 1, revision: review }] : [];
  });
  const runtime = 'src/shell/runtime.ts';
  const anchors = {
    G1: [[runtime, 1301], [runtime, 1935]],
    G2: [[runtime, 160], [runtime, 293], [runtime, 297], [runtime, 2342]],
    G3: [[runtime, 278], [runtime, 794], [runtime, 817], [runtime, 824]],
    G4: [[runtime, 135], [runtime, 2508], [runtime, 2525], [runtime, 2658]],
    G5: [['src/shell/cleanup.ts', 33], ['src/shell/cleanup.ts', 46]],
    G6: [[runtime, 29], [runtime, 62], ['src/shell/shell.ts', 162]],
    G7: [[runtime, 1046], [runtime, 1049], [runtime, 1293], [runtime, 1379], [runtime, 1479], [runtime, 2245], [runtime, 2331], [runtime, 2441]],
    G8: [['src/shell/parser.ts', 6], ['src/shell/parser.ts', 274], ['src/shell/parser.ts', 439], [runtime, 309], [runtime, 824], [runtime, 2512]],
  };
  requireCondition(findings.length === 8, 'finding count mismatch');
  const boundFindings = findings.map(finding => ({ ...finding, disposition: 'OPEN_FOR_ROOT; author response is additive, not ratified',
    sourceAnchors: anchors[finding.id].map(([filename, line]) => {
      const source = seal.authentication.sources.find(entry => entry.path === filename);
      requireCondition(source, `unbound source: ${filename}`);
      const lines = git('show', `${source.revision}:${filename}`).toString('utf8').split('\n');
      return { path: filename, revision: source.revision, sha256: source.sha256, line, text: lines[line - 1] };
    }) }));
  const binding = {
    schema: 'indexed-array-additive-response-binding-v2', createdAt: new Date().toISOString(), reportWords: words,
    qualification: 'Source read/hash and native-receipt audit; not mixed HEAD, full package, product behavior, Linux, async mutation or cancellation certification',
    commits: { original, preseal, review, supervisorSeal: evidence.sealCommit, evidence: evidenceCommit },
    manifestSha256: evidence.manifestSha256, evidenceSha256: hash(read(path.join(observation, 'EVIDENCE.json'))),
    acceptedComposition: evidence.sourceComposition, sourceBlobs: seal.authentication.sources,
    preserved: authenticated.preserved, findingResponses: boundFindings,
    authored: ['REPORT.md', 'DECISIONS.md', 'bind-metadata.mjs'].map(name => record(path.join(directory, name))),
    observed: evidence.totals, originalAndEvidenceIntegrity: 'NO_DRIFT; protected new-entry census includes additions; unrelated checkout not certified',
    rootSettled: ['fresh ledger per independent public Shell.exec; shared within internal descendants/invoke', 'staged target publication, RHS once, completed RHS effects not rolled back', 'scalar assignment sequence unchanged', 'canonical literal indices 0..2147483647 and explicit exclusions'],
    tests: 0, productCalls: 0, productImports: 0, nativeAdditionalCalls: 0,
    implementationApproval: false, eightFindingsClosed: false, crossExecOrRSSClaim: false,
  };
  const filename = path.join(directory, 'BINDINGS.json');
  exclusive(filename, `${JSON.stringify(binding, null, 2)}\n`);
  console.log(JSON.stringify({ path: relative(filename), sha256: hash(read(filename)), reportWords: words, findings: findings.map(item => item.id), preservedFiles: authenticated.preserved.length, evidenceFiles: authenticated.evidenceFiles.length }));
} else if (process.argv[2] === 'final-receipt') {
  const revision = process.argv[3];
  requireCondition(/^[0-9a-f]{40}$/.test(revision ?? ''), 'exact additive commit required');
  verify();
  const binding = readJson(path.join(directory, 'BINDINGS.json'));
  const filenames = [...binding.authored.map(entry => entry.path), relative(path.join(directory, 'BINDINGS.json'))];
  for (const filename of filenames) requireCondition(read(filename).equals(git('show', `${revision}:${filename}`)), `addendum drift: ${filename}`);
  const destination = '/tmp/indexed-arrays-observations-20260828-candidate.txt';
  const text = [
    'Indexed-array delegated leaf receipt — August 28, 2026',
    'Scoped status: observations complete; eight design findings remain OPEN; NO implementation approval.',
    `Supervisor/preflight seal: ${evidence.sealCommit}`,
    `Evidence commit: ${evidenceCommit}`,
    `Additive design commit: ${revision}`,
    `Manifest: ${evidence.manifestSha256} at ${preseal}; independent review ${review}.`,
    `Evidence SHA256: ${binding.evidenceSha256}`,
    `Addendum binding SHA256: ${hash(read(path.join(directory, 'BINDINGS.json')))}`,
    `Accepted sources: base ${binding.acceptedComposition.base}, CD ${binding.acceptedComposition.cd}, LET ${binding.acceptedComposition.let}.`,
    `Accepted runtime SHA256: ${binding.acceptedComposition.runtimeSha256}; not mixed HEAD.`,
    `Binary SHA256: ${seal.authentication.binary.sha256}; manual SHA256: ${seal.authentication.manual.sha256}.`,
    'GNU5.3 on Darwin25.4.0/arm64 only; no Linux/full-Bash, async-parent-mutation, cancellation or resource claim.',
    'N01–N16 once, 1783 script bytes; 14 exit0 and N12/N15 exit127, no signals; no expected values/pass denominator.',
    'stdout3247 + stderr468 =3715 captured bytes; one five-byte kept\\n file effect, captured before deletion; fixture peak4 entries.',
    'All16 top-level children naturally exited/reaped; known groups absent at recorded closure; zero TERM/KILL; root/home/tmp/rhs removed by exact owned-entry cleanup.',
    'Two authorized Bash-managed substitution contexts are script-declared, not independently counted processes. No dormant task process remains.',
    'Per-row maximum18.907584ms, summed201.376081ms; pre/post artifact/source hashes and addition-aware protected/capture census NO_DRIFT.',
    'Original2cb93988/abe53e03/0d70a9d4 inputs and all raw captures preserved. No platform block; initial metadata-only zsh path typo is recorded.',
    'tests=0; productCalls=0; productImports=0; no build/comparator/private checkout/XAN access; alias/dotglob unchanged; STACK locked, DOTGLOB next.',
    `Report: ${relative(path.join(directory, 'REPORT.md'))} (${binding.reportWords} words).`,
    `Details: ${relative(path.join(directory, 'DECISIONS.md'))}; exact G1–G8 anchors: ${relative(path.join(directory, 'BINDINGS.json'))}.`,
    'Pending root: G1 overflow/status phases; G2 watched identities; G3 snapshot consistency; G4 expression ownership; G5 cleanup/checkpoints; G6 private failure; G7 scalar boundaries; G8 grammar/operator policy.',
    'Fresh public exec ledger boundary and staged publication/no RHS rollback are root directions, not native-derived approval. No further native execution or product work is authorized.',
    `Receipt emitted ${new Date().toISOString()}; separate from CLI -o final path.`,
    '',
  ].join('\n');
  exclusive(destination, text);
  console.log(JSON.stringify({ receipt: destination, bytes: Buffer.byteLength(text), sha256: hash(text), preserved: true, tests: 0, productCalls: 0 }));
} else {
  throw new Error('Metadata-only bind or final-receipt required');
}
