# Command Catalog

Commands are organized by buyer journey: sourcing -> inquiry -> cart ->
checkout -> tracking -> post-sale.

## Local browser workbench

The npm package includes a separate `1688-ui` executable. From source, run
`pnpm build` then `pnpm ui`. Open `http://127.0.0.1:4173` (override the port
with `BB1688_UI_PORT`). The workbench uses the CLI's default profile and home
(`~/.1688` or `BB1688_HOME`) and shows the resolved path. Older `.runtime`
sessions require explicitly setting `BB1688_HOME` in both terminals.

Read-only workflows: keyword/image/best-selling search, price/province/city/
inspection-signal/ad filters, selection, and Excel image exports. Results,
selection and query provenance are retained per mode until page refresh.
Failures clearly mark older results; exports preserve their original query.
On-demand details support MOQ, price tiers and SKU comparison for up to five
selected offers. QR login remains an explicit user-confirmed action. This UI
does not add seller messaging, cart or checkout actions.

Result-limit choices are 20, 30, 50, 100, 500 and 1000 for all three views.
These are upper limits, not guaranteed counts. Excel export accepts up to
1000 rows and omits fields that are empty or contain
only unavailable placeholders across all selected offers. A column with any
real value (including zero) is retained. The image column remains first; image
loading and links are preserved when other columns are omitted. Missing-period
definitions remain in the search-source worksheet. Image-link and product-link
cells are clickable and open the image or corresponding 1688 offer respectively.
The optional Excel deduplication choice keeps the first row for each product
ID and preserves rows without an ID. Different product IDs remain separate,
even when they refer to similar products from different sellers.
Keyword search uses normal
in-page pagination, matching both the
current CSS-module next-arrow control and the legacy control. It stops once
enough unique offers exist; repeated ads/items allow additional sequential
pages, bounded by twice the nominal count and 34 pages, with existing delays
and early stops. Optional JSON `pagination` identifies the captured page count
and stop reason. The UI distinguishes a missing/failed next button or timeout
from the end of results. Image search scrolls the results page to collect
subsequent batches and deduplicates offer IDs. It stops at the selected limit,
a capture timeout, a batch with no new offers, or 34 pages. A timeout does
not prove that the platform has exhausted its results.
The UI reports the actual count. An initial image-search capture timeout is an unknown
outcome, not evidence that the platform found no matches; the command returns
`IMAGE_SEARCH_CAPTURE_FAILED`. Login and verification redirects return their
usual exit 3/4 errors. Requests above 50 allow up to 330 seconds
for the search subprocess (the daemon call retains its five-minute timeout).

## Sourcing

```bash
1688 search <keyword>             # keyword search; --max N to limit
1688 search <keyword> --sort best-selling --price-max 50 --exclude-ads
1688 search <keyword> --deeppro   # search, then collect full offer details
1688 search --headed              # open window if slider verification appears
1688 research <keyword...>        # multi-keyword research, scoring, export
1688 similar <offerId>            # official 1688 same-product entry point; currently may be unavailable
1688 image-search <pathOrUrl>     # local .jpg/.png/.webp or http(s) URL
1688 offer <offerId>              # product detail, SKUs, price tiers, package info
1688 offer <offerId...> --pro     # batch details, bypassing daemon health pause
1688 compare <offerId...>         # compare offer details for sourcing
1688 supplier inspect <target>    # supplier/factory trust signals from offerId or b2b-* memberId
1688 supplier search <keyword...> # supplier discovery from 1688 company search
1688 supplier research <keyword...> # supplier scoring + inspect enrichment from company search
```

Research-oriented `search` filters:

```bash
--max <n>                         # default 20; maximum 1000
--sort relevance|best-selling|price-asc|price-desc
--price-min <n>
--price-max <n>
--province <name>
--city <name>
--verified any|factory|business|super-factory
--min-turnover <n>
--exclude-ads
--deeppro
--deeppro-delay-min <seconds>
--deeppro-delay-max <seconds>
```

`--deeppro` preserves normal `search` output and adds a `deeppro` envelope
containing full `offer` results plus per-offer failures. It runs inline with
daemon bypass so a paused daemon does not block the deep collection chain.

`research` adds:

```bash
--max-per-query <n>
--enrich top:N|N|0|none
--jsonl
--csv
--output <file>
```

`similar` only returns results from 1688's official same-product page. It does
not fall back to keyword search or image search, because those are broader
sourcing strategies rather than strict same-product matching. If 1688 returns
the current empty image-search shell, the command fails with
`SIMILAR_UNAVAILABLE`.

