# Architecture

Market Compass is a local research application for US equities, ETFs, Taiwan equities and mutual funds. It contains no account, transfer, order or broker integration. Node.js 24 serves the API and static UI from the IPv4 loopback address. The browser and server use no third-party runtime packages, cloud inference or paid API credentials.

## Boundaries

The fixture layer provides deterministic, explicitly synthetic histories and illustrative scenarios. The research layer validates price series and calculates price-only strategies independently of HTTP and data providers. Fixed-source adapters normalize official Taiwan market snapshots and news-discovery records. The HTTP layer applies request limits, same-origin checks and static-file confinement. The UI renders a separate demonstration workspace and live-source workspace; an unavailable live feed never becomes synthetic data implicitly.

External requests are made only when the user activates live refresh. Requests are restricted to the fixed TWSE daily-snapshot endpoint, GDELT news query, Federal Reserve speeches RSS, and White House remarks index. Reads are bounded by time and response size, cached/throttled, and assessed independently. There is no arbitrary URL fetch endpoint. Official index adapters extract headline links only; they do not retrieve articles, video, transcripts or external entities. User CSV data stays in browser memory and temporary request bodies; it is not persisted or committed.

## Research semantics

The front portion of the chronological series supplies strategy history; a later holdout supplies the reported curve, metrics and benchmark. A signal derived from a completed close cannot execute at that same close. With close-only input, use a full additional close-bar delay and state the convention. Transaction costs apply whenever exposure changes, including initial entry. Benchmark and strategy share observation dates and cost assumptions.

Annualized daily figures assume 252 observations/year and zero risk-free rate unless otherwise stated. Irregular fund NAV samples make these figures unreliable; raw price inputs may omit distributions, splits, tax, currency effects and redemption restrictions. A chronological holdout is a research check, not an untouched test after repeated user tuning or proof of future performance.

No money or personal risk profile is available. Strategy outputs are illustrative comparisons, not allocation advice or an assessment of suitability. Price-only long/cash strategy simulations do not claim to model leverage, shorts, derivatives, fills or fund dealing.

## Provenance

Market session date, provider as-of, original publication time, provider discovery time and app retrieval time represent distinct facts. Missing timestamps stay missing. GDELT discovery is not original publication, independent verification or social engagement. A headline mentioning Trump is a reported event to examine, not an authenticated first-person statement or causal trading signal. Source text is untrusted display data; it is never executable instructions.

Official-feed records have their own explicitly marked provenance. RSS publication dates are used only when supplied; White House link records have no invented publication time. First local observation is bounded in-memory state and resets with the local process, so it cannot support historical event backtests. Source retrieval timestamps are set when reads complete and retained across cached responses.

Synthetic events cannot be presented as real statements from public figures. Heuristic evidence/relevance scores are transparent research aids, not calibrated likelihoods of price direction or profit. Social feeds remain unavailable until access rights and authentic measurements are obtained.

## Validation

Tests must cover delayed timing, chronological split, turnover and initial-entry costs, benchmark comparability, invalid dates/numbers, malformed or oversized bodies, external-provider failures, static traversal, foreign Host/Origin requests and absence of execution routes. Independent review examines numerical and security boundaries. Browser inspection covers readable Traditional Chinese, interactive controls, import errors, data-mode labels, responsive layout and truthful missing-data states.
