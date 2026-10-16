// ==UserScript==
// @name         Farla 07
// @namespace    farla-office-scripts
// @version      1.0.0
// @description  Website admin sign-in: "Sign in with TradePeg" on farlamedical.co.uk/admin signs you in through TradePeg with nothing to click or paste, and TradePeg's menu gets a "Website admin" link.
// @match        https://farla2.tradepeg.net/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @connect      farlamedical.co.uk
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/yitzi-farla/fm_scripts/main/07.user.js
// @downloadURL  https://raw.githubusercontent.com/yitzi-farla/fm_scripts/main/07.user.js
// ==/UserScript==

// Published as 07.user.js in yitzi-farla/fm_scripts, from which every office PC
// updates itself. Edit here, raise @version, and copy it across.

/*
 * Signs staff in to the website admin (farlamedical.co.uk/admin) as whoever is
 * signed in to TradePeg — the way 04 signs in to Farla Tools.
 *
 * TradePeg will not vouch for a user to another server (its tokens only work from
 * the address they were issued to), so the person proves it the one way TradePeg
 * records: the website hands out a one-time code, this script posts it as a
 * comment on Farla's own contact, as the TradePeg user, and the website reads the
 * comment's author back from TradePeg, deletes it, and answers with a ticket good
 * for one use within a minute. Nothing secret is in this script.
 *
 * Two ways in, neither asking anything of the person:
 *
 *   From the website   /admin/login → "Sign in with TradePeg" opens TradePeg at
 *                      #farla-website-signin. The request is remembered first,
 *                      because TradePeg may show its own login and lose the
 *                      address; it is carried out on the first TradePeg page that
 *                      has the menu (so: signed in), within ten minutes, and the
 *                      person lands back in the admin, signed in.
 *   From TradePeg      "Website admin" in TradePeg's left-hand menu opens the
 *                      admin in a new tab, signed in.
 */
