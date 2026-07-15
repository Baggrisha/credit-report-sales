import { useEffect, useRef, useState } from "react";
import { analyzeReport } from "./api";
import type { Analysis, Contract, ScenarioSettings } from "./types";
import { chooseSalesMessage, type RiskLevel } from "./salesMessages";
import { collectReportFiles } from "./reportFiles";

const ruble = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 0,
});
const number = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
const shortDate = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", year: "numeric" });
const RUSSIAN_SHORT_WORD = /(^|[\s(«„"])(а|без|в|во|для|до|за|и|из|к|ко|на|не|ни|но|о|об|от|по|под|при|с|со|у)\s+(?=[А-Яа-яЁё0-9])/gi;

function bindRussianPrepositions(root: Node) {
  const textNodes: Text[] = [];
  if (root.nodeType === Node.TEXT_NODE) {
    textNodes.push(root as Text);
  } else {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) textNodes.push(walker.currentNode as Text);
  }
  for (const node of textNodes) {
    if (node.parentElement?.closest("script, style, input, textarea")) continue;
    const current = node.nodeValue || "";
    const formatted = current.replace(RUSSIAN_SHORT_WORD, "$1$2\u00a0");
    if (formatted !== current) node.nodeValue = formatted;
  }
}

function fmtMoney(value: number | null | undefined) {
  return value == null ? "Нужно уточнить" : ruble.format(value);
}

function fmtDate(value: string | null) {
  return value ? shortDate.format(new Date(`${value}T12:00:00`)) : "Нет данных";
}

function riskTone(count: number) {
  return count >= 3 ? "danger" : count >= 1 ? "warning" : "safe";
}

type Theme = "light" | "dark";

function Icon({ name }: { name: "upload" | "shield" | "copy" | "print" | "arrow" | "check" | "sun" | "moon" }) {
  const paths = {
    upload: <><path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M5 20h14"/></>,
    shield: <><path d="M12 3 5 6v5c0 4.6 2.9 8.1 7 10 4.1-1.9 7-5.4 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-4"/></>,
    copy: <><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></>,
    print: <><path d="M6 9V3h12v6"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v7H6z"/></>,
    arrow: <><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41"/></>,
    moon: <path d="M20 15.2A8.5 8.5 0 0 1 8.8 4 8.5 8.5 0 1 0 20 15.2Z"/>,
  };
  return <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function ThemeToggle({ theme, onToggle, compact = false }: { theme: Theme; onToggle: () => void; compact?: boolean }) {
  const nextTheme = theme === "dark" ? "светлую" : "темную";
  return <button type="button" className={`theme-toggle ${compact ? "compact" : ""}`} onClick={onToggle} aria-label={`Включить ${nextTheme} тему`} title={`Включить ${nextTheme} тему`}>
    <Icon name={theme === "dark" ? "sun" : "moon"} />
    <span>{theme === "dark" ? "Светлая" : "Темная"}</span>
  </button>;
}

function UploadScreen({ onLoaded, theme, onToggleTheme }: { onLoaded: (analyses: Analysis[]) => void; theme: Theme; onToggleTheme: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [accessCode, setAccessCode] = useState(sessionStorage.getItem("access-code") || "");

  async function handleFiles(files: File[]) {
    if (!files.length || loading) return;
    setDragging(false);
    setLoading(true);
    setError("");
    try {
      const pdfFiles = await collectReportFiles(files);
      sessionStorage.setItem("access-code", accessCode);
      const results: Analysis[] = [];
      for (const file of pdfFiles) {
        try {
          results.push(await analyzeReport(file, accessCode));
        } catch (reason) {
          const message = reason instanceof Error ? reason.message : "Не удалось обработать отчет";
          throw new Error(`${file.name}: ${message}`);
        }
      }
      onLoaded(results);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось обработать отчет");
    } finally {
      setLoading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <main
      className={`upload-page ${dragging ? "file-dragging" : ""}`}
      onDragEnter={(event) => { event.preventDefault(); if (event.dataTransfer.types.includes("Files")) setDragging(true); }}
      onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }}
      onDragLeave={(event) => {
        event.preventDefault();
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        void handleFiles(Array.from(event.dataTransfer.files));
      }}
    >
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <div className="upload-header"><header className="brand"><span className="brand-mark">Ф</span><span>Финразбор</span></header><ThemeToggle theme={theme} onToggle={onToggleTheme} /></div>
      <section className="upload-hero">
        <p className="eyebrow">КРЕДИТНАЯ ИСТОРИЯ → ПОНЯТНЫЙ РАЗГОВОР</p>
        <h1>Покажите клиенту,<br /><em>куда уходят его деньги.</em></h1>
        <p className="lead">Загрузите отчет ОКБ. За несколько секунд получите финансовую картину, сравнение с БФЛ и РДГ и отдельные сигналы для юриста.</p>
        <div
          className={`dropzone ${dragging ? "dragging" : ""} ${loading ? "loading" : ""}`}
          onClick={() => !loading && inputRef.current?.click()}
          role="button"
          tabIndex={0}
          aria-busy={loading}
          aria-label="Перетащите кредитные отчеты PDF или ZIP сюда или нажмите для выбора файлов"
          onKeyDown={(event) => event.key === "Enter" && inputRef.current?.click()}
        >
          <input ref={inputRef} type="file" accept="application/pdf,.pdf,application/zip,.zip" multiple hidden onChange={(event) => void handleFiles(Array.from(event.target.files || []))} />
          <span className="upload-icon"><Icon name="upload" /></span>
          <div>
            <strong>{loading ? "Читаем кредитные истории…" : dragging ? "Отпустите файлы здесь" : "Перетащите PDF или ZIP сюда"}</strong>
            <span>{loading ? "Последовательно сверяем договоры и платежи" : dragging ? "Сразу начнем анализ отчетов" : "любое количество отчетов · до 50 МБ на файл"}</span>
          </div>
          {!loading && <button type="button">Выбрать отчеты <Icon name="arrow" /></button>}
          {loading && <div className="progress"><i /></div>}
        </div>
        {error && <div className="error-banner">{error}</div>}
        <label className="access-code">
          <span>Код доступа <small>(если задан при развертывании)</small></span>
          <input type="password" value={accessCode} onChange={(event) => setAccessCode(event.target.value)} placeholder="Не требуется локально" />
        </label>
        <div className="privacy-note"><Icon name="shield" /><span><strong>Без хранения данных.</strong> PDF и ZIP обрабатываются в памяти и удаляются сразу после анализа.</span></div>
      </section>
      <footer className="upload-footer"><span>ОКБ v3.10 / v3.17</span><span>Расчеты являются оценкой, не юридическим заключением</span></footer>
    </main>
  );
}

function MetricCard({ label, value, note, tone, progress }: { label: string; value: string; note: string; tone?: string; progress?: number | null }) {
  return <article className={`metric-card ${tone || ""}`}><span>{label}</span><strong>{value}</strong><small>{note}</small>{progress != null && <i className="debt-progress" aria-hidden="true"><span style={{ width: `${progress}%` }} /></i>}</article>;
}

function Field({ label, value, onChange, suffix }: { label: string; value: number | null; onChange: (value: number | null) => void; suffix: string }) {
  return <label className="setting-field"><span>{label}</span><div><input type="number" min="0" value={value ?? ""} placeholder="Авто" onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))} /><b>{suffix}</b></div></label>;
}

