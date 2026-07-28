import Holidays from 'date-holidays';

export type HolidayInfo = {
  date: string; // YYYY-MM-DD
  name: string;
  country: 'KR' | 'US';
};

const koreaHolidays = new Holidays('KR', { timezone: 'Asia/Seoul' });

// 미국 공휴일 토글을 켠 사용자만 비용을 지불하도록 첫 사용 시점에 생성한다.
let usHolidaysInstance: Holidays | null = null;
function getUsHolidays(): Holidays {
  if (!usHolidaysInstance) {
    usHolidaysInstance = new Holidays('US', { timezone: 'America/New_York' });
  }
  return usHolidaysInstance;
}

function toDateKey(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function expandHolidaysForYear(
  hd: Holidays,
  year: number,
  timeZone: string,
  country: 'KR' | 'US'
): HolidayInfo[] {
  const entries = hd.getHolidays(year).filter((entry) => entry.type === 'public');
  const result: HolidayInfo[] = [];

  for (const entry of entries) {
    const cursor = new Date(entry.start);
    const end = new Date(entry.end);
    while (cursor < end) {
      result.push({ date: toDateKey(cursor, timeZone), name: entry.name, country });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }

  return result;
}

const yearCache = new Map<string, HolidayInfo[]>();

function getHolidaysForYear(year: number, includeUs: boolean): HolidayInfo[] {
  const cacheKey = `${year}-${includeUs}`;
  const cached = yearCache.get(cacheKey);
  if (cached) return cached;

  const kr = expandHolidaysForYear(koreaHolidays, year, 'Asia/Seoul', 'KR');
  const combined = includeUs
    ? [...kr, ...expandHolidaysForYear(getUsHolidays(), year, 'America/New_York', 'US')]
    : kr;

  yearCache.set(cacheKey, combined);
  return combined;
}

export function buildHolidayMap(years: number[], includeUs: boolean): Record<string, HolidayInfo[]> {
  const map: Record<string, HolidayInfo[]> = {};
  for (const year of years) {
    for (const holiday of getHolidaysForYear(year, includeUs)) {
      (map[holiday.date] ??= []).push(holiday);
    }
  }
  return map;
}
