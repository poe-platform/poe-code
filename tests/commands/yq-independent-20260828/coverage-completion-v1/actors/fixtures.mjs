import { Buffer } from 'node:buffer';

export function makeFixture(profile) {
  const fixture = { argv: ['-o', 'json', '-c', '.'], chunks: [], files: [], reuse: false, sourceFailure: false, cleanupFailure: false, callerAbort: false, omitRegistration: false, lateReturn: false, overlapCleanup: false, delayedWrite: false, sinkFailure: null };
  const above = profile.variant === 'above-cap';
  const text = input => { fixture.chunks = [Buffer.from(input, 'utf8')]; };
  switch (profile.recordId) {
    case 'WRK-01':
      fixture.argv = Array.from({ length: above ? 4097 : 4096 }, () => 'x');
      fixture.argv[0] = '--help';
      if (above) fixture.argv[1] = '\ud800';
      break;
    case 'WRK-02':
      fixture.argv = ['.', 'a'.repeat(16384), 'b'.repeat(16384), 'c'.repeat(16384), 'd'.repeat(above ? 16384 : 16383)];
      fixture.files = fixture.argv.slice(1);
      break;
    case 'WRK-03':
      fixture.argv = ['.', '🙂'.repeat(4096) + (above ? 'x' : '')];
      fixture.files = fixture.argv.slice(1);
      break;
    case 'WRK-04':
      fixture.argv = ['.' + ' '.repeat(above ? 8192 : 8191)];
      break;
    case 'WRK-06':
      text('#' + 'x'.repeat(8388608 - 3 + (above ? 1 : 0)) + '\r\n');
      break;
    case 'WRK-07':
      text('"' + '🙂'.repeat(262143) + '\\U0001F642' + (above ? 'x' : '') + '"\n');
      break;
    case 'WRK-09':
      text('['.repeat(above ? 129 : 128) + '0' + ']'.repeat(above ? 129 : 128) + '\n');
      break;
    case 'WRK-10':
      fixture.argv = ['.' + '?'.repeat(above ? 64 : 63)];
      break;
    case 'WRK-13':
      text('[' + '0,'.repeat(above ? 100000 : 99999) + '0]\n');
      break;
    case 'WRK-19':
      fixture.argv = ['.', '🙂'.repeat(62) + '"\\\n' + (above ? 'x' : '')];
      fixture.files = fixture.argv.slice(1);
      fixture.fileContents = '[';
      break;
    case 'WRK-25': {
      const key = '🙂'.repeat(profile.variant === 'plain-at-cap' ? 1024 : 1025);
      text(profile.variant === 'explicit-above-cap' ? `? ${key}\n: 0\n` : `${key}: 0\n`);
      break;
    }
    case 'UTF-22':
      fixture.chunks = ['5b31', '2c32', '5d0a'].map(hex => Buffer.from(hex, 'hex'));
      fixture.reuse = true;
      break;
    case 'LIF-01':
      text('0\n');
      fixture.overlapCleanup = true;
      break;
    case 'LIF-02':
      fixture.sourceFailure = true;
      fixture.omitRegistration = true;
      break;
    case 'LIF-03':
      fixture.sourceFailure = true;
      fixture.cleanupFailure = true;
      fixture.callerAbort = true;
      break;
    case 'LIF-04':
      text('0\n');
      fixture.sinkFailure = profile.variant;
      break;
    case 'LIF-05':
      fixture.sourceFailure = true;
      fixture.cleanupFailure = true;
      break;
    case 'LIF-08':
      fixture.argv = ['-o', 'json', '-c', '.[]'];
      text('[1,2]\n');
      fixture.delayedWrite = true;
      break;
    case 'LIF-10':
      fixture.sourceFailure = true;
      fixture.cleanupFailure = true;
      fixture.lateReturn = true;
      break;
    default:
      throw new TypeError('No declared command fixture');
  }
  return fixture;
}
