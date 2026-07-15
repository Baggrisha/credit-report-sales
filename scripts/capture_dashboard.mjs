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

  if (mode === "dark" || mode === "dark-print") {
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
