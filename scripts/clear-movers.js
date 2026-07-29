// 익일 정규장 개장 1시간 전에 실행: 전날의 장개장/장마감 스캔 데이터를 비운다.
// GitHub Actions 워크플로(.github/workflows/stock-movers.yml)의 다섯 번째 크론에서 실행된다.
const fs = require('fs');
const path = require('path');

const MOVE_THRESHOLD_PERCENT = 5;

function nyDateString(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function clear(session) {
  const outPath = path.join(__dirname, '..', 'data', `movers-${session}.json`);
  const output = {
    generatedAt: new Date().toISOString(),
    tradingDate: nyDateString(new Date()),
    thresholdPercent: MOVE_THRESHOLD_PERCENT,
    session,
    movers: [],
  };
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n');
  console.log(`완료: ${outPath} 비움`);
}

clear('open');
clear('close');