Supplier company-search commands:

```bash
1688 supplier search 键盘 --factory-only --json
1688 supplier research 键盘 --enrich top:10 --csv
```

`supplier search` and `supplier research` use 1688's company search source
(`companySearchBusinessService`). They do not aggregate suppliers from offer
search results. Shared flags:

```bash
--max <n>
--factory-only
--province <name>
--city <name>
--min-years <n>
--min-repeat-rate <n>     # accepts 0.4 or 40
--min-response-rate <n>   # accepts 0.6 or 60
--enrich top:N|N|all|0|none
--jsonl
--csv
--output <file>
```

`supplier search` defaults to `--enrich 0`. `supplier research` defaults to
`--enrich top:10`.

## Pre-Sale Inquiry

```bash
1688 seller inquire <offerId> <message>
1688 seller messages --offer <offerId>
1688 seller messages --offer <offerId> --watch [--interval N]
```

`--watch` is long-running and emits one line of JSON per newly-arrived message
when stdout is piped. Default interval is 30 seconds, minimum is 10 seconds.

## Cart

```bash
1688 cart list
1688 cart add <offerId> --sku <skuId> --qty N
1688 cart remove <cartId>
```

`cart add` returns `{added, isNewRow, addedQuantity}` so pipelines can pick up
the cart row reliably.

## Checkout

```bash
1688 checkout prepare <cartId>...
1688 checkout confirm <cartId>...
1688 checkout confirm <cartId>... --agent
```

`prepare` is read-only. `confirm` places a real order and must follow the
approval protocol in `docs/SAFETY.md`.

## Order Tracking

```bash
1688 order list
1688 order list --status waitsellersend
1688 order list --status waitbuyerreceive
1688 order get <orderId>
1688 order logistics <orderId>
1688 shipped <orderId>
1688 stuck [--days N]
1688 fake-shipped [--days N] [--debug]
1688 seller-history <sellerName>
```

Status filters:

| Value | Meaning |
|---|---|
| `all` | All orders |
| `waitbuyerpay` | Pending payment |
| `waitsellersend` | Paid, seller has not shipped |
| `waitbuyerreceive` | Shipped, awaiting delivery |
| `success` | Completed |
| `cancel` | Canceled |

## Post-Sale Chat

```bash
1688 seller chat <orderId|loginId> <message>
1688 seller chat <orderId> <message> --no-card
1688 seller messages <orderId>
1688 seller messages <orderId> --watch
```

With an `orderId`, chat auto-attaches the order card unless `--no-card` is
given.

## Account And Daemon

```bash
1688 login
1688 login --headed
1688 login --force
1688 logout [--yes]
1688 whoami [--verify]
1688 doctor [--no-launch] [--profile <name>]
1688 daemon start | stop | status | reload [--profile <name>]
1688 serve [--profile <name>]
1688 profile list
1688 profile status [name]
```

All account, browser, daemon, and buyer-workflow commands default to the
`default` profile. Passing `--profile <name>` uses that profile's persistent
browser directory, state file, daemon process, lock, and daemon artifacts.

## Output Flags

Every command supports:

```bash
--json            # force JSON output even in a TTY
--pretty          # indent JSON by 2 spaces
--get <path>      # print one field by dot-path
--pick <paths>    # comma-separated dot-paths as a JSON object
```

Examples:

```bash
1688 offer X --get supplier.name
1688 offer X --get supplier
1688 offer X --get 'skus[*].price'
1688 offer X --pick price,supplier.name
1688 offer X --json --pretty
1688 research 手机壳 数据线 --jsonl
1688 research 手机壳 --csv --output research.csv
1688 compare 123 456 --csv
1688 supplier inspect 628196518518 --json --pretty
1688 supplier search 键盘 --json --pretty
1688 supplier research 键盘 --csv --output suppliers.csv
```

## Agent-Friendly Pipelines

```bash
1688 search 雨伞 | jq '.offers[0:5]'
1688 order list --status waitsellersend | jq '.orders[] | {id: .orderId, paid: .paidAt}'
id=$(1688 cart add <offerId> --sku <skuId> --qty 1 | jq -r '.added.cartId')
```

PowerShell without `jq`:

```powershell
1688 offer <offerId> --get supplier.name
1688 supplier search 键盘 --pick total,source.kind,'items[0].supplier.companyName'
$added = 1688 cart add <offerId> --sku <skuId> --qty 1 --json | ConvertFrom-Json
1688 cart remove $added.added.cartId
1688 supplier research 键盘 --csv --output "$env:TEMP\suppliers.csv"
```
