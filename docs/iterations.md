# Three-iteration delivery plan

## 0.2 — React and TypeScript

Replace the browser implementation with locally bundled React and strict TypeScript. Migrate server, numerical engine, provider adapters, fixtures and regression tests to TypeScript. Preserve existing source separation, CSV identity warnings, backtest timing/cost assumptions and loopback/no-execution boundary. Acceptance requires production build, typecheck, regression tests and responsive browser verification. Public release remains on port 4187; development UI uses 4188.

## 0.3 — Official data and professional analytics

Add bounded, allowlisted Taiwan exchange monthly price history for 0050 and 2330, plus ECB reference foreign exchange and Treasury par yield curves. A verified publisher is not a claim of total-return adjustment: TWSE closes remain raw, and distributions/splits must be disclosed. Treasury rates and ECB reference rates are context, not tradable quotes or automatically substituted risk-free assumptions. Each normalized dataset carries identity, source URLs, retrieval time, source session date, price basis and adjustment limitations.

Add an audited technical-indicator dependency behind a narrow domain adapter, with reference-value tests. Extend financial reports with explicit period/frequency assumptions, downside and tail risk metrics and transparent undefined-value handling. Model outputs must not become claims of suitability or profit.

## 0.4 — Fixed prospective validation

The initial cohort is Taiwan exchange instruments 0050 and 2330, using official daily closing observations. Target-session window: 2026-10-12 through 2026-12-04, Asia/Taipei. This spans eight Monday-to-Friday calendar weeks, not a guarantee of 40 trading sessions. Market closures and missing data reduce coverage. At least 30 non-tie scored observations per instrument are required before an initial descriptive directional-accuracy comparison; fewer remain inconclusive. Even 30 observations do not establish profitable superiority. An initial forecast may be recorded on October 11 for the first actual subsequent exchange session.

Freeze a deterministic 20-observation moving-average direction rule, an always-up baseline and a last-return-sign baseline. SMA equality and zero prior return resolve to up. Issue only at or after 18:00 Asia/Taipei using real source data acquired before prediction creation and settled closes no later than that local date. Save immutable forecast records before any target session, using the next actual observed exchange session strictly after the local forecast date instead of inventing a holiday calendar. Leave the target unresolved when issuing, and resolve it only when the later official session materializes. Deduplicate by symbol and anchor session date. Evaluate only settled official closes, with a conservative Asia/Taipei 18:00 cutoff on that session; missing closes remain pending. Persist exact normalized input bars and features with their content hash, dependency/model version, UTC creation time and local date, source retrieval time, anchor close, target eligibility rule and a separate result record. Later revisions never recalculate old predictions. Never backfill missed forecasts or count synthetic/CSV data as prospective evidence. Exclude zero-return ties from directional denominator and report them, missing outcomes and coverage separately. Report Wilson confidence intervals, identical-cohort baseline scores and paired correctness differences with explicitly descriptive uncertainty; returns and accuracy answer different questions.

Runs may collect official data and evaluate existing records, but no account, money or order action is allowed. Storage is fixed at D:/Project/market-compass-local/validation, outside the public repository. The API never accepts file paths or submitted predictions. Serialize writers, use exclusive append/write and durable flush, enforce stable record IDs and idempotent retries, and verify content hashes on read. A corrupt/crash-truncated record must fail closed and be reported; automatic destructive repair is excluded. Local records are auditable against accidental changes and are not tamper-proof against a machine administrator. Source outages must remain visible. Scheduled checks should stay quiet until completion, meaningful findings, repeated failure or required user action.

## Sources

- TWSE official historical interface: https://www.twse.com.tw/en/trading/historical/stock-day-avg.html
- ECB reference-rate source and information-only usage: https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html
- Treasury XML feed specification: https://home.treasury.gov/treasury-daily-interest-rate-xml-feed
- Technical indicators upstream: https://github.com/anandanand84/technicalindicators

US stock/ETF and mutual-fund issuer histories and authentic social measurements require further verified adapters and access rights. These releases must continue to show gaps rather than relabel news coverage as social attention.
