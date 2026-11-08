import { isValidUri } from "./uri.js";
import { JSON_RPC_ERROR_CODES, type HandleResult, type JSONRPCNotification } from "./types.js";

const listNotifications = {
  "notifications/tools/list_changed": "toolsListChanged",
  "notifications/prompts/list_changed": "promptsListChanged",
  "notifications/resources/list_changed": "resourcesListChanged"
} as const;

interface Subscription {
  filter: Record<string, true | string[]>;
  resourceUris: ReadonlySet<string>;
  ready: boolean;
  finish(): void;
}

export class SubscriptionRegistry {
  private readonly subscriptions = new Map<string | number, Subscription>();

  constructor(
    private readonly listener: (notification: JSONRPCNotification) => void | Promise<void>,
    private readonly supportNotifications: boolean,
    private readonly supportResourceSubscriptions: boolean
  ) {}

  get size(): number {
    return this.subscriptions.size;
  }

  async listen(
    id: string | number | undefined,
    value: unknown,
    signal: AbortSignal
  ): Promise<HandleResult> {
    if (id === undefined || (typeof id === "number" && !Number.isSafeInteger(id))) {
      return {
        error: {
          code: JSON_RPC_ERROR_CODES.INVALID_PARAMS,
          message: "subscriptions/listen requires a request ID"
        }
      };
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return {
        error: {
          code: JSON_RPC_ERROR_CODES.INVALID_PARAMS,
          message: "Subscription notifications must be an object"
        }
      };
    }
    const requested = value as Record<string, unknown>;
    const filter: Record<string, true | string[]> = {};
    for (const field of Object.values(listNotifications)) {
      if (requested[field] !== undefined && typeof requested[field] !== "boolean") {
        return {
          error: {
            code: JSON_RPC_ERROR_CODES.INVALID_PARAMS,
            message: `${field} must be a boolean`
          }
        };
      }
      if (this.supportNotifications && requested[field] === true) filter[field] = true;
    }
    const uris = requested.resourceSubscriptions;
    if (uris !== undefined) {
      if (!Array.isArray(uris) || uris.length > 1024 || !uris.every((uri) => {
        if (typeof uri !== "string" || uri.length > 8192) return false;
        return isValidUri(uri);
      })) {
        return {
          error: {
            code: JSON_RPC_ERROR_CODES.INVALID_PARAMS,
            message: "resourceSubscriptions must contain at most 1024 absolute URIs of at most 8192 characters"
          }
        };
      }
      if (this.supportResourceSubscriptions)
        filter.resourceSubscriptions = [...new Set<string>(uris)];
    }
    if (signal.aborted) return { result: undefined };
    let resolve!: (result: HandleResult) => void;
    const completed = new Promise<HandleResult>((complete) => {
      resolve = complete;
    });
    const entry: Subscription = {
      filter,
      resourceUris: new Set(Array.isArray(filter.resourceSubscriptions) ? filter.resourceSubscriptions : []),
      ready: false,
      finish: () => {
        signal.removeEventListener("abort", entry.finish);
        if (this.subscriptions.get(id) === entry) this.subscriptions.delete(id);
        resolve({ result: undefined });
      }
    };
    this.subscriptions.set(id, entry);
    signal.addEventListener("abort", entry.finish, { once: true });
    try {
      await this.listener({
        jsonrpc: "2.0",
        method: "notifications/subscriptions/acknowledged",
        params: {
          _meta: { "io.modelcontextprotocol/subscriptionId": id },
          notifications: structuredClone(filter)
        }
      });
      if (!signal.aborted) entry.ready = true;
      return await completed;
    } catch (error) {
      entry.finish();
      throw error;
    }
  }

  async emit(method: string, params?: Record<string, unknown>): Promise<void> {
    await Promise.all(
      [...this.subscriptions].map(async ([id, entry]) => {
        if (!entry.ready) return;
        const field = listNotifications[method as keyof typeof listNotifications];
        const selected =
          field !== undefined
            ? entry.filter[field] === true
            : method === "notifications/resources/updated" &&
              typeof params?.uri === "string" &&
              entry.resourceUris.has(params.uri);
        if (!selected) return;
        await this.listener({
          jsonrpc: "2.0",
          method,
          params: {
            ...params,
            _meta: { "io.modelcontextprotocol/subscriptionId": id }
          }
        });
      })
    );
  }
}
