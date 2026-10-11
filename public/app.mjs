import { parsePriceCsv } from "./csv.mjs";

const $ = (selector) => document.querySelector(selector);
const state = {
  mode: "loading",
  instruments: [],
  events: [],
  sources: [],
  warnings: [],
  market: "ALL",
  query: "",
  eventCategory: "ALL",
  importedPrices: null,
  importedName: "",
  importedPreviousSymbol: "",
  selectedStrategySymbol: "",
  lastBacktest: null,
  lastBacktestConfig: null,
  liveRetrievedAt: null,
};

const viewNames = {
  overview: "市場總覽",
  events: "事件雷達",
  strategies: "策略實驗室",
  sources: "資料來源",
};
const categoryNames = {
  policy: "政策",
  macro: "總經",
  influencer: "公開人物",
  social: "社群",
};
const typeNames = { stock: "股票", etf: "交易所交易基金", fund: "基金" };
const marketNames = { US: "美股", TW: "台股", FUND: "基金" };
const dataKindNames = {
  synthetic: "合成資料",
  demo: "合成資料",
  imported: "匯入資料",
  live: "即時資料",
  live_snapshot: "官方每日行情快照",
};
const sourceKindNames = {
  exchange_snapshot: "官方每日行情快照",
  news_index: "新聞索引",
  primary: "官方原始資料",
};
const strategyNames = {
  buy_hold: "買進持有",
  sma: "均線趨勢",
  momentum: "動能",
};
const strategyTitleNames = {
  buy_hold: "買進持有策略",
  sma: "均線趨勢策略",
  momentum: "動能策略",
};
const numberFormat = new Intl.NumberFormat("zh-TW", {
  maximumFractionDigits: 2,
});
let toastTimer = 0;

function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function setText(selector, value) {
  const node = $(selector);
  if (node) node.textContent = value === undefined || value === null || value === "" ? "未提供" : String(value);
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function numberOrMissing(value, digits = 2) {
  if (!isFiniteNumber(value)) return "未提供";
  return new Intl.NumberFormat("zh-TW", { maximumFractionDigits: digits }).format(value);
}

function percentOrMissing(value, signed = false) {
  if (!isFiniteNumber(value)) return "未提供";
  const sign = signed && value > 0 ? "+" : "";
  return sign + new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 2 }).format(value) + "%";
}

function multipleOrMissing(value) {
  return isFiniteNumber(value) ? numberOrMissing(value, 2) + "×" : "未提供";
}

function priceLabel(price, currency) {
  if (!isFiniteNumber(price)) return "未提供";
  const value = numberFormat.format(price);
  return value + " " + (typeof currency === "string" && currency.trim() ? currency.trim() : "未提供");
}

function dateTimeLabel(value) {
  if (typeof value !== "string" || !value.trim()) return "未提供";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    const calendarDate = new Date(Date.UTC(year, month - 1, day));
    if (
      calendarDate.getUTCFullYear() !== year ||
      calendarDate.getUTCMonth() !== month - 1 ||
      calendarDate.getUTCDate() !== day
    ) return "未提供";
    return new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium", timeZone: "UTC" }).format(calendarDate);
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "未提供";
  return new Intl.DateTimeFormat("zh-TW", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function dateLabel(value) {
  if (typeof value !== "string" || !value.trim()) return "未提供";
  const date = new Date(value.length === 10 ? value + "T00:00:00" : value);
  if (!Number.isFinite(date.getTime())) return "未提供";
  return new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium" }).format(date);
}

function dataKindLabel(value) {
  return dataKindNames[value] || "未提供";
}

function safeHttpUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function externalLink(label, url, className = "source-link") {
  const safeUrl = safeHttpUrl(url);
  if (!safeUrl) return make("span", "source-no-link", "來源連結未提供");
  const link = make("a", className, label);
  link.href = safeUrl;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  return link;
}

function showToast(message, isError = false) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.toggle("is-error", isError);
  toast.classList.add("is-visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 3200);
}

function setMode(mode) {
  state.mode = mode;
  const labels = { loading: "載入中", demo: "示範研究", live: "即時來源", error: "服務暫不可用" };
  const badge = $("#mode-badge");
  badge.dataset.mode = mode;
  badge.replaceChildren(make("span", "badge-dot"), make("span", "", labels[mode] || "未提供"));
  const notice = $("#mode-notice");
  notice.dataset.mode = mode;
  const messages = {
    loading: "正在準備研究資料…",
    demo: "示範資料為合成價格與事件，不能代表市場行情或基金實際淨值。基金淨值研究亦未完整涵蓋申贖、配息與公司行動。",
    live: "即時資料模式：僅顯示固定來源本次回應；來源失敗或缺少涵蓋會如實呈現，不以示範資料替補。",
    error: "目前無法取得本機研究服務資料。請確認服務狀態後重試；畫面不會以示範內容替補。",
  };
  $("#mode-notice-text").textContent = messages[mode] || messages.error;
  setText("#service-label", mode === "error" ? "連線待確認" : mode === "loading" ? "正在連線" : "本機研究服務");
  setText("#dataset-label", mode === "demo" ? "合成資料" : mode === "live" ? "即時來源" : "未提供");
}

function setGlobalMessage(message, visible = true) {
  const banner = $("#global-message");
  banner.textContent = message;
  banner.classList.toggle("is-hidden", !visible);
}

async function requestJson(path, options = {}) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(path, {
      ...options,
      signal: controller.signal,
      cache: "no-store",
      headers: { Accept: "application/json", ...(options.headers || {}) },
    });
    if (!response.ok) throw new Error("API_FAILED");
    return await response.json();
  } finally {
    window.clearTimeout(timeout);
  }
}