function ScenarioTable({ analysis, settings }: { analysis: Analysis; settings: ScenarioSettings }) {
  const auto = analysis.summary.bank_projection;
  const bankMonthly = settings.bankMonthly ?? (auto.monthly_payment || null);
  const bankMonths = settings.bankMonths ?? (auto.months || null);
  const hasManualBankOverrides = settings.bankMonthly != null || settings.bankMonths != null;
  const unresolvedLabel = auto.unresolved_contracts === 1
    ? "1 договор требует уточнения"
    : `${auto.unresolved_contracts} договоров требуют уточнения`;
  const calculatedBankTotal = bankMonthly != null && bankMonths != null ? bankMonthly * bankMonths : null;
  const bankTotal = hasManualBankOverrides
    ? calculatedBankTotal
    : auto.unresolved_contracts === 0 && auto.total != null ? auto.total : calculatedBankTotal;
  const bankTotalEstimated = bankTotal != null && auto.unresolved_contracts > 0;
  const bankTag = hasManualBankOverrides && bankTotal != null
    ? `${settings.bankMonthly != null ? "платеж вручную" : "платеж авто"} · ${settings.bankMonths != null ? "срок вручную" : "срок авто"}`
    : bankTotalEstimated ? `Оценка: автоплатеж × автосрок · ${unresolvedLabel}`
    : auto.unresolved_contracts ? unresolvedLabel : "Расчет по отчету";
  const scenarios = [
    { name: "Платить банкам", tag: bankTag, monthly: bankMonthly, months: bankMonths, total: bankTotal, kind: "bank" },
    { name: "БФЛ", tag: "Процедура", monthly: settings.bflCost / settings.bflMonths, months: settings.bflMonths, total: settings.bflCost, kind: "bfl" },
    { name: "РДГ", tag: "Альтернативный сценарий", monthly: settings.rdgCost / settings.rdgMonths, months: settings.rdgMonths, total: settings.rdgCost, kind: "rdg" },
  ];
  return (
    <div className="scenario-wrap">
      <div className="scenario-grid scenario-head"><span>Вариант</span><span>Платеж / мес.</span><span>Срок</span><span>Всего отдаст</span><span>Экономия</span></div>
      {scenarios.map((scenario) => {
        const savings = bankTotal != null && scenario.total != null && scenario.kind !== "bank" ? bankTotal - scenario.total : null;
        return <div className={`scenario-grid scenario-row ${scenario.kind}`} key={scenario.name}>
          <div><strong>{scenario.name}</strong><small>{scenario.tag}</small></div>
          <b>{fmtMoney(scenario.monthly)}</b>
          <b>{scenario.months ? `${scenario.months} мес.` : "Уточнить"}</b>
          <strong>{scenario.kind === "bank" && bankTotalEstimated && scenario.total != null ? `≈ ${fmtMoney(scenario.total)}` : fmtMoney(scenario.total)}</strong>
          <span className={savings != null && savings > 0 ? "saving" : "muted"}>{scenario.kind === "bank" ? "База сравнения" : savings == null ? "После уточнения" : bankTotalEstimated ? `≈ ${fmtMoney(savings)}` : savings > 0 ? `+ ${fmtMoney(savings)}` : fmtMoney(savings)}</span>
        </div>;
      })}
    </div>
  );
}

