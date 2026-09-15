# Scalar MCP result mapper parity

After supporting scalar output schemas, a compile-check reproduced the remaining SDK restriction: a synchronous mapper returning a string was rejected as incompatible with Record<string, unknown>.

Expose MCPResultValue for synchronous JSON-root mapper values, retaining existing object and array element typing and runtime validation. Preserve the compile-check that rejects asynchronous mappers.

Validation: the scalar mapper type check passes, including the asynchronous negative contract. Fourteen modern/legacy output-root tests cover scalar mapping without changing the SDK handler result. Combined mapper, runtime, Toolcraft and approval suites: 126 passing checks.