function normalizeList(value) {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object") : [];
}

function setActiveView(view, updateHistory = false) {
  const selected = Object.hasOwn(viewNames, view) ? view : "overview";
  for (const section of document.querySelectorAll(".view")) {
    const active = section.id === "view-" + selected;
    section.hidden = !active;
    section.classList.toggle("is-visible", active);
  }
  for (const link of document.querySelectorAll("[data-view-link]")) {
    const active = link.dataset.viewLink === selected;
    link.classList.toggle(link.classList.contains("mobile-nav-item") ? "is-active" : "is-active", active);
    if (link.matches("a")) {
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
  }
  setText("#context-title", viewNames[selected]);
  if (updateHistory && window.location.hash !== "#" + selected) {
    window.history.pushState(null, "", "#" + selected);
  }
}

function initNavigation() {
  for (const link of document.querySelectorAll("[data-view-link]")) {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      setActiveView(link.dataset.viewLink, true);
      if (link.tagName === "A") $("#main").focus({ preventScroll: true });
    });
  }
  window.addEventListener("popstate", () => setActiveView(window.location.hash.slice(1), false));
  setActiveView(window.location.hash.slice(1), false);
}

function svgNode(tag, attributes = {}) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  return node;
}

function sparkline(history) {
  const points = normalizeList(history)
    .map((point) => point.close)
    .filter((value) => isFiniteNumber(value) && value > 0);
  if (points.length < 2) return make("div", "instrument-no-history", "趨勢資料未提供");
  const width = 220;
  const height = 38;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const spread = max - min || Math.max(Math.abs(max) * 0.015, 1);
  const coords = points.map((value, index) => ({
    x: (index / (points.length - 1)) * width,
    y: 4 + ((max - value) / spread) * (height - 9),
  }));
  const pathData = coords.map((point, index) => (index ? "L" : "M") + point.x.toFixed(2) + " " + point.y.toFixed(2)).join(" ");
  const svg = svgNode("svg", { viewBox: "0 0 220 38", class: "sparkline" + (points.at(-1) < points[0] ? " is-negative" : ""), role: "img", "aria-label": "價格歷史走勢" });
  const area = svgNode("path", { d: pathData + " L 220 38 L 0 38 Z", class: "spark-area" });
  const line = svgNode("path", { d: pathData, class: "spark-line" });
  svg.append(area, line);
  return svg;
}

function renderInstruments() {
  const grid = $("#instrument-grid");
  grid.replaceChildren();
  const search = state.query.trim().toLocaleLowerCase();
  const rows = state.instruments.filter((instrument) => {
    const marketMatches = state.market === "ALL" || instrument.market === state.market;
    const terms = [instrument.symbol, instrument.name].filter((value) => typeof value === "string").join(" ").toLocaleLowerCase();
    return marketMatches && (!search || terms.includes(search));
  });
  for (const instrument of rows) grid.append(makeInstrumentCard(instrument));
  $("#instrument-empty").classList.toggle("is-hidden", rows.length !== 0);
  setText("#instrument-count", state.instruments.length ? String(state.instruments.length) + " 檔" : "未提供");
  if (state.instruments.length === 0) setText("#overview-asof", "未提供");
  renderStrategySymbols();
}

