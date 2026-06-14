export interface JitterConfig {
  readonly baseMs: number;
}

export type Rng = () => number;

export function computeJitterMs(config: JitterConfig, rng: Rng): number {
  if (config.baseMs <= 0) return 0;
  const half = config.baseMs / 2;
  const r = rng();
  return Math.floor(half + r * config.baseMs);
}
