// 정규장 마감 후 실행: S&P 500 종목 중 당일 시가 대비 5% 이상 변동한 종목을 추리고,
// 해당 종목에 대해서만 한줄 뉴스를 붙여 data/movers.json으로 저장한다.
// GitHub Actions 워크플로(.github/workflows/stock-movers.yml)에서 매일 장 마감 후 실행된다.
const fs = require('fs');
const path = require('path');

const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;
const DEEPL_API_KEY = process.env.DEEPL_API_KEY;
const MOVE_THRESHOLD_PERCENT = 5;
const QUOTE_DELAY_MS = 1100; // 분당 60회 제한 아래로 안전하게 (약 55회/분)
const NEWS_DELAY_MS = 1100;
const DEEPL_URL = (DEEPL_API_KEY ?? '').endsWith(':fx')
  ? 'https://api-free.deepl.com/v2/translate'
  : 'https://api.deepl.com/v2/translate';

if (!FINNHUB_API_KEY) {
  console.error('FINNHUB_API_KEY 환경변수가 필요합니다.');
  process.exit(1);
}

const sp500Path = path.join(__dirname, '..', 'data', 'sp500.json');
const outPath = path.join(__dirname, '..', 'data', 'movers.json');

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

async function fetchQuote(symbol) {
  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_API_KEY}`;
  return fetchJson(url);
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

  console.log(`${companies.length}개 종목 시세 조회 시작 (${tradingDate})`);

  const movers = [];
  for (const [index, company] of companies.entries()) {
    try {
      const quote = await fetchQuote(company.symbol);
      const { o: open, c: current } = quote;
      if (typeof open === 'number' && open > 0 && typeof current === 'number') {
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
    } catch (err) {
      console.warn(`[quote] ${company.symbol} 조회 실패: ${err.message}`);
    }

    if (index < companies.length - 1) await sleep(QUOTE_DELAY_MS);
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
    movers,
  };

  fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n');
  console.log(`완료: ${outPath}에 ${movers.length}개 종목 저장`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
