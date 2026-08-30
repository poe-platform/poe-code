import hashlib
import json
from pathlib import Path
import stat
import subprocess

ROOT = Path(__file__).resolve().parent
REPO = Path('/Users/kjopek/Workspace/safe-bash')
PARENT = ROOT.parent
sha = lambda body: hashlib.sha256(body).hexdigest()
read = lambda path: json.loads(path.read_bytes())
authenticated = []
for name, commit in [('m1a-continuation-v12', 'b94bd13b156320d713d692c11f85f655cda68690'), ('m1a-type-continuation-v13', 'dc380b18d38e72afa7083adcb139fc6f4a28e293'), ('m1a-type-continuation-v14', '7dfde40f453b03d34fdc976eab1d36188c533aa6')]:
    directory = PARENT / name
    inventory = subprocess.check_output(['git', 'ls-tree', '-r', '-z', commit, '--', str(directory.relative_to(REPO))], cwd=REPO)
    rows = []
    for record in inventory.split(b'\0'):
        if not record:
            continue
        header, raw_path = record.split(b'\t', 1)
        mode, kind, object_id = header.split()
        path = REPO / raw_path.decode('utf8')
        assert kind == b'blob' and not path.is_symlink()
        body = path.read_bytes()
        assert hashlib.sha1(b'blob '+str(len(body)).encode()+b'\0'+body).hexdigest() == object_id.decode()
        assert stat.S_IMODE(path.stat().st_mode) == int(mode, 8) & 4095
        rows.append(dict(path=str(path.relative_to(REPO)), blob=object_id.decode(), mode=mode.decode(), bytes=len(body), sha256=sha(body)))
    assert {row['path'] for row in rows} == {str(path.relative_to(REPO)) for path in directory.rglob('*') if path.is_file()}
    authenticated.append(dict(commit=commit, root=str(directory.relative_to(REPO)), files=rows, currentTrackedAndRegularMembershipMatches=True))

v14 = PARENT / 'm1a-type-continuation-v14'
v12 = PARENT / 'm1a-continuation-v12'
seal = read(v14/'PRESEAL.json')
negative = read(v14/'RUN-01/negative-public-root.stdout.raw')
positive = read(v14/'RUN-01/positive.stdout.raw')
receipt = read(v14/'RUN-01/receipt.json')
expected = next(role for role in seal['roles'] if role['id']=='negative-public-root')
assert negative['diagnostics'] == expected['diagnostics'] and negative['formatted'] == expected['formatted']
assert len(negative['diagnostics']) == 1
assert negative['diagnostics'][0]['code'] == 2724 and negative['diagnostics'][0]['line'] == 1 and negative['diagnostics'][0]['column'] == 9
assert negative['args'] == expected['args'] and negative['compiler'] == seal['compiler']
assert negative['consumerSha256'] == expected['consumerSha256']
assert negative['parsedOptions']['noEmit'] is True and negative['parsedOptions']['strict'] is True and negative['parsedOptions']['exactOptionalPropertyTypes'] is True and negative['parsedOptions']['skipLibCheck'] is False
assert negative['nativeExitCode'] == 1 and negative['emitSkipped'] is False
assert positive['nativeExitCode'] == 0 and positive['diagnostics'] == []
assert (v14/'RUN-01/negative-public-root.stderr.raw').read_bytes() == b''
assert receipt['status'] == 'SCOPED_FAILURES' and receipt['results'][1]['verdict'] == 'FAIL'
assert receipt['children'][1]['close'] == {'code': 1, 'signal': None}
assert all(child['cleanupSettled'] and not child['rescueSignals'] for child in receipt['children'])
assert receipt['workRemoved'] and not Path(seal['work']).exists()
wrapper = (v14/'compiler.mjs').read_text()
literal = 'const code = nativeDiagnostics.length ? ts.ExitStatus.DiagnosticsPresent_OutputsSkipped : ts.ExitStatus.Success;'
assert wrapper.count(literal)==1 and wrapper.count('process.exitCode = code;')==1
for path, expected_hash in [(seal['compiler']['entry'],seal['compiler']['sha256']),(seal['compiler']['originalEntry'],seal['compiler']['originalEntrySha256']),(seal['node']['path'],seal['node']['sha256'])]:
    assert sha(Path(path).read_bytes()) == expected_hash
assert sha(Path(expected['consumer']).read_bytes()) == expected['consumerSha256']
types = read(v12/'RUN-01/capture/RESULT.json')['types']
assert [row['id'] for row in types if row['passed']] == ['types-positive','types-negative-limits','types-negative-native','types-negative-boundary']
prior = read(v12/'RUN-01/capture/RESULT.json')
assert [row['passed'] for row in prior['layouts']] == [71,71,71,71]
assert len(prior['mutants'])==len(prior['restores'])==len(prior['bindings'])==3
assert all(row['detected'] for row in prior['mutants']) and all(row['passed'] for row in prior['restores']) and all(row['refused'] for row in prior['bindings'])
result = dict(classification='SOURCE_DATA_ONLY_ROOT_ADJUDICATION_NO_NEW_EXECUTION', source=seal['candidate'], derivedBase=seal['base'], packageSha256=seal['packageSha256'], packageMembers=seal['packageMembers'], compiler=seal['compiler'], node=seal['node'], consumer=expected, rawNegative=dict(path=str((v14/'RUN-01/negative-public-root.stdout.raw').relative_to(REPO)), sha256=sha((v14/'RUN-01/negative-public-root.stdout.raw').read_bytes()), exactExpectedDiagnostic=True, unexpectedDiagnostics=0, actualProcessExit=1, historicalExpectedExit=2), wrapper=dict(path=str((v14/'compiler.mjs').relative_to(REPO)), sha256=sha(wrapper.encode()), literal=literal, line=next(index for index,line in enumerate(wrapper.splitlines(),1) if literal in line), qualification='nativeExitCode is an API-wrapper mapping, not an observed CLI exit'), priorFsIntegrity=dict(authenticatedRecordedGuards=receipt['guards'], newFsCompilerRun=False, workCurrentlyAbsent=True), preservedResults=dict(v12Overall='HOLD/exit1', v12Semantic284=True, v12Types='four original passes; original fifth expectation mismatch remains', v13='positive wrapper failure; negative UNRUN', v14='positive PASS; negative raw FAIL due exit1 versus2; overall SCOPED_FAILURES/exit1'), rootDecision='Actual nonzero1 plus exact sealed missing-export diagnostic establishes intended negative property; no historical result or exit rewritten and no aggregate5/5 claim.', authenticated=authenticated)
text=json.dumps(result,indent=2)+'\n'
subprocess.run(['apply_patch'],input='*** Begin Patch\n*** Add File: '+str(ROOT/'BINDINGS.json')+'\n'+''.join('+'+line+'\n' for line in text.splitlines())+'*** End Patch\n',text=True,check=True)
print(json.dumps(dict(bindingSha256=sha(text.encode()), rawNegativeSha256=result['rawNegative']['sha256'], wrapperSha256=result['wrapper']['sha256'], preservedFiles=[len(row['files']) for row in authenticated], newRuntimeExecutions=0)))
