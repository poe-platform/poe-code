import hashlib
import json
import os
from pathlib import Path
import selectors
import signal
import subprocess
import sys
import time
import traceback

OWN = Path("/Users/kjopek/Workspace/safe-bash/tests/compatibility/bash-strict-extension-independent-20260829")


def digest(filename):
    result = hashlib.sha256()
    with open(filename, 'rb') as stream:
        while block := stream.read(65536):
            result.update(block)
    return result.hexdigest()


output = OWN / 'actual-v1'
output.mkdir()
with open(output / 'events.jsonl', 'x', buffering=1) as events, open(output / 'stdout.raw', 'xb', buffering=0) as stdout, open(output / 'stderr.raw', 'xb', buffering=0) as stderr:
    record = {'primaryPresent': False, 'cleanupPresent': False, 'closed': False, 'signals': [], 'bytes': 0}
    child = None
    began = time.monotonic()
    try:
        events.write(json.dumps({'event': 'capture-before-admission', 'pid': os.getpid()}) + '\n')
        assert sys.argv[1:] == ['--run']
        seal = json.loads((OWN / 'PRESEAL.json').read_text())
        executor = json.loads((OWN / 'EXECUTOR.json').read_text())
        assert digest(seal['node']['path']) == seal['node']['sha256']
        for row in executor['files']:
            target = Path(seal['repo']) / row['path']
            assert target.is_file() and not target.is_symlink()
            assert target.stat().st_size == row['bytes'] and digest(target) == row['sha256'], row['path']
        command = [seal['node']['path'], str(OWN / 'run.mjs'), '--run']
        events.write(json.dumps({'event': 'enrolled-before-spawn', 'command': command}) + '\n')
        child = subprocess.Popen(command, cwd=seal['repo'], env={'PATH': str(Path(seal['node']['path']).parent), 'HOME': seal['workParent'], 'TMPDIR': seal['workParent']}, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
        record['pid'] = child.pid
        watcher = selectors.DefaultSelector()
        watcher.register(child.stdout, selectors.EVENT_READ, stdout)
        watcher.register(child.stderr, selectors.EVENT_READ, stderr)
        while watcher.get_map():
            assert time.monotonic() - began < 3300, 'outer deadline'
            for key, mask in watcher.select(0.25):
                data = os.read(key.fileobj.fileno(), 65536)
                if not data:
                    watcher.unregister(key.fileobj)
                    key.fileobj.close()
                else:
                    record['bytes'] += len(data)
                    assert record['bytes'] <= 16 * 1024 * 1024, 'outer capture cap'
                    key.data.write(data)
        record['exitCode'] = child.wait(timeout=5)
        record['closed'] = True
        watcher.close()
        try:
            os.killpg(child.pid, 0)
            raise AssertionError('owned group remains after coordinator close')
        except ProcessLookupError:
            record['ownedGroupAbsent'] = True
    except BaseException:
        record['primaryPresent'] = True
        record['primary'] = traceback.format_exc()
        stderr.write(record['primary'].encode())
    finally:
        if child is not None:
            try:
                try:
                    os.killpg(child.pid, 0)
                except ProcessLookupError:
                    pass
                else:
                    record['signals'].append('SIGTERM')
                    os.killpg(child.pid, signal.SIGTERM)
                    try:
                        child.wait(timeout=2)
                    except subprocess.TimeoutExpired:
                        pass
                    try:
                        os.killpg(child.pid, 0)
                    except ProcessLookupError:
                        pass
                    else:
                        record['signals'].append('SIGKILL')
                        os.killpg(child.pid, signal.SIGKILL)
                    child.wait(timeout=3)
                if child.poll() is not None:
                    record['closed'] = True
                for stream in [child.stdout, child.stderr]:
                    if not stream.closed:
                        stream.close()
            except BaseException:
                record['cleanupPresent'] = True
                record['cleanup'] = traceback.format_exc()
        record['elapsedSeconds'] = time.monotonic() - began
        events.write(json.dumps({'event': 'terminal', **record}) + '\n')
        (output / 'TERMINAL.json').write_text(json.dumps(record, indent=2) + '\n')
    sys.exit(78 if record['primaryPresent'] or record['cleanupPresent'] or record['signals'] or not record['closed'] else record['exitCode'])
