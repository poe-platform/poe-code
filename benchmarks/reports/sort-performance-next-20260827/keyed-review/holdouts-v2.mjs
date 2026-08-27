import { holdouts, capIntent, mutationIntent } from './holdouts.mjs';

export function holdoutsV2() {
  const rows = holdouts();
  rows.find(row => row.id === 'input-error-keeps-destination').expected.stderr = Buffer.from("sort: ENOENT: no such file or directory, readStream '/absent'\n").toString('base64');
  const budget = rows.find(row => row.id === 'output-budget-rejection');
  budget.limits = { maxOutputBytes: 3 };
  budget.expected.rejection = 'maxOutputBytes';
  return rows;
}

export const proposedCapIntentV2 = {
  ...capIntent,
  binding: 'Bind entry/retained limits and actual conservatively charged NEW backing after root adjudication and exact candidate route. Existing owned record storage remains separately input-budget bounded. No expected ordering/byte/effect change.',
  hugeRecord: 'Three records with small numeric second key and oversized unrelated suffix. Same exact numeric output. Independently trace whole-record ownership/bound and newly retained descriptor backing; selected-key-length charging can be sound if copied selected-key strings alone are retained, without extracted byteviews or whole-record decoded strings. Do not require duplicate charge for existing owned record bytes.',
  retained: 'Construct records whose conservative newly retained backing/string aggregate charge is nearest representable below/at/above B. Preserve output/input stable ties. Record charge quantization and assert admissions stay within B. Reject normalized-prefix-only accounting if suffix backing can survive.',
};

export const proposedMutationIntentV2 = mutationIntent.map(([name, intent]) => name === 'backing-charge'
  ? [name, 'Charge only normalized whole/fraction lengths instead of potentially retained selected-key decoded backing; huge-key suffix detects. Separately inspect that no extracted view or undisclosed whole-record decoded backing is retained; huge unrelated record suffix alone is not proof of undercharge.']
  : [name, intent]);
