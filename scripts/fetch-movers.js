// 정규장 마감 후 실행: S&P 500 종목 중 당일 시가 대비 5% 이상 변동한 종목을 추리고,
// 해당 종목에 대해서만 한줄 뉴스를 붙여 data/movers.json으로 저장한다.
// GitHub Actions 워크플로(.github/workflows/stock-movers.yml)에서 매일 장 마감 후 실행된다.
const fs = require('fs');
const path = require('path');

const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;
const MOVE_THRESHOLD_PERCENT = 5;
const QUOTE_DELAY_MS = 1100; // 분당 60회 제한 아래로 안전하게 (약 55회/분)
const NEWS_DELAY_MS = 1100;

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

async function fetchTopHeadline(symbol, fromDate, toDate) {
  const url = `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}&from=${fromDate}&to=${toDate}&token=${FINNHUB_API_KEY}`;
  const articles = await fetchJson(url);
  if (!Array.isArray(articles) || articles.length === 0) return null;
  const top = articles.sort((a, b) => (b.datetime ?? 0) - (a.datetime ?? 0))[0];
  return {
    headline: top.headline,
    url: top.url,
    source: top.source,
    datetime: top.datetime,
  };
}

async function main() {
  const companies = JSON.parse(fs.readFileSync(sp500Path, 'utf8'));
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
      mover.news = await fetchTopHeadline(mover.symbol, tradingDate, tradingDate);
    } catch (err) {
      console.warn(`[news] ${mover.symbol} 뉴스 조회 실패: ${err.message}`);
      mover.news = null;
    }
    if (index < movers.length - 1) await sleep(NEWS_DELAY_MS);
  }

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
