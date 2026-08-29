from pathlib import Path
import hashlib
import json
import os
import selectors
import signal
import subprocess
import sys
import time
import traceback

OWN = Path(__file__).resolve().parent
assert len(sys.argv) == 3 and sys.argv[1] == '--run', 'sole entry: --run ROOT_AUTHORIZATION.json'
RUN = OWN / 'RUN-FROZEN-PUBLIC80-01'
RUN.mkdir()
STDOUT = open(RUN / 'coordinator.stdout.raw', 'xb')
STDERR = open(RUN / 'coordinator.stderr.raw', 'xb')
EVENTS = open(RUN / 'outer-events.jsonl', 'xb')
child = None
started = time.monotonic()


def event(value):
    EVENTS.write((json.dumps(value) + '\n').encode())
    EVENTS.flush()


def digest(filename):
    result = hashlib.sha256()
    with open(filename, 'rb') as stream:
        while part := stream.read(65536):
            result.update(part)
    return result.hexdigest()


def terminate_owned():
    if child is None:
        return
    def group_exists():
        try:
            os.killpg(child.pid, 0)
            return True
        except ProcessLookupError:
            return False
    for action, seconds in [(signal.SIGTERM, 1), (signal.SIGKILL, 4)]:
        if not group_exists():
            child.wait(timeout=5)
            event({'ownedGroupAbsentAfterCleanup': child.pid})
            return
        event({'ownedGroupSignal': child.pid, 'signal': int(action), 'leaderAlreadyClosed': child.poll() is not None})
        os.killpg(child.pid, action)
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            child.poll()
            if not group_exists():
                child.wait(timeout=5)
                event({'ownedGroupAbsentAfterCleanup': child.pid})
                return
            time.sleep(0.025)
    raise RuntimeError('unknown owned process-group retirement')

try:
    event({'outerCaptureBeforeAdmission': True, 'pid': os.getpid(), 'startedNs': time.time_ns()})
    seal_path = OWN / 'EXECUTION-SEAL.json'
    seal_hash = digest(seal_path)
    seal = json.loads(seal_path.read_text())
    authority = Path(sys.argv[2]); assert authority.is_file() and not authority.is_symlink() and authority.stat().st_size <= 16384
    authorization = json.loads(authority.read_text())
    expected = {'kind': 'FRESH_ONE_PUBLIC80_INDEPENDENT_REVIEW', 'candidate': seal['candidate'], 'packageSha256': seal['packageSha256'], 'executionSealSha256': seal_hash, 'runDirectory': str(RUN), 'maxSeconds': 3600, 'maxAllOsProcesses': 128, 'maxRegexWorkers': 32, 'acceptHistoricalFailuresUnrescored': True}
    for key, value in expected.items():
        assert authorization.get(key) == value, key
    assert authorization.get('nonce') and isinstance(authorization['nonce'], str)
    assert time.time() <= authorization['expiresUnix'] <= time.time() + 86400
    for row in seal['files']:
        filename = OWN / row['path']
        assert filename.is_file() and not filename.is_symlink() and filename.stat().st_size == row['bytes'] and digest(filename) == row['sha256'], row['path']
    assert digest(seal['node']['path']) == seal['node']['sha256']
    for name in ['home', 'tmp', 'scratch']:
        (RUN / name).mkdir()
    environment = {'PATH': str(Path(seal['node']['path']).parent), 'HOME': str(RUN / 'home'), 'TMPDIR': str(RUN / 'tmp'), 'NO_COLOR': '1', 'INDEPENDENT_PUBLIC80_ADMITTED': seal['candidate'], 'INDEPENDENT_PUBLIC80_SCRATCH': str(RUN / 'scratch')}
    command = [seal['node']['path'], str(OWN / 'run.mjs'), '--run']
    event({'enrollBeforeSpawn': True, 'command': command, 'environment': environment, 'authorization': authorization, 'sealSha256': seal_hash})
    child = subprocess.Popen(command, cwd=OWN, env=environment, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    event({'ownedPidAndGroup': child.pid})
    selector = selectors.DefaultSelector()
    for stream, target in [(child.stdout, STDOUT), (child.stderr, STDERR)]:
        os.set_blocking(stream.fileno(), False)
        selector.register(stream, selectors.EVENT_READ, target)
    captured = 0
    while selector.get_map():
        if time.monotonic() - started > 3595:
            raise TimeoutError('outer deadline; cleanup reserved')
        for key, mask in selector.select(0.2):
            part = os.read(key.fileobj.fileno(), 65536)
            if not part:
                selector.unregister(key.fileobj)
                key.fileobj.close()
                continue
            captured += len(part)
            assert captured <= 16 * 1024 * 1024, 'outer capture ceiling'
            key.data.write(part)
            key.data.flush()
    selector.close()
    code = child.wait(timeout=5)
    event({'naturalClose': True, 'returncode': code, 'capturedBytes': captured, 'elapsedSeconds': time.monotonic() - started})
    sys.exit(code if code >= 0 else 1)
except BaseException as error:
    if isinstance(error, SystemExit):
        raise
    STDERR.write(traceback.format_exc().encode())
    STDERR.flush()
    event({'failure': True, 'reasonPresent': True, 'type': type(error).__name__, 'reason': str(error)})
    sys.exit(1)
finally:
    cleanup_failed = False
    try:
        terminate_owned()
    except BaseException as cleanup_error:
        cleanup_failed = True
        event({'cleanupFailure': True, 'reasonPresent': True, 'reason': str(cleanup_error)})
    for stream in [STDOUT, STDERR, EVENTS]:
        stream.close()

    if cleanup_failed:
        os._exit(1)
