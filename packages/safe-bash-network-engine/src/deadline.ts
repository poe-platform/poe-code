/** Long deadlines are rearmed rather than truncated by the host timer range. */
export function scheduleNetworkDeadline(milliseconds: number, expire: () => void): () => void {
  const deadline = performance.now() + milliseconds;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  const arm = (): void => {
    if (closed || !Number.isFinite(deadline)) return;
    const remaining = deadline - performance.now();
    timer = setTimeout(remaining > 2_147_483_647 ? arm : expire, Math.max(0, Math.min(remaining, 2_147_483_647)));
  };
  arm();
  return () => { closed = true; clearTimeout(timer); };
}
