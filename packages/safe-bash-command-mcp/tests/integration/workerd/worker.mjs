import { fetchRemoteMcpSchema, createRemoteMcpCommands, mcpCommands, createMcpCommands, createMcpCommand, initRemoteMcpConfiguration, importRemoteMcpAuthentication, resetRemoteMcpAuthentication } from 'safe-bash-command-mcp/remote';
import { createCommandArguments, toByteSource } from '@poe-platform/safe-bash/contracts';

function check(value, message) { if (!value) throw new Error(message); }

export default {
  async test() {
    check(createMcpCommand().name === 'mcp', 'default management factory missing');
    check(createMcpCommands().length === 1, 'management list factory missing');
    const registered = new Map();
    mcpCommands().setup({ commands: { has: name => registered.has(name), register: command => registered.set(command.name, command) } });
    check(registered.has('mcp'), 'empty management plugin did not register');

    const oauthServer = initRemoteMcpConfiguration([{ name: 'host', url: 'https://resource.example/mcp', tools: [], auth: { type: 'oauth', clientMode: 'dynamic' } }]).configuration.servers[0];
    let imported = false, reset = false;
    const binding = { env: {}, oauth: {
      async importSession(_server, _session, options) { check(options.timeoutMs === Infinity, 'import lock is bounded'); imported = true; },
      async reset(_server, options) { check(options.timeoutMs === Infinity, 'reset lock is bounded'); reset = true; },
    } };
    await importRemoteMcpAuthentication(oauthServer, {
      tokens: { access_token: 'synthetic', token_type: 'Bearer' },
      clientInfo: { client_id: 'host', redirect_uris: ['https://host.example/callback'] },
    }, { binding, timeoutMs: Infinity, fetch: async url => Response.json(String(url).includes('oauth-protected-resource')
      ? { resource: oauthServer.url, authorization_servers: ['https://auth.example'] }
      : { issuer: 'https://auth.example', authorization_endpoint: 'https://auth.example/authorize', token_endpoint: 'https://auth.example/token', response_types_supported: ['code'], code_challenge_methods_supported: ['S256'] }) });
    await resetRemoteMcpAuthentication(oauthServer, { binding, timeoutMs: Infinity });
    check(imported && reset, 'portable credential hooks did not execute');

    for (const authentication of ['fetch', 'provider']) {
      const methods = [];
      const tool = { name: 'echo', inputSchema: { type: 'object', properties: { text: { type: 'string', 'x-mcp-header': 'Text' } }, required: ['text'] } };
      const transportFetch = async (_url, init) => {
        check(new Headers(init.headers).get('Authorization') === 'Bearer synthetic', 'host auth missing');
        if (init.method === 'DELETE') return new Response(null, { status: 204 });
        const request = JSON.parse(init.body);
        methods.push(request.method);
        if (request.method === 'notifications/initialized') return new Response(null, { status: 202 });
        const result = request.method === 'initialize'
          ? { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } }
          : request.method === 'tools/list' ? { tools: [tool] }
          : { content: [{ type: 'text', text: request.params.arguments.text }, { type: 'image', data: 'AA==', mimeType: 'image/png' }] };
        return Response.json({ jsonrpc: '2.0', id: request.id, result });
      };
      const fetch = authentication === 'fetch' ? (url, init) => {
        const headers = new Headers(init.headers); headers.set('Authorization', 'Bearer synthetic');
        return transportFetch(url, { ...init, headers });
      } : transportFetch;
      const server = { name: 'catalog', url: 'https://fixture.example/mcp', protocolVersion: '2025-03-26',
        ...(authentication === 'provider' ? { oauth: { provider: {
          authorizeRequest: async ({ headers }) => { headers.set('Authorization', 'Bearer synthetic'); },
          handleUnauthorized: async () => ({ action: 'fail' })
        } } } : {}) };
      const schema = await fetchRemoteMcpSchema(server, { fetch });
      check(schema.tools[0].name === 'echo', 'discovery failed');
      const [command] = await createRemoteMcpCommands([{ ...server, tools: schema.tools }], { fetch });
      let stdout = '', stderr = '';
      const argumentsValue = createCommandArguments([]).withValues(['echo', '--text', 'worker invocation é🚀']);
      const result = await command.execute({ command: 'catalog', args: argumentsValue.args, argumentValues: argumentsValue,
        cwd: '/', env: {}, fs: {}, signal: new AbortController().signal, stdin: toByteSource(''),
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
      check(result.exitCode === 0 && stdout.includes('worker invocation é🚀') && stderr === '', 'invocation failed: ' + stdout + stderr);
      check(methods.includes('tools/list') && methods.includes('tools/call'), 'remote operations missing');
    }
  }
};
