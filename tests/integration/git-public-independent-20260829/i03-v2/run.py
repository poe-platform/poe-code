import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import traceback

OWN = Path('/Users/kjopek/Workspace/safe-bash/tests/integration/git-public-independent-20260829/i03-v2')


def digest(filename):
    assert filename.is_file() and not filename.is_symlink()
    result = hashlib.sha256()
    with filename.open('rb') as stream:
        while True:
            block = stream.read(65536)
            if not block:
                break
            result.update(block)
    return result.hexdigest()


def main(log, result):
    assert sys.argv[1:] == ['--run']
    seal = json.loads((OWN / 'PRESEAL.json').read_text())
    for row in seal['files']:
        filename = Path(row['path'])
        assert filename.stat().st_size == row['bytes'] and digest(filename) == row['sha256'], row['path']
    assert digest(Path(seal['node']['path'])) == seal['node']['sha256']
    for row in seal['shipping']:
        assert digest(Path(row['path'])) == row['sha256']
    root = Path(seal['work'])
    began = time.monotonic()
    for case in seal['cases']:
        row = {'layout': case['layout'], 'enrolledBeforeSpawn': True, 'closed': False, 'signals': []}
        result['children'].append(row)
        log.write(json.dumps({'beforeSpawn': row, 'command': case['command'], 'environment': case['environment']}) + '\n')
        log.flush()
        child = None
        stdout_file = open(OWN / (case['layout'] + '.stdout.raw'), 'xb', buffering=0)
        stderr_file = open(OWN / (case['layout'] + '.stderr.raw'), 'xb', buffering=0)
        try:
            child = subprocess.Popen(case['command'], cwd=case['cwd'], env=case['environment'], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            row['pid'] = child.pid
            stdout, stderr = child.communicate(timeout=30)
            row.update({'code': child.returncode, 'closed': True, 'stdoutBytes': len(stdout), 'stderrBytes': len(stderr)})
            assert len(stdout) + len(stderr) <= 1048576
            stdout_file.write(stdout)
            stderr_file.write(stderr)
        finally:
            if child is not None and child.poll() is None:
                row['signals'].append('kill')
                child.kill()
                stdout, stderr = child.communicate(timeout=3)
                row['closed'] = True
                stdout_file.write(stdout)
                stderr_file.write(stderr)
            if child is not None:
                child.stdout.close()
                child.stderr.close()
            stdout_file.close()
            stderr_file.close()
            log.write(json.dumps({'retired': row}) + '\n')
            log.flush()
        assert row['closed'] and not row['signals'], 'unknown retirement/deadline'
        observation = json.loads(stdout)
        events = [json.loads(line) for line in Path(case['environment']['RESOURCE_LOG']).read_text().splitlines()]
        births = [event for event in events if event['kind'] == 'worker-create']
        assert len(births) == 0 and any(event['kind'] == 'bootstrap' and event['allowance'] == 0 for event in events)
        assert all(event.get('live', 0) == 0 for event in events)
        row['resources'] = events
        row['observation'] = observation
        row['pass'] = row['code'] == 0 and observation['pass'] is True
        assert time.monotonic() - began < 150
    for row in seal['files']:
        assert digest(Path(row['path'])) == row['sha256'], 'postguard ' + row['path']
    for row in seal['shipping']:
        assert digest(Path(row['path'])) == row['sha256'], 'shipping postguard'
    result['postguardsPassed'] = True
    result['pass'] = sum(row['pass'] for row in result['children'])
    result['fail'] = 3 - result['pass']
    result['elapsedSeconds'] = time.monotonic() - began


if __name__ == '__main__':
    with open(OWN / 'events.jsonl', 'x', buffering=1) as log:
        result = {'children': [], 'primaryPresent': False, 'cleanupPresent': False, 'postguardsPassed': False}
        try:
            log.write(json.dumps({'captureBeforeAdmission': True, 'pid': os.getpid()}) + '\n')
            main(log, result)
        except BaseException as error:
            result['primaryPresent'] = True
            result['primary'] = traceback.format_exc()
            sys.stderr.write(result['primary'])
        finally:
            with open(OWN / 'RESULT.json', 'x') as output:
                json.dump(result, output, indent=2)
                output.write('\n')
        sys.exit(0 if not result['primaryPresent'] and result.get('pass') == 3 and result['postguardsPassed'] else 1)
