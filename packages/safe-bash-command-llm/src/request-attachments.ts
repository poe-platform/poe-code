/** Visit current and historical attachments without materializing another list. */
export function* requestAttachments<T>(request: {
  readonly attachments: readonly T[];
  readonly messages?: readonly { readonly attachments?: readonly T[] }[];
}): Generator<T> {
  yield* request.attachments;
  for (const message of request.messages ?? []) yield* message.attachments ?? [];
}
