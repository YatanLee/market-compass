import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type RefObject,
  type ReactNode,
} from "react";
import { getDashboard, getLiveSnapshot, postBacktest } from "./api";
import { parsePriceCsv } from "./csv";
import type {
  BacktestRequest,
  BacktestResult,
  BacktestSnapshot,
  DataMode,
  DashboardPayload,
  Instrument,
  PricePoint,
  ResearchEvent,
  Source,
  StrategyId,
  ViewId,
} from "./types";
import {
  categoryNames,
  dataKindNames,
  dateLabel,
  dateTimeLabel,
  isFiniteNumber,
  marketNames,
  modeLabel,
  multipleOrMissing,
  numberFormat,
  numberOrMissing,
  percentOrMissing,
  priceLabel,
  safeHttpUrl,
  sourceKindNames,
  sourceStatus,
  strategyNames,
  strategyTitleNames,
  typeNames,
  viewNames,
} from "./utils";

const DEMO_NOTICE = "示範資料為合成價格與事件，不能代表市場行情或基金實際淨值。基金淨值研究亦未完整涵蓋申贖、配息與公司行動。";
const LIVE_NOTICE = "固定來源模式：僅顯示本次回應所含資料；來源失敗或缺少涵蓋會如實呈現，不以示範資料替補。";
const DEFAULT_IMPORT_STATUS = "欄位須為 date,close，至少 100 筆、最多 5,000 筆，日期遞增且價格大於零；空白範本需自行填入 100 筆價格。";
const GENERIC_SOURCE_ERROR = "此來源本次未能提供資料；目前顯示來源狀態，不以示範資料替代。";
const CATEGORY_FILTERS = [
  ["ALL", "全部事件"],
  ["policy", "政策"],
  ["macro", "總經"],
  ["influencer", "公開人物"],
  ["social", "社群"],
] as const;
const MARKET_FILTERS = [
  ["ALL", "全部"],
  ["US", "美股與交易所交易基金"],
  ["TW", "台股"],
  ["FUND", "基金"],
] as const;

type IconName = "overview" | "events" | "strategies" | "sources" | "refresh" | "search" | "download" | "upload" | "arrow";
type ToastInfo = { message: string; isError: boolean } | null;

function Icon({ name, className }: { name: IconName; className?: string }) {
  const classes = className ? `${className} icon-svg` : "icon-svg";
  if (name === "overview") return <svg className={classes} aria-hidden="true" viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="4" rx="1.5"/><rect x="13.5" y="9.5" width="7" height="11" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/></svg>;
  if (name === "events") return <svg className={classes} aria-hidden="true" viewBox="0 0 24 24"><path d="M12 3.5 14.6 9l5.9.7-4.4 4 1.2 5.8L12 16.6l-5.3 2.9 1.2-5.8-4.4-4L9.4 9 12 3.5Z"/></svg>;
  if (name === "strategies") return <svg className={classes} aria-hidden="true" viewBox="0 0 24 24"><path d="M4 18.5 9 13l3.2 3.1L20 7.5"/><path d="M14.5 7.5H20v5.5"/><path d="M4 4.5v15h16"/></svg>;
  if (name === "sources") return <svg className={classes} aria-hidden="true" viewBox="0 0 24 24"><path d="M5 4.5h14v15H5z"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>;
  if (name === "refresh") return <svg className={classes} aria-hidden="true" viewBox="0 0 20 20"><path d="M16.2 8A6.3 6.3 0 0 0 5.4 5.4L3.5 7.3M3.8 12A6.3 6.3 0 0 0 14.6 14.6l1.9-1.9"/><path d="M3.5 3.8v3.5H7M16.5 16.2v-3.5H13"/></svg>;
  if (name === "search") return <svg className={classes} aria-hidden="true" viewBox="0 0 20 20"><circle cx="8.7" cy="8.7" r="5.4"/><path d="m13 13 4 4"/></svg>;
  if (name === "download") return <svg className={classes} aria-hidden="true" viewBox="0 0 20 20"><path d="M10 3v9m0 0 3.5-3.5M10 12 6.5 8.5M4 14.5V17h12v-2.5"/></svg>;
  if (name === "upload") return <svg className={classes} aria-hidden="true" viewBox="0 0 20 20"><path d="M10 13V3m0 0L6.5 6.5M10 3l3.5 3.5M4 12v4.5h12V12"/></svg>;
  return <svg className={classes} aria-hidden="true" viewBox="0 0 20 20"><path d="M4 10h11M10 4l6 6-6 6"/></svg>;
}

function BrandMark({ small = false }: { small?: boolean }) {
  return (
    <span className={`brand-mark${small ? " brand-mark-small" : ""}`} aria-hidden="true">
      <svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="17" fill="none" stroke="currentColor" strokeWidth="1.5"/><circle cx="20" cy="20" r="11" fill="none" stroke="currentColor" strokeWidth="1" opacity=".38"/><path d="M27 12 22 22l-9 6 5-10 9-6Z" fill="currentColor"/><circle cx="20" cy="20" r="2" fill="#f5f4ef"/></svg>
    </span>
  );
}

function NavigationItems({ activeView, onNavigate, mobile = false }: { activeView: ViewId; onNavigate: (view: ViewId) => void; mobile?: boolean }) {
  const views: ViewId[] = ["overview", "events", "strategies", "sources"];
  const labels: Record<ViewId, string> = mobile
    ? { overview: "總覽", events: "事件", strategies: "策略", sources: "來源" }
    : viewNames;
  return (
    <nav className={mobile ? "mobile-nav" : "primary-nav"} aria-label="主要導覽">
      {views.map((view) => (
        <a
          key={view}
          href={`#${view}`}
          className={`${mobile ? "mobile-nav-item" : "nav-item"}${activeView === view ? " is-active" : ""}`}
          aria-current={activeView === view ? "page" : undefined}
          onClick={(event) => { event.preventDefault(); onNavigate(view); }}
        >
          <Icon name={view} /><span>{labels[view]}</span>
        </a>
      ))}
    </nav>
  );
}

function Sidebar({ activeView, onNavigate, mode }: { activeView: ViewId; onNavigate: (view: ViewId) => void; mode: DataMode }) {
  return (
    <aside className="sidebar" aria-label="主要導覽">
      <a className="brand" href="#overview" onClick={(event) => { event.preventDefault(); onNavigate("overview"); }} aria-label="Market Compass 市場羅盤首頁">
        <BrandMark /><span className="brand-copy"><strong>Market Compass</strong><small>投資研究工作台</small></span>
      </a>
      <div className="sidebar-label">研究空間</div>
      <NavigationItems activeView={activeView} onNavigate={onNavigate} />
      <div className="sidebar-bottom">
        <div className="sidebar-note"><span className="note-icon" aria-hidden="true">i</span><p>只供研究與比較<br/>不含下單或個人化配置</p></div>
        <div className="sidebar-foot"><span className="online-dot" aria-hidden="true"/><span>{mode === "error" ? "連線待確認" : mode === "loading" ? "正在連線" : "本機研究服務"}</span></div>
      </div>
    </aside>
  );
}

