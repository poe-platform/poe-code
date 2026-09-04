import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import { createEncodingCommands } from "./encoding/index.js";
import { createChecksumCommands } from "./checksums/index.js";
import { createCompressionCommands } from "./compression/index.js";
import type { ByteInputOptions } from "./input-budget.js";
export type { ByteInputLimits, ByteInputOptions } from "./input-budget.js";

export interface ByteCommandsOptions {
  readonly replace?: boolean;
  /** Input limits for base64, base32, xxd and od only; ignored/skipped bytes count. */
  readonly encoding?: ByteInputOptions;
  /** Input limits for checksum commands only; manifests and referenced files share one invocation budget. */
  readonly checksums?: ByteInputOptions;
}

export function createByteCommands(options: Omit<ByteCommandsOptions, "replace"> = {}): readonly CommandDefinition[] {
  return [...createEncodingCommands(options.encoding), ...createChecksumCommands(options.checksums), ...createCompressionCommands()];
}

export function byteCommands(options: ByteCommandsOptions = {}): VirtualShellPlugin {
  return {
    name: "byte-commands",
    setup(host) {
      const definitions = createByteCommands(options);
      if (!options.replace) for (const definition of definitions) {
        if (host.commands.has(definition.name)) throw new Error(`Command already registered: ${definition.name}`);
      }
      for (const definition of definitions) host.commands.register(definition, { replace: options.replace ?? false });
    },
  };
}
