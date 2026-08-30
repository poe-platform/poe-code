import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import traceback

ROOT = Path('/Users/kjopek/Workspace/safe-bash')
OWN = ROOT / 'tests/integration/git-public-independent-20260829/dispatch-repair-v3'
PACKET = OWN.parent / 'successor-bindings-v2'
PYTHON = '/opt/homebrew/Cellar/python@3.14/3.14.7/Frameworks/Python.framework/Versions/3.14/bin/python3.14'
EXECUTION_HASH = 'af99d459a60679a7e0b466eabbcfbf8bf841c0da8ac25d8b27e1d2b7a839d808'


def digest(filename):
    metadata = filename.lstat()
    assert filename.is_file() and not filename.is_symlink() and metadata.st_size <= 268435456
    result = hashlib.sha256()
    size = 0
    with filename.open('rb') as stream:
        opened = os.fstat(stream.fileno())
        assert (opened.st_dev, opened.st_ino, opened.st_size) == (metadata.st_dev, metadata.st_ino, metadata.st_size)
        while True:
            block = stream.read(65536)
            if not block:
                break
            size += len(block)
            assert size <= metadata.st_size
            result.update(block)
        after = os.fstat(stream.fileno())
        assert size == metadata.st_size and after.st_mtime_ns == metadata.st_mtime_ns and after.st_size == metadata.st_size
    return result.hexdigest()


def data(filename):
    assert filename.is_file() and not filename.is_symlink() and filename.stat().st_size <= 2097152
    return json.loads(filename.read_text())


class PrimaryValue(BaseException):
    def __init__(self, value):
        self.value = value


class Capture:
    def __init__(self, label):
        self.directory = Path(tempfile.mkdtemp(prefix=label + '-', dir=OWN / 'captures'))
        self.stdout = open(self.directory / 'stdout.raw', 'xb', buffering=0)
        self.stderr = open(self.directory / 'stderr.raw', 'xb', buffering=0)
        self.events = open(self.directory / 'events.jsonl', 'xb', buffering=0)
        self.result = {'primaryPresent': False, 'cleanupPresent': False, 'childAttempts': 0, 'children': [], 'execAttempted': False, 'closed': False}
        self.event({'captureInitializedBeforeLookup': True, 'pid': os.getpid()})

    def event(self, value):
        self.events.write((json.dumps(value) + '\n').encode())

    def save(self, name, value):
        with open(self.directory / name, 'x') as stream:
            json.dump(value, stream, indent=2)
            stream.write('\n')

    def execute(self, action, cleanup=lambda: None):
        try:
            action(self)
        except BaseException as error:
            self.result['primaryPresent'] = True
            self.result['primary'] = error.value if isinstance(error, PrimaryValue) else str(error)
            self.result['primaryType'] = type(error).__name__
            self.stderr.write(traceback.format_exc().encode())
        finally:
            try:
                cleanup()
            except BaseException as error:
                self.result['cleanupPresent'] = True
                self.result['cleanup'] = str(error)
                self.stderr.write(traceback.format_exc().encode())
            self.event(self.result)
            failures = []
            for stream in [self.stdout, self.stderr, self.events]:
                try:
                    stream.close()
                except BaseException as error:
                    failures.append(str(error))
            self.result['captureCloseFailures'] = failures
            self.result['closed'] = all(stream.closed for stream in [self.stdout, self.stderr, self.events])
            self.save('RESULT.json', self.result)
        return self.result


def replace_process(capture, command, environment, execute=os.execve):
    capture.result['execAttempted'] = True
    capture.event({'execReplacementIntent': command, 'environment': environment, 'pidUnchangedOnSuccess': os.getpid()})
    execute(command[0], command, environment)
    raise AssertionError('exec replacement returned unexpectedly')