function Topbar({ mode, refreshing, onRefresh, activeView }: { mode: DataMode; refreshing: boolean; onRefresh: () => void; activeView: ViewId }) {
  return (
    <header className="topbar">
      <div className="mobile-brand"><BrandMark small/><strong>Market Compass</strong></div>
      <div className="topbar-context"><span className="eyebrow">研究工作台</span><span className="context-divider">/</span><span>{viewNames[activeView]}</span></div>
      <div className="topbar-actions">
        <span className="mode-badge" data-mode={mode}><span className="badge-dot"/><span>{modeLabel(mode)}</span></span>
        <button className={`button button-live${refreshing ? " is-loading" : ""}`} id="refresh-live" type="button" aria-label="更新真實來源資料" title="更新固定來源" aria-busy={refreshing} disabled={refreshing} onClick={onRefresh}>
          <Icon name="refresh" className="refresh-icon"/><span>{refreshing ? "更新中" : "更新固定來源"}</span>
        </button>
      </div>
    </header>
  );
}

function ModeNotice({ mode }: { mode: DataMode }) {
  const message = mode === "demo" ? DEMO_NOTICE : mode === "live" ? LIVE_NOTICE : mode === "error"
    ? "目前無法取得本機研究服務資料。請確認服務狀態後重試；畫面不會以示範內容替補。"
    : "正在準備研究資料…";
  return <div className="mode-notice" data-mode={mode}><span className="notice-symbol" aria-hidden="true">✳</span><p>{message}</p></div>;
}

function GlobalMessage({ message }: { message: string }) {
  if (!message) return null;
  return <div className="global-message" role="status" aria-live="polite">{message}</div>;
}

function PageFooter() {
  return <footer className="page-foot"><span>Market Compass</span><span>研究用途｜不構成投資建議</span></footer>;
}

function PageHeading({ titleId, kicker, title, subtitle, sideLabel, sideValue, compact = false }: {
  titleId?: string;
  kicker: string;
  title: string;
  subtitle: string;
  sideLabel: string;
  sideValue: string;
  compact?: boolean;
}) {
  return (
    <div className={`page-heading${compact ? " compact-heading" : ""}`}>
      <div><div className="eyebrow heading-kicker"><span className="heading-rule"/>{kicker}</div><h1 id={titleId}>{title}</h1><p className="heading-subtitle">{subtitle}</p></div>
      <div className="asof-block"><span className="label-small">{sideLabel}</span><strong>{sideValue}</strong></div>
    </div>
  );
}

function FilterChips({ items, selected, onChange, label, id }: {
  items: ReadonlyArray<readonly [string, string]>;
  selected: string;
  onChange: (value: string) => void;
  label: string;
  id: string;
}) {
  return (
    <div className="filter-row" role="group" aria-label={label} id={id}>
      {items.map(([value, labelText]) => (
        <button key={value} type="button" className={`filter-chip${selected === value ? " is-selected" : ""}`} aria-pressed={selected === value} onClick={() => onChange(value)}>{labelText}</button>
      ))}
    </div>
  );
}