function makeInstrumentCard(instrument) {
  const card = make("article", "instrument-card");
  const top = make("div", "instrument-top");
  const title = make("div", "instrument-title");
  title.append(make("div", "instrument-name", instrument.name || "名稱未提供"));
  title.append(make("div", "instrument-symbol", instrument.symbol || "代碼未提供"));
  const type = make("span", "type-pill", typeNames[instrument.type] || "類型未提供");
  type.dataset.type = instrument.type || "";
  top.append(title, type);
  const priceRow = make("div", "instrument-price-row");
  priceRow.append(make("strong", "instrument-price", priceLabel(instrument.price, instrument.currency)));
  const change = make("span", "instrument-change", percentOrMissing(instrument.changePct, true));
  if (isFiniteNumber(instrument.changePct)) {
    change.classList.add(instrument.changePct > 0 ? "up" : instrument.changePct < 0 ? "down" : "neutral");
  } else {
    change.classList.add("neutral");
  }
  priceRow.append(change);
  const foot = make("div", "instrument-foot");
  foot.append(
    make("span", "", marketNames[instrument.market] || "市場未提供"),
    make("span", "data-kind", dataKindLabel(instrument.dataKind)),
    make("span", "", dateTimeLabel(instrument.asOf)),
  );
  card.append(top, priceRow, sparkline(instrument.history), foot);
  return card;
}

function renderStrategySymbols() {
  const select = $("#strategy-symbol");
  const previous = state.selectedStrategySymbol || select.value;
  select.replaceChildren();
  for (const instrument of state.instruments) {
    const option = make("option", "", [instrument.symbol || "代碼未提供", instrument.name || "名稱未提供"].join(" · "));
    option.value = typeof instrument.symbol === "string" ? instrument.symbol : "";
    option.dataset.market = instrument.market || "";
    option.dataset.dataKind = instrument.dataKind || "";
    select.append(option);
  }
  if (state.importedPrices) {
    const option = make("option", "", "匯入價格序列（標的未確認）");
    option.value = "IMPORTED";
    option.dataset.dataKind = "imported";
    select.append(option);
  }
  if (!select.options.length) {
    const option = make("option", "", state.mode === "error" ? "目前沒有可用標的" : "標的資料未提供");
    option.value = "";
    select.append(option);
  }
  const preferred = state.importedPrices
    ? previous === "IMPORTED" ? "IMPORTED" : state.selectedStrategySymbol === "IMPORTED" ? "IMPORTED" : ""
    : previous === "IMPORTED" ? state.importedPreviousSymbol : previous;
  if (preferred && [...select.options].some((option) => option.value === preferred)) select.value = preferred;
  else if (state.importedPrices) select.value = "IMPORTED";
  state.selectedStrategySymbol = select.value;
  updateStrategyDataNote();
}

function selectedInstrument() {
  if ($("#strategy-symbol").value === "IMPORTED") return null;
  return state.instruments.find((instrument) => instrument.symbol === $("#strategy-symbol").value) || null;
}

function usesImportedPrices() {
  return Boolean(state.importedPrices && $("#strategy-symbol").value === "IMPORTED");
}

function hasUsableHistory(instrument) {
  if (!instrument || !Array.isArray(instrument.history)) return false;
  const rows = instrument.history.filter((point) => point && typeof point.date === "string" && isFiniteNumber(point.close) && point.close > 0);
  return rows.length >= 100;
}

function updateStrategyDataNote() {
  state.selectedStrategySymbol = $("#strategy-symbol").value;
  const instrument = selectedInstrument();
  if (usesImportedPrices()) {
    $("#strategy-data-note").textContent = "使用匯入序列：" + state.importedName + " · " + state.importedPrices.length + " 筆 · 標的身分未確認；目前僅保留在此頁面記憶體中。";
    return;
  }
  if (!instrument) {
    $("#strategy-data-note").textContent = "資料類型：未提供";
    return;
  }
  const kind = dataKindLabel(instrument.dataKind || (state.mode === "demo" ? "synthetic" : undefined));
  const count = Array.isArray(instrument.history) ? instrument.history.length : 0;
  const available = count >= 100 ? "歷史價格 " + count + " 筆" : "歷史價格不足 100 筆";
  $("#strategy-data-note").textContent = "資料類型：" + kind + " · " + available;
}

function renderEvents() {
  const events = state.events;
  const selected = state.eventCategory;
  const rows = events.filter((event) => selected === "ALL" || event.category === selected);
  const list = $("#event-list");
  list.replaceChildren();
  for (const event of rows) list.append(makeEventCard(event));
  $("#events-empty").classList.toggle("is-hidden", rows.length > 0);
  setText("#event-count", events.length ? events.length + " 則" : "未提供");

  const teaserList = $("#event-teasers");
  teaserList.replaceChildren();
  const teasers = events.slice(0, 3);
  for (const event of teasers) teaserList.append(makeEventTeaser(event));
  $("#event-teaser-empty").classList.toggle("is-hidden", teasers.length > 0);
  const socialSourceConnected = state.sources.some((source) => {
    const name = String(source.name || "").toLocaleLowerCase();
    return (name.includes("social") || name.includes("社群")) && sourceStatus(source.status).kind === "connected";
  });
  const socialEvents = events.some((event) => event.category === "social");
  $("#social-coverage").textContent = socialSourceConnected && socialEvents
    ? "來源已連線；事件資料未提供討論量，新聞注意力不等同社群涵蓋。"
    : "目前沒有可用的社群涵蓋量；新聞報導不能代表社群討論。";
}

