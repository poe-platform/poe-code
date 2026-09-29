import { fetchRemoteMcpSchema, createRemoteMcpCommands } from 'safe-bash-mcp';
import { createCommandArguments, toByteSource } from '@poe-platform/safe-bash/contracts';

function check(value, message) { if (!value) throw new Error(message); }

export default {
  async test() {
    for (const authentication of ['fetch', 'provider']) {
      const methods = [];
      const tool = { name: 'echo', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } };
      const transportFetch = async (_url, init) => {
        check(new Headers(init.headers).get('Authorization') === 'Bearer synthetic', 'host auth missing');
        if (init.method === 'DELETE') return new Response(null, { status: 204 });
        const request = JSON.parse(init.body);
        methods.push(request.method);
        if (request.method === 'notifications/initialized') return new Response(null, { status: 202 });
        const result = request.method === 'initialize'
          ? { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } }
          : request.method === 'tools/list' ? { tools: [tool] }
          : { content: [{ type: 'text', text: request.params.arguments.text }] };
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
      const argumentsValue = createCommandArguments([]).withValues(['echo', '--text', 'worker invocation']);
      const result = await command.execute({ command: 'catalog', args: argumentsValue.args, argumentValues: argumentsValue,
        cwd: '/', env: {}, fs: {}, signal: new AbortController().signal, stdin: toByteSource(''),
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
      check(result.exitCode === 0 && stdout.includes('worker invocation') && stderr === '', 'invocation failed: ' + stdout + stderr);
      check(methods.includes('tools/list') && methods.includes('tools/call'), 'remote operations missing');
    }
  }
};
