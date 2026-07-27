import type { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';

export type WeatherIconName = ComponentProps<typeof Ionicons>['name'];

export type WeatherInfo = {
  temperature: number;
  icon: WeatherIconName;
  description: string;
};

// WMO weather codes: https://open-meteo.com/en/docs
function mapWeatherCode(code: number): { icon: WeatherIconName; description: string } {
  if (code === 0) return { icon: 'sunny', description: '맑음' };
  if (code === 1 || code === 2) return { icon: 'partly-sunny', description: '구름 조금' };
  if (code === 3) return { icon: 'cloudy', description: '흐림' };
  if (code === 45 || code === 48) return { icon: 'cloud-outline', description: '안개' };
  if (code >= 51 && code <= 67) return { icon: 'rainy', description: '비' };
  if (code >= 71 && code <= 77) return { icon: 'snow', description: '눈' };
  if (code >= 80 && code <= 82) return { icon: 'rainy', description: '소나기' };
  if (code >= 85 && code <= 86) return { icon: 'snow', description: '눈 소나기' };
  if (code >= 95) return { icon: 'thunderstorm', description: '뇌우' };
  return { icon: 'partly-sunny', description: '' };
}

export async function fetchCurrentWeather(latitude: number, longitude: number): Promise<WeatherInfo> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Weather request failed with status ${response.status}`);
  }
  const data = await response.json();
  const temperature = data?.current_weather?.temperature;
  const weatherCode = data?.current_weather?.weathercode;
  if (typeof temperature !== 'number' || typeof weatherCode !== 'number') {
    throw new Error('Unexpected weather response shape');
  }
  const { icon, description } = mapWeatherCode(weatherCode);
  return { temperature: Math.round(temperature), icon, description };
}