function makeEventTeaser(event) {
  const row = make("div", "event-teaser-row");
  row.append(make("div", "event-teaser-title", event.title || "事件標題未提供"));
  row.append(make("span", "event-category-mini", categoryNames[event.category] || "其他"));
  const meta = [event.sourceName || "來源未提供", dateTimeLabel(event.publishedAt)].join(" · ");
  row.append(make("div", "event-teaser-meta", meta));
  return row;
}

function makeEventCard(event) {
  const card = make("article", "event-card");
  const accent = make("div", "event-accent");
  const main = make("div", "event-main");
  const meta = make("div", "event-meta-row");
  meta.append(make("span", "event-category", categoryNames[event.category] || "其他"));
  if (event.demo === true) meta.append(make("span", "event-demo", "示範事件"));
  else if (state.mode === "live") {
    if (event.sourceKind === "primary") meta.append(make("span", "event-primary", "官方原始來源"));
    else if (event.sourceKind === "news_index") meta.append(make("span", "event-original", "新聞索引"));
    meta.append(make("span", "event-original", "來源原文"));
  }
  meta.append(make("span", "event-time", "發布 " + dateTimeLabel(event.publishedAt)));
  const title = make("h3");
  const safeUrl = safeHttpUrl(event.sourceUrl);
  if (safeUrl) {
    const link = make("a", "event-title-link", event.title || "事件標題未提供");
    link.href = safeUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    title.append(link);
  } else {
    title.textContent = event.title || "事件標題未提供";
  }
  const footer = make("div", "event-footer");
  footer.append(make("span", "event-source", event.sourceName || "來源未提供"));
  const affected = Array.isArray(event.affectedSymbols) ? event.affectedSymbols.filter((item) => typeof item === "string") : [];
  footer.append(make("span", "event-symbols", affected.length ? "關聯標的 " + affected.join("、") : "關聯標的未提供"));
  const timeDetails = make("div", "event-time-detail");
  const isGdelt = event.sourceKind === "news_index" || String(event.sourceName || "").toLocaleLowerCase().includes("gdelt");
  timeDetails.append(make("span", "", "原文發布 " + dateTimeLabel(event.publishedAt)));
  const observedLabel = isGdelt ? "GDELT 索引發現時間 " : event.sourceKind === "primary" ? "本機取得時間 " : "來源觀察時間 ";
  timeDetails.append(make("span", "", observedLabel + dateTimeLabel(event.observedAt)));
  main.append(meta, title, footer, timeDetails);

  const score = make("aside", "event-score", "");
  score.setAttribute("aria-label", "啟發式證據分數，非獲利機率");
  score.append(make("span", "score-label", "啟發式證據分數"));
  const value = make("strong", "score-value", numberOrMissing(event.evidenceScore, 1));
  score.append(value, make("span", "score-caption", "僅供線索整理，非獲利機率"));
  card.append(accent, main, score);
  return card;
}

function sourceStatus(value) {
  const status = typeof value === "string" ? value.toLowerCase() : "";
  if (["ok", "connected", "available", "success", "ready"].includes(status)) {
    return { kind: "connected", label: "已連線" };
  }
  if (["not_requested", "not-requested"].includes(status)) {
    return { kind: "planned", label: "尚未請求" };
  }
  if (["planned", "not_configured", "not-configured", "missing", "disabled", "pending"].includes(status)) {
    return { kind: "planned", label: "規劃中／未接通" };
  }
  if (["error", "failed", "unavailable", "timeout", "rate_limited"].includes(status)) {
    return { kind: "error", label: "取得失敗" };
  }
  return { kind: "planned", label: "狀態未提供" };
}

