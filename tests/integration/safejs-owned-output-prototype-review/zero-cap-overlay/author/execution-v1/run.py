import os
from pathlib import Path
import selectors
import signal
import subprocess
import time
import traceback
from shared import *
from assess import assess


def launch(arguments, environment, logs):
    started = now()
    process = subprocess.Popen(arguments, cwd=REPOSITORY, env=environment, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    streams = selectors.DefaultSelector()
    outputs = {}
    for name in ['stdout', 'stderr']:
        stream = getattr(process, name)
        streams.register(stream, selectors.EVENT_READ, name)
        outputs[name] = (logs / (name + '.log')).open('xb')
    deadline = time.monotonic() + 180
    total = 0
    containment = None
    try:
        while streams.get_map():
            if time.monotonic() >= deadline and containment is None:
                containment = '180000ms controller containment; inner original guest/cohort deadlines unchanged'
                os.killpg(process.pid, signal.SIGKILL)
            for selected, mask in streams.select(0.05):
                chunk = os.read(selected.fileobj.fileno(), 65536)
                if not chunk:
                    streams.unregister(selected.fileobj)
                    selected.fileobj.close()
                    continue
                total += len(chunk)
                if total <= 4 * 1024 * 1024:
                    outputs[selected.data].write(chunk)
                elif containment is None:
                    containment = '4MiB controller output containment'
                    os.killpg(process.pid, signal.SIGKILL)
        exit_code = process.wait(timeout=10)
    finally:
        for output in outputs.values():
            output.close()
        streams.close()
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait(timeout=10)
    try:
        os.kill(process.pid, 0)
        alive = True
    except ProcessLookupError:
        alive = False
    return {'argv': arguments, 'cwd': str(REPOSITORY), 'pid': process.pid, 'started': started, 'finished': now(), 'exitCode': exit_code, 'knownControllerReaped': not alive, 'outputBytes': total, 'containment': containment}


def main():
    freeze_commit = verify_freeze()
    preparation = load(OWNER / 'PREPARATION.json')
    temporary = Path(preparation['temporary'])
    attempt = temporary / 'author-attempt-01'
    attempt.mkdir()
    raw_json(attempt / 'STARTED.json', {'at': now(), 'executionFreezeCommit': freeze_commit, 'oneAttemptOnly': True})
    expected_inputs = load(OWNER / 'PREPARATION-INPUTS.json')
    expected_shared = load(OWNER / 'PREPARATION-SHARED.json')
    descriptor = temporary / 'ROOT-RELEASE.json'
    assert regular(descriptor) == regular(OWNER / 'ROOT-RELEASE.json')
    environment = {**ENVIRONMENT, 'HOME': str(temporary / 'home'), 'TMPDIR': str(temporary / 'tmp'), 'TMP': str(temporary / 'tmp'), 'TEMP': str(temporary / 'tmp'), 'XDG_CACHE_HOME': str(temporary / 'tmp'), 'PYTHONDONTWRITEBYTECODE': '1', 'ZERO_OVERLAY_ROOT_RELEASE': str(descriptor)}
    results = []
    blocked = None
    for cohort in ['surface', 'lifecycle', 'controls']:
        if blocked:
            results.append({'cohort': cohort, 'classification': 'BLOCKED', 'reason': blocked, 'launched': False})
            continue
        logs = attempt / cohort
        logs.mkdir()
        entry = {'cohort': cohort, 'started': now(), 'rootRelease': str(descriptor), 'executionFreezeCommit': freeze_commit, 'launched': False}
        before = None
        shared_before = None
        inputs_before = None
        raw_root = None
        try:
            before = private_snapshot()
            raw_json(logs / 'private-before.json', before)
            assert len(before['metadata']) == 6 and len(before['engine']) == 264
            engine = [{key: item[key] for key in ['path', 'bytes', 'sha256']} for item in before['engine']]
            assert engine == preparation['preparedEngine']
            pins = json.loads(blob(AUTHOR_COMMIT, 'tests/integration/safejs-owned-output-prototype-review/lifecycle/SOURCE-PINS.json'))['privateExpectedAtRelease']
            for key in ['head', 'tree', 'status', 'staged']:
                assert before[key] == pins[key], f'Private immutable input drift: {key}'
            for filename, metadata in before['metadata'].items():
                assert metadata['sha256'] == pins['metadata'][filename]['sha256']
            shared_before = snapshot(preparation['sharedRoots'])
            inputs_before = snapshot(preparation['immutableRoots'])
            raw_json(logs / 'shared-before.json', shared_before)
            raw_json(logs / 'inputs-before.json', inputs_before)
            assert shared_before == expected_shared
            assert inputs_before == expected_inputs
            assert verify_freeze() == freeze_commit
            assert sha(regular(NODE)) == preparation['node']['sha256']
            arguments = [str(NODE), str(Path(preparation['runtimeRoot']) / cohort / 'run.mjs')]
            if cohort != 'surface':
                raw_root = temporary / 'raw' / cohort
                arguments.append(str(raw_root))
            entry['launched'] = True
            entry.update(launch(arguments, environment, logs))
            if cohort == 'surface':
                choices = list((temporary / 'raw').glob('surface-zero-overlay-*/results'))
                assert len(choices) == 1
                raw_root = choices[0]
            entry['rawRoot'] = str(raw_root)
        except BaseException as error:
            entry['failure'] = {'type': type(error).__name__, 'message': str(error), 'traceback': traceback.format_exc()}
            blocked = f'{cohort}: input/fixture/controller binding failure; no changes or retry'
        finally:
            try:
                after = private_snapshot()
                raw_json(logs / 'private-after.json', after)
                entry['privateUnchanged'] = before is not None and after == before
                assert entry['privateUnchanged']
            except BaseException as error:
                entry['privateAfterFailure'] = {'type': type(error).__name__, 'message': str(error)}
                blocked = f'{cohort}: fresh private after-guard failure'
            try:
                shared_after = snapshot(preparation['sharedRoots'])
                inputs_after = snapshot(preparation['immutableRoots'])
                raw_json(logs / 'shared-after.json', shared_after)
                raw_json(logs / 'inputs-after.json', inputs_after)
                entry['sharedUnchanged'] = shared_before is not None and shared_after == shared_before
                entry['inputsUnchanged'] = inputs_before is not None and inputs_after == inputs_before
                assert entry['sharedUnchanged'] and entry['inputsUnchanged']
                assert regular(descriptor) == regular(OWNER / 'ROOT-RELEASE.json')
                assert verify_freeze() == freeze_commit
            except BaseException as error:
                entry['afterGuardFailure'] = {'type': type(error).__name__, 'message': str(error), 'traceback': traceback.format_exc()}
                blocked = f'{cohort}: input/shared after-guard failure'
            entry['finished'] = now()
            raw_json(logs / 'execution.json', entry)
        if raw_root is not None and raw_root.is_dir():
            try:
                assessment = assess(cohort, raw_root, entry)
                raw_json(logs / 'assessment.json', assessment)
                entry['assessment'] = {'status': assessment['status'], 'counts': assessment['counts'], 'inputOrFixtureBindingBlocker': assessment['inputOrFixtureBindingBlocker']}
                if assessment['inputOrFixtureBindingBlocker']:
                    blocked = f'{cohort}: frozen driver input/fixture/guard blocker; stop before any changes'
            except BaseException as error:
                entry['assessmentFailure'] = {'type': type(error).__name__, 'message': str(error), 'traceback': traceback.format_exc()}
                blocked = f'{cohort}: evidence assessment blocker; no retry'
        results.append(entry)
        raw_json(logs / 'closure.json', entry)
        print(json.dumps({'cohort': cohort, 'launched': entry['launched'], 'assessment': entry.get('assessment'), 'blocked': blocked, 'privateUnchanged': entry.get('privateUnchanged')}), flush=True)
    report = {'started': load(attempt / 'STARTED.json'), 'finished': now(), 'role': 'AUTHOR_REPLAY_NOT_INDEPENDENT_ACCEPTANCE', 'attemptRoot': str(attempt), 'cohorts': results, 'stopReason': blocked, 'noPromotion': True}
    raw_json(attempt / 'REPLAY.json', report)
    print(json.dumps({'attemptRoot': str(attempt), 'stopReason': blocked, 'cohorts': len(results)}))


if __name__ == '__main__':
    main()
