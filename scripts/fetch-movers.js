// S&P 500 종목 중 당일 시가 대비 5% 이상 변동한 종목을 추리고, 해당 종목에 대해서만
// 한줄 뉴스를 붙여 data/movers-<session>.json으로 저장한다.
// GitHub Actions 워크플로(.github/workflows/stock-movers.yml)에서 하루 두 번 실행된다:
// - open: 개장 직후(장 초반 변동 스캔) -> data/movers-open.json
// - close: 마감 후(마감 시점 변동 재선별) -> data/movers-close.json
// 두 파일을 서로 덮어쓰지 않기 때문에, 다음날 개장 1시간 전까지는 둘 다 앱에서 조회할 수 있다.
//
// 시세는 Yahoo Finance의 비공식 벌크 시세 엔드포인트로 한 번에 조회한다(503개 종목 개별 호출 시
// Finnhub 무료 티어 분당 호출 제한 때문에 ~10분이 걸렸는데, 벌크 요청은 몇 초면 끝난다).
// 문서화되지 않은 API라 인증 방식(쿠키+crumb)이 예고 없이 바뀌거나 막힐 수 있다는 리스크는 있다.
// 뉴스는 그대로 Finnhub company-news를 쓴다(대상 종목 수가 적어 속도 제한이 문제되지 않음).
const fs = require('fs');
const path = require('path');

const SESSION = process.argv[2];
if (SESSION !== 'open' && SESSION !== 'close') {
  console.error('사용법: node scripts/fetch-movers.js <open|close>');
  process.exit(1);
}

const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;
const DEEPL_API_KEY = process.env.DEEPL_API_KEY;
const MOVE_THRESHOLD_PERCENT = 5;
const NEWS_DELAY_MS = 1100; // Finnhub 무료 티어 분당 60회 제한 아래로 안전하게 (약 55회/분)
const YAHOO_QUOTE_CHUNK_SIZE = 200; // 한 번에 다 되긴 하지만, 요청 하나에 다 걸지 않도록 나눠서 요청
const YAHOO_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const DEEPL_URL = (DEEPL_API_KEY ?? '').endsWith(':fx')
  ? 'https://api-free.deepl.com/v2/translate'
  : 'https://api.deepl.com/v2/translate';

if (!FINNHUB_API_KEY) {
  console.error('FINNHUB_API_KEY 환경변수가 필요합니다.');
  process.exit(1);
}

const sp500Path = path.join(__dirname, '..', 'data', 'sp500.json');
const outPath = path.join(__dirname, '..', 'data', `movers-${SESSION}.json`);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nyDateString(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return response.json();
}

function chunk(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

// Yahoo Finance의 quote API는 크롬 등 브라우저에서 발급받는 쿠키+crumb가 있어야 응답한다.
// fc.yahoo.com에 아무 요청이나 보내 쿠키를 받고, 그 쿠키로 crumb를 발급받는 흐름이다.
async function getYahooCrumb() {
  const cookieResponse = await fetch('https://fc.yahoo.com', {
    headers: { 'User-Agent': YAHOO_USER_AGENT },
  });
  const cookie = (cookieResponse.headers.getSetCookie?.() ?? [])
    .map((entry) => entry.split(';')[0])
    .join('; ');
  if (!cookie) {
    throw new Error('Yahoo Finance 쿠키를 받지 못했습니다.');
  }

  const crumbResponse = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
    headers: { 'User-Agent': YAHOO_USER_AGENT, Cookie: cookie },
  });
  const crumb = (await crumbResponse.text()).trim();
  if (!crumbResponse.ok || !crumb) {
    throw new Error(`Yahoo Finance crumb 발급 실패: HTTP ${crumbResponse.status}`);
  }

  return { cookie, crumb };
}

