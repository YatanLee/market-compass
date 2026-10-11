# Research roadmap

## Goal and measurement

Improve a user's ability to examine market conditions, competing explanations and investment risk. Earnings are an aspiration, not an acceptance guarantee. Measure strategy behavior against a comparable passive benchmark after costs, with drawdown, volatility, turnover and stability across untouched periods. Do not select a strategy solely because it has the highest simulated return.

## Market coverage

US equities/ETFs require licensed adjusted historical data and corporate actions. Taiwan equities/ETFs require session calendars, distribution and split treatment; the initial TWSE feed is a snapshot only. Mutual funds require verified NAV history, distribution/reinvestment treatment, fees, dealing calendars and redemption restrictions. The initial generic CSV interface can import all these series but cannot verify their adjustment quality.

## Event and attention pipeline

1. Prioritize original company/issuer/regulatory releases, official government statements and economic data. News discovery supplies leads and corroboration, not substitutes for the primary record.
2. For Trump's public remarks, locate the original transcript/video/post where available, record its publication and first availability time, and preserve the distinction between a proposal, implemented policy and later correction. Do not create fictitious quotes.
3. Influential-speaker coverage should span monetary-policy speakers, company management and established investors. Prominence alone does not establish relevance or truth.
4. Social attention requires authenticated/licensed feeds or user-supplied authorized observations. Separate mention velocity, unique contributors, platform baseline, sentiment and spam risk. News counts must never be labeled social volume. No paid subscription or external account is created automatically.
5. Group duplicate coverage into the same event, retain source disagreement, decay stale evidence and record exact first-observed times. Any language-model extraction later added must treat source documents as untrusted data and retain cited evidence; it must not issue orders.

## Proving contribution

The first version's backtests are price-only baselines. Event cards and heuristic scores do not yet modify positions or demonstrate improved forecasting accuracy. The next research experiment must compare price-only, price-plus-news, price-plus-social and combined features on identical chronological folds. Use point-in-time records, embargo overlapping events, freeze hyperparameters before holdout evaluation, include acquisition and turnover costs, and report negative results. Event-aware results stay disabled when historical first-availability data is missing.

Leverage and derivatives remain future scenario research requiring an explicit model of financing, margin, path dependency and loss limits. The user allowed exploring them; permission alone supplies neither the data nor a personal risk budget. No live execution is part of this roadmap.
