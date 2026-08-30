import { commandCases as originals, shebangCases as originalScripts } from './cases.mjs';
export { scriptBody, boundedCases, baseValues } from './cases.mjs';

export const commandCases = originals.map(row => {
  if (row.id === 'lookup-before-ignore-and-unset') return { ...row, args: ['-S', '-i -u WORDS PATH=${PATH} COPY=${WORDS} argvprobe ${WORDS}'] };
  if (row.id === 'earlier-ignore-lookup') return { ...row, args: ['-i', '-S', 'PATH=${PATH} SNAP=${WORDS} argvprobe ${WORDS}'] };
  if (row.id === 'assignment-options-stop') return { ...row, args: ['-S', '-i PATH=${PATH} KEEP=one KEEP=two argvprobe -u KEEP'] };
  return row;
});
export const shebangCases = originalScripts.map(row => row.id === 'split-assignment-and-clear' ? { ...row, optional: '-S -i PATH=${PATH} MARK=kept bash -e' } : row);