// symbol -> { open, current } 맵을 반환한다. 시세가 없거나 형식이 이상한 종목은 맵에서 빠진다.
async function fetchYahooQuotes(symbols, { cookie, crumb }) {
  const quotes = new Map();

  for (const symbolChunk of chunk(symbols, YAHOO_QUOTE_CHUNK_SIZE)) {
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbolChunk.join(','))}&crumb=${encodeURIComponent(crumb)}`;
    const response = await fetch(url, {
      headers: { 'User-Agent': YAHOO_USER_AGENT, Cookie: cookie },
    });
    if (!response.ok) {
      throw new Error(`Yahoo Finance 시세 조회 실패: HTTP ${response.status}`);
    }
    const data = await response.json();
    for (const result of data.quoteResponse?.result ?? []) {
      const { symbol, regularMarketOpen: open, regularMarketPrice: current } = result;
      if (typeof open === 'number' && open > 0 && typeof current === 'number') {
        quotes.set(symbol, { open, current });
      }
    }
  }

  return quotes;
}

// Finnhub의 company-news는 조회한 종목에 조금이라도 언급되면 다 붙여주기 때문에,
// "오늘의 급등락 종목 모음" 같은 여러 종목이 섞인 기사도 그대로 섞여 들어온다.
// related/category 필드로는 구분이 안 돼서, 헤드라인 텍스트로 걸러낸다.
const ROUNDUP_KEYWORDS = [
  'stocks that explain',
  'are gapping',
  'biggest gainers',
  'biggest losers',
  'top movers',
  'stock movers',
  'week ahead',
  'stocks to watch',
  'which s&p',
  'market movers',
  'stocks surge',
  'stocks that hit',
  'featured highlights',
];

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// "3M", "AT&T" 처럼 그대로 쓰는 이름도 있고 "Booking Holdings"처럼 법인 형태가
// 붙은 이름도 있어서, 후자만 접미사를 떼어 핵심 이름으로 정규화한다.
function coreCompanyName(name) {
  return name
    .replace(/\([^)]*\)/g, '')
    .replace(/,?\s*(Inc\.?|Incorporated|Corp\.?|Corporation|Co\.?|Company|Ltd\.?|PLC|Group|Holdings?)$/i, '')
    .trim();
}

function buildCompanyMatchers(companies) {
  return companies.map((company) => ({
    symbol: company.symbol,
    regex: new RegExp(`\\b${escapeRegex(coreCompanyName(company.name))}\\b`, 'i'),
  }));
}

// 헤드라인이 "이 종목 하나"에 대한 기사인지 판단한다:
// 1) 대상 종목의 티커/회사명이 실제로 언급돼야 하고 (엉뚱한 종목 피드에 잘못 태깅된 기사 배제)
// 2) 다른 종목이 2개 이상 함께 언급되면 여러 종목을 묶은 모음 기사로 보고 배제한다.
function isRelevantSingleStockHeadline(headline, symbol, allSymbols, companyMatchers) {
  const lower = headline.toLowerCase();
  if (ROUNDUP_KEYWORDS.some((keyword) => lower.includes(keyword))) return false;

  const targetMatcher = companyMatchers.find((m) => m.symbol === symbol);
  const mentionsTarget =
    new RegExp(`\\b${symbol}\\b`).test(headline) || (targetMatcher?.regex.test(headline) ?? false);
  if (!mentionsTarget) return false;

  const otherMatches = new Set(
    (headline.match(/\b[A-Z]{2,5}\b/g) ?? []).filter(
      (token) => token !== symbol && allSymbols.has(token)
    )
  );
  for (const { symbol: otherSymbol, regex } of companyMatchers) {
    if (otherMatches.size >= 2) break;
    if (otherSymbol === symbol || otherMatches.has(otherSymbol)) continue;
    if (regex.test(headline)) otherMatches.add(otherSymbol);
  }
  return otherMatches.size < 2;
}

async function fetchTopHeadline(symbol, fromDate, toDate, allSymbols, companyMatchers) {
  const url = `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}&from=${fromDate}&to=${toDate}&token=${FINNHUB_API_KEY}`;
  const articles = await fetchJson(url);
  if (!Array.isArray(articles) || articles.length === 0) return null;

  const sorted = articles.sort((a, b) => (b.datetime ?? 0) - (a.datetime ?? 0));
  const top = sorted.find((article) =>
    isRelevantSingleStockHeadline(article.headline, symbol, allSymbols, companyMatchers)
  );
  if (!top) return null;

  return {
    headline: top.headline,
    url: top.url,
    source: top.source,
    datetime: top.datetime,
  };
}

async function logDeepLUsage() {
  if (!DEEPL_API_KEY) return;
  const usageUrl = DEEPL_API_KEY.endsWith(':fx')
    ? 'https://api-free.deepl.com/v2/usage'
    : 'https://api.deepl.com/v2/usage';
  try {
    const response = await fetch(usageUrl, {
      headers: { Authorization: `DeepL-Auth-Key ${DEEPL_API_KEY}` },
    });
    if (!response.ok) return;
    const { character_count, character_limit } = await response.json();
    console.log(
      `[translate] DeepL 남은 글자 수: ${character_limit - character_count} / ${character_limit}`
    );
  } catch (err) {
    console.warn(`[translate] DeepL 사용량 조회 실패: ${err.message}`);
  }
}

async function translateHeadlines(headlines) {
  if (!DEEPL_API_KEY || headlines.length === 0) return headlines.map(() => null);

  const params = new URLSearchParams();
  headlines.forEach((headline) => params.append('text', headline));
  params.append('target_lang', 'KO');

  try {
    const response = await fetch(DEEPL_URL, {
      method: 'POST',
      headers: {
        Authorization: `DeepL-Auth-Key ${DEEPL_API_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params,
    });
    if (!response.ok) {
      console.warn(`[translate] DeepL 요청 실패: HTTP ${response.status}`);
      return headlines.map(() => null);
    }
    const data = await response.json();
    return data.translations.map((t) => t.text);
  } catch (err) {
    console.warn(`[translate] DeepL 요청 실패: ${err.message}`);
    return headlines.map(() => null);
  }
}

