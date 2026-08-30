import { createBaseCommand } from "./base.js";
import { createOdCommand } from "./od.js";
import { createXxdCommand } from "./xxd.js";
export function createEncodingCommands() {
    return [createBaseCommand("base64"), createBaseCommand("base32"), createXxdCommand(), createOdCommand()];
}
//# sourceMappingURL=index.js.map