function ContractCard({ contract }: { contract: Contract }) {
  const [open, setOpen] = useState(false);
  const paidCharges = contract.paid.interest + contract.paid.other;
  const projectionLabel = contract.projection?.status === "paid"
    ? "Погашено"
    : contract.projection?.status === "calculated" ? "Прогноз" : "Нужно уточнение";
  const projectionValue = contract.projection?.status === "paid"
    ? "Дальнейших платежей нет"
    : contract.projection?.total != null
      ? `${fmtMoney(contract.projection.total)} · ${contract.projection.months} мес.`
      : contract.projection?.message;
  return <article className={`contract-card ${contract.status}`}>
    <button className="contract-summary" onClick={() => setOpen((value) => !value)}>
      <div><span className={`status-dot ${contract.has_overdue_history ? "overdue" : ""}`} /><div><strong>{contract.creditor}</strong><small>{contract.status === "closed" ? "Закрыт" : contract.status_label}</small></div></div>
      <div><small>Текущий долг</small><strong>{fmtMoney(contract.balance.total)}</strong></div>
      <div><small>Уже внесено</small><strong>{fmtMoney(contract.paid.total)}</strong></div>
      <span className={`chevron ${open ? "open" : ""}`}>⌄</span>
    </button>
    <div className={`contract-detail ${open ? "open" : ""}`}>
      <div className="detail-grid">
        <span>Открыт <b>{fmtDate(contract.deal_date)}</b></span>
        <span>Сумма договора <b>{fmtMoney(contract.initial_amount)}</b></span>
        <span>В тело <b>{fmtMoney(contract.paid.principal)}</b></span>
        <span>Проценты и иное <b>{fmtMoney(paidCharges)}</b></span>
        <span>ПСК <b>{contract.rates.psk == null ? "Нет данных" : `${number.format(contract.rates.psk)}%`}</b></span>
        <span>Фактических платежей <b>{contract.actual_payment_count}{contract.payment_count_confidence === "low" ? "*" : ""}</b></span>
      </div>
      {contract.projection && <div className={`projection-note ${contract.projection.confidence}`}><span>{projectionLabel}</span><strong>{projectionValue}</strong></div>}
    </div>
  </article>;
}

