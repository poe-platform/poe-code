import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess

ROOT = Path(__file__).resolve().parent
sha = lambda body: hashlib.sha256(body).hexdigest()
read = lambda path: json.loads(path.read_bytes())
seal = read(ROOT / 'PRESEAL.json')
bindings = read(ROOT / 'INPUT-BINDINGS.json')
receipt = read(ROOT / 'RUN-01/receipt.json')
timing = read(ROOT / 'RUN-01/timing.json')
for row in seal['files']:
    assert sha(Path(row['path']).read_bytes()) == row['sha256']
assert receipt['status'] == 'SCOPED_FAILURES'
assert len(receipt['children']) == 2 and all(row['cleanupSettled'] and row['close']['signal'] is None and not row['rescueSignals'] for row in receipt['children'])
assert not Path(seal['work']).exists() and receipt['workRemoved']
assert receipt['results'][0]['verdict'] == 'PASS' and receipt['results'][1]['verdict'] == 'FAIL'
role_results = []
for role in seal['roles']:
    raw = (ROOT / 'RUN-01' / (role['id'] + '.stdout.raw')).read_bytes()
    report = json.loads(raw)
    assert (ROOT / 'RUN-01' / (role['id'] + '.stderr.raw')).read_bytes() == b''
    assert report['args'] == role['args'] and report['compiler'] == seal['compiler']
    assert report['consumerSha256'] == role['consumerSha256']
    assert report['diagnostics'] == role['diagnostics'] and report['formatted'] == role['formatted']
    assert report['noEmit'] is True and report['parsedOptions']['noEmit'] is True
    assert report['nestedProcessAttempts'] == report['networkAttempts'] == 0
    assert report['nativeExitCode'] == (0 if role['id'] == 'positive' else 1)
    assert all(row in bindings['routes'] for row in report['sourceFiles'])
    role_results.append(dict(role=role['id'], exactDiagnosticComparison=True, unexpectedDiagnostics=0, diagnosticCount=len(report['diagnostics']), expectedExit=role['exitCode'], actualWrapperExit=report['nativeExitCode'], emitSkippedObservation=report['emitSkipped'], sourceFiles=len(report['sourceFiles']), readFiles=len(report['reads']), consumerSha256=report['consumerSha256'], rawSha256=sha(raw)))

def census(directory):
    rows = []
    for path in directory.rglob('*'):
        assert not path.is_symlink()
        info = path.stat()
        row = dict(path=str(path), type='directory' if path.is_dir() else 'file', mode=stat.S_IMODE(info.st_mode))
        if row['type'] == 'file':
            row.update(bytes=info.st_size, sha256=sha(path.read_bytes()))
        rows.append(row)
    return sorted(rows, key=lambda row: row['path'].encode())

def canonical(rows):
    tuples = [[row['path'].encode().hex(), row['type'], row['mode']] + ([row['bytes'], row['sha256']] if row['type'] == 'file' else []) for row in rows]
    return b'M1A-CENSUS-v12\0' + json.dumps(tuples, separators=(',', ':')).encode() + b'\n'

preserved = []
for item in bindings['censuses']:
    if item['root'] == seal['work']:
        continue
    actual = census(Path(item['root']))
    assert len(actual) == item['entries'] and sha(canonical(actual)) == item['canonicalSha256']
    preserved.append(dict(root=item['root'], entries=len(actual), canonicalSha256=item['canonicalSha256'], newEntryCheck=True))
assert (ROOT/'EXPECTATION.json').read_bytes() == (ROOT.parent/'m1a-type-continuation-v13/EXPECTATION.json').read_bytes()
cli = Path('/Users/kjopek/Workspace/safe-bash/node_modules/typescript/lib/_tsc.js')
cli_lines = cli.read_text().splitlines()
source_excerpt = '\n'.join(cli_lines[128843:128850])
assert 'if (emitResult.emitSkipped && diagnostics.length > 0)' in source_excerpt and 'return 1' in source_excerpt and 'return 2' in source_excerpt
capture = [dict(path=str(path.relative_to(ROOT)), bytes=path.stat().st_size, sha256=sha(path.read_bytes())) for path in sorted((ROOT/'RUN-01').iterdir())]
audit = dict(status='HOLD_EXACT_NEGATIVE_DIAGNOSTIC_OBSERVED_EXIT_MAPPING_MISMATCH', subjectRuns=1, retry=False, roles=role_results, controlledProcesses=receipt['controlledProcesses'], peak=receipt['peak'], children=receipt['children'], guards=receipt['guards'], protectedPostAudit=preserved, workRemoved=True, timing=timing, rawCaptureBytes=sum(row['bytes'] for row in capture), rawFiles=capture, sourceOnlyDiagnosis=dict(wrapper='compiler.mjs:90', inheritedFrom='m1a-type-continuation-v13/compiler.mjs:91', description='Wrapper unconditionally maps any diagnostic to DiagnosticsPresent_OutputsSkipped (1); this is not a native CLI exit observation.', pinnedCliPath=str(cli), pinnedCliSha256=sha(cli.read_bytes()), pinnedCliStartLine=128844, pinnedCliExcerpt=source_excerpt, executedCli=False), preparationFailure=dict(error='KeyError source/package.json', operation='DATA-only archive rehydration before preseal', consequence='No compiler run; subsequent DATA pass authenticated existing partial files without overwrite and completed expected entries', retrySubject=False), historical=dict(v12Semantic=284, v12TypesPassed=4, v12TypesTotal=5, v12Overall='HOLD', v13Positive='harness failure', v13Negative='UNRUN', composedTypes='4/5 pending exact exit criterion proof', mutants=3, restores=3, bindingNegatives=3, rerun=False))
text = json.dumps(audit, indent=2) + '\n'
subprocess.run(['apply_patch'], input='*** Begin Patch\n*** Add File: '+str(ROOT/'AUDIT.json')+'\n'+''.join('+'+line+'\n' for line in text.splitlines())+'*** End Patch\n', text=True, check=True)
print(json.dumps(dict(status=audit['status'], roles=role_results, controlledProcesses=receipt['controlledProcesses'], peak=receipt['peak'], captureBytes=audit['rawCaptureBytes'], workRemoved=True)))
