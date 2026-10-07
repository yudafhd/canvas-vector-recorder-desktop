/** NativeTraceEngine.hypot: preserve the reference's two-channel arithmetic. */
export function geometricHypot(x: number, y: number) {
  x = Math.abs(x); y = Math.abs(y); const maximum = Math.max(x, y);
  return maximum === 0 ? 0 : Math.sqrt((x / maximum) ** 2 + (y / maximum) ** 2) * maximum;
}
