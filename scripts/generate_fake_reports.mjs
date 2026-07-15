import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const outputDir = resolve(process.argv[2] || "/home/baggr/Downloads/Тестовые кредитные отчеты");

const money = (value) => `${Number(value).toLocaleString("ru-RU", {
  minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
  maximumFractionDigits: 2,
}).replace(/\u00a0/g, " ")} р.`;

function contractText(contract, index) {
  const status = contract.closed ? "Закрыт" : contract.overdue ? "Была просрочка" : "Без просрочек";
  const rateLine = contract.nominal == null ? "-" : `${contract.nominal} % ${contract.nominal} %`;
  const averageLine = contract.average == null
    ? "-"
    : [money(contract.average), contract.remaining == null ? null : money(contract.remaining)].filter(Boolean).join("    ");
  const nextLine = contract.next == null ? "-" : `${money(contract.next.principal)}    ${money(contract.next.interest)}`;
  const minimumLine = contract.minimum == null ? "-" : money(contract.minimum);
  const paymentSection = contract.paymentDates.length
    ? `Фактические платежи по договору
Дата платежа    Сумма платежа    Основной долг    Проценты    Иное (пени)
${contract.paymentYear}
${contract.paymentDates.join("    ")}
${contract.paymentDates.map(() => money(contract.paymentAmount || 1000)).join("    ")}`
    : "Фактические платежи по договору\nПлатежей не было";

  return `${index}. ${contract.creditor} - Договор займа (кредита) - Иной необеспеченный заем ${status}

Сведения об источнике
${contract.creditor}

Сумма и валюта обязательства
Сумма и валюта обязательства    Дата расчета
${money(contract.initial)}    ${contract.dealDate}

Сведения о полной стоимости кредита (займа) - ПСК
ПСК в % годовых
${contract.psk} %

Общие сведения о сделке
Дата совершения сделки    Дата возникновения обязательства    Дата прекращения обязательства по условиям сделки
${contract.dealDate}    ${contract.dealDate}    ${contract.endDate}
Тип сделки
Договор займа (кредита)    Иной необеспеченный заем

Сведения об учете обязательства и льготном финансировании с государственной поддержкой
Минимальная процентная ставка    Максимальная процентная ставка
${rateLine}
Учет задолженности на балансовых счетах
Да

Величина среднемесячного платежа по договору займа (кредита)
Величина среднемесячного платежа    Сумма всех оставшихся платежей по обязательству
${averageLine}

Условия платежей
Сумма и дата ближайшего следующего платежа по основному долгу и процентам
${nextLine}
Сумма минимального платежа
${minimumLine}

Сведения о сумме задолженности
Задолженность    Всего    Основной долг    Проценты    Иное
Общая    ${money(contract.balance.total)}    ${money(contract.balance.principal)}    ${money(contract.balance.interest)}    ${money(contract.balance.other)}

Сумма всех внесенных платежей
По обязательству    По основному долгу    По процентам    По иным требованиям
${money(contract.paid.total)}    ${money(contract.paid.principal)}    ${money(contract.paid.interest)}    ${money(contract.paid.other)}

${paymentSection}`;
}

function reportText(report) {
  const active = report.contracts.filter((contract) => !contract.closed);
  const debt = active.reduce((sum, contract) => sum + contract.balance.total, 0);
  return `КРЕДИТНЫЙ ОТЧЕТ ОБЪЕДИНЕННОГО КРЕДИТНОГО БЮРО
Тестовый документ. Все данные вымышлены.
Отчет Объединенного Кредитного Бюро
Сформирован ${report.generatedAt} 12:00    v3.17.0.0

СУБЪЕКТ КРЕДИТНОЙ ИСТОРИИ
${report.customer}

КРАТКАЯ СВОДКА
${active.length}    ${money(debt)}
Действующие кредиты/займы

ДЕЙСТВУЮЩИЕ И ЗАКРЫТЫЕ КРЕДИТНЫЕ ДОГОВОРЫ

${report.contracts.map(contractText).join("\n\n")}
`;
}

const baseContract = {
  closed: false,
  overdue: false,
  nominal: 20,
  psk: 24,
  average: 10_000,
  remaining: null,
  minimum: 10_000,
  next: { principal: 7_000, interest: 3_000 },
  paymentYear: 2026,
  paymentAmount: 10_000,
  paid: { total: 0, principal: 0, interest: 0, other: 0 },
  balance: { total: 0, principal: 0, interest: 0, other: 0 },
  paymentDates: [],
};

