# Recommendation methods

The broader draft combines recent shopping-date participation and recency. The
optional focused draft blends multiple repeat-purchase signals after calibrating
them on completed earlier seven-day windows aligned with the request weekday.
These scores rank products; the website does not present them as probabilities.

The focused scorer calibrates earlier prediction errors separately for weekly,
biweekly, monthly, occasional and irregular restocking patterns. It uses 26
completed weeks, downweights older errors, and shrinks sparse item estimates
toward the corresponding cadence and rank group. Half of the ranking retains
the underlying experts' ranks. These are generic settings chosen on an earlier
validation period; household records and fitted private weights are not embedded
in the code. The previous calibrated scorer remains available for comparison.

Purchases from both stores feed one household ranking through reviewed equivalent
item mappings. Ranking eligibility and scores do not depend on the selected
store. Store selection resolves the product, package quantity and availability
after ranking; an unmatched item remains optional. An interval-smoothing
alternative is retained for research, but tied the existing scorer on the earlier
shared-household validation period and was not selected. Quantity defaults and
the broader starting selection remain separate.

The selected focused method did not meet the requested consistency target.
Household-specific measurements remain in the private experiment reports
outside the repository. A focused result covers only a small part of actual
purchases and is not whole-cart prediction accuracy. The broader starting draft
is unchanged. The source implementation was checked against every historical
week; rollout requires the normal server restart.

The focused signals include hierarchical time-decayed frequency, calendar and
shopping-trip recurrence, item-specific repurchase intervals, earlier basket
transitions, similar historical baskets and co-purchases. The local implementation
adapts ideas from these primary sources:

- Hu et al., SIGIR 2020, [Modeling Personalized Item Frequency Information for
  Next-basket Recommendation](https://arxiv.org/abs/2006.00556), with the
  [authors' TIFU-KNN implementation](https://github.com/HaojiHu/TIFUKNN).
- Romanov et al., RecSys 2023, [Time-Aware Item Weighting for the Next Basket
  Recommendations](https://arxiv.org/abs/2307.16297).
- Li et al., [A Next Basket Recommendation Reality Check](https://arxiv.org/abs/2109.14233),
  which distinguishes repeat purchases from first-time purchases in evaluation.
- Teunter, Syntetos and Babai, [Intermittent demand: Linking forecasting to
  inventory obsolescence](https://doi.org/10.1016/j.ejor.2011.05.018), for the
  distinction between interval smoothing and updating occurrence estimates
  during periods without purchases. The application uses a locally calibrated
  occurrence-ranking adaptation, not a reproduction of inventory forecasting.

This is a single-household adaptation, not a reproduction of the papers' complete
multi-user training procedures. It does not download other shoppers' data or send
household purchases to an external service. Calibration uses only completed
earlier windows; an item's outcome cannot enter its own prediction features.
Accounts are modeled separately. Substitutes, unmatched products, snoozed items
and unavailable products are not automatically selected.

Starting counts use the most recent purchase day's amount, converted to the
nearest whole package at the selected store. Purchases of the same household
item on the same day are combined. For products sold by weight, the draft starts
with one item/package because receipt weight does not establish item count.
All counts remain editable. Quantity evaluation separates canonical amounts
from feasible whole-package counts when stores sell different package sizes.

Evaluate precision together with recall, list size, weeks with no recorded
shopping, and performance across time periods. A high-precision five-item list
must not be described as equally comprehensive as a thirty-item draft. Existing
product matches applied retrospectively are a separate assumption from purchase
timing prediction. Repeated examination of a historical test period makes it
development evidence, not a pristine prospective accuracy guarantee.

Household-specific experiment scripts, receipt extracts, models and detailed
reports belong outside the repository. Keep promising components and their
revision results, including approaches that did not win the current comparison.


## Category + cycle runtime

The default server setting is `category-cycle`; `date-based` selects the preserved `recommendation-risk.js` path. `POST /api/recommendations/method` persists this preference. Recovery/read-only mode uses the previous method without starting a trainer. No setting change submits a list or touches a store cart.

`recommendation-category-cycle.js` implements the verified 94-column category × cadence group features and within-group allocation. It uses only positive purchase occurrence, dates and prior receipt titles. Public structural scores use the generic public model in `models/`; private training weights and cached results go only into `.data/recommendations` (or the configured data directory). Receipt quantities remain editable starting amounts, not timing/ranking inputs. Same-day completed purchases are not automatically selected again.

The worker uses the selected expanding-history HGB Poisson model: 100 iterations, 7 leaves, minimum leaf 20, L2 10, learning rate .05, no internal early stopping, seed 7. Target is distinct recurring household items in a category/cycle, not package quantity. Only fully completed earlier shopping windows are training examples. All broad 90-day-cadence training examples are retained as in the backtest; automatic output is filtered to median gaps 3.5–31.5 days (upper bound exclusive). Existing longer-cycle rows remain manually reviewable.

A Node worker thread builds features and invokes `recommendation-trainer.py`; this keeps training off the HTTP thread. Results are cached by account, date, presence history, categories and source version. The trainer interpreter is selected from private `recommendations/config.json`, `GROCERY_PYTHON`, an isolated environment, or Python on PATH. Missing/failed training explicitly falls back to the previous method. Settings provides a retry. Setup dependencies are pinned in `recommendation-requirements.txt`.

Implementation verification reproduces all 148 historical group feature arrays exactly, all 52 selected-model rankings exactly, and 344/540 correct suggestions on the narrowed 15-item benchmark. Those fixtures include the approved research aliases; live input follows the household's current editable product matches. Full-application runtime tests are recorded outside the checkout in the Transfer verification folder. Scores and private model parameters are not committed or shipped in releases.
