export type ParsedSchedule = {
  dates: string[]; // YYYY-MM-DD, one entry per day (inclusive range for multi-day schedules)
  time: string | null; // HH:mm
  title: string;
};

const MAX_RANGE_DAYS = 366;

const PARTICLE = '(?:에는|에|쯤에|쯤|경에)?';

// "시" 뒤에 다른 한글이 바로 이어지면(예: "2 시험", "3시작") 시각이 아니라
// 다른 단어의 일부이므로 시간으로 인식하지 않는다.
const NOT_FOLLOWED_BY_HANGUL = '(?![가-힣])';

const WEEKDAY_INDEX: Record<string, number> = {
  일: 0,
  월: 1,
  화: 2,
  수: 3,
  목: 4,
  금: 5,
  토: 6,
};

const RELATIVE_DAY_OFFSET: Record<string, number> = {
  오늘: 0,
  내일: 1,
  모레: 2,
  어제: -1,
};

const ABSOLUTE_DATE_RE = new RegExp(
  `(?:(\\d{4})\\s*년\\s*)?(\\d{1,2})\\s*월\\s*(\\d{1,2})\\s*일${PARTICLE}`
);
const OFFSET_DATE_RE = new RegExp(`(\\d{1,2})\\s*(일|주|개월)\\s*(후|뒤)${PARTICLE}`);
const BARE_DAY_RE = new RegExp(`(\\d{1,2})\\s*일(?!\\s*(?:후|뒤))${PARTICLE}`);
const WEEKDAY_RE = new RegExp(
  `(이번\\s*주|다음\\s*주|다다음\\s*주)?\\s*(월|화|수|목|금|토|일)요일${PARTICLE}`
);
const RELATIVE_DAY_RE = new RegExp(`(오늘|내일|모레|어제)${PARTICLE}`);
const RANGE_RE = /(.+?)부터\s*(.+?)까지(?:에는|에|는|은)?/;
const TIME_RE = new RegExp(
  `(오전|오후)?\\s*(\\d{1,2})\\s*시(?:\\s*(\\d{1,2})\\s*분)?${PARTICLE}${NOT_FOLLOWED_BY_HANGUL}`
);

function pad2(value: number) {
  return value.toString().padStart(2, '0');
}

export function toDateString(date: Date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function startOfDay(date: Date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function findDateMatch(text: string, reference: Date): { match: string; date: Date } | null {
  const absolute = text.match(ABSOLUTE_DATE_RE);
  if (absolute) {
    const [, yearText, monthText, dayText] = absolute;
    const month = parseInt(monthText, 10);
    const day = parseInt(dayText, 10);
    let year = yearText ? parseInt(yearText, 10) : reference.getFullYear();
    let candidate = new Date(year, month - 1, day);
    if (!yearText && startOfDay(candidate) < startOfDay(reference)) {
      year += 1;
      candidate = new Date(year, month - 1, day);
    }
    if (candidate.getMonth() !== month - 1 || candidate.getDate() !== day) {
      return null;
    }
    return { match: absolute[0], date: candidate };
  }

  const offset = text.match(OFFSET_DATE_RE);
  if (offset) {
    const [, amountText, unit] = offset;
    const amount = parseInt(amountText, 10);
    const candidate = new Date(reference);
    if (unit === '일') candidate.setDate(candidate.getDate() + amount);
    else if (unit === '주') candidate.setDate(candidate.getDate() + amount * 7);
    else candidate.setMonth(candidate.getMonth() + amount);
    return { match: offset[0], date: candidate };
  }

  // 월 없이 일자만 언급된 경우 (예: "26일에 약속") 현재 달로 인식하고,
  // 이미 지난 날짜면 다음 달로 넘긴다.
  const bareDay = text.match(BARE_DAY_RE);
  if (bareDay) {
    const day = parseInt(bareDay[1], 10);
    let candidate = new Date(reference.getFullYear(), reference.getMonth(), day);
    if (startOfDay(candidate) < startOfDay(reference)) {
      candidate = new Date(reference.getFullYear(), reference.getMonth() + 1, day);
    }
    if (candidate.getDate() !== day) {
      return null;
    }
    return { match: bareDay[0], date: candidate };
  }

  const weekday = text.match(WEEKDAY_RE);
  if (weekday) {
    const [, qualifierRaw, dayChar] = weekday;
    const qualifier = qualifierRaw?.replace(/\s/g, '');
    const targetDow = WEEKDAY_INDEX[dayChar];
    const fromDow = reference.getDay();
    const weekOffset = qualifier === '다다음주' ? 2 : qualifier === '다음주' ? 1 : 0;
    const diff = ((targetDow - fromDow + 7) % 7) + weekOffset * 7;
    const candidate = new Date(reference);
    candidate.setDate(candidate.getDate() + diff);
    return { match: weekday[0], date: candidate };
  }

  const relative = text.match(RELATIVE_DAY_RE);
  if (relative) {
    const [, word] = relative;
    const candidate = new Date(reference);
    candidate.setDate(candidate.getDate() + RELATIVE_DAY_OFFSET[word]);
    return { match: relative[0], date: candidate };
  }

  return null;
}

function tryParseRange(text: string, reference: Date): { match: string; dates: Date[] } | null {
  const rangeMatch = text.match(RANGE_RE);
  if (!rangeMatch) return null;

  const [fullMatch, startText, endText] = rangeMatch;
  const startMatch = findDateMatch(startText, reference);
  if (!startMatch) return null;

  // 종료일에 월/연도가 없으면("~부터 5일까지") 시작일을 기준으로 해석한다.
  const endMatch = findDateMatch(endText, startMatch.date);
  if (!endMatch) return null;

  if (startOfDay(endMatch.date) < startOfDay(startMatch.date)) return null;

  const dates: Date[] = [];
  const cursor = startOfDay(startMatch.date);
  const end = startOfDay(endMatch.date);
  while (cursor <= end) {
    dates.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
    if (dates.length > MAX_RANGE_DAYS) return null;
  }

  return { match: fullMatch, dates };
}

function findTimeMatch(text: string): { match: string; time: string } | null {
  const time = text.match(TIME_RE);
  if (!time) return null;

  const [, meridiem, hourText, minuteText] = time;
  let hour = parseInt(hourText, 10);
  const minute = minuteText ? parseInt(minuteText, 10) : 0;
  if (meridiem === '오후' && hour < 12) hour += 12;
  if (meridiem === '오전' && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;

  return { match: time[0], time: `${pad2(hour)}:${pad2(minute)}` };
}

export function parseScheduleText(input: string, reference: Date = new Date()): ParsedSchedule | null {
  const trimmedInput = input.trim();
  if (!trimmedInput) return null;

  const rangeMatch = tryParseRange(trimmedInput, reference);

  let dates: string[];
  let matchedDateText: string;

  if (rangeMatch) {
    dates = rangeMatch.dates.map(toDateString);
    matchedDateText = rangeMatch.match;
  } else {
    const dateMatch = findDateMatch(trimmedInput, reference);
    if (!dateMatch) return null;
    dates = [toDateString(dateMatch.date)];
    matchedDateText = dateMatch.match;
  }

  const timeMatch = findTimeMatch(trimmedInput);

  let title = trimmedInput.replace(matchedDateText, ' ');
  if (timeMatch) {
    title = title.replace(timeMatch.match, ' ');
  }
  title = title.replace(/\s+/g, ' ').trim();
  if (!title) title = '일정';

  return { dates, time: timeMatch ? timeMatch.time : null, title };
}
