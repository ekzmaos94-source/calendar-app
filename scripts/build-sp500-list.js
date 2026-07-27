// S&P 500 구성종목 CSV(data/.sp500.csv, datasets/s-and-p-500-companies 출처)를
// data/sp500.json으로 변환한다. 종목 구성은 자주 안 바뀌므로 이 스크립트는
// 가끔 수동으로만 재실행하면 된다 (매일 API 호출로 받아올 필요 없음).
const fs = require('fs');
const path = require('path');

const csvPath = path.join(__dirname, '..', 'data', '.sp500.csv');
const outPath = path.join(__dirname, '..', 'data', 'sp500.json');

function parseCsvLine(line) {
  const fields = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields;
}

const lines = fs.readFileSync(csvPath, 'utf8').trim().split('\n');
const [header, ...rows] = lines;
const cols = parseCsvLine(header);
const symbolIdx = cols.indexOf('Symbol');
const nameIdx = cols.indexOf('Security');
const sectorIdx = cols.indexOf('GICS Sector');

const companies = rows.map((line) => {
  const fields = parseCsvLine(line);
  return {
    symbol: fields[symbolIdx].trim(),
    name: fields[nameIdx].trim(),
    sector: fields[sectorIdx].trim(),
  };
});

fs.writeFileSync(outPath, JSON.stringify(companies, null, 2) + '\n');
console.log(`Wrote ${companies.length} companies to ${outPath}`);