async function main() {
  const companies = JSON.parse(fs.readFileSync(sp500Path, 'utf8'));
  const allSymbols = new Set(companies.map((company) => company.symbol));
  const companyMatchers = buildCompanyMatchers(companies);
  const tradingDate = nyDateString(new Date());

  console.log(`[${SESSION}] ${companies.length}개 종목 시세 조회 시작 (${tradingDate})`);

  const yahooAuth = await getYahooCrumb();
  const quotes = await fetchYahooQuotes(
    companies.map((company) => company.symbol),
    yahooAuth
  );
  console.log(`${quotes.size}/${companies.length}개 종목 시세 조회 완료`);

  const movers = [];
  for (const company of companies) {
    const quote = quotes.get(company.symbol);
    if (!quote) continue;

    const { open, current } = quote;
    const changePercent = ((current - open) / open) * 100;
    if (Math.abs(changePercent) >= MOVE_THRESHOLD_PERCENT) {
      movers.push({
        symbol: company.symbol,
        name: company.name,
        sector: company.sector,
        open,
        current,
        changePercent: Math.round(changePercent * 100) / 100,
      });
    }
  }

  console.log(`${movers.length}개 종목이 ${MOVE_THRESHOLD_PERCENT}% 이상 변동, 뉴스 조회 시작`);

  for (const [index, mover] of movers.entries()) {
    try {
      mover.news = await fetchTopHeadline(
        mover.symbol,
        tradingDate,
        tradingDate,
        allSymbols,
        companyMatchers
      );
    } catch (err) {
      console.warn(`[news] ${mover.symbol} 뉴스 조회 실패: ${err.message}`);
      mover.news = null;
    }
    if (index < movers.length - 1) await sleep(NEWS_DELAY_MS);
  }

  const newsIndices = [];
  const headlinesToTranslate = [];
  movers.forEach((mover, index) => {
    if (mover.news?.headline) {
      newsIndices.push(index);
      headlinesToTranslate.push(mover.news.headline);
    }
  });

  console.log(`${headlinesToTranslate.length}개 헤드라인 번역 시작`);
  await logDeepLUsage();
  const translated = await translateHeadlines(headlinesToTranslate);
  newsIndices.forEach((moverIndex, i) => {
    movers[moverIndex].news.headlineKo = translated[i];
  });

  movers.sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent));

  const output = {
    generatedAt: new Date().toISOString(),
    tradingDate,
    thresholdPercent: MOVE_THRESHOLD_PERCENT,
    session: SESSION,
    movers,
  };

  fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n');
  console.log(`완료: ${outPath}에 ${movers.length}개 종목 저장`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