function renderSources() {
  const list = $("#source-list");
  list.replaceChildren();
  for (const source of state.sources) {
    const card = make("article", "source-card");
    const top = make("div", "source-card-top");
    top.append(make("div", "source-name", source.name || "來源名稱未提供"));
    const status = sourceStatus(source.status);
    const statusBadge = make("span", "source-status", status.label);
    statusBadge.dataset.status = status.kind;
    top.append(statusBadge);
    const description = make("p", "source-description", source.description || "來源說明未提供。");
    const footer = make("div", "source-card-foot");
    if (sourceKindNames[source.sourceKind]) footer.append(make("span", "source-kind", "來源類型 " + sourceKindNames[source.sourceKind]));
    footer.append(make("span", "", "資料截至 " + dateTimeLabel(source.asOf)));
    if (state.mode === "live") footer.append(make("span", "", "來源取得 " + dateTimeLabel(source.retrievedAt)));
    footer.append(externalLink("開啟來源 ↗", source.url));
    card.append(top, description, footer);
    if (status.kind === "error") {
      const genericError = "此來源本次未能提供資料；目前顯示來源狀態，不以示範資料替代。";
      const sourceError = typeof source.error === "string" && source.error.trim()
        ? source.error.trim()
        : genericError;
      card.append(make("div", "source-error", sourceError));
    }
    list.append(card);
  }
  $("#sources-empty").classList.toggle("is-hidden", state.sources.length > 0);
  const connected = state.sources.filter((source) => sourceStatus(source.status).kind === "connected").length;
  setText("#connected-count", state.sources.length ? connected + " / " + state.sources.length + " 已連線" : "未提供");
  $("#sources-time-label").textContent = state.mode === "live" ? "回應時間" : "示範資料日期";
  setText("#sources-asof", dateTimeLabel(state.mode === "live" ? state.liveRetrievedAt : state.dashboardAsOf));
}

function renderWarnings() {
  if (state.mode !== "live" || !state.warnings.length) return;
  const list = state.warnings.filter((warning) => typeof warning === "string" && warning.trim());
  if (!list.length) return;
  setGlobalMessage("固定來源回傳 " + list.length + " 則提醒；請查看資料來源狀態。", true);
}

function renderAll() {
  const priceAsOf = state.mode === "live"
    ? state.instruments.find((instrument) => typeof instrument.asOf === "string" && instrument.asOf)?.asOf
    : state.dashboardAsOf;
  setText("#overview-asof", dateTimeLabel(priceAsOf));
  renderInstruments();
  renderEvents();
  renderSources();
  renderWarnings();
}

async function loadDashboard() {
  setMode("loading");
  try {
    const payload = await requestJson("/api/dashboard");
    if (!payload || typeof payload !== "object") throw new Error("INVALID_RESPONSE");
    state.instruments = normalizeList(payload.instruments);
    state.events = normalizeList(payload.events);
    state.sources = normalizeList(payload.sources);
    state.warnings = Array.isArray(payload.warnings) ? payload.warnings : [];
    state.dashboardAsOf = payload.asOf || null;
    state.liveRetrievedAt = payload.retrievedAt || null;
    if (payload.mode === "live") setMode("live");
    else if (payload.mode === "demo") setMode("demo");
    else setMode("error");
    if (state.mode === "error") setGlobalMessage("研究服務回傳的資料模式無法辨識。", true);
    else setGlobalMessage("", false);
    renderAll();
  } catch {
    state.instruments = [];
    state.events = [];
    state.sources = [];
    state.warnings = [];
    setMode("error");
    setGlobalMessage("無法載入研究資料。請確認本機服務已啟動，再重新載入頁面。", true);
    renderAll();
  }
}

async function refreshLive() {
  const button = $("#refresh-live");
  if (button.disabled) return;
  button.disabled = true;
  button.classList.add("is-loading");
  button.setAttribute("aria-busy", "true");
  setGlobalMessage("正在讀取固定資料來源…", true);
  try {
    const payload = await requestJson("/api/live");
    if (!payload || payload.mode !== "live") throw new Error("INVALID_RESPONSE");
    state.mode = "live";
    state.liveRetrievedAt = payload.retrievedAt || null;
    state.instruments = normalizeList(payload.instruments);
    state.events = normalizeList(payload.events);
    state.sources = normalizeList(payload.sources);
    state.warnings = Array.isArray(payload.warnings) ? payload.warnings : [];
    setMode("live");
    setGlobalMessage("", false);
    renderAll();
    showToast(state.sources.some((source) => sourceStatus(source.status).kind === "error")
      ? "更新已完成；部分來源未能提供資料，請查看來源狀態。"
      : "固定來源更新完成。");
  } catch {
    setGlobalMessage("固定來源更新未完成。畫面仍顯示最近一次成功取得的資料；請查看來源狀態後重試。", true);
    showToast("目前無法完成來源更新。", true);
  } finally {
    button.disabled = false;
    button.classList.remove("is-loading");
    button.removeAttribute("aria-busy");
  }
}

function updateMarketFilters(button) {
  state.market = button.dataset.market || "ALL";
  for (const chip of document.querySelectorAll("#market-filters .filter-chip")) {
    const active = chip === button;
    chip.classList.toggle("is-selected", active);
    chip.setAttribute("aria-pressed", String(active));
  }
  renderInstruments();
}

function updateEventFilters(button) {
  state.eventCategory = button.dataset.category || "ALL";
  for (const chip of document.querySelectorAll("#event-filters .filter-chip")) {
    const active = chip === button;
    chip.classList.toggle("is-selected", active);
    chip.setAttribute("aria-pressed", String(active));
  }
  renderEvents();
}