const DEFAULT_SETTINGS: ScenarioSettings = {
  bflCost: 200_000,
  bflMonths: 15,
  rdgCost: 150_000,
  rdgMonths: 15,
  bankMonthly: null,
  bankMonths: null,
  largeDebtThreshold: 300_000,
};
const LARGE_DEBT_THRESHOLD_KEY = "finrazbor-large-debt-threshold";

function Dashboard({ analysis, onReset, theme, onToggleTheme, reportIndex, reportCount, onPrevious, onNext }: { analysis: Analysis; onReset: () => void; theme: Theme; onToggleTheme: () => void; reportIndex: number; reportCount: number; onPrevious: () => void; onNext: () => void }) {
  const auto = analysis.summary.bank_projection;
  const [settings, setSettings] = useState<ScenarioSettings>(() => {
    const storedThresholdValue = localStorage.getItem(LARGE_DEBT_THRESHOLD_KEY);
    const storedThreshold = Number(storedThresholdValue);
    return {
      ...DEFAULT_SETTINGS,
      largeDebtThreshold: storedThresholdValue !== null && Number.isFinite(storedThreshold) && storedThreshold >= 0
        ? storedThreshold
        : DEFAULT_SETTINGS.largeDebtThreshold,
    };
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notification, setNotification] = useState("");
  const notificationTimer = useRef<number | null>(null);

  useEffect(() => {
    localStorage.setItem(LARGE_DEBT_THRESHOLD_KEY, String(settings.largeDebtThreshold));
  }, [settings.largeDebtThreshold]);
  const paid = analysis.summary.paid;
  const charges = paid.interest + paid.other;
  const chargesShare = paid.total > 0 ? charges / paid.total * 100 : 0;
  const debt = analysis.summary.reported_total_debt ?? analysis.summary.calculated_total_debt;
  const activeContracts = analysis.contracts.filter((contract) => contract.status === "active");
  const initialAmountsKnown = activeContracts.length > 0 && activeContracts.every((contract) => contract.initial_amount != null && contract.initial_amount > 0);
  const initialAmount = initialAmountsKnown ? activeContracts.reduce((sum, contract) => sum + (contract.initial_amount || 0), 0) : null;
  const debtRemainingPercent = debt === 0 ? 0 : initialAmount ? Math.min(100, Math.round(debt / initialAmount * 100)) : null;
  const debtTone = debtRemainingPercent == null ? "ink" : debtRemainingPercent >= 80 ? "debt debt-critical" : debtRemainingPercent >= 50 ? "debt debt-warning" : "debt debt-good";
  const debtNote = debtRemainingPercent == null
    ? `${analysis.summary.active_count} действующих договора`
    : debtRemainingPercent === 0 ? "действующие долги погашены" : `осталось ${debtRemainingPercent}% от выданной суммы`;
  const largeRisks = analysis.compliance.low_payment_contracts.filter((item) => item.status === "active" && item.balance >= settings.largeDebtThreshold);
  const needsReview = analysis.compliance.low_payment_contracts.length > 0 || analysis.compliance.proximity_groups.length > 0 || largeRisks.length > 0;
  const riskLevel: RiskLevel = debt >= 700_000 || largeRisks.length > 0 || analysis.compliance.low_payment_contracts.length >= 3
    ? "danger"
    : debt >= 300_000 || needsReview ? "warning" : "safe";
  const salesMessage = chooseSalesMessage(
    riskLevel,
    `${analysis.report.customer_name}-${debt}-${analysis.compliance.low_payment_contracts.length}`,
  );

  function patchSettings(patch: Partial<ScenarioSettings>) {
    setSettings((current) => ({ ...current, ...patch }));
  }

  const salesText = `${analysis.report.customer_name || "Клиент"}: текущий долг ${fmtMoney(debt)}. Уже внесено ${fmtMoney(paid.total)}, из них ${fmtMoney(charges)} ушло на проценты и иные начисления. ${auto.total != null && auto.unresolved_contracts === 0 ? `При текущем сценарии банкам предстоит отдать около ${fmtMoney(auto.total)}.` : "Для точного прогноза выплаты банкам нужно уточнить платеж и срок."} БФЛ: ${fmtMoney(settings.bflCost)} за ${settings.bflMonths} месяцев. РДГ: ${fmtMoney(settings.rdgCost)} за ${settings.rdgMonths} месяцев. ${salesMessage}`;
  const lowPaymentSummary = analysis.compliance.low_payment_contracts.length
    ? analysis.compliance.low_payment_contracts.map((item) => `- ${item.creditor}: ${item.payment_count} платеж(а), долг ${fmtMoney(item.balance)}, статус: ${item.status === "active" ? "действующий" : "закрытый"}`).join("\n")
    : "- не обнаружены";
  const proximitySummary = analysis.compliance.proximity_groups.length
    ? analysis.compliance.proximity_groups.map((group) => `- ${group.creditors.join(" + ")}: период ${group.days_window} дн.`).join("\n")
    : "- не обнаружены";
  const largeRiskSummary = largeRisks.length
    ? largeRisks.map((item) => `- ${item.creditor}: долг ${fmtMoney(item.balance)}, платежей ${item.payment_count}`).join("\n")
    : "- не обнаружены";
  const legalText = `ПРОВЕРКА РИСКОВ\nКлиент: ${analysis.report.customer_name || "не указан"}\nОтчет: ${fmtDate(analysis.report.generated_at)}\nТекущий долг: ${fmtMoney(debt)}\nУровень внимания: ${riskLevel === "danger" ? "высокий" : riskLevel === "warning" ? "средний" : "низкий"}\n\nДОГОВОРЫ С МЕНЕЕ ЧЕМ 3 ПЛАТЕЖАМИ\n${lowPaymentSummary}\n\nКРЕДИТЫ, ОТКРЫТЫЕ МЕНЕЕ ЧЕМ ЗА 4 ДНЯ\n${proximitySummary}\n\nКРУПНЫЙ ДОЛГ И МАЛО ПЛАТЕЖЕЙ\n${largeRiskSummary}\n\nПередать юристу или старшему специалисту до заключения договора.`;

  async function copy(value: string, message: string) {
    try {
      const copyWithoutPermissionPrompt = () => {
        const textarea = document.createElement("textarea");
        textarea.value = value;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        const copied = document.execCommand("copy");
        textarea.remove();
        if (!copied) throw new Error("Copy command failed");
      };

      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(value);
        } catch {
          copyWithoutPermissionPrompt();
        }
      } else {
        copyWithoutPermissionPrompt();
      }
      setNotification(message);
    } catch {
      setNotification("Не удалось скопировать сводку");
    }
    if (notificationTimer.current != null) window.clearTimeout(notificationTimer.current);
    notificationTimer.current = window.setTimeout(() => setNotification(""), 2800);
  }

  return <main className={`dashboard-page risk-${riskLevel}`}>
    <header className="topbar">
      <div className="brand compact"><span className="brand-mark">Ф</span><span>Финразбор</span></div>
      <div className="client-navigation">
        {reportCount > 1 && <button type="button" className="report-nav-button previous" onClick={onPrevious} aria-label="Предыдущий отчет" title="Предыдущий отчет"><Icon name="arrow" /></button>}
        <div className="client-meta"><strong>{analysis.report.customer_name || "Клиент"}</strong><span>{analysis.report.provider} · отчет от {fmtDate(analysis.report.generated_at)}{reportCount > 1 ? ` · ${reportIndex + 1} / ${reportCount}` : ""}</span></div>
        {reportCount > 1 && <button type="button" className="report-nav-button" onClick={onNext} aria-label="Следующий отчет" title="Следующий отчет"><Icon name="arrow" /></button>}
      </div>
      <div className="top-actions"><button className="ghost" onClick={onReset}>Другой отчет</button><ThemeToggle theme={theme} onToggle={onToggleTheme} compact /><button className="icon-button" onClick={() => window.print()} title="Печать"><Icon name="print" /></button></div>
    </header>

    <div className="dashboard-shell">
      <section className="report-intro reveal">
        <div><p className="eyebrow">ТЕКУЩАЯ СИТУАЦИЯ</p><h1>Финансовая картина <em>без банковского языка</em></h1></div>
        <span className="verified"><Icon name="check" /> Сверено со сводкой ОКБ</span>
      </section>

      {analysis.warnings.length > 0 && <div className="warnings">{analysis.warnings.map((warning) => <span key={warning}>{warning}</span>)}</div>}

      <section className="metrics reveal delay-one">
        <MetricCard label="Текущий долг" value={fmtMoney(debt)} note={debtNote} tone={debtTone} progress={debtRemainingPercent} />
        <MetricCard label="Уже внесено" value={fmtMoney(paid.total)} note="по действующим обязательствам" />
        <MetricCard label="Ушло на проценты" value={fmtMoney(charges)} note={`${number.format(chargesShare)}% всех внесенных денег`} tone="warning" />
        <MetricCard label="В погашение тела" value={fmtMoney(paid.principal)} note="по данным кредитной истории" tone="positive" />
      </section>

      <section className="sales-thesis reveal delay-two">
        <div className="thesis-number">{Math.round(chargesShare)}<span>%</span></div>
        <div><p className="eyebrow">ГЛАВНЫЙ ТЕЗИС ДЛЯ КЛИЕНТА</p><h2>Из уже внесенных {fmtMoney(paid.total)} на проценты и другие начисления ушло <mark>{fmtMoney(charges)}</mark>.</h2><p>{salesMessage}</p></div>
        <button className="copy-button" onClick={() => void copy(salesText, "Аргумент для клиента скопирован")}><Icon name="copy" /> Скопировать аргумент</button>
      </section>

      <section className="comparison section-card reveal">
        <div className="section-heading"><div><p className="eyebrow">ГЛАВНЫЙ ПРОДАЖНЫЙ ВОПРОС</p><h2>Платить дальше или решить вопрос через процедуру?</h2></div><button className="settings-button" onClick={() => setSettingsOpen((value) => !value)}>Настроить расчет <span>{settingsOpen ? "×" : "↗"}</span></button></div>
        {settingsOpen && <div className="settings-panel">
          <div className="settings-panel-head"><div><strong>Параметры сценариев</strong><span>Изменения сразу пересчитывают таблицу</span></div><button type="button" onClick={() => setSettings({ ...DEFAULT_SETTINGS })}>Сбросить</button></div>
          <section className="settings-group bank"><div className="settings-group-head"><span>01</span><div><strong>Банки</strong><small>По отчету: {fmtMoney(auto.monthly_payment)} · {auto.months || "?"} мес.</small></div></div><div className="settings-fields">
            <Field label="Платеж в месяц" value={settings.bankMonthly} onChange={(value) => patchSettings({ bankMonthly: value })} suffix="₽" />
            <Field label="Осталось платить" value={settings.bankMonths} onChange={(value) => patchSettings({ bankMonths: value })} suffix="мес." />
          </div></section>
          <section className="settings-group bfl"><div className="settings-group-head"><span>02</span><div><strong>БФЛ</strong><small>Процедура банкротства</small></div></div><div className="settings-fields">
            <Field label="Стоимость" value={settings.bflCost} onChange={(value) => patchSettings({ bflCost: value ?? 0 })} suffix="₽" />
            <Field label="Срок" value={settings.bflMonths} onChange={(value) => patchSettings({ bflMonths: value || 1 })} suffix="мес." />
          </div></section>
          <section className="settings-group rdg"><div className="settings-group-head"><span>03</span><div><strong>РДГ</strong><small>Альтернативный сценарий</small></div></div><div className="settings-fields">
            <Field label="Стоимость" value={settings.rdgCost} onChange={(value) => patchSettings({ rdgCost: value ?? 0 })} suffix="₽" />
            <Field label="Срок" value={settings.rdgMonths} onChange={(value) => patchSettings({ rdgMonths: value || 1 })} suffix="мес." />
          </div></section>
        </div>}
        <ScenarioTable analysis={analysis} settings={settings} />
      </section>

      <section className="contracts-section section-card">
        <div className="section-heading"><div><p className="eyebrow">ДЕТАЛИ</p><h2>Договоры и платежи</h2></div><span className="pill">{analysis.summary.active_count} действующих · {analysis.summary.closed_count} закрытых</span></div>
        <div className="contract-list">{analysis.contracts.map((contract) => <ContractCard key={contract.id} contract={contract} />)}</div>
      </section>

      <section className="compliance-section">
        <div className="compliance-title"><div className="compliance-icon"><Icon name="shield" /></div><div><p className="eyebrow">ПРОВЕРКА РИСКОВ</p><h2>Что нужно проверить</h2><p>Передайте эти факты юристу или старшему специалисту до заключения договора.</p></div><span className={`review-badge ${needsReview ? "alert" : "clear"}`}>{needsReview ? "Требует проверки" : "Рисков не найдено"}</span></div>
        <div className="risk-grid">
          <article className={riskTone(analysis.compliance.low_payment_contracts.length)}><span>01</span><strong>{analysis.compliance.low_payment_contracts.length}</strong><h3>Менее 3 платежей</h3><p>{analysis.compliance.low_payment_contracts.length ? analysis.compliance.low_payment_contracts.map((item) => `${item.creditor}: ${item.payment_count}`).join(" · ") : "Таких договоров не найдено"}</p></article>
          <article className={riskTone(analysis.compliance.proximity_groups.length)}><span>02</span><strong>{analysis.compliance.proximity_groups.length}</strong><h3>Кредиты за &lt; 4 дней</h3><p>{analysis.compliance.proximity_groups.length ? analysis.compliance.proximity_groups.map((group) => group.creditors.join(" + ")).join(" · ") : "Близких дат открытия не найдено"}</p></article>
          <article className={riskTone(largeRisks.length)}><span>03</span><strong>{largeRisks.length}</strong><h3>Крупный долг + мало платежей</h3><p>{largeRisks.length ? `Под проверку: ${largeRisks.map((item) => item.creditor).join(" · ")}` : "Договоров выше выбранной суммы нет"}</p><Field label="Считать крупным долгом от" value={settings.largeDebtThreshold} onChange={(value) => patchSettings({ largeDebtThreshold: value ?? 0 })} suffix="₽" /><div className="threshold-presets">{[300_000, 500_000, 1_000_000].map((value) => <button type="button" className={settings.largeDebtThreshold === value ? "active" : ""} key={value} onClick={() => patchSettings({ largeDebtThreshold: value })}>{value === 1_000_000 ? "1 млн" : `${value / 1000} тыс.`}</button>)}</div><small className="threshold-current">Текущий порог: {fmtMoney(settings.largeDebtThreshold)} · пересчет сразу</small></article>
        </div>
        <div className="legal-actions"><button className="legal-copy" onClick={() => void copy(legalText, "Сводка для юриста скопирована")}><Icon name="copy" /> Скопировать сводку для юриста</button><p>Кнопка копирует клиента, долг и все найденные риски в буфер обмена для передачи специалисту.</p></div>
      </section>
    </div>
    {notification && <div className="copy-toast" role="status">{notification}</div>}
    <footer className="dashboard-footer"><span>Финразбор · {analysis.report.provider_label}</span><span>Расчеты носят оценочный характер и требуют проверки специалистом</span></footer>
  </main>;
}

