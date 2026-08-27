import { finish, snapshot } from "./harness.mjs";
import { publicChecks } from "./public-checks.mjs";

const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== "--source-commit")) throw new Error("usage: node verify-public.mjs [--source-commit COMMIT]");
const report = snapshot(args[1] ?? "HEAD");
try {
  publicChecks(report);
  finish(report, 0);
} catch (error) {
  finish(report, 1, error);
}
