import { useEffect, useState } from 'react';
import { clock, fetchWeather, monsoonStrength, sky, type Conditions, type Weather } from './kasaragod';

/*
 * For previews only: ?time=19:30 shows that time in Kasaragod today,
 * ?weather=rain|storm|clear|cloudy|fog overrides the weather.
 */
const params = new URLSearchParams(location.search);

function overrideTime(real: Date): Date {
  const t = params.get('time');
  if (!t) return real;
  const [h, m = '0'] = t.split(':');
  // Kasaragod is UTC+5:30 all year
  const day = new Date(real.getTime() + 5.5 * 3600_000);
  day.setUTCHours(Number(h) || 0, Number(m) || 0, 0, 0);
  return new Date(day.getTime() - 5.5 * 3600_000);
}

const PRESETS: Record<string, Partial<Weather>> = {
  clear: { cloudCover: 0.05, rain: 0, code: 0, label: 'Clear sky', emoji: '☀️' },
  cloudy: { cloudCover: 0.9, rain: 0, code: 3, label: 'Overcast', emoji: '☁️' },
  rain: { cloudCover: 0.95, rain: 3, wind: 20, code: 63, label: 'Rain', emoji: '🌧️' },
  storm: { cloudCover: 1, rain: 9, wind: 35, code: 95, label: 'Thunderstorm', emoji: '⛈️' },
  fog: { cloudCover: 0.8, rain: 0, code: 45, label: 'Fog', emoji: '🌫️' },
};

const FALLBACK: Weather = { temperature: 28, cloudCover: 0.3, rain: 0, wind: 8, code: 1, label: 'Mostly clear', emoji: '🌤️', live: false };

function snapshot(weather: Weather): Conditions {
  const now = overrideTime(new Date());
  const preset = PRESETS[params.get('weather') ?? ''];
  return {
    now,
    clock: clock(now),
    ...sky(now),
    monsoon: monsoonStrength(now),
    weather: preset ? { ...weather, ...preset } : weather,
  };
}

/** Kasaragod right now: refreshed every 30 s, weather every 10 minutes. */
export function useConditions(): Conditions {
  const [weather, setWeather] = useState<Weather>(FALLBACK);
  const [state, setState] = useState(() => snapshot(FALLBACK));

  useEffect(() => {
    let alive = true;
    const load = () => fetchWeather().then((w) => alive && setWeather(w));
    load();
    const id = setInterval(load, 10 * 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    setState(snapshot(weather));
    const id = setInterval(() => setState(snapshot(weather)), 30_000);
    return () => clearInterval(id);
  }, [weather]);

  return state;
}