export default function App() {
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [activeReport, setActiveReport] = useState(0);
  const [theme, setTheme] = useState<Theme>(() => localStorage.getItem("finrazbor-theme") === "dark" ? "dark" : "light");
  const toggleTheme = () => setTheme((current) => current === "light" ? "dark" : "light");
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    localStorage.setItem("finrazbor-theme", theme);
  }, [theme]);
  useEffect(() => {
    const root = document.getElementById("root");
    if (!root) return;
    bindRussianPrepositions(root);
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "characterData") bindRussianPrepositions(mutation.target);
        mutation.addedNodes.forEach(bindRussianPrepositions);
      }
    });
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);
  const resetReports = () => {
    setAnalyses([]);
    setActiveReport(0);
  };
  const loadReports = (loaded: Analysis[]) => {
    setAnalyses(loaded);
    setActiveReport(0);
  };
  const moveReport = (direction: number) => setActiveReport((current) => (current + direction + analyses.length) % analyses.length);
  return analyses.length
    ? <Dashboard
        key={activeReport}
        analysis={analyses[activeReport]}
        onReset={resetReports}
        theme={theme}
        onToggleTheme={toggleTheme}
        reportIndex={activeReport}
        reportCount={analyses.length}
        onPrevious={() => moveReport(-1)}
        onNext={() => moveReport(1)}
      />
    : <UploadScreen onLoaded={loadReports} theme={theme} onToggleTheme={toggleTheme} />;
}
