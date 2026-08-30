import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import { createEncodingCommands } from "./encoding/index.js";
import { createChecksumCommands } from "./checksums/index.js";
import { createCompressionCommands } from "./compression/index.js";

export interface ByteCommandsOptions {
  readonly replace?: boolean;
}

export function createByteCommands(): readonly CommandDefinition[] {
  return [...createEncodingCommands(), ...createChecksumCommands(), ...createCompressionCommands()];
}

export function byteCommands(options: ByteCommandsOptions = {}): VirtualShellPlugin {
  return {
    name: "byte-commands",
    setup(host) {
      const definitions = createByteCommands();
      if (!options.replace) for (const definition of definitions) {
        if (host.commands.has(definition.name)) throw new Error(`Command already registered: ${definition.name}`);
      }
      for (const definition of definitions) host.commands.register(definition, { replace: options.replace ?? false });
    },
  };
}