function parseHistoricalSeries(instrument) {
  if (!instrument || !Array.isArray(instrument.history)) return [];
  return instrument.history
    .filter((point) => point && typeof point.date === "string" && isFiniteNumber(point.close) && point.close > 0)
    .map((point) => ({ date: point.date, close: point.close }));
}

function setLoadingBacktest(loading) {
  const button = $("#run-backtest");
  button.disabled = loading;
  button.classList.toggle("loading-button", loading);
  button.querySelector("span").textContent = loading ? "正在計算…" : "執行回測";
  $("#backtest-form").setAttribute("aria-busy", String(loading));
}

function renderBacktest(result, config) {
  state.lastBacktest = result;
  state.lastBacktestConfig = config;
  $("#results-placeholder").classList.add("is-hidden");
  $("#results-content").classList.remove("is-hidden");
  $("#download-report").disabled = false;
  const kind = dataKindLabel(result.dataKind || config.dataKind);
  const pill = $("#result-kind");
  pill.textContent = kind;
  pill.classList.remove("is-hidden");
  const strategy = strategyTitleNames[result.strategy] || "策略回測";
  const resultKind = result.dataKind || config.dataKind;
  const displaySymbol = resultKind === "imported" ? "匯入價格序列（標的未確認）" : result.symbol || "標的未提供";
  setText("#result-title", displaySymbol + " · " + strategy);
  const split = result.split || {};
  setText("#result-period", "區間：" + dateLabel(split.trainEnd) + " 至 " + dateLabel(split.testEnd));
  drawEquityChart(result.curve);
  renderMetrics(result);
  renderSplit(split);
  renderBacktestWarnings(result);
}

function renderMetrics(result) {
  const metrics = result.metrics || {};
  const benchmark = result.benchmark || {};
  const metricsData = [
    ["總報酬", percentOrMissing(metrics.totalReturnPct), "基準 " + percentOrMissing(benchmark.totalReturnPct)],
    ["年化報酬", percentOrMissing(metrics.annualizedReturnPct), "保留測試區間結果需搭配期間檢視"],
    ["最大回撤", percentOrMissing(metrics.maxDrawdownPct), "基準 " + percentOrMissing(benchmark.maxDrawdownPct)],
    ["波動度", percentOrMissing(metrics.volatilityPct), "依回測序列計算"],
    ["夏普值", numberOrMissing(metrics.sharpe, 2), "未提供風險調整資訊時不推定"],
    ["累計換手倍數", multipleOrMissing(metrics.turnover), "曝險調整幅度累計；每次變動各計 1×"],
    ["曝險變動次數", numberOrMissing(metrics.trades, 0), "每次 0↔1 持倉變化各計一次"],
  ];
  const grid = $("#metric-grid");
  grid.replaceChildren();
  for (const [label, value, compare] of metricsData) {
    const card = make("div", "metric-card");
    card.append(make("div", "metric-label", label));
    const valueNode = make("div", "metric-value", value);
    if (value.startsWith("-")) valueNode.classList.add("negative");
    card.append(valueNode, make("div", "metric-compare", compare));
    grid.append(card);
  }
}

function renderSplit(split) {
  const details = [
    ["歷史區間結束", dateLabel(split.trainEnd)],
    ["保留測試開始", dateLabel(split.testStart)],
    ["保留測試結束", dateLabel(split.testEnd)],
    ["歷史／保留測試筆數", numberOrMissing(split.trainBars, 0) + " / " + numberOrMissing(split.testBars, 0)],
  ];
  const container = $("#split-details");
  container.replaceChildren();
  for (const [label, value] of details) {
    const item = make("div", "split-item");
    item.append(make("span", "", label), make("strong", "", value));
    container.append(item);
  }
}

function renderBacktestWarnings(result) {
  const list = $("#result-warnings");
  list.replaceChildren();
  const warnings = [
    ...(Array.isArray(result.assumptions) ? result.assumptions : []),
    ...(Array.isArray(result.warnings) ? result.warnings : []),
  ];
  for (const item of warnings) {
    if (typeof item === "string" && item.trim()) list.append(make("li", "", item));
    else if (item && typeof item === "object" && typeof item.message === "string") list.append(make("li", "", item.message));
  }
}

