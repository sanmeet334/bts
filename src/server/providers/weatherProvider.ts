import { env } from '../config/env.js';

export interface WeatherSnapshot {
  condition: 'CLEAR' | 'RAIN' | 'HEAVY_RAIN';
  speedImpactFactor: number;
  provider: string;
  isSimulated: boolean;
  observedAt: string;
}

export async function getWeatherSnapshot(
  overrideCondition?: 'CLEAR' | 'RAIN' | 'HEAVY_RAIN'
): Promise<WeatherSnapshot> {
  const condition = overrideCondition || 'CLEAR';
  const factor =
    condition === 'HEAVY_RAIN' ? 0.72 : condition === 'RAIN' ? 0.86 : 1.0;

  return {
    condition,
    speedImpactFactor: factor,
    provider: env.liveWeatherApiKey
      ? 'External Weather Adapter (Fallback Simulated)'
      : 'SIMULATED_WEATHER_MODEL',
    isSimulated: true,
    observedAt: new Date().toISOString(),
  };
}
