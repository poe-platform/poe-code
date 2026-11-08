import { admitActualJob } from './parent-gate.mjs';
import path from 'node:path';
export async function parentSection({job,receipt,evidence,id,seen,verify,durable,phases}) {
      const final = await admitActualJob({ expected: job, processReceipt: receipt, rawFile: path.join(evidence, id, 'stdout.raw'), seen, verify,
        capture: record => durable(path.join(evidence, id, 'RAW-ADMISSION.json'), record) });
      phases.push(final.requiredChildPhase);
  return final;
}
