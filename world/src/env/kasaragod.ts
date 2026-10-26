import SunCalc from 'suncalc';

/**
 * Real-world conditions in Kasaragod, Kerala: the time there, where the sun and moon
 * are, and the current weather (Open-Meteo, free and without tracking).
 */
export const KASARAGOD = { lat: 12.4996, lon: 74.9869, timeZone: 'Asia/Kolkata' };

export interface Weather {
  /** °C */
  temperature: number;
  /** 0–1 */
  cloudCover: number;
  /** mm in the last hour */
  rain: number;
  /** km/h */
  wind: number;
  /** WMO weather code */
  code: number;
  label: string;
  emoji: string;
  /** true when the weather came from the live service */
  live: boolean;
}

export interface Conditions {
  now: Date;
  /** "7:42 PM" in Kasaragod */
  clock: string;
  /** Sun height above the horizon in radians (negative at night) */
  sunAltitude: number;
  /** Sun compass direction in radians (SunCalc: 0 = south, positive = west) */
  sunAzimuth: number;
  moonAltitude: number;
  moonAzimuth: number;
  /** 0 = deep night, 1 = full daylight */
  daylight: number;
  /** 0–1: how much the monsoon season is in swing (June–September) */
  monsoon: number;
  weather: Weather;
}

const WMO: Record<number, [string, string]> = {
  0: ['Clear sky', '☀️'],
  1: ['Mostly clear', '🌤️'],
  2: ['Partly cloudy', '⛅'],
  3: ['Overcast', '☁️'],
  45: ['Fog', '🌫️'],
  48: ['Fog', '🌫️'],
  51: ['Light drizzle', '🌦️'],
  53: ['Drizzle', '🌦️'],
  55: ['Heavy drizzle', '🌧️'],
  61: ['Light rain', '🌦️'],
  63: ['Rain', '🌧️'],
  65: ['Heavy rain', '🌧️'],
  80: ['Rain showers', '🌦️'],
  81: ['Rain showers', '🌧️'],
  82: ['Heavy showers', '⛈️'],
  95: ['Thunderstorm', '⛈️'],
  96: ['Thunderstorm', '⛈️'],
  99: ['Thunderstorm', '⛈️'],
};

/** A believable guess for when the live weather can't be reached. */
function seasonalGuess(now: Date): Weather {
  const month = Number(new Intl.DateTimeFormat('en', { timeZone: KASARAGOD.timeZone, month: 'numeric' }).format(now));
  const monsoon = month >= 6 && month <= 9;
  return {
    temperature: monsoon ? 26 : 30,
    cloudCover: monsoon ? 0.85 : 0.3,
    rain: monsoon ? 1.2 : 0,
    wind: monsoon ? 18 : 10,
    code: monsoon ? 61 : 1,
    label: monsoon ? 'Light rain' : 'Mostly clear',
    emoji: monsoon ? '🌦️' : '🌤️',
    live: false,
  };
}

let cached: { at: number; weather: Weather } | null = null;
const WEATHER_TTL_MS = 10 * 60_000;

export async function fetchWeather(now = new Date()): Promise<Weather> {
  if (cached && Date.now() - cached.at < WEATHER_TTL_MS) return cached.weather;
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${KASARAGOD.lat}&longitude=${KASARAGOD.lon}` +
      '&current=temperature_2m,precipitation,rain,cloud_cover,wind_speed_10m,weather_code&timezone=Asia%2FKolkata';
    const res = await fetch(url);
    if (!res.ok) throw new Error(String(res.status));
    const c = (await res.json()).current;
    const code = Number(c.weather_code) || 0;
    const [label, emoji] = WMO[code] ?? ['Cloudy', '☁️'];
    const weather: Weather = {
      temperature: Math.round(Number(c.temperature_2m)),
      cloudCover: Math.min(Math.max(Number(c.cloud_cover) / 100, 0), 1),
      rain: Math.max(Number(c.rain) || 0, Number(c.precipitation) || 0),
      wind: Number(c.wind_speed_10m) || 0,
      code,
      label,
      emoji,
      live: true,
    };
    cached = { at: Date.now(), weather };
    return weather;
  } catch {
    return seasonalGuess(now);
  }
}

export function sky(now = new Date()) {
  const sun = SunCalc.getPosition(now, KASARAGOD.lat, KASARAGOD.lon);
  const moon = SunCalc.getMoonPosition(now, KASARAGOD.lat, KASARAGOD.lon);
  // Soft change from night to day around sunrise and sunset
  const daylight = Math.min(Math.max((sun.altitude + 0.1) / 0.3, 0), 1);
  return { sunAltitude: sun.altitude, sunAzimuth: sun.azimuth, moonAltitude: moon.altitude, moonAzimuth: moon.azimuth, daylight };
}

export function clock(now = new Date()): string {
  return new Intl.DateTimeFormat('en-IN', { timeZone: KASARAGOD.timeZone, hour: 'numeric', minute: '2-digit', hour12: true }).format(now).toUpperCase();
}

export function monsoonStrength(now = new Date()): number {
  const month = Number(new Intl.DateTimeFormat('en', { timeZone: KASARAGOD.timeZone, month: 'numeric' }).format(now));
  return ({ 5: 0.3, 6: 1, 7: 1, 8: 0.9, 9: 0.6, 10: 0.3 } as Record<number, number>)[month] ?? 0;
}

/**
 * Turn a sun or moon position into a direction in the world. The street runs east–west
 * along the X axis, the building faces south (towards +Z).
 */
export function skyDirection(altitude: number, azimuth: number): [number, number, number] {
  // SunCalc azimuth: 0 = south, +π/2 = west. World: +Z = south, +X = east.
  const x = -Math.sin(azimuth) * Math.cos(altitude);
  const y = Math.sin(altitude);
  const z = Math.cos(azimuth) * Math.cos(altitude);
  return [x, y, z];
}
