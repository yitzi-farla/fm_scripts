# Deployment Notes for IT

## Browser requirement

These scripts are intended for Tampermonkey.

## Install URLs

Replace `CHANGE-ME-ORG` and `CHANGE-ME-REPO` with the real GitHub org/repo names, then install these raw URLs in Tampermonkey:

```text
https://raw.githubusercontent.com/CHANGE-ME-ORG/CHANGE-ME-REPO/main/userscripts/01-tradepeg-uom-drilldown.user.js
https://raw.githubusercontent.com/CHANGE-ME-ORG/CHANGE-ME-REPO/main/userscripts/02-placeholder.user.js
https://raw.githubusercontent.com/CHANGE-ME-ORG/CHANGE-ME-REPO/main/userscripts/03-placeholder.user.js
https://raw.githubusercontent.com/CHANGE-ME-ORG/CHANGE-ME-REPO/main/userscripts/04-placeholder.user.js
https://raw.githubusercontent.com/CHANGE-ME-ORG/CHANGE-ME-REPO/main/userscripts/05-placeholder.user.js
https://raw.githubusercontent.com/CHANGE-ME-ORG/CHANGE-ME-REPO/main/userscripts/06-placeholder.user.js
https://raw.githubusercontent.com/CHANGE-ME-ORG/CHANGE-ME-REPO/main/userscripts/07-placeholder.user.js
https://raw.githubusercontent.com/CHANGE-ME-ORG/CHANGE-ME-REPO/main/userscripts/08-placeholder.user.js
```

## Future scripts

Scripts 02-08 are intentionally blank. They are safe to deploy now. When a future script is needed, replace the placeholder logic and increase `@version`.

## Testing updates

After pushing a new version to GitHub, open Tampermonkey Dashboard and use the update check. The script should update only if the remote `@version` is higher than the installed version.