function drawEquityChart(curve) {
  const svg = $("#equity-chart");
  const empty = $("#chart-empty");
  const rows = normalizeList(curve).filter((row) =>
    typeof row.date === "string" && isFiniteNumber(row.equity) && isFiniteNumber(row.benchmark)
  );
  svg.replaceChildren();
  if (rows.length < 2) {
    svg.classList.add("is-hidden");
    empty.classList.remove("is-hidden");
    return;
  }
  svg.classList.remove("is-hidden");
  empty.classList.add("is-hidden");
  const width = 760;
  const height = 270;
  const pad = { top: 16, right: 12, bottom: 32, left: 58 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const sampled = sampleRows(rows, 240);
  const values = sampled.flatMap((row) => [row.equity, row.benchmark]);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    const delta = Math.max(Math.abs(max) * 0.03, 1);
    min -= delta;
    max += delta;
  }
  const yFor = (value) => pad.top + ((max - value) / (max - min)) * plotHeight;
  const xFor = (index) => pad.left + (index / (sampled.length - 1)) * plotWidth;
  for (let i = 0; i <= 3; i++) {
    const value = max - ((max - min) * i) / 3;
    const y = pad.top + (plotHeight * i) / 3;
    svg.append(svgNode("line", { x1: pad.left, y1: y, x2: width - pad.right, y2: y, class: "chart-grid-line" }));
    const label = svgNode("text", { x: pad.left - 7, y: y + 3, "text-anchor": "end", class: "chart-axis-label" });
    label.textContent = numberFormat.format(value);
    svg.append(label);
  }
  const dateIndexes = [0, Math.floor((sampled.length - 1) / 2), sampled.length - 1];
  for (const index of [...new Set(dateIndexes)]) {
    const x = xFor(index);
    const label = svgNode("text", { x, y: height - 8, "text-anchor": index === 0 ? "start" : index === sampled.length - 1 ? "end" : "middle", class: "chart-axis-label" });
    label.textContent = sampled[index].date;
    svg.append(label);
  }
  const strategyPath = sampled.map((row, index) =>
    (index ? "L" : "M") + xFor(index).toFixed(2) + " " + yFor(row.equity).toFixed(2)
  ).join(" ");
  const benchmarkPath = sampled.map((row, index) =>
    (index ? "L" : "M") + xFor(index).toFixed(2) + " " + yFor(row.benchmark).toFixed(2)
  ).join(" ");
  svg.append(svgNode("path", { d: benchmarkPath, class: "chart-benchmark-line" }));
  svg.append(svgNode("path", { d: strategyPath, class: "chart-strategy-line" }));
}

function sampleRows(rows, limit) {
  if (rows.length <= limit) return rows;
  const sampled = [];
  for (let index = 0; index < limit; index++) {
    sampled.push(rows[Math.round((index / (limit - 1)) * (rows.length - 1))]);
  }
  return sampled;
}

