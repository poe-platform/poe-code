export async function fetchMcpResponse(
  fetchImplementation: (input: string | URL, init?: RequestInit) => Promise<Response>,
  input: string | URL,
  init: RequestInit = {}
): Promise<Response> {
  const response = await fetchImplementation(input, { ...init, redirect: "error" });
  if (response.redirected || response.type === "opaqueredirect") {
    void response.body?.cancel().catch(() => undefined);
    throw new Error("MCP HTTP redirects are not allowed");
  }
  return response;
}