const scenarios = [
  {
    filename: "01_все_поля_и_расчеты.pdf",
    generatedAt: "15 июля 2026",
    customer: "ТЕСТОВА МАРИЯ ПРИМЕРОВНА",
    contracts: [
      { ...baseContract, creditor: "ТЕСТ БАНК АЛЬФА", initial: 500_000, dealDate: "01 января 2024", endDate: "01 января 2029", psk: 24.5, average: 20_000, remaining: 600_000, minimum: 20_000, next: { principal: 14_000, interest: 6_000 }, balance: { total: 450_000, principal: 420_000, interest: 25_000, other: 5_000 }, paid: { total: 180_000, principal: 80_000, interest: 90_000, other: 10_000 }, paymentDates: ["10 января", "10 февраля", "10 марта", "10 апреля", "10 мая"] },
      { ...baseContract, creditor: "ТЕСТ БАНК БЕТА", initial: 250_000, dealDate: "10 марта 2025", endDate: "10 марта 2028", overdue: true, nominal: 18, psk: 21.2, average: 12_000, minimum: 12_000, next: { principal: 9_000, interest: 3_000 }, balance: { total: 150_000, principal: 140_000, interest: 10_000, other: 0 }, paid: { total: 140_000, principal: 100_000, interest: 38_000, other: 2_000 }, paymentDates: ["10 апреля", "10 мая"], paymentAmount: 12_000 },
      { ...baseContract, creditor: "ТЕСТ КАРТА ГАММА", initial: 100_000, dealDate: "17 ноября 2023", endDate: "31 декабря 9999", nominal: 36, psk: 39.1, average: 5_000, minimum: 5_000, next: { principal: 3_000, interest: 2_000 }, balance: { total: 70_000, principal: 70_000, interest: 0, other: 0 }, paid: { total: 350_000, principal: 300_000, interest: 50_000, other: 0 }, paymentDates: ["05 января", "05 февраля", "05 марта", "05 апреля", "05 мая", "05 июня", "05 июля", "05 августа", "05 сентября", "05 октября"], paymentAmount: 5_000 },
      { ...baseContract, creditor: "ТЕСТ МФО ДЕЛЬТА", initial: 40_000, dealDate: "01 июня 2026", endDate: "31 декабря 9999", nominal: null, psk: 200, average: null, minimum: null, next: null, balance: { total: 40_000, principal: 35_000, interest: 4_000, other: 1_000 }, paid: { total: 0, principal: 0, interest: 0, other: 0 }, paymentDates: [] },
      { ...baseContract, creditor: "ТЕСТ БАНК ЭПСИЛОН", initial: 300_000, dealDate: "02 июня 2026", endDate: "31 декабря 9999", nominal: 60, psk: 65, average: 10_000, minimum: 10_000, next: { principal: 0, interest: 10_000 }, balance: { total: 300_000, principal: 280_000, interest: 20_000, other: 0 }, paid: { total: 10_000, principal: 0, interest: 10_000, other: 0 }, paymentDates: ["10 июня"] },
      { ...baseContract, creditor: "ТЕСТ БАНК ЗАКРЫТЫЙ", initial: 120_000, dealDate: "01 января 2019", endDate: "01 января 2022", closed: true, nominal: 15, psk: 17, average: null, minimum: null, next: null, balance: { total: 0, principal: 0, interest: 0, other: 0 }, paid: { total: 150_000, principal: 120_000, interest: 30_000, other: 0 }, paymentYear: 2021, paymentDates: ["01 января", "01 февраля", "01 марта", "01 апреля", "01 мая", "01 июня"] },
    ],
  },
  {
    filename: "02_риски_0_1_2_платежа.pdf",
    generatedAt: "15 июля 2026",
    customer: "ПРОВЕРКИН ИВАН ТЕСТОВИЧ",
    contracts: [
      { ...baseContract, creditor: "ТЕСТ БАНК КРУПНЫЙ", initial: 700_000, dealDate: "01 июля 2026", endDate: "01 июля 2031", nominal: 25, psk: 28, average: null, minimum: null, next: null, balance: { total: 600_000, principal: 590_000, interest: 10_000, other: 0 }, paid: { total: 0, principal: 0, interest: 0, other: 0 }, paymentDates: [] },
      { ...baseContract, creditor: "ТЕСТ МФО ОДИН", initial: 60_000, dealDate: "02 июля 2026", endDate: "02 июля 2027", nominal: 50, psk: 55, average: 5_000, minimum: 5_000, balance: { total: 50_000, principal: 48_000, interest: 2_000, other: 0 }, paid: { total: 5_000, principal: 3_000, interest: 2_000, other: 0 }, paymentDates: ["10 июля"], paymentAmount: 5_000 },
      { ...baseContract, creditor: "ТЕСТ МФО ДВА", initial: 40_000, dealDate: "04 июля 2026", endDate: "04 июля 2027", nominal: 45, psk: 49, average: 4_000, minimum: 4_000, balance: { total: 30_000, principal: 28_000, interest: 2_000, other: 0 }, paid: { total: 8_000, principal: 5_000, interest: 3_000, other: 0 }, paymentDates: ["10 июля", "12 июля"], paymentAmount: 4_000 },
    ],
  },
  {
    filename: "03_чистый_клиент_без_рисков.pdf",
    generatedAt: "15 июля 2026",
    customer: "НАДЕЖНЫЙ ПЕТР ТЕСТОВИЧ",
    contracts: [
      { ...baseContract, creditor: "ТЕСТ БАНК СЕВЕР", initial: 300_000, dealDate: "01 января 2022", endDate: "01 января 2028", nominal: 16, psk: 18, average: 15_000, remaining: 240_000, minimum: 15_000, balance: { total: 200_000, principal: 190_000, interest: 10_000, other: 0 }, paid: { total: 180_000, principal: 110_000, interest: 70_000, other: 0 }, paymentDates: ["15 января", "15 февраля", "15 марта", "15 апреля", "15 мая", "15 июня"], paymentAmount: 15_000 },
      { ...baseContract, creditor: "ТЕСТ БАНК ЮГ", initial: 180_000, dealDate: "10 октября 2023", endDate: "10 октября 2027", nominal: 14, psk: 16, average: 9_000, remaining: 108_000, minimum: 9_000, balance: { total: 100_000, principal: 95_000, interest: 5_000, other: 0 }, paid: { total: 120_000, principal: 80_000, interest: 38_000, other: 2_000 }, paymentDates: ["20 января", "20 февраля", "20 марта", "20 апреля", "20 мая"], paymentAmount: 9_000 },
    ],
  },
  {
    filename: "04_критический_долг_и_просрочки.pdf",
    generatedAt: "15 июля 2026",
    customer: "ДОЛГОВ МАКСИМ КРИТИЧЕСКИЙ",
    contracts: [
      { ...baseContract, creditor: "ТЕСТ БАНК ИПОТЕЧНЫЙ", initial: 3_800_000, dealDate: "01 июля 2026", endDate: "01 июля 2041", overdue: true, nominal: 28, psk: 31, average: 40_000, remaining: null, minimum: 40_000, balance: { total: 3_700_000, principal: 3_600_000, interest: 80_000, other: 20_000 }, paid: { total: 0, principal: 0, interest: 0, other: 0 }, paymentDates: [] },
      { ...baseContract, creditor: "ТЕСТ БАНК ПОТРЕБИТЕЛЬСКИЙ", initial: 1_300_000, dealDate: "02 июля 2026", endDate: "02 июля 2033", overdue: true, nominal: 34, psk: 38, average: 32_000, minimum: 32_000, balance: { total: 1_240_000, principal: 1_180_000, interest: 45_000, other: 15_000 }, paid: { total: 32_000, principal: 5_000, interest: 24_000, other: 3_000 }, paymentDates: ["10 июля"], paymentAmount: 32_000 },
      { ...baseContract, creditor: "ТЕСТ МФО СРОЧНЫЙ", initial: 420_000, dealDate: "04 июля 2026", endDate: "04 июля 2027", overdue: true, nominal: 120, psk: 180, average: 35_000, minimum: 35_000, balance: { total: 410_000, principal: 380_000, interest: 20_000, other: 10_000 }, paid: { total: 70_000, principal: 10_000, interest: 50_000, other: 10_000 }, paymentDates: ["08 июля", "12 июля"], paymentAmount: 35_000 },
      { ...baseContract, creditor: "ТЕСТ БАНК КАРТА", initial: 300_000, dealDate: "01 января 2025", endDate: "31 декабря 9999", overdue: true, nominal: 44, psk: 49, average: 18_000, minimum: 18_000, balance: { total: 280_000, principal: 250_000, interest: 20_000, other: 10_000 }, paid: { total: 12_000, principal: 0, interest: 10_000, other: 2_000 }, paymentDates: ["05 июля"], paymentAmount: 12_000 },
    ],
  },
  {
    filename: "05_много_микрозаймов.pdf",
    generatedAt: "15 июля 2026",
    customer: "МИКРОЗАЙМОВА АЛИНА ТЕСТОВНА",
    contracts: [
      { ...baseContract, creditor: "ТЕСТ МФО 01", initial: 90_000, dealDate: "01 июня 2026", endDate: "01 июня 2027", overdue: true, nominal: 150, psk: 210, average: 12_000, balance: { total: 82_000, principal: 75_000, interest: 5_000, other: 2_000 }, paid: { total: 0, principal: 0, interest: 0, other: 0 }, paymentDates: [] },
      { ...baseContract, creditor: "ТЕСТ МФО 02", initial: 80_000, dealDate: "02 июня 2026", endDate: "02 июня 2027", overdue: true, nominal: 145, psk: 205, average: 11_000, balance: { total: 72_000, principal: 67_000, interest: 4_000, other: 1_000 }, paid: { total: 11_000, principal: 3_000, interest: 7_000, other: 1_000 }, paymentDates: ["15 июня"], paymentAmount: 11_000 },
      { ...baseContract, creditor: "ТЕСТ МФО 03", initial: 70_000, dealDate: "03 июня 2026", endDate: "03 июня 2027", nominal: 140, psk: 198, average: 10_000, balance: { total: 61_000, principal: 57_000, interest: 4_000, other: 0 }, paid: { total: 20_000, principal: 7_000, interest: 13_000, other: 0 }, paymentDates: ["15 июня", "01 июля"], paymentAmount: 10_000 },
      { ...baseContract, creditor: "ТЕСТ МФО 04", initial: 60_000, dealDate: "04 июня 2026", endDate: "04 июня 2027", overdue: true, nominal: 135, psk: 190, average: 9_000, balance: { total: 54_000, principal: 49_000, interest: 4_000, other: 1_000 }, paid: { total: 0, principal: 0, interest: 0, other: 0 }, paymentDates: [] },
      { ...baseContract, creditor: "ТЕСТ МФО 05", initial: 55_000, dealDate: "20 июня 2026", endDate: "20 июня 2027", nominal: 125, psk: 175, average: 8_000, balance: { total: 48_000, principal: 45_000, interest: 3_000, other: 0 }, paid: { total: 8_000, principal: 3_000, interest: 5_000, other: 0 }, paymentDates: ["05 июля"], paymentAmount: 8_000 },
      { ...baseContract, creditor: "ТЕСТ МФО 06", initial: 45_000, dealDate: "21 июня 2026", endDate: "21 июня 2027", overdue: true, nominal: 120, psk: 168, average: 7_000, balance: { total: 40_000, principal: 36_000, interest: 3_000, other: 1_000 }, paid: { total: 14_000, principal: 5_000, interest: 8_000, other: 1_000 }, paymentDates: ["01 июля", "10 июля"], paymentAmount: 7_000 },
      { ...baseContract, creditor: "ТЕСТ МФО 07", initial: 35_000, dealDate: "22 июня 2026", endDate: "22 июня 2027", nominal: 115, psk: 160, average: 6_000, balance: { total: 31_000, principal: 28_000, interest: 3_000, other: 0 }, paid: { total: 0, principal: 0, interest: 0, other: 0 }, paymentDates: [] },
      { ...baseContract, creditor: "ТЕСТ МФО 08", initial: 30_000, dealDate: "23 июня 2026", endDate: "23 июня 2027", nominal: 110, psk: 155, average: 5_000, balance: { total: 27_000, principal: 24_000, interest: 2_000, other: 1_000 }, paid: { total: 5_000, principal: 2_000, interest: 3_000, other: 0 }, paymentDates: ["08 июля"], paymentAmount: 5_000 },
    ],
  },
  {
    filename: "06_большой_долг_без_рисков_по_платежам.pdf",
    generatedAt: "15 июля 2026",
    customer: "КАПИТАЛОВ РОМАН СТАБИЛЬНЫЙ",
    contracts: [
      { ...baseContract, creditor: "ТЕСТ БАНК ДОМ", initial: 4_000_000, dealDate: "01 января 2021", endDate: "01 января 2041", nominal: 14, psk: 15.2, average: 48_000, remaining: 4_300_000, minimum: 48_000, balance: { total: 3_400_000, principal: 3_350_000, interest: 50_000, other: 0 }, paid: { total: 1_350_000, principal: 650_000, interest: 700_000, other: 0 }, paymentDates: ["10 января", "10 февраля", "10 марта", "10 апреля", "10 мая", "10 июня", "10 июля"], paymentAmount: 48_000 },
      { ...baseContract, creditor: "ТЕСТ БАНК АВТО", initial: 1_200_000, dealDate: "15 мая 2023", endDate: "15 мая 2030", nominal: 19, psk: 21, average: 28_000, remaining: 1_260_000, minimum: 28_000, balance: { total: 900_000, principal: 870_000, interest: 30_000, other: 0 }, paid: { total: 700_000, principal: 330_000, interest: 365_000, other: 5_000 }, paymentDates: ["15 января", "15 февраля", "15 марта", "15 апреля", "15 мая", "15 июня"], paymentAmount: 28_000 },
    ],
  },
  {
    filename: "07_большая_переплата_процентами.pdf",
    generatedAt: "15 июля 2026",
    customer: "ПРОЦЕНТОВА ЕЛЕНА ИСТОРИЧЕСКАЯ",
    contracts: [
      { ...baseContract, creditor: "ТЕСТ БАНК ДЛИННЫЙ КРЕДИТ", initial: 900_000, dealDate: "01 января 2020", endDate: "01 января 2032", nominal: 29, psk: 32, average: 24_000, remaining: 960_000, minimum: 24_000, balance: { total: 620_000, principal: 590_000, interest: 30_000, other: 0 }, paid: { total: 980_000, principal: 210_000, interest: 750_000, other: 20_000 }, paymentDates: ["12 января", "12 февраля", "12 марта", "12 апреля", "12 мая", "12 июня", "12 июля"], paymentAmount: 24_000 },
      { ...baseContract, creditor: "ТЕСТ БАНК КРЕДИТНАЯ КАРТА", initial: 250_000, dealDate: "10 сентября 2022", endDate: "31 декабря 9999", nominal: 42, psk: 47, average: 15_000, remaining: 420_000, minimum: 15_000, balance: { total: 210_000, principal: 195_000, interest: 15_000, other: 0 }, paid: { total: 570_000, principal: 80_000, interest: 470_000, other: 20_000 }, paymentDates: ["20 января", "20 февраля", "20 марта", "20 апреля", "20 мая", "20 июня"], paymentAmount: 15_000 },
    ],
  },
  {
    filename: "08_полностью_погашенная_история.pdf",
    generatedAt: "15 июля 2026",
    customer: "ЧИСТОВА ОЛЬГА ПОГАШЕННАЯ",
    contracts: [
      { ...baseContract, creditor: "ТЕСТ БАНК ПОГАШЕННЫЙ", initial: 400_000, dealDate: "01 января 2018", endDate: "01 января 2022", closed: true, nominal: 13, psk: 14, average: null, minimum: null, next: null, balance: { total: 0, principal: 0, interest: 0, other: 0 }, paid: { total: 510_000, principal: 400_000, interest: 110_000, other: 0 }, paymentYear: 2021, paymentDates: ["10 января", "10 февраля", "10 марта", "10 апреля", "10 мая", "10 июня"], paymentAmount: 14_000 },
      { ...baseContract, creditor: "ТЕСТ БАНК КАРТА ПОГАШЕНА", initial: 120_000, dealDate: "15 марта 2020", endDate: "15 марта 2023", closed: true, nominal: 20, psk: 23, average: null, minimum: null, next: null, balance: { total: 0, principal: 0, interest: 0, other: 0 }, paid: { total: 165_000, principal: 120_000, interest: 43_000, other: 2_000 }, paymentYear: 2022, paymentDates: ["15 января", "15 февраля", "15 марта", "15 апреля", "15 мая"], paymentAmount: 7_000 },
    ],
  },
];

const escapeHtml = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const tempDir = await mkdtemp(join(tmpdir(), "fake-credit-reports-"));
await mkdir(outputDir, { recursive: true });

try {
  for (const [index, scenario] of scenarios.entries()) {
    const htmlPath = join(tempDir, `report-${index + 1}.html`);
    const outputPath = join(outputDir, scenario.filename);
    const html = `<!doctype html><html lang="ru"><meta charset="utf-8"><style>
      @page { size: A4; margin: 12mm; }
      body { margin: 0; color: #111; background: white; }
      pre { margin: 0; white-space: pre-wrap; font: 8px/1.45 "DejaVu Sans Mono", monospace; }
    </style><pre>${escapeHtml(reportText(scenario))}</pre></html>`;
    await writeFile(htmlPath, html, "utf8");
    const result = spawnSync("google-chrome-stable", [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--no-pdf-header-footer",
      `--print-to-pdf=${outputPath}`,
      `file://${htmlPath}`,
    ], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr || `Chrome exited with ${result.status}`);
    console.log(outputPath);
  }
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
