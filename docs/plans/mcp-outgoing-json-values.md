# Outgoing MCP JSON values

Nine failing checks reproduced invalid request values being silently omitted or changed by JSON.stringify, writes happening before eventual timeout, and serialization hooks executing. Reject invalid request params before modern snapshots or wire writes. Share the existing bounded, descriptor-based JSON guard through the protocol module; it rejects cycles, nonfinite numbers, opaque values, sparse arrays, getters and serialization hooks while allowing shared references.

Apply the same guard to serialized notification/request params. Callback results, error data, HTTP direct writes and payload size remain audit work. Build and focused validation in progress.

Four additional failing legacy callback checks reproduced undefined/nonfinite/function-containing results becoming malformed or altered JSON-RPC replies. Reject invalid result values in serialization so the existing callback error path emits -32603. Full client verification is running.
