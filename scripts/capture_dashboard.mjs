import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";

const reportPath = process.argv[2];
const outputPath = process.argv[3] || "/tmp/credit-dashboard.png";
const targetUrl = process.argv[4] || "http://127.0.0.1:8765";
const viewportWidth = Number(process.argv[5] || 1440);
const viewportHeight = Number(process.argv[6] || 1200);
const mode = process.argv[7] || "file-input";
const printMode = mode === "print" || mode === "dark-print";
const dragMode = mode === "drag" || mode === "drag-after-invalid" || mode === "drag-hover";
const auxiliaryPath = process.argv[8];

if (!reportPath) {
  throw new Error("Usage: node scripts/capture_dashboard.mjs REPORT.pdf [OUTPUT.png] [URL]");
}

const browser = spawn("google-chrome-stable", [
  "--headless=new",
  "--no-sandbox",
  "--disable-gpu",
  "--hide-scrollbars",
  "--remote-debugging-port=9322",
  "--user-data-dir=/tmp/credit-report-cdp",
  `--window-size=${viewportWidth},${viewportHeight}`,
  targetUrl,
], { stdio: "ignore" });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
await sleep(1200);

try {
  const pages = await fetch("http://127.0.0.1:9322/json").then((response) => response.json());
  const page = pages.find((item) => item.type === "page");
  if (!page) throw new Error("Chrome page was not created");

  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  let nextId = 1;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject, method } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(`${method}: ${message.error.message} (${message.error.data || "CDP call failed"})`));
    else resolve(message.result);
  });

  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject, method });
    socket.send(JSON.stringify({ id, method, params }));
  });

  await call("Emulation.setDeviceMetricsOverride", {
    width: viewportWidth,
    height: viewportHeight,
    deviceScaleFactor: 1,
    mobile: viewportWidth < 600,
  });
  await call("DOM.enable");
  const document = await call("DOM.getDocument", { depth: -1 });
  const input = await call("DOM.querySelector", {
    nodeId: document.root.nodeId,
    selector: "input[type=file]",
  });
  if (mode === "threshold" || mode === "threshold-pages") {
    await call("Runtime.evaluate", { expression: "localStorage.removeItem('finrazbor-large-debt-threshold')" });
  }
  if (dragMode) {
    const dropzone = await call("Runtime.evaluate", {
      expression: "JSON.stringify((() => { const r = document.querySelector('.dropzone').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })())",
      returnByValue: true,
    });
    const point = JSON.parse(dropzone.result.value);
    const dispatchFile = async (path, mimeType, shouldDrop = true) => {
      const data = { items: [{ mimeType, data: "" }], files: [path], dragOperationsMask: 1 };
      await call("Input.dispatchDragEvent", { type: "dragEnter", ...point, data });
      await call("Input.dispatchDragEvent", { type: "dragOver", ...point, data });
      if (shouldDrop) await call("Input.dispatchDragEvent", { type: "drop", ...point, data });
    };
    if (mode === "drag-after-invalid") {
      if (!auxiliaryPath) throw new Error("drag-after-invalid mode requires an invalid file path");
      await dispatchFile(auxiliaryPath, "image/png");
      await sleep(300);
      const invalidState = await call("Runtime.evaluate", {
        expression: "document.querySelector('.error-banner')?.textContent || ''",
        returnByValue: true,
      });
      if (!invalidState.result.value.includes("PDF")) {
        throw new Error("Invalid file did not produce a PDF validation error");
      }
    }
    await dispatchFile(reportPath, "application/pdf", mode !== "drag-hover");
  } else {
    if (mode === "multiple" && !auxiliaryPath) throw new Error("multiple mode requires a second PDF path");
    await call("DOM.setFileInputFiles", { nodeId: input.nodeId, files: mode === "multiple" ? [reportPath, auxiliaryPath] : [reportPath] });
  }
  if (mode === "drag-hover") {
    await sleep(500);
    const hoverState = await call("Runtime.evaluate", {
      expression: "JSON.stringify((() => { const zone = document.querySelector('.dropzone'); const rect = zone?.getBoundingClientRect(); return { dragging: zone?.classList.contains('dragging'), height: rect?.height || 0, width: rect?.width || 0 }; })())",
      returnByValue: true,
    });
    const hover = JSON.parse(hoverState.result.value);
    if (!hover.dragging || hover.height < 270) throw new Error(`Dropzone did not expand: ${hoverState.result.value}`);
    const screenshot = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await writeFile(outputPath, Buffer.from(screenshot.data, "base64"));
    console.log(JSON.stringify({ outputPath, mode, hover }));
    socket.close();
    browser.kill("SIGTERM");
    process.exit(0);
  }

  await sleep(mode === "multiple" ? 5000 : 2500);

  const state = await call("Runtime.evaluate", {
    expression: "JSON.stringify({title: document.title, dashboard: !!document.querySelector('.dashboard-page'), clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth, text: document.body.innerText.slice(0, 200)})",
    returnByValue: true,
  });
  if (!JSON.parse(state.result.value).dashboard) {
    throw new Error(`Dashboard did not load: ${state.result.value}`);
  }

  if (mode === "settings") {
    await call("Runtime.evaluate", { expression: "document.querySelector('.settings-button')?.click()" });
    await sleep(300);
  }

  if (mode === "calculator-auto-term" || mode === "calculator-auto-payment") {
    await call("Runtime.evaluate", { expression: "document.querySelector('.settings-button')?.click()" });
    await sleep(300);
    await call("Runtime.evaluate", {
      expression: `(() => {
        const inputs = document.querySelectorAll('.settings-group.bank input');
        const input = inputs[${mode === "calculator-auto-term" ? 0 : 1}];
        if (!input) return;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '${mode === "calculator-auto-term" ? "50000" : "60"}');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`,
    });
    await sleep(300);
    const calculation = await call("Runtime.evaluate", {
      expression: `JSON.stringify((() => {
        const rows = [...document.querySelectorAll('.scenario-row')];
        const values = (row) => [...row.children].map((cell) => cell.textContent?.trim() || '');
        return {
          bank: values(rows.find((row) => row.classList.contains('bank'))),
          bfl: values(rows.find((row) => row.classList.contains('bfl'))),
          inputs: [...document.querySelectorAll('.settings-group.bank input')].map((input) => input.value),
        };
      })())`,
      returnByValue: true,
    });
    const result = JSON.parse(calculation.result.value);
    const digits = (value) => String(value || '').replace(/\D/g, '');
    const expected = mode === "calculator-auto-term"
      ? { untouched: result.inputs[1], total: '1200000', saving: '1000000', tag: 'срок авто' }
      : { untouched: result.inputs[0], total: '1080000', saving: '880000', tag: 'платеж авто' };
    if (expected.untouched !== '' || digits(result.bank[3]) !== expected.total || digits(result.bfl[4]) !== expected.saving || !result.bank[0].includes(expected.tag)) {
      throw new Error(`Auto term calculation failed: ${calculation.result.value}`);
    }
  }

  if (mode === "calculator-auto-auto") {
    const calculation = await call("Runtime.evaluate", {
      expression: `JSON.stringify((() => {
        const rows = [...document.querySelectorAll('.scenario-row')];
        const values = (row) => [...row.children].map((cell) => cell.textContent?.trim() || '');
        return {
          bank: values(rows.find((row) => row.classList.contains('bank'))),
          bfl: values(rows.find((row) => row.classList.contains('bfl'))),
        };
      })())`,
      returnByValue: true,
    });
    const result = JSON.parse(calculation.result.value);
    const digits = (value) => String(value || '').replace(/\D/g, '');
    if (digits(result.bank[3]) !== '432000' || digits(result.bfl[4]) !== '232000' || !result.bank[0].includes('Оценка: автоплатеж × автосрок')) {
      throw new Error(`Automatic calculation failed: ${calculation.result.value}`);
    }
  }

  if (mode === "dark" || mode === "dark-print" || mode === "dark-economy") {
    const initialTheme = await call("Runtime.evaluate", { expression: "document.documentElement.dataset.theme || 'light'", returnByValue: true });
    if (initialTheme.result.value === "dark") {
      await call("Runtime.evaluate", { expression: "document.querySelector('.theme-toggle.compact')?.click()" });
      await sleep(150);
    }
    await call("Runtime.evaluate", { expression: "document.querySelector('.theme-toggle.compact')?.click()" });
    await sleep(300);
    const themeState = await call("Runtime.evaluate", {
      expression: "JSON.stringify({theme: document.documentElement.dataset.theme, stored: localStorage.getItem('finrazbor-theme')})",
      returnByValue: true,
    });
    const selectedTheme = JSON.parse(themeState.result.value);
    if (selectedTheme.theme !== "dark" || selectedTheme.stored !== "dark") {
      throw new Error(`Dark theme was not persisted: ${themeState.result.value}`);
    }
  }

  if (mode === "dark-economy") {
    const economyStyle = await call("Runtime.evaluate", {
      expression: `JSON.stringify((() => {
        const cell = document.querySelector('.scenario-row.bfl > span:last-child');
        const style = cell ? getComputedStyle(cell) : null;
        return { text: cell?.textContent?.trim() || '', color: style?.color || '', background: style?.backgroundColor || '', weight: style?.fontWeight || '' };
      })())`,
      returnByValue: true,
    });
    const economy = JSON.parse(economyStyle.result.value);
    if (!economy.text.includes('₽') || economy.color !== 'rgb(32, 55, 20)' || economy.background !== 'rgba(0, 0, 0, 0)' || Number(economy.weight) < 700) {
      throw new Error(`Dark economy cell is not readable: ${economyStyle.result.value}`);
    }
  }

  if (mode === "multiple") {
    const firstReport = await call("Runtime.evaluate", {
      expression: "JSON.stringify({name: document.querySelector('.client-meta strong')?.textContent || '', meta: document.querySelector('.client-meta span')?.textContent || '', arrows: document.querySelectorAll('.report-nav-button').length})",
      returnByValue: true,
    });
    await call("Runtime.evaluate", { expression: "document.querySelector('.report-nav-button:not(.previous)')?.click()" });
    await sleep(800);
    const secondReport = await call("Runtime.evaluate", {
      expression: "JSON.stringify({name: document.querySelector('.client-meta strong')?.textContent || '', meta: document.querySelector('.client-meta span')?.textContent || ''})",
      returnByValue: true,
    });
    const first = JSON.parse(firstReport.result.value);
    const second = JSON.parse(secondReport.result.value);
    if (first.arrows !== 2 || first.name === second.name || !first.meta.includes("1 / 2") || !second.meta.includes("2 / 2")) {
      throw new Error(`Multiple report navigation failed: ${JSON.stringify({ first, second })}`);
    }
  }

  if (mode === "threshold" || mode === "threshold-pages") {
    const thresholdState = await call("Runtime.evaluate", {
      expression: `JSON.stringify((() => {
        const card = document.querySelector('.risk-grid article:nth-child(3)');
        const input = card?.querySelector('input');
        const before = card?.querySelector(':scope > strong')?.textContent || '';
        if (!input) return { before, after: '', value: '', missing: true };
        input.focus();
        input.select();
        return { before, value: input.value };
      })())`,
      returnByValue: true,
    });
    await call("Input.insertText", { text: "2000000" });
    await sleep(300);
    const updatedThreshold = await call("Runtime.evaluate", {
      expression: "JSON.stringify({count: document.querySelector('.risk-grid article:nth-child(3) > strong')?.textContent || '', value: document.querySelector('.risk-grid article:nth-child(3) input')?.value || '', text: document.querySelector('.threshold-current')?.textContent || ''})",
      returnByValue: true,
    });
    const before = JSON.parse(thresholdState.result.value);
    const after = JSON.parse(updatedThreshold.result.value);
    if (before.missing || (mode === "threshold" && before.before === after.count) || after.value !== "2000000" || after.text.replace(/\D/g, "") !== "2000000") {
      throw new Error(`Risk threshold did not update: ${JSON.stringify({ before, after })}`);
    }
    if (mode === "threshold-pages") {
      await call("Runtime.evaluate", { expression: "document.querySelector('.report-nav-button:not(.previous)')?.click()" });
      await sleep(500);
      const nextReportThreshold = await call("Runtime.evaluate", {
        expression: "JSON.stringify({value: document.querySelector('.risk-grid article:nth-child(3) input')?.value || '', meta: document.querySelector('.client-meta span')?.textContent || '', stored: localStorage.getItem('finrazbor-large-debt-threshold')})",
        returnByValue: true,
      });
      const next = JSON.parse(nextReportThreshold.result.value);
      if (next.value !== "2000000" || next.stored !== "2000000" || !next.meta.includes("2 / 2")) {
        throw new Error(`Risk threshold was reset between reports: ${nextReportThreshold.result.value}`);
      }
    }
  }

  if (["debt-critical", "debt-warning", "debt-good"].includes(mode)) {
    const debtState = await call("Runtime.evaluate", {
      expression: "JSON.stringify({classes: document.querySelector('.metric-card')?.className || '', note: document.querySelector('.metric-card small')?.textContent || '', progress: document.querySelector('.debt-progress span')?.style.width || ''})",
      returnByValue: true,
    });
    const debtCard = JSON.parse(debtState.result.value);
    if (!debtCard.classes.includes(mode) || !debtCard.progress) {
      throw new Error(`Debt tone mismatch for ${mode}: ${debtState.result.value}`);
    }
  }

  if (mode === "legal-copy") {
    await call("Browser.grantPermissions", {
      origin: new URL(targetUrl).origin,
      permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"],
    });
    const copyResult = await call("Runtime.evaluate", {
      expression: `JSON.stringify((() => {
        const button = document.querySelector('.legal-copy');
        const buttonTextBefore = button?.textContent?.trim() || '';
        button?.click();
        return { buttonTextBefore };
      })())`,
      returnByValue: true,
    });
    await sleep(300);
    const notificationResult = await call("Runtime.evaluate", {
      expression: `JSON.stringify({
        toast: document.querySelector('.copy-toast')?.textContent?.trim() || '',
        buttonTextAfter: document.querySelector('.legal-copy')?.textContent?.trim() || ''
      })`,
      returnByValue: true,
    });
    const copyState = { ...JSON.parse(copyResult.result.value), ...JSON.parse(notificationResult.result.value) };
    const normalizedToast = copyState.toast.replace(/\u00a0/g, " ");
    if (normalizedToast !== "Сводка для юриста скопирована") {
      throw new Error(`Copy notification was not shown: ${JSON.stringify(copyState)}`);
    }
    if (copyState.buttonTextBefore !== copyState.buttonTextAfter) {
      throw new Error(`Copy button text changed: ${JSON.stringify(copyState)}`);
    }
  }

  if (printMode) {
    await call("Emulation.setEmulatedMedia", { media: "print" });
    const pdf = await call("Page.printToPDF", {
      printBackground: true,
      preferCSSPageSize: true,
    });
    await writeFile(outputPath, Buffer.from(pdf.data, "base64"));
    console.log(JSON.stringify({ outputPath, mode: "print", state: JSON.parse(state.result.value) }));
  } else {
    const metrics = await call("Page.getLayoutMetrics");
    const width = Math.min(viewportWidth, Math.ceil(metrics.cssContentSize.width));
    const height = Math.min(4200, Math.ceil(metrics.cssContentSize.height));
    const screenshot = await call("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width, height, scale: 1 },
    });
    await writeFile(outputPath, Buffer.from(screenshot.data, "base64"));
    console.log(JSON.stringify({ outputPath, width, height, state: JSON.parse(state.result.value) }));
  }
  socket.close();
} finally {
  browser.kill("SIGTERM");
}