async function submitBacktest(event) {
  event.preventDefault();
  const form = $("#backtest-form");
  const error = $("#backtest-error");
  error.classList.add("is-hidden");
  error.textContent = "";
  if (!form.reportValidity()) return;
  const usesImported = usesImportedPrices();
  const instrument = usesImported ? null : selectedInstrument();
  const symbol = usesImported ? "IMPORTED" : $("#strategy-symbol").value;
  if (!symbol || (!usesImported && !instrument)) {
    error.textContent = "請先選擇有價格資料的標的。";
    error.classList.remove("is-hidden");
    return;
  }
  if (state.mode === "live" && !usesImported && !hasUsableHistory(instrument)) {
    error.textContent = "即時來源沒有足夠的歷史價格可供回測。請匯入至少 100 筆本機歷史價格。";
    error.classList.remove("is-hidden");
    return;
  }
  const body = {
    symbol,
    strategy: $("#strategy-name").value,
    lookback: Number($("#lookback").value),
    feeBps: Number($("#fee").value),
    slippageBps: Number($("#slippage").value),
    initialCapital: Number($("#initial-capital").value),
    splitRatio: 0.7,
  };
  if (usesImported) body.prices = state.importedPrices;
  else if (state.mode === "live") body.prices = parseHistoricalSeries(instrument);
  const runConfig = {
    ...body,
    prices: Array.isArray(body.prices) ? body.prices.map((row) => ({ date: row.date, close: row.close })) : undefined,
    priceProvenance: usesImported ? "imported" : state.mode === "demo" ? "synthetic" : "live",
    importedFileName: usesImported ? state.importedName : null,
    symbolIdentity: usesImported ? "unverified" : "listed_instrument",
    dataKind: usesImported ? "imported" : instrument.dataKind || (state.mode === "demo" ? "synthetic" : "live_snapshot"),
  };
  if (!runConfig.prices) delete runConfig.prices;
  setLoadingBacktest(true);
  try {
    const result = await requestJson("/api/backtest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!result || typeof result !== "object") throw new Error("INVALID_RESPONSE");
    renderBacktest(result, runConfig);
    showToast("回測完成。");
  } catch {
    error.textContent = "回測無法完成。請檢查資料來源與研究條件後重試。";
    error.classList.remove("is-hidden");
    showToast("回測未完成，請檢查條件後重試。", true);
  } finally {
    setLoadingBacktest(false);
  }
}

async function importCsv(file) {
  const status = $("#import-status");
  status.classList.remove("is-error", "is-success");
  if (!file) return;
  const currentSymbol = $("#strategy-symbol").value;
  if (currentSymbol !== "IMPORTED") state.importedPreviousSymbol = currentSymbol;
  state.importedPrices = null;
  state.importedName = "";
  state.selectedStrategySymbol = state.importedPreviousSymbol;
  renderStrategySymbols();
  $("#file-name").textContent = file.name || "已選取價格檔";
  try {
    const text = await file.text();
    const rows = parsePriceCsv(text);
    state.importedPrices = rows;
    state.importedName = file.name || "";
    state.selectedStrategySymbol = "IMPORTED";
    renderStrategySymbols();
    status.textContent = "已在此裝置解析並檢查日期與價格；標的身分未確認。執行回測時價格列會傳送至本機服務，不會送往外部來源或寫入持久儲存。";
    status.classList.add("is-success");
    $("#import-actions").classList.remove("is-hidden");
    setText("#import-count", rows.length + " 筆 · " + rows[0].date + " 至 " + rows.at(-1).date);
    updateStrategyDataNote();
    showToast("本機價格匯入完成。");
  } catch (problem) {
    state.importedPrices = null;
    state.importedName = "";
    state.selectedStrategySymbol = state.importedPreviousSymbol;
    state.importedPreviousSymbol = "";
    renderStrategySymbols();
    status.textContent = problem instanceof Error ? problem.message : "匯入檔格式無法辨識。";
    status.classList.add("is-error");
    $("#import-actions").classList.add("is-hidden");
    updateStrategyDataNote();
  }
}

function clearImport() {
  state.importedPrices = null;
  state.importedName = "";
  state.selectedStrategySymbol = state.importedPreviousSymbol;
  state.importedPreviousSymbol = "";
  $("#csv-file").value = "";
  $("#file-name").textContent = "選取價格檔";
  $("#import-status").textContent = "欄位須為 date,close，至少 100 筆、最多 5,000 筆，日期遞增且價格大於零；空白範本需自行填入 100 筆價格。";
  $("#import-status").classList.remove("is-error", "is-success");
  $("#import-actions").classList.add("is-hidden");
  renderStrategySymbols();
  showToast("已清除本機匯入資料。");
}

function downloadBlob(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = make("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadTemplate() {
  downloadBlob("市場羅盤_價格範本.csv", "date,close\r\n", "text/csv;charset=utf-8");
  showToast("價格範本已下載。");
}

function downloadReport() {
  if (!state.lastBacktest || !state.lastBacktestConfig) return;
  const config = state.lastBacktestConfig;
  const report = {
    title: "Market Compass 回測研究報告",
    exportedAt: new Date().toISOString(),
    configuration: {
      symbol: config.symbol,
      symbolLabel: config.symbolIdentity === "unverified" ? "匯入價格序列（標的未確認）" : config.symbol,
      symbolIdentity: config.symbolIdentity === "unverified" ? "未確認" : "依所選標的清單",
      strategy: config.strategy,
      lookback: config.lookback,
      feeBps: config.feeBps,
      slippageBps: config.slippageBps,
      initialCapital: config.initialCapital,
      splitRatio: config.splitRatio,
      priceProvenance: config.priceProvenance,
      dataKind: config.dataKind,
      importedFileName: config.importedFileName,
    },
    result: state.lastBacktest,
  };
  downloadBlob("市場羅盤_回測研究報告.json", JSON.stringify(report, null, 2), "application/json;charset=utf-8");
  showToast("研究報告已下載。");
}

function initControls() {
  $("#refresh-live").addEventListener("click", refreshLive);
  $("#instrument-search").addEventListener("input", (event) => {
    state.query = event.target.value;
    $("#clear-search").classList.toggle("is-hidden", !state.query);
    renderInstruments();
  });
  $("#clear-search").addEventListener("click", () => {
    $("#instrument-search").value = "";
    state.query = "";
    $("#clear-search").classList.add("is-hidden");
    renderInstruments();
    $("#instrument-search").focus();
  });
  $("#market-filters").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-market]");
    if (button) updateMarketFilters(button);
  });
  $("#event-filters").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-category]");
    if (button) updateEventFilters(button);
  });
  $("#strategy-symbol").addEventListener("change", updateStrategyDataNote);
  $("#backtest-form").addEventListener("submit", submitBacktest);
  $("#csv-file").addEventListener("change", (event) => importCsv(event.target.files?.[0]));
  $("#clear-import").addEventListener("click", clearImport);
  $("#download-template").addEventListener("click", downloadTemplate);
  $("#download-report").addEventListener("click", downloadReport);
}

initNavigation();
initControls();
loadDashboard();
