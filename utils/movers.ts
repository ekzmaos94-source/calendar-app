export type MoverNews = {
  headline: string;
  url: string;
  source: string;
  datetime: number;
};

export type Mover = {
  symbol: string;
  name: string;
  sector: string;
  open: number;
  current: number;
  changePercent: number;
  news: MoverNews | null;
};

export type MoversData = {
  generatedAt: string;
  tradingDate: string;
  thresholdPercent: number;
  movers: Mover[];
};

const MOVERS_URL =
  'https://raw.githubusercontent.com/ekzmaos94-source/calendar-app/master/data/movers.json';

export async function fetchMovers(): Promise<MoversData> {
  // raw.githubusercontent.com 캐시를 우회하기 위해 매번 다른 쿼리를 붙인다.
  const response = await fetch(`${MOVERS_URL}?t=${Date.now()}`);
  if (!response.ok) {
    throw new Error(`Movers request failed with status ${response.status}`);
  }
  return response.json();
}
