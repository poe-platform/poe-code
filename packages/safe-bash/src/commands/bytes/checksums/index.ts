import type { CommandDefinition } from "../../../contracts/index.js";
import { command } from "safe-bash-checksum-engine";
import { createMd5sumCommand } from "../../md5sum/index.js";
import { createSha1sumCommand } from "../../sha1sum/index.js";
import { createSha256sumCommand } from "../../sha256sum/index.js";
import { resolveInputLimit, type ByteInputOptions } from "../input-budget.js";
export function createChecksumCommands(options: ByteInputOptions = {}): readonly CommandDefinition[] {
 const maximum = resolveInputLimit(options);
 return [command("sha512sum", "sha512", maximum), command("sha384sum", "sha384", maximum), createSha256sumCommand(options), command("sha224sum", "sha224", maximum), createSha1sumCommand(options), createMd5sumCommand(options), command("cksum", "crc", maximum)];
}

export { evalSyncChecksum } from "safe-bash-checksum-engine";

import { syncCommandEvaluators } from "../../internal.js";
import { evalSyncChecksum } from "safe-bash-checksum-engine";
syncCommandEvaluators.evalSyncChecksum = evalSyncChecksum;