def tiny_child(capture):
    capture.result['childAttempts'] += 1
    row = {'enrolledBeforeSpawn': True, 'closed': False, 'signals': []}
    capture.result['children'].append(row)
    child = None
    try:
        child = subprocess.Popen([PYTHON, '-I', '-c', 'import os; os.write(1,bytes([84,73,78,89,95,79,75,10])); os.write(2,bytes([84,73,78,89,95,69,82,82,10]))'], cwd=capture.directory, env={'PATH': str(Path(PYTHON).parent), 'HOME': str(capture.directory)}, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        row['pid'] = child.pid
        stdout, stderr = child.communicate(timeout=3)
        row.update({'code': child.returncode, 'closed': True, 'stdout': stdout.decode(), 'stderr': stderr.decode()})
        assert len(stdout) + len(stderr) <= 4096
        capture.stdout.write(stdout)
        capture.stderr.write(stderr)
    finally:
        if child is not None and child.poll() is None:
            row['signals'].append('kill')
            child.kill()
            child.communicate(timeout=3)
            row['closed'] = True
        if child is not None:
            for stream in [child.stdout, child.stderr]:
                stream.close()


def controls(outer):
    freeze = data(OWN / 'CONTROL-PRESEAL.json')
    for row in freeze['files']:
        assert digest(OWN / row['path']) == row['sha256']
    rows = []
    for identity in freeze['cases']:
        capture = Capture(identity)
        if identity == 'C01-missing-reference':
            def action(owner):
                return missing_reference_for_control
            result = capture.execute(action)
            passed = result['primaryPresent'] and result['primaryType'] == 'NameError' and 'missing_reference_for_control' in result['primary']
        elif identity == 'C02-preauth-throw':
            def action(owner):
                raise RuntimeError('PREAUTH_SENTINEL')
            result = capture.execute(action)
            passed = result['primaryPresent'] and result['primary'] == 'PREAUTH_SENTINEL' and not result['execAttempted']
        elif identity == 'C03-exec-spawn-failure':
            def reject(executable, command, environment):
                raise OSError('EXEC_SENTINEL')
            result = capture.execute(lambda owner: replace_process(owner, [PYTHON, '-I', 'unused'], {}, reject))
            passed = result['primaryPresent'] and result['primary'] == 'EXEC_SENTINEL' and result['execAttempted'] and not result['children']
        elif identity == 'C04-falsy-primary-cleanup':
            def action(owner):
                raise PrimaryValue(False)
            def cleanup():
                raise RuntimeError('CLEANUP_SENTINEL')
            result = capture.execute(action, cleanup)
            passed = result['primaryPresent'] and result['primary'] is False and result['cleanupPresent'] and result['cleanup'] == 'CLEANUP_SENTINEL'
        elif identity == 'C05-normal-tiny-child':
            result = capture.execute(tiny_child)
            passed = not result['primaryPresent'] and len(result['children']) == 1 and result['children'][0]['code'] == 0 and result['children'][0]['stdout'] == bytes([84,73,78,89,95,79,75,10]).decode() and result['children'][0]['stderr'] == bytes([84,73,78,89,95,69,82,82,10]).decode() and result['children'][0]['closed'] and not result['children'][0]['signals']
        elif identity == 'C06-capture-closure':
            result = capture.execute(lambda owner: owner.stdout.write(b'CLOSURE_OK\n'))
            passed = not result['primaryPresent'] and result['closed'] and (capture.directory / 'stdout.raw').read_bytes() == b'CLOSURE_OK\n'
        else:
            raise AssertionError('unknown control')
        passed = passed and result['closed'] and not result['captureCloseFailures']
        row = {'id': identity, 'pass': passed, 'directory': str(capture.directory), 'result': result, 'files': [{'path': filename.name, 'sha256': digest(filename)} for filename in sorted(capture.directory.iterdir())]}
        rows.append(row)
        outer.stdout.write((json.dumps({'id': identity, 'pass': passed}) + '\n').encode())
        assert not any(not child['closed'] for child in result['children']), 'unknown child retirement'
    summary = {'rows': rows, 'pass': sum(row['pass'] for row in rows), 'fail': sum(not row['pass'] for row in rows), 'childAttempts': sum(row['result']['childAttempts'] for row in rows), 'realChildren': sum(len(row['result']['children']) for row in rows), 'product': 0, 'loader': 0, 'regex': 0, 'sourceSha256': digest(OWN / 'dispatch.py')}
    outer.save('CONTROL-RESULT.json', summary)
    assert len(rows) == 6 and summary['pass'] == 6 and summary['fail'] == 0, 'control assertion failure'


def activate(capture, binding_path):
    assert binding_path == OWN / 'ACTUAL-BINDING.json'
    binding = data(binding_path)
    assert binding['conditionalRootGo'] is True and binding['sourceCommitted'] is True
    supplement = data(OWN / 'DISPATCH-SEAL.json')
    assert digest(OWN / 'DISPATCH-SEAL.json') == binding['dispatchSealSha256']
    for row in supplement['files']:
        assert digest(OWN / row['path']) == row['sha256']
    result_path = Path(binding['controlsPath'])
    assert result_path.is_relative_to(OWN / 'captures') and digest(result_path) == binding['controlsSha256']
    result = data(result_path)
    assert result['pass'] == 6 and result['fail'] == 0 and len(result['rows']) == 6
    assert result['sourceSha256'] == digest(OWN / 'dispatch.py')
    assert all(row['pass'] and row['result']['closed'] and not row['result']['captureCloseFailures'] for row in result['rows'])
    assert digest(PACKET / 'EXECUTION-SEAL.json') == EXECUTION_HASH
    seal = data(PACKET / 'EXECUTION-SEAL.json')
    for row in seal['files']:
        filename = PACKET / row['path']
        assert filename.stat().st_size == row['bytes'] and digest(filename) == row['sha256']
    for tool in [seal['python'], seal['node']]:
        assert digest(Path(tool['path'])) == tool['sha256']
    assert seal['python']['path'] == PYTHON
    assert not Path(seal['runDirectory']).exists(), 'actual-v2 namespace already used'
    authorization = dict(binding['authorization'])
    assert authorization['executionSealSha256'] == EXECUTION_HASH
    assert authorization['runDirectory'] == seal['runDirectory']
    assert authorization['preparationOnly'] is False
    assert time.time() < authorization['expiresUnix'] <= time.time() + 3600
    capture.save('ROOT_AUTHORIZATION.json', authorization)
    capture.save('ACTIVATION.json', {'conditionalRootGo': True, 'sourceCommit': binding['sourceCommit'], 'dispatchSealSha256': binding['dispatchSealSha256'], 'executionSealSha256': EXECUTION_HASH, 'namespaceUnused': True, 'pid': os.getpid(), 'sameProcessExecReplacement': True, 'originalHoldsPreserved': True})
    environment = {'PATH': str(Path(seal['node']['path']).parent), 'HOME': str(capture.directory), 'TMPDIR': str(capture.directory), 'LC_ALL': 'C', 'NO_COLOR': '1'}
    command = [PYTHON, '-I', str(PACKET / 'launch.py'), '--run', str(capture.directory / 'ROOT_AUTHORIZATION.json')]
    os.dup2(capture.stdout.fileno(), 1)
    os.dup2(capture.stderr.fileno(), 2)
    replace_process(capture, command, environment)


def main(capture):
    arguments = sys.argv[1:]
    if arguments == ['--controls']:
        controls(capture)
    elif len(arguments) == 2 and arguments[0] == '--activate':
        activate(capture, Path(arguments[1]))
    else:
        raise AssertionError('exact --controls or --activate binding required')


if __name__ == '__main__':
    capture = Capture('entry')
    result = capture.execute(main)
    print(json.dumps({'directory': str(capture.directory), 'result': result}))
    sys.exit(1 if result['primaryPresent'] or result['cleanupPresent'] or result['captureCloseFailures'] or not result['closed'] else 0)
