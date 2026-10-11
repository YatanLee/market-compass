# First release verification

Date: 2026-10-11. This release is a local investment research prototype, not a validated profitable strategy or an event-aware prediction model.

## Delivered behavior

- Traditional Chinese desktop and mobile interface, with source-original event titles.
- Separate synthetic demonstration and manual live-source modes.
- Buy-and-hold, moving-average and momentum comparisons on the same chronological holdout, including fees, slippage and delayed signals.
- Strict two-column price CSV import with unverified instrument identity; temporary local processing only.
- Independently reported TWSE, GDELT, Federal Reserve and White House source status.
- No money, brokerage or order routes; loopback-only server, no third-party runtime dependencies.

## Verification evidence

`npm test` passed 27/27 tests. `npm run check` passed syntax checks for 10 JavaScript files. Independent review found no remaining high or medium severity blockers after fixes to trading-cost accounting, numeric overflow, imported identity and first-observation timestamps.

The live smoke check completed at 2026-10-11T09:07:23.832Z. TWSE returned two watched instruments; Federal Reserve and White House returned 21 official event links in total. GDELT timed out at the configured 10-second limit. The API and browser showed this partial failure without inserting synthetic replacements. TWSE session dates and White House publication dates remained unknown when the source did not supply them.

Browser checks covered desktop and 390-by-844 mobile layouts, market filtering, strategy selection and backtest rendering, live refresh, official-event provenance and source status. No horizontal overflow was observed in the mobile check. Synthetic performance was visibly labelled and is not evidence of real profitability.

## Remaining limitations

- The browser automation session could not open its file chooser. CSV parser and local API import tests passed, but native file selection still needs a manual Chrome/Edge check; full end-to-end file selection is not claimed.
- US market and fund historical feeds and authentic social-attention measurements are not connected. Authorized price CSV imports supply research inputs without proving adjustment quality or ticker identity.
- Official-source parsing is bounded headline/link extraction and may need maintenance if provider formats change. External availability is not guaranteed.
- Primary-event first-observation history is process-local and capped at 5,000 records; restart resets it and capacity exhaustion leaves new observation times unknown. It does not supply historical point-in-time event data.
- Event cards do not change strategy positions. Improved accuracy requires the controlled experiments in `research-plan.md`; it has not been demonstrated by this release.
- Annualization assumes 252 observations/year and a zero risk-free rate. Fund cadence, distributions, corporate actions, tax and currency effects may invalidate comparisons.

Public source publication and hosted CI results are reported separately from these local checks.