;(function () {
  'use strict'

  const VERSION = typeof GM_info === 'undefined' ? '?' : GM_info.script?.version
  const log = (...args) => console.info('[Farla Website admin]', VERSION, ...args)

  /** Overridable for testing against another copy of the site: GM value `websiteUrl`. */
  const WEBSITE = (GM_getValue('websiteUrl', '') || 'https://farlamedical.co.uk').replace(/\/$/, '')
  const SIGNIN_HASH = 'farla-website-signin'
  const PENDING = 'websiteSigninPending'
  const PENDING_FOR_MS = 10 * 60_000

  /** Only a page of the admin itself, never somewhere else a link could send someone. */
  const adminPath = (next) => (typeof next === 'string' && /^\/admin(\/|\?|$)/.test(next) ? next : '/admin')

  /** One call to the website's sign-in endpoints. No cookies: nothing here is anyone's session yet. */
  function websiteAuth(path, body) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'POST',
        url: `${WEBSITE}/api/auth${path}`,
        headers: { 'Content-Type': 'application/json' },
        data: JSON.stringify(body),
        anonymous: true,
        timeout: 30000,
        onload(response) {
          let parsed = null
          try {
            parsed = JSON.parse(response.responseText)
          } catch {
            // Answered below: a proxy or a stopped service answers with HTML.
          }
          if (response.status >= 200 && response.status < 300 && parsed) resolve(parsed)
          else reject(new Error(parsed?.message || `the website answered ${response.status}`))
        },
        onerror: () => reject(new Error(`could not reach ${WEBSITE}`)),
        ontimeout: () => reject(new Error('the website took too long to answer')),
      })
    })
  }

  /** TradePeg's own pages, in this page's language, as the signed-in user. */
  const wapp = (path) => `/wapp/${location.pathname.split('/')[2] || 'en-gb'}${path}`

  /** Prove who is signed in to TradePeg; answer the website address that finishes signing in. */
  async function signinUrl(next) {
    const challenge = await websiteAuth('/tradepeg/challenge', {})
    const posted = await fetch(wapp('/io/post/'), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
      body: new URLSearchParams({ concept: 'doc-note', baseType: 'CONTACTS', baseId: challenge.contactId, note: challenge.note }),
    })
    if (!posted.ok) throw new Error(`TradePeg answered ${posted.status} to the sign-in comment`)
    const signedIn = await websiteAuth('/tradepeg/verify', { challengeId: challenge.challengeId, handoff: true })
    // The website deletes the comment too; as its author, so can we.
    if (signedIn.noteId) {
      void fetch(wapp(`/io/post/legacy/?concept=delete-note&noteId=${signedIn.noteId}`), {
        credentials: 'same-origin',
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      }).catch(() => {})
    }
    log('signed in as', signedIn.name)
    return `${WEBSITE}/admin/tradepeg?ticket=${encodeURIComponent(signedIn.ticket)}&next=${encodeURIComponent(adminPath(next))}`
  }

  /* ------------------------------------------------ from the website's login */

  let running = false

  function resume() {
    if (location.hash.includes(SIGNIN_HASH)) {
      const query = location.hash.includes('?') ? location.hash.slice(location.hash.indexOf('?') + 1) : ''
      GM_setValue(PENDING, { at: Date.now(), next: adminPath(new URLSearchParams(query).get('next')) })
      history.replaceState(null, '', location.pathname + location.search)
    }
    if (running) return
    const pending = GM_getValue(PENDING, null)
    if (!pending) return
    if (!(Date.now() - pending.at < PENDING_FOR_MS)) return GM_deleteValue(PENDING)
    // TradePeg's login page has no menu; wait for the first page that does.
    if (!document.querySelector('li.vert_menu_inventory')) return
    running = true
    GM_deleteValue(PENDING)

    const cover = document.createElement('div')
    cover.style.cssText =
      'position:fixed;inset:0;z-index:100000;background:rgba(255,255,255,.94);display:flex;align-items:center;justify-content:center;font:16px sans-serif;color:#333'
    cover.textContent = 'Signing you in to the website admin…'
    document.body.append(cover)

    signinUrl(pending.next)
      .then((url) => location.assign(url))
      .catch((error) => {
        log('sign-in failed', error)
        location.assign(`${WEBSITE}/admin/login?error=${encodeURIComponent(`TradePeg sign-in didn't work: ${error.message}`)}`)
      })
  }

  /* ----------------------------------------------------- from TradePeg's menu */

  async function openAdmin(event) {
    event.preventDefault()
    // Opened now, inside the click, or a pop-up blocker stops it.
    const tab = window.open('about:blank', '_blank')
    try {
      const url = await signinUrl('/admin')
      if (tab) tab.location.href = url
      else window.open(url, '_blank')
    } catch (error) {
      tab?.close()
      window.alert(`Website admin: ${error.message}`)
    }
  }

  /** A "Website admin" entry after Inventory. (TradePeg draws the menu twice, for wide and narrow screens.) */
  function installMenu() {
    for (const inventory of document.querySelectorAll('li.vert_menu_inventory')) {
      const list = inventory.parentElement
      if (list.querySelector(':scope > li.farla-website-admin')) continue
      const li = document.createElement('li')
      li.className = 'farla-website-admin'
      const a = document.createElement('a')
      a.href = `${WEBSITE}/admin`
      a.addEventListener('click', openAdmin)
      const icon = document.createElement('i')
      icon.className = 'fa fa-globe'
      const title = document.createElement('span')
      title.className = 'title'
      title.textContent = ' Website admin'
      a.append(icon, title)
      li.append(a)
      // After the PIM section (06) when it is there, else after Inventory.
      const after = list.querySelector(':scope > li.fpim-menu') ?? inventory
      after.after(li)
    }
  }

  // TradePeg swaps pages in without a reload, so keep checking as the page changes.
  const tick = () => {
    try {
      resume()
      installMenu()
    } catch (error) {
      console.error('[Farla Website admin]', VERSION, error)
    }
  }
  tick()
  let queued = false
  new MutationObserver(() => {
    if (queued) return
    queued = true
    setTimeout(() => {
      queued = false
      tick()
    }, 100)
  }).observe(document.body, { childList: true, subtree: true })
})()
