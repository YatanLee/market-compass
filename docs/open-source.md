# Open-source evaluation

Evaluated on 2026-10-11 using primary project pages and license files. Evaluation does not mean the libraries are installed, benchmarked locally or incorporated into this repository.

| Candidate | Evidence | Relevance | First-version decision |
| --- | --- | --- | --- |
| Microsoft Qlib | [Repository](https://github.com/microsoft/qlib), [MIT license](https://github.com/microsoft/qlib/blob/main/LICENSE) | Quantitative feature/model research, datasets and experiment workflows | Candidate for later model evaluation. First validate reliable timestamped datasets and baselines; do not add a Python/data stack before its benefit is measured. |
| QuantConnect LEAN | [Repository](https://github.com/QuantConnect/Lean), [Apache-2.0 license](https://github.com/QuantConnect/Lean/blob/master/LICENSE) | Mature event-driven research and backtesting engine | Candidate as an independent validation engine. Its trading/broker capabilities are outside this product's scope; any future adapter must expose research only. |

The first version uses original, small Node.js modules so the current computer can run it with the installed runtime and no dependency installation. No Qlib or LEAN source code has been copied; the application does not claim to use their engines or match their methodology. Future reuse must record the specific revision, required notices, resource requirements, data licensing and validation results.

## Source references

- [TWSE OpenAPI](https://openapi.twse.com.tw/) — first adapter targets the daily official market snapshot. This is not a historical series or real-time quotation service.
- [GDELT DOC API](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/) — news discovery for policy/macroeconomic topics. Discovery records do not supply reliable original publication time, first-person verification or social engagement volume.
- [White House remarks](https://www.whitehouse.gov/remarks/) and [Federal Reserve RSS directory](https://www.federalreserve.gov/feeds/feeds.htm) — primary headline-link adapters for public statements. Links do not imply the app has transcribed, verified or assessed the economic meaning of a speech.
- [SEC EDGAR APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces) — verified reference directory, not automatically connected. SEC filing metadata is not a stock-price feed.

Availability and coverage must be shown from actual requests; a configured URL is not evidence of a connected source. Public access does not automatically grant redistribution rights to article bodies or commercial market datasets. The app links to articles and stores no article body. Providers can block requests or change schema; their failures must be visible.
