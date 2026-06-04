# Farla Tampermonkey Scripts

GitHub-ready Tampermonkey userscript bundle for Farla office staff.

## What this repo contains

- `userscripts/01-tradepeg-uom-drilldown.user.js` - active TradePeg SO/PO UOM drilldown script.
- `userscripts/02-placeholder.user.js` through `userscripts/08-placeholder.user.js` - installed now as safe blank placeholders so future scripts can be added by editing GitHub and increasing `@version`.

## One-time setup before deployment

After creating the GitHub repo, replace these placeholders in every `.user.js` file:

- `CHANGE-ME-ORG`
- `CHANGE-ME-REPO`

Example final URL:

```text
https://raw.githubusercontent.com/FarlaMedical/farla-tampermonkey-scripts/main/userscripts/01-tradepeg-uom-drilldown.user.js
```

The `@updateURL` and `@downloadURL` lines must point to the raw GitHub URL for each userscript.

## Deploying to staff PCs

1. Install Tampermonkey in the staff browser.
2. Open each raw GitHub userscript URL once.
3. Tampermonkey will show an install screen.
4. Install all 8 scripts.
5. Future changes are delivered by Tampermonkey auto-update, as long as the `@version` number is increased.

## Updating a script

When changing any script:

1. Edit the relevant `.user.js` file.
2. Increase the `@version` value, for example `0.1.0` to `0.1.1`.
3. Commit and push to GitHub.
4. Tampermonkey will pick up the newer version during its update check.

## Important

Do not rename files after deployment unless IT is ready to reinstall that userscript on all PCs. Tampermonkey update URLs depend on the file path.
