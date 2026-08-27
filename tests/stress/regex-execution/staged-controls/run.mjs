import { superviseControl } from './supervisor.mjs';

if (process.argv.length !== 3 || !['benign', 'waiting'].includes(process.argv[2])) {
  throw new Error('Usage: node [fixed flags] run.mjs benign|waiting; one control only');
}
const requiredFlags = [
  '--unhandled-rejections=strict',
  '--max-old-space-size=32',
  '--max-semi-space-size=1',
  '--stack-size=256',
];
if (process.execArgv.length !== requiredFlags.length
  || !requiredFlags.every((flag, index) => process.execArgv[index] === flag)
  || process.env.NODE_OPTIONS) {
  throw new Error('Use the documented exact parent flags and unset NODE_OPTIONS');
}
const control = await superviseControl(process.argv[2]);
console.log(JSON.stringify({
  schema: 1,
  cohort: 'staged-controls-only',
  node: process.version,
  v8: process.versions.v8,
  platform: process.platform,
  arch: process.arch,
  parentFlags: process.execArgv,
  controlsExecuted: 1,
  controlsPassed: control.pass ? 1 : 0,
  productExecutions: 0,
  regexExecutions: 0,
  provenProductViolations: 0,
  control,
}, null, 2));
process.exitCode = control.pass ? 0 : 1;
