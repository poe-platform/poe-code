import http from "node:http";
import { createRequire } from "node:module";
const native = createRequire(import.meta.url)("./mcp-oauth-rust.node");
export function buildSuccessPage(landingPage) {
  return native.renderSuccessPage(landingPage?.title, landingPage?.body);
}
function callbackParameters(url) {
  return { code: url.searchParams.get("code"), error: url.searchParams.get("error"), errorDescription: url.searchParams.get("error_description"), state: url.searchParams.get("state"), iss: url.searchParams.get("iss") };
}
function manualParameters(input) {
  const text = native.normalizeCallbackInput(input);
  if (text.length === 0) return null;
  try { return callbackParameters(new URL(text)); }
  catch { return { code: text, error: null, errorDescription: null, state: null, iss: null }; }
}
export function extractCodeFromInput(input) {
  return manualParameters(input)?.code ?? null;
}
export async function createLoopbackAuthorizationSession(options = {}) {
  const callbackPath = options.callbackPath ?? "/callback";
  const server = options.createServer ? options.createServer() : http.createServer();
  const port = await new Promise((resolve,reject) => {
    const onError = error => { server.off("error",onError); reject(error); };
    server.once("error",onError);
    try {
      server.listen(0,"127.0.0.1",() => { server.off("error",onError); resolve(server.address().port); });
    } catch (error) { server.off("error",onError); reject(error); }
  });
  let closed = false;
  const listeners = new Set();
  const pending = new Set();
  return {
    redirectUri: `http://127.0.0.1:${port}${callbackPath}`,
    async waitForCode(authorizationUrl) {
      if (closed) throw new Error("OAuth authorization session closed");
      const binding = new native.NativeCallbackBinding(new URL(authorizationUrl).searchParams.get("state"));
      return new Promise((resolve,reject) => {
        let settled = false;
        const cancel = () => finish(false,new Error("OAuth authorization session closed"));
        const finish = (success,value) => {
          if (settled) return;
          settled = true; pending.delete(cancel);
          if (success) resolve(value); else reject(value);
        };
        pending.add(cancel);
        const onRequest = (request,response) => {
          let url;
          try { url = new URL(request.url ?? "/","http://127.0.0.1"); }
          catch { response.writeHead(400); response.end("Invalid OAuth callback"); return; }
          if (url.pathname !== callbackPath) { response.writeHead(404); response.end("Not found"); return; }
          const result = binding.resolve(JSON.stringify(callbackParameters(url)));
          if (Object.hasOwn(result,"error")) {
            response.writeHead(400); response.end(result.response); finish(false,new Error(result.error));
          } else {
            response.writeHead(200,{ "Content-Type": "text/html" }); response.end(buildSuccessPage(options.landingPage)); finish(true,result.code);
          }
        };
        server.on("request",onRequest); listeners.add(onRequest);
        if (options.readLine !== undefined) {
          options.readLine().then(input => {
            if (settled) return;
            const parameters = manualParameters(input);
            if (parameters === null) { finish(false,new Error("OAuth callback missing authorization code")); return; }
            const result = binding.resolve(JSON.stringify(parameters));
            if (Object.hasOwn(result,"error")) finish(false,new Error(result.error)); else finish(true,result.code);
          }).catch(error => finish(false,error instanceof Error ? error : new Error(String(error))));
        }
        if (options.openBrowser !== undefined) options.openBrowser(authorizationUrl).catch(error => finish(false,error));
      });
    },
    close() {
      if (closed) return;
      closed = true;
      for (const cancel of pending) cancel();
      for (const listener of listeners) server.off("request",listener);
      listeners.clear();
      server.closeAllConnections?.(); server.close();
    }
  };
}
