import { syntheticState, verdict } from "./verdict.mjs";
const id = process.argv[2], state = syntheticState(id), result = verdict(state);
process.stdout.write(JSON.stringify({ id, synthetic: true, state, result }) + "\n");
process.exitCode = result.exitCode;
