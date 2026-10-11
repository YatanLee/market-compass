# Market Compass — 產品規格

## 核准範圍

本機投資研究系統，涵蓋美股、ETF、台股與基金。提供研究、事件觀測與策略比較，不處理金流、不連接券商、不協助下單。UI 使用繁體中文。本金、期間與風險承受度尚未確定；不宣稱個人化配置或保證獲利。

## 第一版行為

1. Node.js 24、無第三方執行依賴，可離線啟動，服務只綁定 127.0.0.1。
2. 自適應研究介面：市場總覽、事件雷達、策略實驗室、資料來源。
3. 美股／ETF／台股／基金示範資料均標示合成資料，不提供虛構的真實人物引言。
4. 支援歷史價格 CSV 匯入。基金以淨值研究，說明申贖、配息與資料頻率限制。
5. 真實資料透過使用者主動更新取得；固定來源為 TWSE、GDELT、聯準會官方談話 RSS 與白宮公開談話索引。失敗與缺少美股／基金／社群 API 需如實呈現。
6. 事件保留來源 URL、發布時間、首次取得時間。GDELT 發現時間不得假稱原文發布時間；新聞報導不得假稱原始發言或社群討論量。
7. 回測比較持有、均線趨勢、動能策略，採延遲一根收盤資料執行、保留測試區間、手續費、滑價、回撤與基準；主要績效、曲線與基準使用相同的保留測試區間。反覆調參後不得將該區間假稱未接觸的樣本外證據。
8. 啟發式事件評分不等於獲利機率；不宣稱已證明社群或談話可提升預測準度。
9. API 有輸入大小限制、驗證、timeout、固定外部網址、同源限制與安全靜態檔案處理。
10. 公開版本僅包含程式、合成資料與文件；使用者匯入資料不寫入 repository。

## Shared API contract

- `GET /api/health` -> `{status:"ok", executionEnabled:false}`.
- `GET /api/dashboard` -> `{mode:"demo", asOf, generatedAt, instruments:[{symbol,name,market,type,currency,price,changePct,history:[{date,close}],dataKind,asOf}], events:[{id,title,category,sourceName,sourceUrl,publishedAt,observedAt,affectedSymbols,stance,evidenceScore,reasons,demo}], strategies:[{id,name,description,risk}], sources:[{id,name,status,url,description}], warnings:[]}`.
- Market ids: `US`, `TW`, `FUND`; type values: `stock`, `etf`, `fund`. Fixtures are synthetic. Categories: `policy`, `influencer`, `social`, `macro`.
- `POST /api/backtest` accepts `{symbol,strategy,lookback,feeBps,slippageBps,initialCapital,splitRatio,prices?:[{date,close}]}`. Strategies: `buy_hold`, `sma`, `momentum`. Return `{symbol,strategy,dataKind,metrics:{totalReturnPct,annualizedReturnPct,maxDrawdownPct,volatilityPct,sharpe,turnover,trades},benchmark:{totalReturnPct,maxDrawdownPct},split:{trainEnd,testStart,testEnd,trainBars,testBars},curve:[{date,equity,benchmark,position}],warnings:[],assumptions:[]}`.
- `GET /api/live` performs user-triggered reads and returns `{mode:"live",retrievedAt,instruments:[],events:[],sources:[],warnings:[]}`. Each source carries status, asOf/retrievedAt and an error when unavailable. Demo/live data stay separate.
- CSV parsing is local to frontend: exact header `date,close`, ISO dates, sorted unique positive finite closes, max 5000 rows. Backend independently validates.
- No endpoint accepts arbitrary external URLs or financial orders.
