import { isValidUri } from "tiny-stdio-mcp-server/protocol";
import type { JsonRpcMessageLayer, RequestId } from "./internal.js";

export interface NotificationFilter {
  toolsListChanged?: boolean;
  promptsListChanged?: boolean;
  resourcesListChanged?: boolean;
  resourceSubscriptions?: string[];
}

export interface SubscriptionOptions {
  signal?: AbortSignal;
}

export interface McpSubscription {
  readonly id: RequestId;
  readonly notifications: NotificationFilter;
  readonly closed: Promise<void>;
  cancel(): void;
}

interface Entry {
  requested: NotificationFilter;
  accepted?: NotificationFilter;
  acknowledge(filter: NotificationFilter): void;
  reject(error: Error): void;
  cancel(): void;
}

const listFields = {
  "notifications/tools/list_changed": "toolsListChanged",
  "notifications/prompts/list_changed": "promptsListChanged",
  "notifications/resources/list_changed": "resourcesListChanged"
} as const;

function filterValue(value: unknown): NotificationFilter {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Notification filter must be an object");
  }
  const input = value as Record<string, unknown>;
  const filter: NotificationFilter = {};
  for (const key of Object.values(listFields)) {
    if (input[key] !== undefined && typeof input[key] !== "boolean") {
      throw new Error(`${key} must be a boolean`);
    }
    if (input[key] === true) filter[key] = true;
  }
  const uris = input.resourceSubscriptions;
  if (uris !== undefined) {
    if (
      !Array.isArray(uris) ||
      uris.length > 1024 ||
      !uris.every((uri) => {
        if (typeof uri !== "string" || uri.length > 8192) return false;
        return isValidUri(uri);
      })
    )
      throw new Error(
        "Resource subscriptions require at most 1024 absolute URIs of at most 8192 characters"
      );
    filter.resourceSubscriptions = [...new Set<string>(uris)];
  }
  return filter;
}

export class SubscriptionManager {
  private readonly entries = new Map<RequestId, Entry>();

  constructor(private readonly layer: JsonRpcMessageLayer) {
    layer.onNotification("notifications/subscriptions/acknowledged", (params) => {
      if (typeof params !== "object" || params === null) return;
      const input = params as Record<string, unknown>;
      const metadata = input._meta as Record<string, unknown> | undefined;
      const id = metadata?.["io.modelcontextprotocol/subscriptionId"];
      if (typeof id !== "string" && typeof id !== "number") return;
      const entry = this.entries.get(id);
      if (entry === undefined || entry.accepted !== undefined) return;
      try {
        const accepted = filterValue(input.notifications);
        if (
          Object.values(listFields).some(
            (key) => accepted[key] === true && entry.requested[key] !== true
          ) ||
          accepted.resourceSubscriptions?.some(
            (uri) => !entry.requested.resourceSubscriptions?.includes(uri)
          )
        ) {
          throw new Error("Subscription acknowledgement exceeds the requested filter");
        }
        entry.accepted = accepted;
        entry.acknowledge(accepted);
      } catch (error) {
        entry.reject(error instanceof Error ? error : new Error(String(error)));
        entry.cancel();
      }
    });
  }

  accepts(method: string, params: unknown): boolean {
    if (typeof params !== "object" || params === null) return false;
    const input = params as Record<string, unknown>;
    const metadata = input._meta as Record<string, unknown> | undefined;
    const id = metadata?.["io.modelcontextprotocol/subscriptionId"];
    if (typeof id !== "string" && typeof id !== "number") return false;
    const accepted = this.entries.get(id)?.accepted;
    if (accepted === undefined) return false;
    const key = listFields[method as keyof typeof listFields];
    if (key !== undefined) return accepted[key] === true;
    return (
      method === "notifications/resources/updated" &&
      typeof input.uri === "string" &&
      accepted.resourceSubscriptions?.includes(input.uri) === true
    );
  }

  async listen(
    value: NotificationFilter,
    options: SubscriptionOptions = {}
  ): Promise<McpSubscription> {
    if (options.signal?.aborted) throw options.signal.reason;
    if (this.entries.size >= 64) throw new Error("Too many MCP subscriptions");
    const requested = filterValue(value);
    let id!: RequestId;
    let canceled = false;
    let acknowledge!: (filter: NotificationFilter) => void;
    let reject!: (error: Error) => void;
    const acknowledged = new Promise<NotificationFilter>((resolve, fail) => {
      acknowledge = resolve;
      reject = fail;
    });
    const cancel = (): void => {
      if (canceled) return;
      canceled = true;
      clearTimeout(timer);
      this.entries.delete(id);
      const error = new Error("MCP subscription canceled");
      reject(error);
      if (this.layer.cancelRequest(id, error)) {
        try {
          this.layer.sendNotification("notifications/cancelled", { requestId: id });
        } catch {
          /* disposed */
        }
      }
    };
    const entry: Entry = {
      requested,
      acknowledge: (filter) => {
        clearTimeout(timer);
        acknowledge(filter);
      },
      reject,
      cancel
    };
    const completion = this.layer.sendRequest(
      "subscriptions/listen",
      { notifications: requested },
      {
        timeoutMs: null,
        onRequestId: (requestId) => {
          id = requestId;
          this.entries.set(id, entry);
        }
      }
    );
    const timer = setTimeout(() => {
      reject(new Error("MCP subscription acknowledgement timed out"));
      cancel();
    }, this.layer.requestTimeoutMs);
    const abort = (): void => {
      reject(options.signal!.reason);
      cancel();
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    const closed = completion
      .then((result) => {
        const metadata = (result as { _meta?: Record<string, unknown> })._meta;
        if (metadata?.["io.modelcontextprotocol/subscriptionId"] !== id) {
          throw new Error("Invalid subscription completion ID");
        }
        if (entry.accepted === undefined)
          throw new Error("Subscription completed before acknowledgement");
      })
      .catch((error: unknown) => {
        reject(error instanceof Error ? error : new Error(String(error)));
        if (!canceled) throw error;
      })
      .finally(() => {
        options.signal?.removeEventListener("abort", abort);
        clearTimeout(timer);
        this.entries.delete(id);
      });
    void closed.catch(() => undefined);
    try {
      const accepted = await acknowledged;
      return { id, notifications: structuredClone(accepted), closed, cancel };
    } catch (error) {
      cancel();
      throw error;
    }
  }

  close(): void {
    for (const entry of this.entries.values()) entry.cancel();
    this.entries.clear();
  }
}
