export interface ServiceCall {
  method: string;
  args: unknown[];
  result?: unknown;
  error?: unknown;
}

export interface FetchRoute {
  method?: string;
  url: string | ((url: string) => boolean);
  status?: number;
  json?: unknown;
  text?: string;
  error?: Error;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    ((typeof value === "object" && value !== null) || typeof value === "function") &&
    typeof (value as PromiseLike<unknown>).then === "function"
  );
}

export function fakeService<T extends object>(
  stubs: Partial<T> = {}
): T & { calls: ServiceCall[] } {
  const calls: ServiceCall[] = [];

  return new Proxy(stubs, {
    get(target, property, receiver) {
      if (property === "calls") {
        return calls;
      }

      const stub = Reflect.get(target, property, receiver) as unknown;
      if (typeof stub !== "function") {
        if (stub !== undefined) {
          return stub;
        }

        return (...args: unknown[]) => {
          const method = String(property);
          const error = new Error(`Unstubbed service method "${method}" was called.`);
          calls.push({ method, args, error });
          throw error;
        };
      }

      return (...args: unknown[]) => {
        const method = String(property);
        const call: ServiceCall = { method, args };
        calls.push(call);

        try {
          const result = Reflect.apply(stub, receiver, args) as unknown;
          if (!isPromiseLike(result)) {
            call.result = result;
            return result;
          }

          return Promise.resolve(result).then(
            (value) => {
              call.result = value;
              return value;
            },
            (error: unknown) => {
              call.error = error;
              throw error;
            }
          );
        } catch (error) {
          call.error = error;
          throw error;
        }
      };
    }
  }) as T & { calls: ServiceCall[] };
}

function routeDescription(route: FetchRoute): string {
  const method = route.method?.toUpperCase() ?? "*";
  const url = typeof route.url === "string" ? route.url : "<predicate>";
  return `${method} ${url}`;
}

function routeMatches(route: FetchRoute, request: Request): boolean {
  if (route.method !== undefined && route.method.toUpperCase() !== request.method.toUpperCase()) {
    return false;
  }
  return typeof route.url === "string" ? route.url === request.url : route.url(request.url);
}

export function fakeFetch(routes: FetchRoute[]): typeof globalThis.fetch & { calls: Request[] } {
  const calls: Request[] = [];

  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    calls.push(request);

    const route = routes.find((candidate) => routeMatches(candidate, request));
    if (route === undefined) {
      const configuredRoutes = routes.map(routeDescription).join(", ") || "none";
      throw new Error(
        `No fake fetch route matched ${request.method} ${request.url}. Configured routes: ${configuredRoutes}.`
      );
    }
    if (route.error !== undefined) {
      throw route.error;
    }

    if (Object.hasOwn(route, "json")) {
      return new Response(JSON.stringify(route.json), {
        status: route.status ?? 200,
        headers: { "content-type": "application/json" }
      });
    }
    return new Response(route.text ?? null, { status: route.status ?? 200 });
  };

  return Object.assign(fetch, { calls });
}