function Sparkline({ history }: { history?: PricePoint[] | undefined }) {
  const points = (history ?? []).map((point) => point.close).filter((value) => isFiniteNumber(value) && value > 0);
  if (points.length < 2) return <div className="instrument-no-history">趨勢資料未提供</div>;
  const width = 220;
  const height = 38;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const spread = max - min || Math.max(Math.abs(max) * 0.015, 1);
  const path = points.map((value, index) => {
    const x = (index / (points.length - 1)) * width;
    const y = 4 + ((max - value) / spread) * (height - 9);
    return `${index ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(" ");
  const first = points[0] ?? 0;
  const last = points[points.length - 1] ?? first;
  return (
    <svg viewBox="0 0 220 38" className={`sparkline${last < first ? " is-negative" : ""}`} role="img" aria-label="價格歷史走勢">
      <path d={`${path} L 220 38 L 0 38 Z`} className="spark-area"/><path d={path} className="spark-line"/>
    </svg>
  );
}

function InstrumentCard({ instrument }: { instrument: Instrument }) {
  const changeClass = !isFiniteNumber(instrument.changePct) ? "neutral" : instrument.changePct > 0 ? "up" : instrument.changePct < 0 ? "down" : "neutral";
  return (
    <article className="instrument-card">
      <div className="instrument-top"><div className="instrument-title"><div className="instrument-name">{instrument.name || "名稱未提供"}</div><div className="instrument-symbol">{instrument.symbol || "代碼未提供"}</div></div><span className="type-pill" data-type={instrument.type}>{typeNames[instrument.type] ?? "類型未提供"}</span></div>
      <div className="instrument-price-row"><strong className="instrument-price">{priceLabel(instrument.price, instrument.currency)}</strong><span className={`instrument-change ${changeClass}`}>{percentOrMissing(instrument.changePct, true)}</span></div>
      <Sparkline history={instrument.history}/>
      <div className="instrument-foot"><span>{marketNames[instrument.market] ?? "市場未提供"}</span><span className="data-kind">{dataKindNames[instrument.dataKind ?? ""] ?? "未提供"}</span><span>{dateTimeLabel(instrument.asOf)}</span></div>
    </article>
  );
}

function EventTeaser({ event }: { event: ResearchEvent }) {
  return (
    <div className="event-teaser-row">
      <div className="event-teaser-title">{event.title || "事件標題未提供"}</div>
      <span className="event-category-mini">{categoryNames[event.category] ?? "其他"}</span>
      <div className="event-teaser-meta">{event.sourceName || "來源未提供"} · {dateTimeLabel(event.publishedAt)}</div>
    </div>
  );
}

function OverviewPage({
  instruments,
  events,
  sources,
  mode,
  asOf,
  onNavigate,
  active,
}: {
  instruments: Instrument[];
  events: ResearchEvent[];
  sources: Source[];
  mode: DataMode;
  asOf: string | null;
  onNavigate: (view: ViewId) => void;
  active: boolean;
}) {
  const [market, setMarket] = useState("ALL");
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return instruments.filter((instrument) => {
      const marketMatches = market === "ALL" || instrument.market === market;
      const terms = `${instrument.symbol ?? ""} ${instrument.name ?? ""}`.toLocaleLowerCase();
      return marketMatches && (!query || terms.includes(query));
    });
  }, [instruments, market, search]);
  const connectedSocial = sources.some((source) => /social|社群/i.test(source.name) && sourceStatus(source).kind === "connected");
  const socialEvents = events.some((event) => event.category === "social");
  const socialText = connectedSocial && socialEvents
    ? "來源已連線；事件資料未提供討論量，新聞注意力不等同社群涵蓋。"
    : "目前沒有可用的社群涵蓋量；新聞報導不能代表社群討論。";

  return (
    <section className={`view${active ? " is-visible" : ""}`} id="view-overview" aria-labelledby="page-title-overview" hidden={!active}>
      <div className="page-heading">
        <div><div className="eyebrow heading-kicker"><span className="heading-rule"/>市場觀察</div><h1 id="page-title-overview">讓研究回到脈絡</h1><p className="heading-subtitle">把市場資料、事件線索與策略假設放在同一張桌面上。</p></div>
        <div className="asof-block"><span className="label-small">資料時間</span><strong>{dateTimeLabel(asOf)}</strong></div>
      </div>
      <section className="intro-panel" aria-label="研究資料說明">
        <div className="intro-copy"><span className="overline">研究札記</span><h2>先看資料從哪裡來，<br className="desktop-break"/>再決定要問什麼。</h2><p>市場數字不是答案。這裡整理可追溯的觀察，並把假設留在明處。</p></div>
        <div className="intro-art" aria-hidden="true"><span className="orbit orbit-one"/><span className="orbit orbit-two"/><span className="orbit orbit-three"/><span className="art-core"/><span className="art-point point-one"/><span className="art-point point-two"/><span className="art-point point-three"/><span className="art-label">觀察資料<br/>保留脈絡</span></div>
        <div className="intro-footer"><span>研究資料集</span><strong>{mode === "demo" ? "合成資料" : mode === "live" ? "固定來源" : "未提供"}</strong><span className="intro-footer-divider"/><span>觀察標的</span><strong>{instruments.length ? `${instruments.length} 檔` : "未提供"}</strong></div>
      </section>
      <div className="section-header market-header">
        <div><div className="eyebrow">市場觀察</div><h2>市場清單</h2><p>資料類型與幣別依來源標示</p></div>
        <div className="market-controls"><label className="search-box"><Icon name="search"/><span className="visually-hidden">搜尋標的</span><input type="search" placeholder="搜尋名稱或代碼" autoComplete="off" value={search} onChange={(event) => setSearch(event.target.value)}/>{search && <button type="button" aria-label="清除搜尋" className="clear-search" onClick={() => setSearch("")}>×</button>}</label></div>
      </div>
      <FilterChips items={MARKET_FILTERS} selected={market} onChange={setMarket} label="市場篩選" id="market-filters"/>
      {filtered.length ? <div className="instrument-grid" aria-live="polite">{filtered.map((instrument) => <InstrumentCard key={instrument.symbol} instrument={instrument}/>)}</div> : <div className="empty-state" role={mode === "loading" ? "status" : undefined} aria-live="polite"><span className="empty-mark" aria-hidden="true">{mode === "loading" ? "◌" : "⌕"}</span><h3>{mode === "loading" ? "正在載入市場清單" : mode === "error" ? "目前無法取得市場清單" : "沒有符合條件的標的"}</h3><p>{mode === "loading" ? "正在準備標的與價格資料。" : mode === "error" ? "請確認本機服務連線後重新載入。" : "調整市場或搜尋條件，或查看資料來源狀態。"}</p></div>}
      <section className="lower-grid">
        <article className="surface-card event-teaser">
          <div className="card-head"><div><div className="eyebrow">事件觀察</div><h2>近期事件觀察</h2></div><button className="text-button" type="button" onClick={() => onNavigate("events")}>查看事件 <span aria-hidden="true">↗</span></button></div>
          {events.length ? <div className="teaser-list">{events.slice(0, 3).map((event) => <EventTeaser key={event.id} event={event}/>)}</div> : <div className="inline-empty" role={mode === "loading" ? "status" : undefined} aria-live="polite">{mode === "loading" ? "正在載入事件資料…" : mode === "error" ? "目前無法取得事件資料。" : "目前沒有可顯示的事件。"}</div>}
        </article>
        <article className="surface-card signal-card">
          <div className="card-head"><div><div className="eyebrow">資料品質</div><h2>資料邊界</h2></div><span className="quality-icon" aria-hidden="true">⌁</span></div>
          <div className="quality-row"><span className="quality-mark"/><div><strong>社群觀測</strong><p>{socialText}</p></div></div>
          <div className="quality-row"><span className="quality-mark quality-mark-muted"/><div><strong>基金淨值</strong><p>淨值研究未涵蓋申贖費、配息再投入與完整公司行動。</p></div></div>
          <button className="text-button quality-link" type="button" onClick={() => onNavigate("sources")}>檢視來源狀態 <span aria-hidden="true">↗</span></button>
        </article>
      </section>
      <PageFooter/>
    </section>
  );
}

function InsightStrip({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`insight-strip ${className}`}><span className="insight-icon" aria-hidden="true">✳</span><p>{children}</p></div>;
}

function EventCard({ event, mode }: { event: ResearchEvent; mode: DataMode }) {
  const sourceUrl = safeHttpUrl(event.sourceUrl);
  const isGdelt = event.sourceKind === "news_index" || String(event.sourceName ?? "").toLocaleLowerCase().includes("gdelt");
  const observedLabel = isGdelt ? "GDELT 索引發現時間" : event.sourceKind === "primary" ? "本機取得時間" : "來源觀察時間";
  const affected = Array.isArray(event.affectedSymbols) ? event.affectedSymbols.filter((item) => typeof item === "string") : [];
  return (
    <article className="event-card">
      <div className="event-accent"/>
      <div className="event-main">
        <div className="event-meta-row">
          <span className="event-category">{categoryNames[event.category] ?? "其他"}</span>
          {event.demo === true ? <span className="event-demo">示範事件</span> : mode === "live" && event.sourceKind === "primary" ? <span className="event-primary">官方原始來源</span> : null}
          {mode === "live" && event.sourceKind === "news_index" && <span className="event-original">新聞索引</span>}
          {mode === "live" && event.demo !== true && <span className="event-original">來源原文</span>}
          <span className="event-time">發布 {dateTimeLabel(event.publishedAt)}</span>
        </div>
        <h3>{sourceUrl ? <a className="event-title-link" href={sourceUrl} target="_blank" rel="noopener noreferrer">{event.title || "事件標題未提供"}</a> : event.title || "事件標題未提供"}</h3>
        <div className="event-footer"><span className="event-source">{event.sourceName || "來源未提供"}</span><span className="event-symbols">{affected.length ? `關聯標的 ${affected.join("、")}` : "關聯標的未提供"}</span></div>
        <div className="event-time-detail"><span>原文發布 {dateTimeLabel(event.publishedAt)}</span><span>{observedLabel} {dateTimeLabel(event.observedAt)}</span></div>
      </div>
      <aside className="event-score" aria-label="啟發式證據分數，非獲利機率"><span className="score-label">啟發式證據分數</span><strong className="score-value">{numberOrMissing(event.evidenceScore, 1)}</strong><span className="score-caption">僅供線索整理，非獲利機率</span></aside>
    </article>
  );
}

function EventsPage({ events, mode, active }: { events: ResearchEvent[]; mode: DataMode; active: boolean }) {
  const [category, setCategory] = useState("ALL");
  const filtered = events.filter((event) => category === "ALL" || event.category === category);
  return (
    <section className={`view${active ? " is-visible" : ""}`} id="view-events" aria-labelledby="page-title-events" hidden={!active}>
      <PageHeading titleId="page-title-events" kicker="觀察與脈絡" title="事件雷達" subtitle="追蹤來源、時間與標的關聯；評分是整理線索的啟發式指標。" sideLabel="事件數" sideValue={events.length ? `${events.length} 則` : "未提供"} compact/>
      <InsightStrip><strong>注意力不等於預測力。</strong>啟發式證據分數不是獲利機率；新聞報導也不代表原始發言或社群討論量。</InsightStrip>
      <div className="section-header event-controls-header"><div><h2>觀察清單</h2><p>每則事件保留可取得的時間與來源資訊。</p></div></div>
      <FilterChips items={CATEGORY_FILTERS} selected={category} onChange={setCategory} label="事件類別篩選" id="event-filters"/>
      {filtered.length ? <div className="event-list" aria-live="polite">{filtered.map((event) => <EventCard key={event.id} event={event} mode={mode}/>)}</div> : <div className="empty-state" role={mode === "loading" ? "status" : undefined} aria-live="polite"><span className="empty-mark" aria-hidden="true">{mode === "loading" ? "◌" : "⌁"}</span><h3>{mode === "loading" ? "正在載入事件資料" : mode === "error" ? "目前無法取得事件資料" : "目前沒有符合條件的事件"}</h3><p>{mode === "loading" ? "正在整理可用來源。" : mode === "error" ? "請確認本機服務連線後重新載入。" : "請稍後重新整理，或在資料來源查看可用性。"}</p></div>}
    </section>
  );
}

function SafeExternalLink({ href, children, className = "source-link" }: { href?: string | null | undefined; children: ReactNode; className?: string }) {
  const safeUrl = safeHttpUrl(href);
  return safeUrl
    ? <a className={className} href={safeUrl} target="_blank" rel="noopener noreferrer">{children}</a>
    : <span className="source-no-link">來源連結未提供</span>;
}

function SourceCard({ source, live }: { source: Source; live: boolean }) {
  const status = sourceStatus(source);
  const errorMessage = typeof source.error === "string" && source.error.trim() ? source.error.trim() : GENERIC_SOURCE_ERROR;
  return (
    <article className="source-card">
      <div className="source-card-top"><div className="source-name">{source.name || "來源名稱未提供"}</div><span className="source-status" data-status={status.kind}>{status.label}</span></div>
      <p className="source-description">{source.description || "來源說明未提供。"}</p>
      <div className="source-card-foot">
        {sourceKindNames[source.sourceKind ?? ""] && <span className="source-kind">來源類型 {sourceKindNames[source.sourceKind ?? ""]}</span>}
        <span>資料截至 {dateTimeLabel(source.asOf)}</span>
        {live && <span>來源取得 {dateTimeLabel(source.retrievedAt)}</span>}
        <SafeExternalLink href={source.url}>開啟來源 ↗</SafeExternalLink>
      </div>
      {status.kind === "error" && <div className="source-error">{errorMessage}</div>}
    </article>
  );
}

function OfficialReferenceCard({ title, description, href, referenceOnly = false }: {
  title: string;
  description: string;
  href: string;
  referenceOnly?: boolean;
}) {
  return (
    <article className="source-card">
      <div className="source-card-top"><div className="source-name">{title}</div><span className={referenceOnly ? "source-status" : "not-connected-badge"} data-status={referenceOnly ? "planned" : undefined}>{referenceOnly ? "官方原始資料／尚未自動接通" : "官方來源入口"}</span></div>
      <p className="source-description">{description}</p>
      <div className="source-card-foot"><span>官方公開頁面</span><SafeExternalLink href={href}>開啟原始資料 ↗</SafeExternalLink></div>
    </article>
  );
}

function SourcesPage({ sources, warnings, mode, asOf, retrievedAt, active }: {
  sources: Source[];
  warnings: string[];
  mode: DataMode;
  asOf: string | null;
  retrievedAt: string | null;
  active: boolean;
}) {
  const connected = sources.filter((source) => sourceStatus(source).kind === "connected").length;
  return (
    <section className={`view${active ? " is-visible" : ""}`} id="view-sources" aria-labelledby="page-title-sources" hidden={!active}>
      <PageHeading titleId="page-title-sources" kicker="可追溯性" title="資料來源" subtitle="連線狀態、涵蓋範圍與資料限制一覽。" sideLabel={mode === "live" ? "本次回應" : "示範資料日期"} sideValue={dateTimeLabel(mode === "live" ? retrievedAt : mode === "demo" ? asOf : null)} compact/>
      <InsightStrip className="source-note">來源更新由你主動觸發。來源失敗與缺少涵蓋會保留呈現，不以示範資料替補。</InsightStrip>
      <div className="source-summary surface-card">
        <div className="summary-icon"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 6.5h16M4 12h16M4 17.5h10"/><circle cx="18" cy="17.5" r="2"/></svg></div>
        <div><span className="eyebrow">來源涵蓋</span><h2>固定研究來源</h2><p>台股官方行情、新聞索引與官方談話；美股、基金及社群資料仍有涵蓋缺口。</p></div>
        <span className="summary-count">{sources.length ? `${connected} / ${sources.length} 已連線` : "未提供"}</span>
      </div>
      {sources.length ? <div className="source-list" aria-live="polite">{sources.map((source) => <SourceCard key={source.id} source={source} live={mode === "live"}/>)}</div> : <div className="empty-state" role={mode === "loading" ? "status" : undefined} aria-live="polite"><span className="empty-mark" aria-hidden="true">{mode === "loading" ? "◌" : "⌁"}</span><h3>{mode === "loading" ? "正在讀取來源狀態" : mode === "error" ? "無法取得來源狀態" : "尚未收到來源狀態"}</h3><p>{mode === "error" ? "請檢查本機服務連線後重試。" : "來源連線狀態會在取得回應後顯示。"}</p></div>}
      {warnings.length > 0 && <section className="source-warnings surface-card" aria-label="資料來源提示"><div className="eyebrow">資料來源提示</div><ul className="warning-list">{warnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}</ul></section>}
      <section className="official-reference-section" aria-labelledby="official-reference-title">
        <div className="section-header official-reference-heading">
          <div><div className="eyebrow">官方資料入口</div><h2 id="official-reference-title">官方原始資料核對入口</h2><p>供研究者自行核對；本機服務的取得狀態以上方來源清單為準。</p></div>
          <span className="not-connected-badge">連線狀態見上方</span>
        </div>
        <div className="official-reference-list">
          <OfficialReferenceCard title="The White House — Remarks" description="白宮公開談話與聲明索引；本機服務是否取得內容，請見上方來源狀態。" href="https://www.whitehouse.gov/remarks/"/>
          <OfficialReferenceCard title="Federal Reserve — Feeds" description="聯準會公開演說與貨幣政策資料入口；本機服務是否取得內容，請見上方來源狀態。" href="https://www.federalreserve.gov/feeds/feeds.htm"/>
          <OfficialReferenceCard title="SEC — EDGAR APIs" description="美國公開公司申報資料介面說明；本機系統目前沒有自動申報資料連線。" href="https://www.sec.gov/search-filings/edgar-application-programming-interfaces" referenceOnly/>
        </div>
      </section>
      <section className="limitations-grid">
        <article className="surface-card limitation-card"><span className="limit-number">01</span><div><h3>美股與基金</h3><p>固定來源尚未涵蓋時，畫面會標示涵蓋缺口。基金以淨值研究，未完整反映申贖、配息與公司行動。</p></div></article>
        <article className="surface-card limitation-card"><span className="limit-number">02</span><div><h3>新聞與社群</h3><p>GDELT 時間代表索引發現時間，不等同原文發布時間。新聞報導不代表原始發言或社群討論量。</p></div></article>
      </section>
      <PageFooter/>
    </section>
  );
}

interface StrategyFormProps {
  instruments: Instrument[];
  mode: DataMode;
  selectedSymbol: string;
  strategy: StrategyId;
  lookback: string;
  feeBps: string;
  slippageBps: string;
  initialCapital: string;
  importedPrices: PricePoint[] | null;
  importedName: string;
  importStatus: { text: string; kind: "neutral" | "success" | "error" };
  importCount: string;
  fileName: string;
  running: boolean;
  error: string;
  formRef: RefObject<HTMLFormElement | null>;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onSymbolChange: (value: string) => void;
  onStrategyChange: (value: StrategyId) => void;
  onLookbackChange: (value: string) => void;
  onFeeChange: (value: string) => void;
  onSlippageChange: (value: string) => void;
  onCapitalChange: (value: string) => void;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onClearImport: () => void;
  onDownloadTemplate: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

function StrategyForm({
  instruments, mode, selectedSymbol, strategy, lookback, feeBps, slippageBps,
  initialCapital, importedPrices, importedName, importStatus, importCount,
  fileName, running, error, formRef, fileInputRef, onSymbolChange, onStrategyChange,
  onLookbackChange, onFeeChange, onSlippageChange, onCapitalChange,
  onFileChange, onClearImport, onDownloadTemplate, onSubmit,
}: StrategyFormProps) {
  const instrument = instruments.find((item) => item.symbol === selectedSymbol);
  const isImported = Boolean(importedPrices && selectedSymbol === "IMPORTED");
  const availableHistory = instrument?.history?.length ?? 0;
  const selectedKind = isImported ? "匯入資料" : dataKindNames[instrument?.dataKind ?? (mode === "demo" ? "synthetic" : "") ] ?? "未提供";
  const dataNote = isImported
    ? `使用匯入序列：${importedName} · ${importedPrices?.length ?? 0} 筆 · 標的身分未確認；目前僅保留在此頁面記憶體中。`
    : instrument
      ? `資料類型：${selectedKind} · ${availableHistory >= 100 ? `歷史價格 ${availableHistory} 筆` : "歷史價格不足 100 筆"}`
      : "資料類型：未提供";

  return (
    <form ref={formRef} id="backtest-form" className="surface-card strategy-form" onSubmit={onSubmit} aria-busy={running}>
      <div className="card-head form-title"><div><div className="eyebrow">回測設定</div><h2>設定研究條件</h2></div><span className="form-index">01</span></div>
      <label className="field-label" htmlFor="strategy-symbol">研究標的</label>
      <select id="strategy-symbol" name="symbol" required value={selectedSymbol} onChange={(event) => onSymbolChange(event.target.value)}>
        {!instruments.length && !importedPrices && <option value="">{mode === "error" ? "目前沒有可用標的" : "標的資料未提供"}</option>}
        {instruments.map((item) => <option key={item.symbol} value={item.symbol}>{item.symbol || "代碼未提供"} · {item.name || "名稱未提供"}</option>)}
        {importedPrices && <option value="IMPORTED">匯入價格序列（標的未確認）</option>}
      </select>
      <div id="strategy-data-note" className="field-note">{dataNote}</div>
      <label className="field-label" htmlFor="strategy-name">策略規則</label>
      <select id="strategy-name" name="strategy" value={strategy} onChange={(event) => onStrategyChange(event.target.value as StrategyId)}>
        <option value="buy_hold">買進持有</option><option value="sma">均線趨勢</option><option value="momentum">動能</option>
      </select>
      <div className="two-fields">
        <div><label className="field-label" htmlFor="lookback">回看期間</label><div className="input-suffix input-suffix-wide"><input id="lookback" name="lookback" type="number" min="5" max="252" value={lookback} onChange={(event) => onLookbackChange(event.target.value)} required/><span>資料筆數／期</span></div></div>
        <div><label className="field-label" htmlFor="initial-capital">研究本金</label><div className="input-prefix"><span>單位</span><input id="initial-capital" name="initialCapital" type="number" min="1" max="1000000000" step="1" value={initialCapital} onChange={(event) => onCapitalChange(event.target.value)} required/></div></div>
      </div>
      <div className="two-fields">
        <div><label className="field-label" htmlFor="fee">手續費</label><div className="input-suffix"><input id="fee" name="feeBps" type="number" min="0" max="500" value={feeBps} onChange={(event) => onFeeChange(event.target.value)} required/><span>基點</span></div></div>
        <div><label className="field-label" htmlFor="slippage">滑價</label><div className="input-suffix"><input id="slippage" name="slippageBps" type="number" min="0" max="500" value={slippageBps} onChange={(event) => onSlippageChange(event.target.value)} required/><span>基點</span></div></div>
      </div>
      <div className="split-explainer"><span className="split-mini" aria-hidden="true"><i/><i/></span><p><strong>歷史／保留測試切分</strong><br/>依價格序列前 70% 與後 30% 切分；反覆比較策略後，後段區間不再是未曾檢視的測試資料。</p></div>
      <div className="form-divider"/>
      <div className="upload-heading"><div><strong>匯入歷史價格</strong><span>價格檔於此裝置解析；回測資料僅傳至本機服務</span></div><span className="upload-tag">價格檔</span></div>
      <label className="file-control" htmlFor="csv-file"><Icon name="upload"/><span>{fileName}</span><span className="file-choose">瀏覽</span></label>
      <input id="csv-file" ref={fileInputRef} className="visually-hidden" type="file" accept=".csv,text/csv" onChange={onFileChange}/>
      <div id="import-status" className={`import-status${importStatus.kind === "neutral" ? "" : ` is-${importStatus.kind}`}`} aria-live="polite">{importStatus.text}</div>
      {importedPrices && <div className="import-actions"><button id="clear-import" className="subtle-button" type="button" onClick={onClearImport}>清除匯入</button><span>{importCount}</span></div>}
      <div className="template-row"><button id="download-template" type="button" className="text-button" onClick={onDownloadTemplate}>下載空白價格範本 <span aria-hidden="true">↓</span></button><span>欄位：date,close</span></div>
      <button id="run-backtest" className={`button button-primary run-button${running ? " loading-button" : ""}`} type="submit" disabled={running}><span>{running ? "正在計算…" : "執行回測"}</span><span aria-hidden="true">↗</span></button>
      {error && <div id="backtest-error" className="form-error" role="alert">{error}</div>}
    </form>
  );
}

function EquityChart({ curve }: { curve?: BacktestResult["curve"] }) {
  const rows = (curve ?? []).filter((row) => typeof row.date === "string" && isFiniteNumber(row.equity) && isFiniteNumber(row.benchmark));
  if (rows.length < 2) return <div className="chart-empty">回測回傳的曲線資料不足，無法繪製圖表。</div>;
  const width = 760;
  const height = 270;
  const pad = { top: 16, right: 12, bottom: 32, left: 58 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const sampled = rows.length <= 240 ? rows : Array.from({ length: 240 }, (_, index) => rows[Math.round((index / 239) * (rows.length - 1))]).filter((row): row is NonNullable<typeof row> => Boolean(row));
  const values = sampled.flatMap((row) => [row.equity, row.benchmark]);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    const delta = Math.max(Math.abs(max) * 0.03, 1);
    min -= delta;
    max += delta;
  }
  const yFor = (value: number) => pad.top + ((max - value) / (max - min)) * plotHeight;
  const xFor = (index: number) => pad.left + (index / (sampled.length - 1)) * plotWidth;
  const strategyPath = sampled.map((row, index) => `${index ? "L" : "M"}${xFor(index).toFixed(2)} ${yFor(row.equity).toFixed(2)}`).join(" ");
  const benchmarkPath = sampled.map((row, index) => `${index ? "L" : "M"}${xFor(index).toFixed(2)} ${yFor(row.benchmark).toFixed(2)}`).join(" ");
  const dateIndexes = [...new Set([0, Math.floor((sampled.length - 1) / 2), sampled.length - 1])];
  return (
    <svg id="equity-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="策略與基準的資產曲線圖">
      {[0, 1, 2, 3].map((index) => {
        const value = max - ((max - min) * index) / 3;
        const y = pad.top + (plotHeight * index) / 3;
        return <g key={`grid-${index}`}><line x1={pad.left} y1={y} x2={width - pad.right} y2={y} className="chart-grid-line"/><text x={pad.left - 7} y={y + 3} textAnchor="end" className="chart-axis-label">{numberFormat.format(value)}</text></g>;
      })}
      {dateIndexes.map((index) => {
        const row = sampled[index];
        if (!row) return null;
        return <text key={`date-${index}`} x={xFor(index)} y={height - 8} textAnchor={index === 0 ? "start" : index === sampled.length - 1 ? "end" : "middle"} className="chart-axis-label">{row.date}</text>;
      })}
      <path d={benchmarkPath} className="chart-benchmark-line"/><path d={strategyPath} className="chart-strategy-line"/>
    </svg>
  );
}

function MetricCard({ label, value, compare }: { label: string; value: string; compare: string }) {
  return <div className="metric-card"><div className="metric-label">{label}</div><div className={`metric-value${value.startsWith("-") ? " negative" : ""}`}>{value}</div><div className="metric-compare">{compare}</div></div>;
}

function BacktestResults({ result, snapshot }: { result: BacktestResult | null; snapshot: BacktestSnapshot | null }) {
  if (!result || !snapshot) {
    return (
      <div className="results-placeholder"><div className="placeholder-chart" aria-hidden="true"><span/><span/><span/><span/><span/><i/></div><div><span className="eyebrow">準備開始研究</span><h3>先選一組研究條件</h3><p>設定標的與成本，或匯入自己的歷史價格，開始比較策略與基準。</p></div></div>
    );
  }
  const resultKind = result.dataKind ?? snapshot.dataKind;
  const displaySymbol = resultKind === "imported" ? "匯入價格序列（標的未確認）" : result.symbol || "標的未提供";
  const metrics = result.metrics ?? {};
  const benchmark = result.benchmark ?? {};
  const split = result.split ?? {};
  const metricRows: Array<[string, string, string]> = [
    ["總報酬", percentOrMissing(metrics.totalReturnPct), `基準 ${percentOrMissing(benchmark.totalReturnPct)}`],
    ["年化報酬", percentOrMissing(metrics.annualizedReturnPct), "保留測試區間結果需搭配期間檢視"],
    ["最大回撤", percentOrMissing(metrics.maxDrawdownPct), `基準 ${percentOrMissing(benchmark.maxDrawdownPct)}`],
    ["波動度", percentOrMissing(metrics.volatilityPct), "依回測序列計算"],
    ["夏普值", numberOrMissing(metrics.sharpe, 2), "未提供風險調整資訊時不推定"],
    ["累計換手倍數", multipleOrMissing(metrics.turnover), "曝險調整幅度累計；每次變動各計 1×"],
    ["曝險變動次數", numberOrMissing(metrics.trades, 0), "每次 0↔1 持倉變化各計一次"],
  ];
  const splitRows: Array<[string, string]> = [
    ["歷史區間結束", dateLabel(split.trainEnd)],
    ["保留測試開始", dateLabel(split.testStart)],
    ["保留測試結束", dateLabel(split.testEnd)],
    ["歷史／保留測試筆數", `${numberOrMissing(split.trainBars, 0)} / ${numberOrMissing(split.testBars, 0)}`],
  ];
  const warnings = [
    ...(Array.isArray(result.assumptions) ? result.assumptions : []),
    ...(Array.isArray(result.warnings) ? result.warnings : []),
  ].map((item) => typeof item === "string" ? item : item && typeof item.message === "string" ? item.message : "").filter(Boolean);
  return (
    <div id="results-content">
      <article className="surface-card chart-card">
        <div className="card-head chart-card-head"><div><span className="eyebrow">資產曲線</span><h3>{displaySymbol} · {strategyTitleNames[result.strategy] ?? "策略回測"}</h3><p>區間：{dateLabel(split.trainEnd)} 至 {dateLabel(split.testEnd)}</p></div><div className="chart-legend"><span><i className="legend-strategy"/>策略</span><span><i className="legend-benchmark"/>基準</span></div></div>
        <div className="chart-wrap"><EquityChart curve={result.curve}/></div>
      </article>
      <div className="metric-grid">{metricRows.map(([label, value, compare]) => <MetricCard key={label} label={label} value={value} compare={compare}/>)}</div>
      <article className="surface-card split-card"><div className="card-head"><div><span className="eyebrow">保留測試檢視</span><h3>歷史與保留測試區間</h3></div><span className="split-badge">70 / 30</span></div><div className="split-details">{splitRows.map(([label, value]) => <div className="split-item" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div></article>
      <article className="surface-card warning-card"><div className="card-head"><div><span className="eyebrow">回測假設</span><h3>假設與提醒</h3></div></div><ul className="warning-list">{warnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}</ul></article>
    </div>
  );
}

interface StrategiesPageProps extends Omit<StrategyFormProps, "fileInputRef"> {
  fileInputRef: RefObject<HTMLInputElement | null>;
  result: BacktestResult | null;
  snapshot: BacktestSnapshot | null;
  onDownloadReport: () => void;
}

function StrategiesPage({ result, snapshot, onDownloadReport, active, ...formProps }: StrategiesPageProps & { active: boolean }) {
  const resultKind = result?.dataKind ?? snapshot?.dataKind;
  return (
    <section className={`view${active ? " is-visible" : ""}`} id="view-strategies" aria-labelledby="page-title-strategies" hidden={!active}>
      <PageHeading titleId="page-title-strategies" kicker="假設檢驗" title="策略實驗室" subtitle="用同一段價格資料比較規則與基準，檢視保留測試區間。" sideLabel="研究方式" sideValue="歷史回測" compact/>
      <InsightStrip className="strategy-note"><strong>回測結果依賴資料、規則與成本假設。</strong>反覆調整策略可能造成選擇偏誤；保留測試區間不等於未受研究者檢視。歷史表現不代表未來結果，也不構成個人化投資建議。</InsightStrip>
      <div className="strategy-layout">
        <StrategyForm {...formProps}/>
        <div className="results-column">
          <div className="results-heading"><div><div className="eyebrow">回測結果</div><h2>研究結果</h2></div><div className="result-actions">{resultKind && <span id="result-kind" className="data-pill">{dataKindNames[resultKind] ?? "未提供"}</span>}<button id="download-report" type="button" className="icon-button" disabled={!result || !snapshot} aria-label="下載研究報告" title="下載研究報告" onClick={onDownloadReport}><Icon name="download"/></button></div></div>
          <BacktestResults result={result} snapshot={snapshot}/>
        </div>
      </div>
    </section>
  );
}

function initialView(): ViewId {
  const value = window.location.hash.slice(1);
  return Object.hasOwn(viewNames, value) ? value as ViewId : "overview";
}

function downloadBlob(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function App() {
  const [mode, setMode] = useState<DataMode>("loading");
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [events, setEvents] = useState<ResearchEvent[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [dashboardAsOf, setDashboardAsOf] = useState<string | null>(null);
  const [retrievedAt, setRetrievedAt] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<ViewId>(initialView);
  const [globalMessage, setGlobalMessage] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState<ToastInfo>(null);
  const [selectedSymbol, setSelectedSymbol] = useState("");
  const [previousSymbol, setPreviousSymbol] = useState("");
  const [strategy, setStrategy] = useState<StrategyId>("buy_hold");
  const [lookback, setLookback] = useState("20");
  const [feeBps, setFeeBps] = useState("10");
  const [slippageBps, setSlippageBps] = useState("5");
  const [initialCapital, setInitialCapital] = useState("100000");
  const [importedPrices, setImportedPrices] = useState<PricePoint[] | null>(null);
  const [importedName, setImportedName] = useState("");
  const [fileName, setFileName] = useState("選取價格檔");
  const [importCount, setImportCount] = useState("");
  const [importStatus, setImportStatus] = useState<{ text: string; kind: "neutral" | "success" | "error" }>({ text: DEFAULT_IMPORT_STATUS, kind: "neutral" });
  const [running, setRunning] = useState(false);
  const [backtestError, setBacktestError] = useState("");
  const [lastBacktest, setLastBacktest] = useState<BacktestResult | null>(null);
  const [lastBacktestSnapshot, setLastBacktestSnapshot] = useState<BacktestSnapshot | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const toastTimer = useRef<number | null>(null);

  const showToast = (message: string, isError = false) => {
    setToast({ message, isError });
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3200);
  };

  const applyPayload = (payload: DashboardPayload) => {
    if (payload.mode !== "demo" && payload.mode !== "live") throw new Error("INVALID_RESPONSE");
    setMode(payload.mode);
    setInstruments(Array.isArray(payload.instruments) ? payload.instruments : []);
    setEvents(Array.isArray(payload.events) ? payload.events : []);
    setSources(Array.isArray(payload.sources) ? payload.sources : []);
    setWarnings(Array.isArray(payload.warnings) ? payload.warnings.filter((item): item is string => typeof item === "string") : []);
    setDashboardAsOf(typeof payload.asOf === "string" ? payload.asOf : null);
    setRetrievedAt(typeof payload.retrievedAt === "string" ? payload.retrievedAt : null);
    setGlobalMessage(payload.mode === "live" && payload.warnings?.length
      ? `固定來源回傳 ${payload.warnings.length} 則提醒；請查看資料來源狀態。`
      : "");
  };

  useEffect(() => {
    let active = true;
    void getDashboard().then((payload) => {
      if (active) applyPayload(payload);
    }).catch(() => {
      if (!active) return;
      setMode("error");
      setInstruments([]);
      setEvents([]);
      setSources([]);
      setWarnings([]);
      setGlobalMessage("無法載入研究資料。請確認本機服務已啟動，再重新載入頁面。");
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const onPopState = () => setActiveView(initialView());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => () => {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
  }, []);

  useEffect(() => {
    if (importedPrices) {
      if (!selectedSymbol) setSelectedSymbol("IMPORTED");
      return;
    }
    if (selectedSymbol && instruments.some((instrument) => instrument.symbol === selectedSymbol)) return;
    setSelectedSymbol(instruments[0]?.symbol ?? "");
  }, [instruments, importedPrices, selectedSymbol]);

  const navigate = (view: ViewId) => {
    if (window.location.hash !== `#${view}`) window.history.pushState(null, "", `#${view}`);
    setActiveView(view);
    mainRef.current?.focus({ preventScroll: true });
  };

  const refreshLive = async () => {
    if (refreshing) return;
    setRefreshing(true);
    setGlobalMessage("正在讀取固定資料來源…");
    try {
      const payload = await getLiveSnapshot();
      if (payload.mode !== "live") throw new Error("INVALID_RESPONSE");
      applyPayload(payload);
      const hasFailures = (payload.sources ?? []).some((source) => sourceStatus(source).kind === "error");
      showToast(hasFailures ? "更新已完成；部分來源未能提供資料，請查看來源狀態。" : "固定來源更新完成。");
    } catch {
      setGlobalMessage("固定來源更新未完成。畫面仍顯示最近一次成功取得的資料；請查看來源狀態後重試。");
      showToast("目前無法完成來源更新。", true);
    } finally {
      setRefreshing(false);
    }
  };

  const onImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    const selectedBefore = selectedSymbol;
    const restoreSymbol = selectedBefore === "IMPORTED" ? previousSymbol : selectedBefore;
    if (selectedBefore !== "IMPORTED") setPreviousSymbol(selectedBefore);
    setImportedPrices(null);
    setImportedName("");
    setSelectedSymbol(restoreSymbol);
    setFileName(file.name || "已選取價格檔");
    setImportCount("");
    setImportStatus({ text: "正在檢查價格列…", kind: "neutral" });
    try {
      const rows = parsePriceCsv(await file.text());
      setImportedPrices(rows);
      setImportedName(file.name || "");
      setSelectedSymbol("IMPORTED");
      setImportCount(`${rows.length} 筆 · ${rows[0]?.date ?? "未提供"} 至 ${rows.at(-1)?.date ?? "未提供"}`);
      setImportStatus({
        text: "已在此裝置解析並檢查日期與價格；標的身分未確認。執行回測時價格列會傳送至本機服務，不會送往外部來源或寫入持久儲存。",
        kind: "success",
      });
      showToast("本機價格匯入完成。");
    } catch (problem) {
      setImportedPrices(null);
      setImportedName("");
      setPreviousSymbol("");
      setSelectedSymbol(restoreSymbol);
      setImportStatus({ text: problem instanceof Error ? problem.message : "匯入檔格式無法辨識。", kind: "error" });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const clearImport = () => {
    setImportedPrices(null);
    setImportedName("");
    setSelectedSymbol(previousSymbol || instruments[0]?.symbol || "");
    setPreviousSymbol("");
    setFileName("選取價格檔");
    setImportCount("");
    setImportStatus({ text: DEFAULT_IMPORT_STATUS, kind: "neutral" });
    if (fileInputRef.current) fileInputRef.current.value = "";
    showToast("已清除本機匯入資料。");
  };

  const downloadTemplate = () => {
    downloadBlob("市場羅盤_價格範本.csv", "date,close\r\n", "text/csv;charset=utf-8");
    showToast("價格範本已下載。");
  };

  const submitBacktest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBacktestError("");
    if (!formRef.current?.reportValidity()) return;
    const useImported = Boolean(importedPrices && selectedSymbol === "IMPORTED");
    const instrument = useImported ? null : instruments.find((item) => item.symbol === selectedSymbol) ?? null;
    if (!selectedSymbol || (selectedSymbol !== "IMPORTED" && !instrument)) {
      setBacktestError("請先選擇有價格資料的標的。");
      return;
    }
    if (mode === "live" && !useImported) {
      const validHistory = (instrument?.history ?? []).filter((point) => typeof point.date === "string" && isFiniteNumber(point.close) && point.close > 0);
      if (validHistory.length < 100) {
        setBacktestError("固定來源沒有足夠的歷史價格可供回測。請匯入至少 100 筆本機歷史價格。");
        return;
      }
    }

    const body: BacktestRequest = {
      symbol: useImported ? "IMPORTED" : selectedSymbol,
      strategy,
      lookback: Number(lookback),
      feeBps: Number(feeBps),
      slippageBps: Number(slippageBps),
      initialCapital: Number(initialCapital),
      splitRatio: 0.7,
    };
    const inputPrices = useImported ? importedPrices ?? [] : instrument?.history ?? [];
    if (useImported) body.prices = (importedPrices ?? []).map((row) => ({ date: row.date, close: row.close }));
    else if (mode === "live") body.prices = inputPrices.map((row) => ({ date: row.date, close: row.close }));

    const snapshotRequest: BacktestRequest = {
      ...body,
      ...(body.prices ? { prices: body.prices.map((row) => ({ date: row.date, close: row.close })) } : {}),
    };
    const inputDates = inputPrices.map((row) => row.date).filter((date): date is string => typeof date === "string");
    const snapshot: BacktestSnapshot = {
      request: snapshotRequest,
      dataKind: useImported ? "imported" : instrument?.dataKind ?? (mode === "demo" ? "synthetic" : "live_snapshot"),
      priceProvenance: useImported ? "imported" : mode === "demo" ? "synthetic" : "live",
      importedFileName: useImported ? importedName : null,
      symbolIdentity: useImported ? "unverified" : "listed_instrument",
      inputPriceCount: inputPrices.length,
      priceDateRange: { start: inputDates[0] ?? null, end: inputDates.at(-1) ?? null },
    };
    setRunning(true);
    try {
      const result = await postBacktest(body);
      setLastBacktest(result);
      setLastBacktestSnapshot(snapshot);
      showToast("回測完成。");
    } catch (problem) {
      const message = problem instanceof Error && problem.message !== "API_FAILED" && problem.message !== "Failed to fetch"
        ? problem.message
        : "回測無法完成。請檢查資料來源與研究條件後重試。";
      setBacktestError(message);
      showToast("回測未完成，請檢查條件後重試。", true);
    } finally {
      setRunning(false);
    }
  };

  const downloadReport = () => {
    if (!lastBacktest || !lastBacktestSnapshot) return;
    const snapshot = lastBacktestSnapshot;
    const request = snapshot.request;
    const report = {
      title: "Market Compass 回測研究報告",
      exportedAt: new Date().toISOString(),
      configuration: {
        symbol: request.symbol,
        symbolLabel: snapshot.symbolIdentity === "unverified" ? "匯入價格序列（標的未確認）" : request.symbol,
        symbolIdentity: snapshot.symbolIdentity === "unverified" ? "未確認" : "依所選標的清單",
        strategy: request.strategy,
        lookback: request.lookback,
        feeBps: request.feeBps,
        slippageBps: request.slippageBps,
        initialCapital: request.initialCapital,
        splitRatio: request.splitRatio,
        priceProvenance: snapshot.priceProvenance,
        dataKind: snapshot.dataKind,
        importedFileName: snapshot.importedFileName,
        inputPriceCount: snapshot.inputPriceCount,
        priceDateRange: snapshot.priceDateRange,
      },
      result: lastBacktest,
    };
    downloadBlob("市場羅盤_回測研究報告.json", JSON.stringify(report, null, 2), "application/json;charset=utf-8");
    showToast("研究報告已下載。");
  };

  const overviewAsOf = mode === "live"
    ? instruments.find((instrument) => typeof instrument.asOf === "string" && instrument.asOf)?.asOf ?? null
    : mode === "demo" ? dashboardAsOf : null;

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">跳至主要內容</a>
      <Sidebar activeView={activeView} onNavigate={navigate} mode={mode}/>
      <div className="workspace">
        <Topbar mode={mode} refreshing={refreshing} onRefresh={() => void refreshLive()} activeView={activeView}/>
        <main id="main" ref={mainRef} tabIndex={-1}>
          <GlobalMessage message={globalMessage}/>
          <ModeNotice mode={mode}/>
          <OverviewPage instruments={instruments} events={events} sources={sources} mode={mode} asOf={overviewAsOf} onNavigate={navigate} active={activeView === "overview"}/>
          <EventsPage events={events} mode={mode} active={activeView === "events"}/>
          <StrategiesPage
            instruments={instruments}
            mode={mode}
            selectedSymbol={selectedSymbol}
            strategy={strategy}
            lookback={lookback}
            feeBps={feeBps}
            slippageBps={slippageBps}
            initialCapital={initialCapital}
            importedPrices={importedPrices}
            importedName={importedName}
            importStatus={importStatus}
            importCount={importCount}
            fileName={fileName}
            running={running}
            error={backtestError}
            formRef={formRef}
            fileInputRef={fileInputRef}
            result={lastBacktest}
            snapshot={lastBacktestSnapshot}
            active={activeView === "strategies"}
            onSymbolChange={setSelectedSymbol}
            onStrategyChange={setStrategy}
            onLookbackChange={setLookback}
            onFeeChange={setFeeBps}
            onSlippageChange={setSlippageBps}
            onCapitalChange={setInitialCapital}
            onFileChange={(event) => void onImportFile(event)}
            onClearImport={clearImport}
            onDownloadTemplate={downloadTemplate}
            onSubmit={(event) => void submitBacktest(event)}
            onDownloadReport={downloadReport}
          />
          <SourcesPage sources={sources} warnings={warnings} mode={mode} asOf={dashboardAsOf} retrievedAt={retrievedAt} active={activeView === "sources"}/>
        </main>
      </div>
      <NavigationItems activeView={activeView} onNavigate={navigate} mobile/>
      {toast && <div id="toast" className={`toast is-visible${toast.isError ? " is-error" : ""}`} role="status" aria-live="polite">{toast.message}</div>}
    </div>
  );
}

export default App;
