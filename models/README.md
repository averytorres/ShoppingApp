# Recommendation models

`replenishment-public.json` contains numeric trees trained only on public,
anonymized Instacart shopping history. Its 17 inputs describe earlier shopping-day
occurrences. Product names, product IDs, user IDs, prices, and physical amounts are
not model features. The embedded provenance records public sources and hashes.

Source attribution: Xiaoyu Wang, *Instacart Market Basket Analysis* (2019),
[Zenodo record 2654444](https://doi.org/10.5281/zenodo.2654444). The archive metadata
lists CC BY 4.0. The original dataset is the Instacart 2017 grocery-shopping data.
Public next-shopping-day training differs from predicting a household's next
seven calendar days; this model is a supporting signal, not a verified guarantee.

Household-trained models, Python configuration, and caches belong under
`.data/recommendations/`, which must remain outside Git. Never place private
training examples or household model weights in this directory.

The optional local trainer uses Python 3.10–3.13 (3.12 recommended). Run
`powershell -ExecutionPolicy Bypass -File .\setup-recommendations.ps1` from the
application directory to create an isolated environment with pinned dependencies.
`GROCERY_PYTHON` can select an existing Python executable. Setup installs packages
only into `.data/recommendations/venv`; its local executable path is saved in the
private configuration after verification succeeds.
