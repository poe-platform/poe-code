# High Level CLI

<provider> is this context is an agent e.g. claude code, codex

## Global

poe-code --help
poe-code login

## Query

poe-code query [--text]
poe-code query --image
poe-code query --audio
poe-code query --video --params { resolution: "4k" }

## Agent - default

[agent] is the default and can be omitted

poe-code agent
poe-code [agent] configure <provider>
poe-code [agent] unconfigure <provider>
poe-code [agent] spawn <provider>
poe-code [agent] wrap <provider>
poe-code [agent] install <provider>
poe-code [agent] test <provider>

## Skill

poe-code skill configure # prompt for provider
poe-code skill configure <provider>
poe-code skill unconfigure <provider>
poe-code skill --help # explain that it will install skill

## MCP

poe-code mcp # output the configuration json
poe-code mcp run # start the stdio MCP server
poe-code mcp configure # prompt for provider, --yes auto selects default
poe-code mcp configure <provider>
poe-code mcp unconfigure <provider>
poe-code mcp --help
