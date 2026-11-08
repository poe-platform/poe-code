import { S, defineCommand, defineGroup } from "./index.js";
import { toolcraftCommands, toolcraftDefaults } from "./safe-bash.js";

const users = defineGroup({ name: "users", children: [
  defineCommand({ name: "list_users", params: S.Object({ limit: S.Number(), enabled: S.Boolean() }), handler: ({ params }) => params })
] as const });
const library = defineGroup({ name: "tools", children: [users] as const });
toolcraftCommands(library, { defaults: toolcraftDefaults(library, { "users/list_users": { limit: 25, enabled: false } }) });
// @ts-expect-error unknown declaration path
toolcraftDefaults(library, { "users/missing": { limit: 25 } });
// @ts-expect-error unknown parameter
toolcraftDefaults(library, { "users/list_users": { typo: 25 } });
// @ts-expect-error wrong schema value type
toolcraftDefaults(library, { "users/list_users": { limit: "25" } });
toolcraftDefaults([library] as const, { "tools/users/list_users": { limit: 25 } });
// @ts-expect-error multiple roots require the root prefix
toolcraftDefaults([library] as const, { "users/list_users": { limit: 25 } });
