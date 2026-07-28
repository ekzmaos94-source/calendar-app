import AsyncStorage from '@react-native-async-storage/async-storage';

export type MoverNews = {
  headline: string;
  headlineKo: string | null;
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

export type MoversSession = 'open' | 'close';

export type MoversData = {
  generatedAt: string;
  tradingDate: string;
  thresholdPercent: number;
  session: MoversSession;
  movers: Mover[];
};

export type MoversBundle = {
  open: MoversData;
  close: MoversData;
};

const MOVERS_BASE_URL =
  'https://raw.githubusercontent.com/ekzmaos94-source/calendar-app/master/data';
const MOVERS_CACHE_KEY = 'calendar-app/moversCache';

async function fetchSession(session: MoversSession): Promise<MoversData> {
  // raw.githubusercontent.com 캐시를 우회하기 위해 매번 다른 쿼리를 붙인다.
  const response = await fetch(`${MOVERS_BASE_URL}/movers-${session}.json?t=${Date.now()}`);
  if (!response.ok) {
    throw new Error(`Movers request failed with status ${response.status}`);
  }
  return response.json();
}

function isMoversBundle(value: unknown): value is MoversBundle {
  const bundle = value as Partial<MoversBundle> | null;
  return !!bundle && Array.isArray(bundle.open?.movers) && Array.isArray(bundle.close?.movers);
}

// 화면을 열자마자 네트워크 응답을 기다리지 않고 마지막으로 성공한 데이터를 바로 보여줄 수 있도록,
// fetchMovers가 성공할 때마다 로컬에 캐시해 둔다.
// open/close로 나뉘기 전 예전 형식이 캐시에 남아있을 수 있어 모양을 검증한다.
export async function loadCachedMovers(): Promise<MoversBundle | null> {
  try {
    const raw = await AsyncStorage.getItem(MOVERS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isMoversBundle(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function fetchMovers(): Promise<MoversBundle> {
  const [open, close] = await Promise.all([fetchSession('open'), fetchSession('close')]);
  const bundle: MoversBundle = { open, close };
  AsyncStorage.setItem(MOVERS_CACHE_KEY, JSON.stringify(bundle)).catch(() => {});
  return bundle;
}
