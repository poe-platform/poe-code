const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function decode(value) {
  if (typeof value !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new Error('invalid base64');
  return Buffer.from(value, 'base64');
}

export function qualifyDatum(expected, datum) {
  const failures = [];
  const require = (condition, reason) => { if (!condition) failures.push(reason); };
  try {
    require(same(datum.binding, expected.binding), 'exact artifact/input/candidate/blob/argv/layout binding');
    const observation = datum.observation;
    require(observation.failed === false, 'escaping failure');
    require(observation.result?.exitCode === expected.status, 'status');
    require(observation.stdoutBase64 === expected.stdoutBase64, 'exact stdout');
    require(same(observation.files, expected.files), 'exact readonly namespace');
    require(datum.outcomeIntact === true && datum.outcomeClosed === true, 'historical intact/closed fields');
    require(observation.closed === true, 'closed');
    require(observation.cleanup?.drained === true && observation.cleanup?.failures === 0, 'cooperative cleanup fields');
    require(Array.isArray(observation.inputEvents) && Array.isArray(observation.fsEvents), 'phase fields present');
    if (Array.isArray(observation.inputEvents)) {
      require(!observation.inputEvents.some(event => event === 'return' || event === 'throw'), 'borrowed input lifetime');
      if (expected.beforeIO) require(observation.inputEvents.length === 0, 'before input acquisition');
    }
    if (Array.isArray(observation.fsEvents)) {
      if (expected.beforeIO) require(observation.fsEvents.length === 0, 'before metadata/publication');
      require(observation.fsEvents.every(event => typeof event?.method === 'string' && !/^(write|remove|rename|mkdir|rmdir|chmod|truncate|unlink)/.test(event.method)), 'readonly filesystem effects');
    }
    const bytes = decode(observation.stderrBase64);
    require(bytes.length > 0 && bytes.length <= expected.diagnosticByteCap, 'finite diagnostic bytes');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (expected.kind === 'M') {
      require(observation.stderrBase64 === expected.exactStderrBase64, 'inherited exact malformed CSV M bytes');
    } else if (expected.kind === 'I') {
      require(/^(?:Could not deserialize 'x' to u64 for '-I\/--indices'\.|invalid integer for -I(?:; note: -i is a separate option)?)\n$/.test(text), 'offending plural -I option identity');
    } else {
      const prefix = `xan ${expected.command}: `;
      require(text.startsWith(prefix), 'command/subcommand identity');
      const body = text.slice(prefix.length);
      const recognized = {
        S: ['unsupported in bounded CSV profile: selector syntax\n', 'selector syntax\n'],
        O: ['unsigned arithmetic overflow\n'],
        H: ['unsigned arithmetic overflow\n'],
        C: ['conflicting slice modes\n'],
      };
      require(recognized[expected.kind]?.includes(body) === true, 'known identifying class');
      if (expected.requiredFamily) require(text.includes(expected.requiredFamily), 'inherited literal diagnostic family');
    }
  } catch (error) {
    failures.push(`malformed data: ${error.message}`);
  }
  return { qualified: failures.length === 0, failures };
}

export function mutateDatum(original, operation) {
  const datum = structuredClone(original);
  const encode = text => Buffer.from(text).toString('base64');
  const text = () => Buffer.from(datum.observation.stderrBase64, 'base64').toString('utf8');
  switch (operation) {
    case 'unchanged': break;
    case 'wrong-class': datum.observation.stderrBase64 = encode(text().replace(/selector syntax|unsigned arithmetic overflow|conflicting slice modes/, 'unrelated file error')); break;
    case 'wrong-subcommand': datum.observation.stderrBase64 = encode(text().replace(/^xan \w+:/, 'xan count:')); break;
    case 'wrong-command': datum.observation.stderrBase64 = encode(text().replace(/^xan /, 'other ')); break;
    case 'wrong-status': datum.observation.result.exitCode = 0; break;
    case 'wrong-output': datum.observation.stdoutBase64 = encode('unexpected\n'); break;
    case 'wrong-argv': datum.binding.argv.push('unexpected'); break;
    case 'wrong-layout': datum.binding.layout = 'OTHER'; break;
    case 'wrong-input': datum.binding.inputSha256 = '0'.repeat(64); break;
    case 'wrong-candidate': datum.binding.candidate = '0'.repeat(40); break;
    case 'wrong-blob': datum.binding.candidateBlobs[0].blob = '0'.repeat(40); break;
    case 'wrong-class-binding': datum.binding.kind = 'OTHER'; break;
    case 'wrong-receipt': datum.binding.rawBinding.observationLineSha256 = '0'.repeat(64); break;
    case 'wrong-job': datum.binding.job.sha256 = '0'.repeat(64); break;
    case 'missing-cleanup': delete datum.observation.cleanup; break;
    case 'cleanup-failure': datum.observation.cleanup.failures = 1; break;
    case 'not-drained': datum.observation.cleanup.drained = false; break;
    case 'not-closed': datum.observation.closed = false; break;
    case 'not-intact': datum.outcomeIntact = false; break;
    case 'escaping-failure': datum.observation.failed = true; break;
    case 'readonly-change': datum.observation.files['new.csv'] = encode('changed'); break;
    case 'write-event': datum.observation.fsEvents.push({ method: 'writeFile' }); break;
    case 'wrong-phase': datum.observation.inputEvents.push('acquire'); break;
    case 'borrowed-return': datum.observation.inputEvents.push('return'); break;
    case 'missing-phase': delete datum.observation.inputEvents; break;
    case 'overbudget': datum.observation.stderrBase64 = encode('x'.repeat(65537)); break;
    case 'invalid-utf8': datum.observation.stderrBase64 = Buffer.from([255]).toString('base64'); break;
    case 'invalid-base64': datum.observation.stderrBase64 = '!'; break;
    case 'empty-diagnostic': datum.observation.stderrBase64 = ''; break;
    case 'class-without-family': datum.observation.stderrBase64 = encode('xan select: selector syntax\n'); break;
    case 'wrong-M-bytes': datum.observation.stderrBase64 = encode(text().replace('malformed CSV quoting', 'selector syntax')); break;
    case 'wrong-I-label': datum.observation.stderrBase64 = encode("Could not deserialize 'x' to u64 for '-i/--index'.\n"); break;
    case 'plural-I-with-incidental-i': datum.observation.stderrBase64 = encode('invalid integer for -I; note: -i is a separate option\n'); break;
    default: throw new Error(`unknown finite data operation ${operation}`);
  }
  return datum;
}
