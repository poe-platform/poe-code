import { createCurlCommand } from "./curl.js";
export * from "./types.js";
export { createNodeHttpTransport } from "./transport.js";
export { createCurlCommand } from "./curl.js";
export function createNetworkCommands(options) {
    return [createCurlCommand(options)];
}
export function networkCommands(options) {
    const definitions = createNetworkCommands(options);
    return {
        name: "network-commands",
        setup(host) {
            if (!options.replace && host.commands.has("curl"))
                throw new Error("Command already registered: curl");
            for (const definition of definitions)
                host.commands.register(definition, { replace: options.replace ?? false });
        },
    };
}
export const createCurlCommands = createNetworkCommands;
export const curlCommands = networkCommands;
//# sourceMappingURL=index.js.map