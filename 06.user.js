// ==UserScript==
// @name         Farla 06 - TradePeg PIM
// @namespace    farla-office-scripts
// @version      3.15.0
// @description  The Farla PIM inside TradePeg: a PIM section in the menu (parents, categories, import, settings with TradePeg sync and export), each part's VARPAR opening its parent, website pictures in each part's Images tab, and, for parts ticked in TradePeg's list, "VARPAR / SOLOPAR" and "Edit in PIM". No need to open Strapi.
// @match        https://farla2.tradepeg.net/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        unsafeWindow
// @connect      pim.farlamedical.co.uk
// @connect      up.railway.app
// @connect      localhost
// @connect      127.0.0.1
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/yitzi-farla/fm_scripts/main/06.user.js
// @downloadURL  https://raw.githubusercontent.com/yitzi-farla/fm_scripts/main/06.user.js
// ==/UserScript==

// Published as 06.user.js in yitzi-farla/fm_scripts, from which every office PC
// updates itself. Edit here, raise @version, and copy it across.

/*
 * TradePeg owns the item — SKU, units, barcodes, price, stock. The PIM (Strapi)
 * owns what the website, Google and eBay say about it. This script is the PIM's
 * front end inside TradePeg, so nobody needs to open Strapi:
 *
 *   A PIM section in TradePeg's menu, its pages drawn like TradePeg's own:
 *   Parents (search, filters, columns chosen per user, tick and bulk edit,
 *   Refresh = resync with TradePeg), Categories (name and slug), Import (incl.
 *   pictures from links), AI (parent titles, variations, pictures, categories),
 *   TradePeg sync, Issues, Export, Channels, Settings (incl. product fields
 *   added without code). A parent opens at
 *   #pim/parent/<VARPAR>: its title, status, brand, description, key features,
 *   specs, what's in the box, its pictures (one set for the whole range),
 *   videos, documents, categories, tags, website / Google / eBay, variation
 *   types and each variant's title and values, with Save and Preview. Back,
 *   reload and bookmarks work.
 *
 *   On a part's page: its VARPAR (Details) opens the parent, and its Images tab
 *   gets "Website pictures" — the part's pictures, each tagged with what it
 *   shows: the parent (the whole range: every part shows it), the item
 *   (FM-NPFL) or one of its units (FM-NPFL-CASE, FM-NPFL-UNIT). A picture
 *   cannot be added without a tag.
 *
 *   TradePeg's own Parts list: tick parts and its selection bar gets
 *   "VARPAR / SOLOPAR" (a new or existing VARPAR, or a SOLOPAR each, saved to
 *   TradePeg through its own Edit Details form) and "Edit in PIM" for what a
 *   part has of its own (its variation values).
 *
 * It talks to the PIM's content API (repos/pim src/api/pim) with a Strapi API
 * token of type Custom. Under Pim tick lookup, update, upload and options for
 * the tab, and admin for PIM tools. lookup alone gives a read-only tab. The
 * token is pasted in once and kept in this browser's Tampermonkey storage —
 * never in this file, which is public.
 *
 * Every save sends the product's updatedAt from when it was loaded; if someone
 * has saved it since, the PIM refuses rather than overwrite their work.
 *
 * Same shape as 04 (Repricer): TradePeg swaps pages in without a reload, so the
 * script watches for a part's page, the menu and the Parts toolbar,
 * and adds its pieces whenever they turn up without them. Nothing is asked of
 * the PIM until one of its tabs or pages is opened.
 */
;(function () {
  'use strict'

  // The Railway address until pim.farlamedical.co.uk is pointed at it.
  const DEFAULT_PIM_URL = 'https://farla-pim-production.up.railway.app'
  const WEBSITE_URL = 'https://farlamedical.co.uk/en/uk/products/'
  const TOKEN_KEY = 'pimToken'
  const URL_KEY = 'pimUrl'
  const TAB = 'tab_pim'

  const VERSION = typeof GM_info === 'undefined' ? '?' : GM_info.script?.version
  const log = (...args) => console.info('[Farla PIM]', VERSION, ...args)
  log('running on', location.pathname)

  GM_addStyle(`
    .fpim .fpim-state { padding: 30px 15px; text-align: center; color: #777; }
    .fpim .fpim-wrap { display: grid; grid-template-columns: 250px minmax(0, 1fr); gap: 20px; padding: 15px; }
    .fpim .fpim-side { position: sticky; top: 10px; align-self: start; }
    .fpim .fpim-side .btn-block { margin-top: 6px; }
    .fpim .fpim-score { font-size: 32px; font-weight: 600; line-height: 1; }
    .fpim .fpim-bar { height: 8px; background: #eee; border-radius: 4px; margin: 8px 0 12px; overflow: hidden; }
    .fpim .fpim-bar > div { height: 100%; }
    .fpim .fpim-missing { padding-left: 18px; }
    .fpim .fpim-missing li { color: #a94442; }
    .fpim .fpim-section { border: 1px solid #e3e3e3; margin-bottom: 16px; background: #fff; }
    .fpim .fpim-section > h4 { margin: 0; padding: 8px 12px; background: #f7f7f7; border-bottom: 1px solid #e3e3e3; font-size: 14px; font-weight: 600; }
    .fpim .fpim-section > .fpim-body { padding: 12px; }
    .fpim .fpim-field { margin-bottom: 12px; }
    .fpim .fpim-field > label { display: block; font-weight: 600; margin-bottom: 3px; }
    .fpim h5 { font-weight: 600; margin: 4px 0 8px; }
    .fpim .fpim-help { color: #666; font-size: 11px; margin-top: 2px; }
    .fpim .fpim-ro { padding: 5px 0; }
    .fpim .fpim-ro .label { margin-left: 4px; }
    .fpim .fpim-cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0 16px; }
    .fpim .fpim-row { display: flex; gap: 6px; margin-bottom: 6px; align-items: center; }
    .fpim .fpim-row > .form-control, .fpim .fpim-row > .fpim-grow { flex: 1; }
    .fpim .fpim-narrow { flex: 0 0 80px !important; }
    .fpim .fpim-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; }
    .fpim .fpim-chip { background: #eef3f8; border: 1px solid #c9d8e8; padding: 2px 4px 2px 8px; font-size: 12px; display: inline-flex; align-items: center; gap: 4px; }
    .fpim .fpim-chip button { border: 0; background: none; color: #a94442; font-weight: 600; padding: 0 4px; cursor: pointer; }
    .fpim .fpim-picker { position: relative; }
    .fpim .fpim-options { position: absolute; z-index: 1000; left: 0; right: 0; top: 100%; background: #fff; border: 1px solid #ccc; max-height: 260px; overflow: auto; margin: 0; padding: 0; list-style: none; box-shadow: 0 4px 10px rgba(0,0,0,.1); }
    .fpim .fpim-options li { padding: 6px 10px; cursor: pointer; font-size: 12px; }
    .fpim .fpim-options li:hover, .fpim .fpim-options li.fpim-hi { background: #eef3f8; }
    .fpim .fpim-options li.fpim-note { color: #888; cursor: default; }
    .fpim .fpim-images { display: flex; flex-wrap: wrap; gap: 10px; }
    .fpim .fpim-image { width: 120px; border: 1px solid #e3e3e3; padding: 4px; text-align: center; background: #fff; }
    .fpim .fpim-image img { width: 110px; height: 110px; object-fit: contain; display: block; margin: 0 auto 4px; }
    .fpim .fpim-image.fpim-small { width: 86px; }
    .fpim .fpim-image.fpim-small img { width: 76px; height: 76px; }
    .fpim .fpim-image .fpim-first { font-size: 11px; font-weight: 600; color: #3c763d; }
    .fpim .fpim-image .btn-group { display: flex; }
    .fpim .fpim-image .btn { flex: 1; padding: 1px 2px; font-size: 11px; }
    .fpim .fpim-sku { font-family: Menlo, Consolas, monospace; font-size: 12px; }
    .fpim .fpim-current { background: #fcf8e3; }
    .fpim .fpim-variant { border: 1px solid #e3e3e3; padding: 10px; margin-bottom: 10px; }
    .fpim .fpim-variant.fpim-current { border-color: #e6d28a; }
    .fpim .fpim-variant-head { display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; margin-bottom: 8px; }
    .fpim .fpim-variant-head .fpim-grow { flex: 1; }
    .fpim .fpim-dirty { color: #8a6d3b; font-weight: 600; margin-right: 8px; }
    .fpim .fpim-message { margin: 15px 15px 0; }
    .fpim textarea.form-control { resize: vertical; }
    .fpim table.fpim-table { width: 100%; font-size: 12px; }
    .fpim table.fpim-table th, .fpim table.fpim-table td { padding: 4px 6px; border-bottom: 1px solid #eee; vertical-align: top; text-align: left; }
    .fpim .fpim-pre { white-space: pre-wrap; font-family: Menlo, Consolas, monospace; font-size: 11px; background: #f7f7f7; padding: 8px; max-height: 220px; overflow: auto; }
    .fpim .fpim-kv { display: grid; grid-template-columns: 170px 1fr; gap: 4px 12px; font-size: 12px; margin-bottom: 10px; }
    .fpim .fpim-kv > :nth-child(odd) { color: #666; }
    .fpim :focus-visible, #fpim-savebar :focus-visible, .fpim-modal :focus-visible { outline: 2px solid #3c8dbc; outline-offset: 1px; }
    .fpim button, .fpim summary, .fpim [role="button"], .fpim .fpim-click { cursor: pointer; }
    .fpim .btn, .fpim .fpim-grid-table tbody tr, .fpim .fpim-node, .fpim .fpim-chip { transition: background-color .15s ease, border-color .15s ease, color .15s ease; }
    .fpim .fpim-grid-table tbody tr.fpim-click:hover > td { background: #f5f8fb; }
    .fpim .fpim-grid-table tbody tr.fpim-picked > td { background: #eef3f8; }
    .fpim .fpim-grid-table td { vertical-align: middle; }
    @media (prefers-reduced-motion: reduce) { .fpim *, #fpim-savebar, .fpim-modal * { transition: none !important; scroll-behavior: auto !important; } }

    .fpim-pagination { margin-top: 6px; }
    .fpim-pagination .pagination { margin: 10px 0; }
    .fpim .fpim-selbar { position: fixed; bottom: 10px; z-index: 1030; box-sizing: border-box; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; background: #f6f9fc; border: 1px solid #c9d8e8; padding: 8px 10px; margin-top: 10px; box-shadow: 0 -2px 6px rgba(0,0,0,.06); }
    .fpim .fpim-selbar strong { margin-right: 4px; }
    #fpim-savebar { position: fixed; left: 50%; transform: translateX(-50%); bottom: 16px; z-index: 10000; display: flex; gap: 10px; align-items: center; background: #fff; border: 1px solid #e6d28a; box-shadow: 0 4px 16px rgba(0,0,0,.18); padding: 8px 12px; }
    #fpim-savebar .fpim-dirty { margin: 0; }
    .fpim-push-badge { margin-left: 6px; background: #fff !important; color: #c67605 !important; }
    li.fpim-menu-publish .fpim-push-badge { background: #f0ad4e !important; color: #fff !important; }
    #fpim-toast { position: fixed; top: 16px; right: 16px; z-index: 10100; max-width: 420px; box-shadow: 0 4px 16px rgba(0,0,0,.18); }
    .fpim .fpim-jump { position: sticky; top: 0; z-index: 20; display: flex; flex-wrap: wrap; gap: 4px; background: #fff; border-bottom: 1px solid #e3e3e3; padding: 6px 0; margin-bottom: 12px; }
    .fpim .fpim-vtable { width: 100%; }
    .fpim .fpim-vtable td { vertical-align: middle; }
    .fpim .fpim-vtable .form-control { min-width: 110px; }
    .fpim .fpim-vtable img { width: 36px; height: 36px; object-fit: contain; }
    .fpim .fpim-vtable tr.fpim-current > td { background: #fcf8e3; }
    .fpim .fpim-vtable tr.fpim-detail > td { background: #fafafa; padding: 10px 12px; }
    .fpim .fpim-vtools { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin: 4px 0 8px; }
    .fpim-modal { z-index: 10050; overflow-y: auto; }
    .fpim-backdrop { z-index: 10040; }
    .fpim-modal .modal-body { max-height: calc(100vh - 220px); overflow: auto; }
    .fpim-modal .fpim-options { position: relative; }
    /* In a dialog a dropdown's list takes room in the page, so the dialog grows to show it rather than cutting it off. */
    .fpim-modal .fpim-select .selectize-dropdown { position: relative; top: auto; margin-top: 2px; }
    .fpim-modal .fpim-multi { position: relative; }
    .fpim-menu-button .dropdown-menu { z-index: 1060; }
    .fpim .fpim-facets { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; }
    .fpim .fpim-facet { position: relative; }
    .fpim .fpim-facet > summary { list-style: none; cursor: pointer; border: 1px solid #ccc; padding: 4px 10px; font-size: 12px; background: #fff; }
    .fpim .fpim-facet > summary::-webkit-details-marker { display: none; }
    .fpim .fpim-facet[open] > summary, .fpim .fpim-facet.fpim-on > summary { border-color: #3c8dbc; background: #eef3f8; }
    .fpim .fpim-facet > div { position: absolute; z-index: 1001; top: 100%; left: 0; min-width: 240px; max-width: 420px; max-height: 320px; overflow: auto; background: #fff; border: 1px solid #ccc; box-shadow: 0 4px 10px rgba(0,0,0,.12); padding: 6px 10px; }
    .fpim .fpim-facet label { display: flex; gap: 6px; font-weight: normal; font-size: 12px; margin: 3px 0; }
    .fpim .fpim-facet label span { flex: 1; }
    .fpim .fpim-grid-table th { white-space: nowrap; }
    .fpim .fpim-grid-table th.fpim-sortable { cursor: pointer; color: #3c8dbc; }
    .fpim .fpim-grid-table img { width: 36px; height: 36px; object-fit: contain; display: block; }
    .fpim .fpim-grid-table .fpim-thumb { width: 48px; }
    .fpim .fpim-grid-table .fpim-noimg { display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; border: 1px dashed #ccc; color: #bbb; }
    .fpim .fpim-grid-table tbody td { height: 49px; }
    .fpim .fpim-grid-table tr.fpim-picked td { background: #eef3f8; }
    .fpim .fpim-bulk { border: 1px solid #c9d8e8; background: #f6f9fc; padding: 10px 12px; margin: 10px 0; }
    .fpim .fpim-tree { list-style: none; padding-left: 0; margin: 0; }
    .fpim .fpim-tree .fpim-tree { padding-left: 22px; border-left: 1px dotted #ccc; margin-left: 8px; }
    .fpim .fpim-node { display: flex; align-items: center; gap: 6px; padding: 3px 0; flex-wrap: wrap; }
    .fpim .fpim-node:hover { background: #fafafa; }
    .fpim .fpim-node .fpim-twisty { width: 22px; border: 0; background: none; padding: 0; color: #555; }
    .fpim .fpim-node .fpim-name { font-weight: 600; }
    .fpim .fpim-node { padding: 3px 4px; }
    .fpim .fpim-node .fpim-menu-button .btn { padding: 1px 8px; font-size: 11px; }
    a.fpim-varpar { font-weight: 600; }
    a.fpim-varpar .fa { font-size: 11px; margin-left: 2px; }
    .fpim .fpim-tags { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 4px; }
    .fpim .fpim-tag { display: flex; gap: 8px; align-items: flex-start; border: 1px solid #ddd; background: #fff; padding: 6px 10px; margin: 0; font-weight: normal; cursor: pointer; min-width: 180px; }
    .fpim .fpim-tag input { margin-top: 3px; }
    .fpim .fpim-tag.fpim-on { border-color: #3c8dbc; background: #eef3f8; }
    .fpim .fpim-drop { border: 2px dashed #c9d8e8; background: #f9fbfd; padding: 22px; text-align: center; color: #555; cursor: pointer; margin: 10px 0 16px; }
    .fpim .fpim-drop.fpim-off { cursor: not-allowed; color: #888; background: #fafafa; border-color: #ddd; }
    .fpim .fpim-drop.fpim-over { border-color: #3c8dbc; background: #eef3f8; }
    .fpim .fpim-group { margin-bottom: 14px; }
    .fpim .fpim-group h5 { margin-bottom: 6px; }
    .fpim .fpim-image.fpim-tile { width: 150px; }
    .fpim .fpim-image.fpim-tile img { width: 140px; height: 120px; }
    .fpim .fpim-image select { width: 100%; height: 24px; padding: 0 4px; font-size: 11px; margin-top: 4px; }
    .fpim .fpim-sheet { max-height: 60vh; overflow: auto; }
    .fpim .fpim-sheet-table { margin: 0; }
    .fpim .fpim-sheet-table thead th { position: sticky; top: 0; z-index: 2; background: #f0f0f0; white-space: nowrap; font-size: 12px; }
    .fpim .fpim-sheet-table td { padding: 0 !important; }
    .fpim .fpim-sheet-table tr.danger td { background: #f2dede; }
    .fpim .fpim-sheet-table tr.success td { background: #dff0d8; }
    .fpim .fpim-cell { display: block; width: 100%; min-width: 130px; height: 28px; border: 0; background: transparent; padding: 4px 6px; font-size: 12px; resize: none; overflow: hidden; }
    .fpim .fpim-cell:focus { outline: 2px solid #3c8dbc; outline-offset: -2px; background: #fff; }
    .fpim th.fpim-rownum { width: 44px; text-align: center; color: #666; background: #f7f7f7; position: relative; font-weight: normal; }
    .fpim .fpim-rowdel { display: none; position: absolute; right: 2px; top: 4px; border: 0; background: none; color: #a94442; font-weight: 600; padding: 0 3px; }
    .fpim tr:hover .fpim-rowdel, .fpim .fpim-rowdel:focus { display: inline; }
    .fpim td.fpim-ro-cell { background: #f5f5f5; color: #666; padding: 4px 6px !important; font-size: 12px; white-space: nowrap; max-width: 240px; overflow: hidden; text-overflow: ellipsis; }
    .fpim .fpim-import-options { display: flex; gap: 16px; align-items: flex-start; padding: 10px 12px; }
    .fpim .fpim-import-option { min-width: 220px; }
    .fpim .fpim-dropzone { min-height: 120px; cursor: pointer; }
    .fpim .fpim-import .well { margin: 0 12px 12px; }
    .fpim .fpim-import > .panel-body > .alert, .fpim .fpim-import > .panel-body > div > .alert { margin: 10px 12px; }
    .fpim .fpim-summary { display: flex; flex-wrap: wrap; gap: 10px 24px; align-items: center; border: 1px solid #e3e3e3; background: #fafafa; padding: 10px 14px; margin-bottom: 12px; }
    .fpim .fpim-summary .fpim-score-line { min-width: 170px; }
    .fpim .fpim-summary .fpim-score-line strong { font-size: 20px; }
    .fpim .fpim-summary .fpim-bar { margin: 4px 0 0; width: 160px; height: 6px; }
    .fpim .fpim-summary .fpim-todo { flex: 1; min-width: 260px; }
    .fpim .fpim-summary .fpim-todo .btn-link { padding: 0 2px; font-size: 12px; vertical-align: baseline; }
    .fpim .fpim-summary .fpim-actions { display: flex; gap: 6px; }
    .fpim .fpim-editor { padding: 15px; }
    .fpim .fpim-status { display: flex; gap: 14px; align-items: center; border: 1px solid #d6e9c6; background: #dff0d8; color: #2b542c; padding: 14px 16px; margin-bottom: 14px; }
    .fpim .fpim-status.fpim-bad { border-color: #ebccd1; background: #f2dede; color: #843534; }
    .fpim .fpim-status.fpim-busy { border-color: #bce8f1; background: #d9edf7; color: #245269; }
    .fpim .fpim-status > .fa { font-size: 28px; }
    .fpim .fpim-status h4 { margin: 0 0 3px; font-size: 18px; font-weight: 600; }
    .fpim .fpim-status .fpim-grow { flex: 1; }
    .fpim .fpim-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; margin-bottom: 14px; }
    .fpim .fpim-card { border: 1px solid #e3e3e3; background: #fff; padding: 12px 14px; }
    .fpim .fpim-card h5 { margin: 0 0 6px; color: #666; font-weight: 600; text-transform: uppercase; font-size: 11px; letter-spacing: .03em; }
    .fpim .fpim-card .fpim-big { font-size: 20px; font-weight: 600; margin-bottom: 4px; }
    .fpim details.fpim-more > summary { cursor: pointer; color: #3c8dbc; margin: 6px 0; }
    .fpim .fpim-part { padding: 10px 0 2px; border-bottom: 1px solid #e5e5e5; }
    .fpim .fpim-part-title { color: #9C27B0 !important; text-align: left !important; margin: 4px 15px 10px !important; font-size: 13px; }
    .fpim .fpim-field { margin-bottom: 14px; }
    .fpim .fpim-field > .help-block { margin: 4px 0 0 !important; text-align: left !important; }
    .fpim .fpim-field > .help-block.fpim-label-top { margin: 0 0 6px !important; font-weight: 600; }
    .fpim .fpim-field > .help-block[title] { cursor: help; }
    .fpim .fpim-summary { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 36px; border: 1px solid #c3e2bc; background: #f5faf3; margin-bottom: 4px; padding: 10px 16px; }
    .fpim .fpim-summary .fpim-statcell .help-block { margin: 2px 0 0 !important; text-align: left !important; }
    .fpim .fpim-summary .fpim-stat { font-size: 15px; font-weight: 600; }
    .fpim .fpim-summary .fpim-score-cell .fpim-stat { font-size: 24px; line-height: 1; }
    .fpim .fpim-summary .fpim-grow { flex: 1; }
    .fpim .fpim-summary > .fpim-statcell:last-child { display: flex; gap: 4px; }
    .fpim .fpim-ib { padding: 3px 7px; }
    .fpim .fpim-row-tools { flex: 0 0 auto; }
    .fpim .fpim-image .btn-group .fpim-ib { flex: 1; }
    .fpim .fpim-jump { margin: 12px 0 0; }
    .fpim h5 { color: #1f730c; }
    .fpim .fpim-node-edit { margin: 4px 0 8px 28px; padding: 8px; border: 1px solid #e3e3e3; background: #fff; max-width: 640px; }
    /* A heading with buttons: title left, buttons right, both centred inside the green bar. */
    .fpim .panel-heading:has(> .btns), .fpim .panel-heading:has(> .pull-right) { display: flex; align-items: center; gap: 8px; min-height: 38px; padding-top: 4px; padding-bottom: 4px; }
    .fpim .panel-heading > .btns, .fpim .panel-heading > .pull-right { float: none !important; margin: 0 0 0 auto !important; display: flex; align-items: center; flex-wrap: wrap; justify-content: flex-end; gap: 5px; }
    .fpim .panel-heading > .btns .btn, .fpim .panel-heading > .pull-right .btn { margin-top: 0; margin-bottom: 0; }
    .fpim .panel-heading > .btns > .ml5, .fpim .panel-heading > .btns .btn.ml5 { margin-left: 0; }
    .fpim .formRow.fluid { padding-left: 0; padding-right: 0; }
    .fpim .fpim-facet > summary.form-control { display: flex; align-items: center; justify-content: space-between; gap: 6px; height: 34px; padding: 6px 10px; border: 1px solid #ccc; font-size: 13px; background: #fff; }
    .fpim .fpim-facet .fpim-facet-value { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .fpim .fpim-facet.fpim-on > summary.form-control { border-color: #66afe9; background: #fff; }
    .fpim .fpim-facet > div { min-width: 100%; }
    .fpim .fpim-pager { margin-left: 0; display: inline-flex; }
    .fpim .panel-heading > .btn-warning { margin: 0; }
    .fpim .fpim-colpicker { list-style: none; padding: 0; margin: 0; max-height: 60vh; overflow: auto; border: 1px solid #ddd; }
    .fpim .fpim-colpicker li { display: flex; align-items: center; gap: 10px; padding: 6px 10px; border-bottom: 1px solid #eee; background: #fff; }
    .fpim .fpim-colpicker li.fpim-on { background: #f6fbf4; }
    .fpim .fpim-colpicker li.fpim-dragging { opacity: .5; }
    .fpim .fpim-colpicker label { flex: 1; margin: 0; font-weight: normal; cursor: pointer; }
    .fpim .fpim-colpicker .fpim-grip { cursor: grab; color: #aaa; }
    .fpim .fpim-mono { font-family: Consolas, monospace; font-size: 12px; }
    .fpim .fpim-catpick { font-weight: normal; margin: 2px 0; cursor: pointer; display: inline-block; }
    .fpim .fpim-pick { padding: 4px; cursor: pointer; }
    .fpim .fpim-pick.fpim-on { border-color: #3c8dbc; box-shadow: 0 0 0 2px #3c8dbc; }
    .fpim .fpim-compare { display: flex; gap: 16px; flex-wrap: wrap; }
    .fpim .fpim-compare figure { margin: 0; }
    .fpim .fpim-compare-box { width: 360px; height: 360px; border: 1px solid #ddd; display: flex; align-items: center; justify-content: center; }
    .fpim .fpim-compare-box img { max-width: 100%; max-height: 100%; object-fit: contain; }
    .fpim .fpim-crop { position: relative; display: inline-block; max-width: 100%; overflow: hidden; user-select: none; background: repeating-conic-gradient(#eee 0 25%, #fff 0 50%) 0 0 / 16px 16px; border: 1px solid #ddd; }
    .fpim .fpim-crop > img { display: block; max-width: 100%; max-height: 60vh; }
    .fpim .fpim-cropbox { position: absolute; border: 2px solid #3c8dbc; box-shadow: 0 0 0 9999px rgba(0,0,0,.45); cursor: move; touch-action: none; }
    .fpim .fpim-logo-preview { min-height: 60px; display: flex; align-items: center; gap: 10px; }
    .fpim .fpim-logo-preview img { max-width: 220px; max-height: 90px; object-fit: contain; border: 1px solid #eee; padding: 4px; background: #fff; }
    .fpim .fpim-croparea { display: flex; gap: 20px; align-items: flex-start; flex-wrap: wrap; }
    .fpim .fpim-croparea figure { margin: 0; }
    .fpim .fpim-croppreview { display: block; border: 1px solid #ddd; background: repeating-conic-gradient(#eee 0 25%, #fff 0 50%) 0 0 / 16px 16px; }
    .fpim .fpim-crop > img { max-height: 55vh; }
    .fpim .fpim-h { position: absolute; width: 14px; height: 14px; background: #fff; border: 2px solid #3c8dbc; }
    .fpim .fpim-h-nw { left: -8px; top: -8px; cursor: nwse-resize; }
    .fpim .fpim-h-ne { right: -8px; top: -8px; cursor: nesw-resize; }
    .fpim .fpim-h-sw { left: -8px; bottom: -8px; cursor: nesw-resize; }
    .fpim .fpim-h-se { right: -8px; bottom: -8px; cursor: nwse-resize; }
    .fpim .fpim-steps { list-style: none; padding: 0; margin: 10px 0; font-size: 14px; }
    .fpim .fpim-steps li { padding: 5px 0; }
    .fpim .fpim-steps .fpim-step-todo { color: #999; }
    .fpim .fpim-steps .fpim-step-now { font-weight: 600; }
    .fpim .fpim-pager .btn { margin-left: 0; }
    .fpim .fpim-pager .fpim-pageno { cursor: default; pointer-events: none; }
    .fpim .fpim-grid-table { width: 100%; margin: 0; }
    .fpim .fpim-grid-table td, .fpim .fpim-grid-table th { padding: 6px 6px; }
    .fpim .fpim-grid-table th.header { cursor: pointer; }
    .fpim .fpim-grid-table .fpim-tick { width: 34px; text-align: center; }
    .fpim .fpim-grid-table .fpim-tick input.form-control { width: 18px; height: 18px; margin: 0 auto; box-shadow: none; }
    .fpim-page > .fpim-selbar { margin-top: 0; }
    .fpim .panel-heading .btn-group.fpim-trees .btn { margin: 0; }
    .fpim .panel-heading .label { font-size: 11px; vertical-align: middle; }
    .fpim .fpim-cats { max-width: 1100px; margin-top: 4px; }
    .fpim .fpim-cats ul { list-style: none; margin: 0; padding: 0; }
    .fpim .fpim-cats ul ul { margin-left: 22px; padding-left: 16px; border-left: 2px solid #e6ebe4; }
    .fpim .fpim-cat { display: flex; align-items: center; gap: 10px; min-height: 48px; margin: 8px 0; padding: 6px 12px 6px 6px; background: #fff; border: 1px solid #dcdfe3; border-radius: 4px; box-shadow: 0 1px 2px rgba(0,0,0,.04); transition: border-color .15s ease, box-shadow .15s ease, background-color .15s ease; }
    .fpim .fpim-cat:hover { border-color: #b4c9ae; }
    .fpim .fpim-cat .fpim-grip { border: 0; background: none; color: #9aa1a8; padding: 6px 8px; cursor: grab; min-width: 32px; min-height: 32px; }
    .fpim .fpim-cat .fpim-grip:hover, .fpim .fpim-cat .fpim-grip:focus { color: #1f730c; }
    .fpim .fpim-cat .fpim-twisty { border: 0; background: none; color: #555; padding: 0; width: 26px; height: 32px; }
    .fpim .fpim-cat .fpim-twisty[disabled] { cursor: default; }
    .fpim .fpim-cat .fpim-folder { color: #1f730c; font-size: 16px; }
    .fpim .fpim-cat .fpim-name { font-weight: 600; font-size: 13px; cursor: pointer; }
    .fpim .fpim-cat .fpim-count { color: #6b7177; font-size: 12px; }
    .fpim .fpim-cat .fpim-grow { flex: 1; }
    .fpim .fpim-cat .fpim-cat-tools { display: flex; gap: 4px; opacity: .55; transition: opacity .15s ease; }
    .fpim .fpim-cat:hover .fpim-cat-tools, .fpim .fpim-cat:focus-within .fpim-cat-tools { opacity: 1; }
    .fpim .fpim-cat .fpim-cat-tools .fpim-ib { padding: 5px 9px; }
    .fpim .fpim-cat.fpim-dragging { opacity: .45; }
    .fpim .fpim-cat.fpim-drop-inside { border-color: #3c8dbc; background: #eef5fb; }
    .fpim .fpim-cat.fpim-drop-before { box-shadow: 0 -3px 0 #3c8dbc; }
    .fpim .fpim-cat.fpim-drop-after { box-shadow: 0 3px 0 #3c8dbc; }
    .fpim .fpim-cat-end { display: none; border: 2px dashed #c9d8e8; color: #555; text-align: center; padding: 14px; margin: 8px 0; }
    .fpim .fpim-dnd .fpim-cat-end { display: block; }
    .fpim .fpim-cat-end.fpim-over { border-color: #3c8dbc; background: #eef5fb; }
    .fpim .fpim-cats .fpim-node-edit { margin: -4px 0 10px 40px; max-width: 900px; }
    .fpim .fpim-node-edit .fpim-row { align-items: flex-start; }
    .fpim .fpim-syncrow { padding-top: 16px; padding-bottom: 6px; }
    .fpim .fpim-syncrow .fpim-stat { font-size: 18px; font-weight: 600; line-height: 1.3; }
    .fpim .fpim-syncrow .help-block { margin-top: 2px !important; text-align: left !important; }
    .fpim .fpim-syncrow .help-block[title] { cursor: help; }
    .fpim .fpim-issue { border: 1px solid #e3e3e3; margin-bottom: 6px; background: #fff; }
    .fpim .fpim-issue > summary { padding: 8px 10px; cursor: pointer; font-weight: 600; }
    .fpim .fpim-issue > .fpim-issue-body { padding: 0 10px 10px; }
    .fpim .fpim-part .fpim-kv { margin: 0 0 10px; }
    .fpim .fpim-colcount { color: #666; font-weight: normal; margin-left: 4px; }
    .fpim .fpim-colpresets { margin-left: 12px; }
    .fpim .fpim-colpresets .btn-link { padding: 0 6px; font-size: 12px; vertical-align: baseline; }
    .fpim .fpim-cols4 { columns: 4 200px; column-gap: 24px; }
    .fpim .fpim-colpick { display: flex; align-items: center; gap: 6px; font-weight: normal; margin: 0 0 6px; break-inside: avoid; cursor: pointer; }
    .fpim .fpim-colpick input { margin: 0; }
    .fpim .fpim-colpick.fpim-ro-col { color: #666; }
    .fpim .fpim-colpick .fa-lock { color: #aaa; font-size: 11px; }
    .fpim .panel-heading > .btns > span:first-child:not(:empty) { font-size: 12px; margin-right: 6px; }
    .fpim .fpim-sheet { position: relative; }
    .fpim select.fpim-cell { padding: 3px 4px; cursor: pointer; }
    .fpim .fpim-multi { position: absolute; z-index: 30; width: 340px; background: #fff; border: 1px solid #bbb; box-shadow: 0 6px 16px rgba(0,0,0,.15); padding: 8px; }
    .fpim .fpim-multi-list { max-height: 240px; overflow: auto; margin: 6px 0; }
    .fpim .fpim-multi-list label { display: flex; gap: 6px; font-weight: normal; font-size: 12px; margin: 3px 0; cursor: pointer; }
    .fpim .fpim-multi-foot { text-align: right; }
    .fpim .fpim-import { margin-bottom: 0; }
    .fpim .fpim-hot td { white-space: nowrap !important; overflow: hidden; text-overflow: ellipsis; max-width: 320px; }
    .fpim .fpim-hot { overflow: auto; max-height: 60vh; }
    .fpim .fpim-select, .fpim-modal .fpim-select { position: relative; }
    .fpim .fpim-select .selectize-input { min-height: 34px; cursor: text; }
    .fpim .fpim-select .selectize-input > input { border: 0; outline: 0; background: transparent; min-width: 60px; padding: 0; margin: 2px 0; }
    .fpim .fpim-select.single .selectize-input .item { padding-right: 18px; }
    .fpim .fpim-select.fpim-typing.single .selectize-input .item { display: none; }
    .fpim .fpim-select .selectize-dropdown { position: absolute; top: 100%; left: 0; right: 0; z-index: 1050; max-height: 300px; overflow: auto; }
    .fpim .fpim-select .selectize-dropdown .option, .fpim .fpim-select .selectize-dropdown .create { padding: 6px 10px; cursor: pointer; }
    .fpim .fpim-select .selectize-dropdown .active { background: #eef3f8; }
    .fpim .fpim-select .selectize-dropdown .fpim-none { color: #888; cursor: default; }
    .fpim .fpim-tile { border: 1px solid #dfe3e8; border-radius: 4px; background: #fff; margin-bottom: 12px; overflow: visible; transition: opacity .15s ease, filter .15s ease; }
    .fpim .fpim-tile-head { display: flex; align-items: center; gap: 10px; padding: 10px 14px; color: #fff; font-size: 15px; font-weight: 600; border-radius: 3px 3px 0 0; }
    .fpim .fpim-tile-head .fa { font-size: 18px; }
    .fpim .fpim-tile-name { flex: 1; }
    /* The three channel tiles side by side, all as tall as the tallest, their bands the same height. */
    .fpim .fpim-part[data-title="Channels"] { display: flex; flex-wrap: wrap; }
    .fpim .fpim-part[data-title="Channels"] > .fpim-part-title, .fpim .fpim-part[data-title="Channels"] > .clear { flex: 0 0 100%; }
    .fpim .fpim-part[data-title="Channels"] > .col-md-4 { display: flex; float: none; flex: 0 0 100%; }
    @media (min-width: 992px) { .fpim .fpim-part[data-title="Channels"] > .col-md-4 { flex-basis: 33.333%; } }
    .fpim .fpim-part[data-title="Channels"] .fpim-tile { flex: 1; display: flex; flex-direction: column; }
    .fpim .fpim-part[data-title="Channels"] .fpim-tile-body { flex: 1; }
    .fpim .fpim-tile-head { min-height: 56px; }
    .fpim .fpim-tile-name { white-space: nowrap; }
    .fpim .fpim-tile-web .fpim-tile-head { background: #2e8b3d; }
    .fpim .fpim-tile-google .fpim-tile-head { background: #1a73e8; }
    .fpim .fpim-tile-ebay .fpim-tile-head { background: #e8a200; }
    .fpim .fpim-tile-body { padding: 14px 4px 0; margin: 0; }
    .fpim .fpim-tile.fpim-off .fpim-tile-head { background: #9aa1a8; }
    .fpim .fpim-tile.fpim-off .fpim-tile-body { opacity: .55; }
    .fpim .fpim-switch { display: inline-flex; align-items: center; gap: 8px; margin: 0; cursor: pointer; font-weight: 600; }
    .fpim .fpim-switch input { position: absolute; opacity: 0; width: 1px; height: 1px; }
    .fpim .fpim-switch-track { position: relative; width: 40px; height: 22px; border-radius: 11px; background: rgba(255,255,255,.45); transition: background-color .15s ease; }
    .fpim .fpim-switch-track::after { content: ''; position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: transform .15s ease; box-shadow: 0 1px 2px rgba(0,0,0,.25); }
    .fpim .fpim-switch input:checked + .fpim-switch-track { background: rgba(255,255,255,.85); }
    .fpim .fpim-switch input:checked + .fpim-switch-track::after { transform: translateX(18px); background: #1f730c; }
    .fpim .fpim-switch input:focus-visible + .fpim-switch-track { outline: 2px solid #fff; outline-offset: 2px; }
    .fpim .fpim-switch-text { min-width: 24px; }
    .fpim .fpim-settings-tabs { margin-top: 10px; }
    .fpim .autocompleteEditor td { color: #333 !important; font-style: normal !important; background: #fff; cursor: pointer; padding: 3px 6px; }
    .fpim .autocompleteEditor td.current, .fpim .autocompleteEditor td:hover { background: #eef3f8; }
    .fpim .autocompleteEditor { box-shadow: 0 4px 10px rgba(0,0,0,.15); }
    .fpim .fpim-tile-head .fpim-switch-text { color: #fff; }
    .fpim .fpim-facet .fpim-facet-find { position: sticky; top: -6px; z-index: 1; margin: 0 0 6px; }
    .fpim .fpim-facet > div { min-width: 280px; }
  `)

  // ---------------------------------------------------------------- dom

  /** Build DOM without innerHTML: every title and description comes from a database. */
  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag)
    for (const [k, v] of Object.entries(attrs ?? {})) {
      if (v == null || v === false) continue
      // Media on the PIM's own disk comes as "/uploads/…": on a TradePeg page that would mean TradePeg's.
      if ((k === 'src' || k === 'href') && typeof v === 'string' && v.startsWith('/uploads/')) node.setAttribute(k, `${pimUrl()}${v}`)
      else if (k === 'value') node.value = v
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v)
      else node.setAttribute(k, v === true ? '' : v)
    }
    for (const child of children.flat(Infinity)) {
      if (child == null || child === false) continue
      node.append(child instanceof Node ? child : document.createTextNode(String(child)))
    }
    return node
  }
  /**
   * Replace a node's children. Unlike replaceChildren, skips null and false and
   * flattens lists — a browser would print "null" or "[object HTMLDivElement]".
   */
  const fill = (node, ...children) => node.replaceChildren(...children.flat(Infinity).filter((c) => c != null && c !== false).map((c) => (c instanceof Node ? c : document.createTextNode(String(c)))))
  const icon = (name) => el('i', { class: `fa ${name}`, 'aria-hidden': 'true' })
  const button = (label, onclick, cls = 'btn-default', attrs = {}) =>
    el('button', { type: 'button', class: `btn btn-sm ${cls}`, onclick, ...attrs }, label)
  /** A small icon button; its name is read out and shown on hover. */
  const iconButton = (name, label, onclick, attrs = {}) =>
    el('button', { type: 'button', class: 'btn btn-xs btn-default fpim-ib', title: label, 'aria-label': label, onclick, ...attrs }, icon(name))
  const clone = (value) => JSON.parse(JSON.stringify(value))
  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
  const when = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—')

  /** Keep TradePeg's keyboard shortcuts out of the way while typing in a PIM field. */
  const shieldKeys = (root) =>
    root.addEventListener('keydown', (event) => {
      // TradePeg's grid (Handsontable) needs its keys: Enter moves to the next cell, arrows move.
      if (event.target.closest?.('.handsontable, .handsontableInputHolder, .htAutocomplete')) return
      if (event.target.matches('input, textarea, select')) event.stopPropagation()
    })

  // ---------------------------------------------------------------- api

  // pim.farlamedical.co.uk was the default before the PIM had a home; a browser that saved it then
  // would otherwise keep asking an address that does not answer.
  const NEVER_LIVE = ['https://pim.farlamedical.co.uk']
  const pimUrl = () => {
    const saved = (GM_getValue(URL_KEY) || '').replace(/\/$/, '')
    return (saved && !NEVER_LIVE.includes(saved) ? saved : DEFAULT_PIM_URL).replace(/\/$/, '')
  }
  const hasToken = () => Boolean(GM_getValue(TOKEN_KEY))

  /**
   * One call to the PIM. `json` is sent as JSON, `form` (FormData) as multipart;
   * `blob` asks for a file back (exports, templates) as { blob, name }.
   */
  function request(method, path, { json, form, blob = false, timeout } = {}) {
    const token = GM_getValue(TOKEN_KEY)
    const headers = token ? { Authorization: `Bearer ${token}` } : {}
    if (json !== undefined) headers['Content-Type'] = 'application/json'
    return new Promise((resolve, reject) => {
      const failWith = (status, body) => {
        const error = new Error(body?.error?.message || `The PIM answered ${status}`)
        error.status = status
        error.body = body
        reject(error)
      }
      GM_xmlhttpRequest({
        method,
        url: `${pimUrl()}${path}`,
        headers,
        data: json !== undefined ? JSON.stringify(json) : form,
        responseType: blob ? 'blob' : undefined,
        anonymous: true,
        timeout: timeout ?? (form ? 180000 : 60000),
        async onload(response) {
          if (blob) {
            if (response.status >= 200 && response.status < 300) {
              const name = /filename="?([^";\n]+)/i.exec(response.responseHeaders || '')?.[1] || 'pim-export'
              return resolve({ blob: response.response, name })
            }
            let body = null
            try { body = JSON.parse(await response.response.text()) } catch { /* not JSON */ }
            return failWith(response.status, body)
          }
          let body = null
          try {
            body = JSON.parse(response.responseText)
          } catch {
            // A proxy or a stopped service answers with HTML; reported below.
          }
          if (response.status >= 200 && response.status < 300) return resolve(body)
          failWith(response.status, body)
        },
        onerror: () => reject(new Error(`Could not reach the PIM at ${pimUrl()}`)),
        ontimeout: () => reject(new Error('The PIM did not answer in time')),
      })
    })
  }

  const skuPath = (sku) => `/api/pim/sku/${encodeURIComponent(sku)}`
  const adminPath = (path) => `/api/pim/admin${path}`

  function saveFile({ blob, name }) {
    const url = URL.createObjectURL(blob)
    const a = el('a', { href: url, download: name, style: 'display:none' })
    document.body.append(a)
    a.click()
    setTimeout(() => { URL.revokeObjectURL(url); a.remove() }, 1000)
  }

  /** The settings form, shared by the tab and the PIM pages. */
  function settingsForm(onSaved, onBack) {
    const url = el('input', { class: 'form-control', value: pimUrl() })
    const token = el('input', { class: 'form-control', type: 'password', placeholder: hasToken() ? 'A token is saved — paste a new one to replace it' : 'Paste the Strapi API token' })
    return el(
      'div',
      { style: 'max-width: 560px; margin: 0 auto; text-align: left' },
      el('label', {}, 'PIM address'),
      url,
      el('label', { style: 'margin-top: 10px' }, 'API token'),
      token,
      el(
        'p',
        { class: 'help-block' },
        'Kept in this browser only. Ask whoever runs the PIM for a token. It needs Pim → lookup, update, upload, options and admin. With lookup alone everything is read-only.'
      ),
      button('Save', () => {
        GM_setValue(URL_KEY, url.value.trim() || DEFAULT_PIM_URL)
        if (token.value.trim()) GM_setValue(TOKEN_KEY, token.value.trim())
        onSaved()
      }, 'btn-primary'),
      onBack ? el('span', {}, ' ', button('Cancel', onBack)) : null
    )
  }

  // ================================================================ product tab

  /**
   * `data` is the product as the PIM last sent it; `base` and `draft` are its
   * editable fields in the tab's own shape — `base` as saved, `draft` as edited.
   * Save sends only what differs between them.
   */
  const state = { sku: '', data: null, base: null, draft: null, saving: false, readOnly: false, generation: 0, host: 'tab' }

  const fileId = (f) => f?.id ?? null

  function editable(data) {
    const p = data.product
    const own = (c) => (c && !c.inheritedFrom ? { id: c.id, path: c.path } : null)
    return {
      label: p.label ?? '',
      status: p.status,
      brand: p.brand ?? '',
      longDescription: p.longDescription ?? '',
      bullets: [...p.bullets],
      specs: p.specs.map((s) => ({ label: s.label, value: s.value })),
      contents: p.contents.map((c) => ({ item: c.item, qty: c.qty ?? 1 })),
      images: p.images.map((i) => ({ ...i })),
      videos: p.videos.map((v) => ({ title: v.title ?? '', url: v.url ?? '', file: v.file })),
      documentation: p.documentation.map((x) => ({ name: x.name ?? '', link: x.link ?? '', file: x.file })),
      categories: p.categories.map((c) => ({ id: c.id, path: c.path })),
      tags: [...p.tags],
      channelWeb: p.channels.web,
      seoTitle: p.seoTitle ?? '',
      seoDescription: p.seoDescription ?? '',
      channelGoogle: p.channels.google,
      googleCategory: own(p.googleCategory),
      channelEbay: p.channels.ebay,
      ebayItemNumber: p.ebayItemNumber ?? '',
      ebayCategory: own(p.ebayCategory),
      variationTypes: p.variationTypes.map((t) => ({ id: t.id, name: t.name })),
      // The fields made in Settings, as their boxes hold them ('' for empty).
      custom: Object.fromEntries((p.customFields ?? []).map((f) => [f.key, p.custom?.[f.key] ?? ''])),
      variants: Object.fromEntries(
        data.variants.map((v) => [v.documentId, { labelOverride: v.labelOverride ?? '', values: { ...v.values }, images: v.images.map((i) => ({ ...i })) }])
      ),
    }
  }

  function setData(data) {
    state.data = data
    state.base = editable(data)
    state.draft = clone(state.base)
  }

  /** What changed, in the shape PUT /api/pim/sku/:sku takes. */
  function changes() {
    const { base, draft } = state
    const patch = {}
    const plain = ['label', 'status', 'brand', 'longDescription', 'seoTitle', 'seoDescription', 'ebayItemNumber', 'channelWeb', 'channelGoogle', 'channelEbay', 'tags']
    for (const k of plain) if (!same(base[k], draft[k])) patch[k] = draft[k]
    const lists = {
      bullets: (l) => l.map((b) => b.trim()).filter(Boolean),
      specs: (l) => l.filter((s) => s.label.trim() && String(s.value).trim()),
      contents: (l) => l.filter((c) => c.item.trim()).map((c) => ({ item: c.item, qty: Number(c.qty) || 1 })),
      videos: (l) => l.filter((v) => v.url.trim() || v.file).map((v) => ({ title: v.title, url: v.url, file: fileId(v.file) })),
      documentation: (l) => l.filter((x) => x.link.trim() || x.file).map((x) => ({ name: x.name, link: x.link, file: fileId(x.file) })),
    }
    for (const [k, tidy] of Object.entries(lists)) if (!same(tidy(base[k]), tidy(draft[k]))) patch[k] = tidy(draft[k])
    const ids = (list) => list.map((x) => x.id)
    for (const k of ['categories', 'images', 'variationTypes']) if (!same(ids(base[k]), ids(draft[k]))) patch[k] = ids(draft[k])
    for (const k of ['googleCategory', 'ebayCategory']) if (!same(base[k]?.id, draft[k]?.id)) patch[k] = draft[k]?.id ?? null
    const custom = Object.fromEntries(Object.entries(draft.custom ?? {}).filter(([k, v]) => String(v ?? '') !== String(base.custom?.[k] ?? '')).map(([k, v]) => [k, v === '' ? null : v]))
    if (Object.keys(custom).length) patch.custom = custom
    const variants = {}
    for (const [id, v] of Object.entries(draft.variants)) {
      const was = base.variants[id]
      const edit = {}
      if (v.labelOverride.trim() !== was.labelOverride.trim()) edit.labelOverride = v.labelOverride
      if (!same(ids(v.images), ids(was.images))) edit.images = ids(v.images)
      const values = Object.fromEntries(Object.entries(v.values).filter(([type, value]) => (value ?? '').trim() !== (was.values[type] ?? '').trim()))
      if (Object.keys(values).length) edit.values = values
      if (Object.keys(edit).length) variants[id] = edit
    }
    if (Object.keys(variants).length) patch.variants = variants
    return patch
  }

  const isDirty = () => Boolean(state.draft) && Object.keys(changes()).length > 0

  // Leaving the page with unsaved edits asks first. (TradePeg's in-place page
  // swaps cannot be stopped; the Save bar says when there is something to save.)
  window.addEventListener('beforeunload', (event) => {
    if (!isDirty()) return
    event.preventDefault()
    event.returnValue = ''
  })

  // Ctrl/Cmd+S saves the open parent, as in Farla Tools (not inside TradePeg's grid: it has its own keys).
  window.addEventListener(
    'keydown',
    (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key?.toLowerCase() !== 's') return
      if (!state.draft || state.readOnly || !body?.isConnected) return
      if (event.target.closest?.('.handsontable, .handsontableInputHolder, .htAutocomplete')) return
      event.preventDefault()
      event.stopPropagation()
      if (isDirty() && !state.saving) void save()
    },
    true
  )

  let pane = null
  /** Where the editor draws: the parent's PIM page. */
  let body = null
  let saveBar = null
  let tabHost = null // the editor no longer lives in a product tab; kept null

  function productReference() {
    // The read-only "SKU" field on the Details tab — the same field 04 reads.
    for (const help of document.querySelectorAll('#tab_details .help-block')) {
      if (help.textContent.trim() !== 'SKU') continue
      const value = help.parentElement?.querySelector('.form-control')?.textContent.trim()
      if (value) return value
    }
    return document.title.trim()
  }

  function showState(...children) {
    paintSaveBar()
    fill(body, el('div', { class: 'fpim-state' }, ...children))
  }

  function showSettings(message) {
    showState(message ? el('p', {}, message) : null, settingsForm(() => void load(), state.data ? () => render() : null))
  }

  /** Load a product: by default the TradePeg product on screen, or in PIM tools the one being edited. */
  async function load(sku) {
    if (isDirty() && !confirm('Throw away your unsaved PIM changes and reload?')) return
    const mine = ++state.generation
    if (!hasToken()) return showSettings('The PIM needs an API token once on this computer.')
    state.sku = sku ?? (state.host === 'tools' ? state.sku : productReference())
    Object.assign(state, { data: null, base: null, draft: null })
    showState(icon('fa-spinner fa-spin'), ` Loading ${state.sku} from the PIM…`)
    try {
      const data = await request('GET', skuPath(state.sku))
      if (mine !== state.generation) return
      setData(data)
      render()
      void checkPricing()
    } catch (error) {
      if (mine !== state.generation) return
      if (error.status === 401 || error.status === 403) return showSettings('The PIM refused the token. Paste a new one.')
      if (error.status === 404) {
        return showState(
          el('p', {}, el('strong', {}, state.sku), ' is not in the PIM yet.'),
          el('p', {}, 'Only SELECT items are synced. If it was tagged SELECT in the last half hour, resync from PIM → TradePeg sync.'),
          button('Go to TradePeg sync', () => openTools('sync'))
        )
      }
      showState(icon('fa-exclamation-triangle'), ` ${error.message} `, button('Try again', () => void load()))
    }
  }

  // ---------------------------------------------------------------- saving

  let message = null

  function say(kind, ...text) {
    message?.remove()
    message = el('div', { class: `alert alert-${kind} fpim-message` }, ...text)
    body.prepend(message)
    message.scrollIntoView({ block: 'nearest' })
  }

  function paintSaveBar() {
    paintFloatingSave()
    if (!saveBar) return
    if (!state.draft || state.readOnly) return fill(saveBar, )
    const dirty = isDirty()
    fill(saveBar, 
      dirty ? el('span', { class: 'fpim-dirty' }, 'Unsaved changes') : null,
      el(
        'div',
        { class: 'btn-group', style: 'margin-right: 6px' },
        dirty ? el('a', { class: 'btn btn-default btn-sm', href: '#', onclick: (e) => { e.preventDefault(); discard() } }, 'Discard') : null,
        el(
          'a',
          { class: `btn btn-success btn-sm${dirty && !state.saving ? '' : ' disabled'}`, href: '#', onclick: (e) => { e.preventDefault(); void save() } },
          state.saving ? icon('fa-spinner fa-spin') : icon('fa-check'),
          state.saving ? ' Saving…' : ' Save'
        )
      )
    )
  }

  /**
   * A long product scrolls the Save button out of sight: while there is
   * something to save, a bar at the bottom of the window says so and saves.
   */
  function paintFloatingSave() {
    let bar = document.getElementById('fpim-savebar')
    const show = Boolean(state.draft) && !state.readOnly && body?.isConnected && isDirty()
    if (!show) return bar?.remove()
    if (!bar) {
      bar = el('div', { id: 'fpim-savebar', class: 'fpim', role: 'region', 'aria-label': 'Unsaved PIM changes' })
      document.body.append(bar)
    }
    fill(bar, 
      el('span', { class: 'fpim-dirty' }, `Unsaved changes to ${state.data?.product.sku ?? 'this product'}`),
      button('Discard', () => discard()),
      button(state.saving ? [icon('fa-spinner fa-spin'), ' Saving…'] : [icon('fa-check'), ' Save'], () => void save(), 'btn-success', { disabled: state.saving })
    )
  }

  const changed = () => paintSaveBar()

  function discard() {
    state.draft = clone(state.base)
    render()
  }

  /** Save the draft. Resolves true when it is saved (or there was nothing to save). */
  async function save() {
    const patch = changes()
    if (!Object.keys(patch).length) return true
    if (state.saving) return false
    if ('label' in patch && !patch.label.trim()) {
      say('danger', 'The website title cannot be empty.')
      return false
    }
    state.saving = true
    paintSaveBar()
    const mine = state.generation
    try {
      const data = await request('PUT', skuPath(state.data.product.sku), { json: { ...patch, updatedAt: state.data.product.updatedAt } })
      if (mine !== state.generation) return false
      setData(data)
      render()
      say('success', 'Saved. The website picks it up within a minute or two.')
      log('saved', state.data.product.sku, Object.keys(patch))
      return true
    } catch (error) {
      if (mine !== state.generation) return false
      if (error.status === 403) {
        state.readOnly = true
        render()
        say('warning', 'This computer’s PIM token can only look products up, so the tab is now read-only. Ask for one with Pim → update ticked, and paste it under Settings.')
      } else if (error.status === 409) {
        say('warning', error.message, ' ', button('Reload', () => void load()))
      } else {
        say('danger', `Not saved: ${error.message}`)
      }
      return false
    } finally {
      if (mine === state.generation) {
        state.saving = false
        paintSaveBar()
      }
    }
  }

  /**
   * Upload files straight to the PIM (`to`: images | document | video |
   * variant:<id>). They are saved at once; any other edit in progress is kept.
   */
  async function uploadFiles(to, files) {
    if (!files.length) return
    const form = new FormData()
    for (const file of files) form.append('files', file, file.name)
    const mine = state.generation
    say('info', icon('fa-spinner fa-spin'), ` Uploading ${plural(files.length, 'file')}…`)
    try {
      const data = await request('POST', `${skuPath(state.data.product.sku)}/files?to=${encodeURIComponent(to)}`, { form })
      if (mine !== state.generation) return
      const before = state.base
      const draft = state.draft
      setData(data)
      const after = state.base
      // What the upload added, appended to the edit in progress.
      const newIds = (list, old) => list.filter((x) => !old.some((o) => fileId(o.file ?? o) === fileId(x.file ?? x)))
      if (to === 'images') draft.images.push(...newIds(after.images, before.images))
      else if (to === 'document') draft.documentation.push(...newIds(after.documentation, before.documentation))
      else if (to === 'video') draft.videos.push(...newIds(after.videos, before.videos))
      else {
        const id = to.slice(8)
        draft.variants[id].images.push(...newIds(after.variants[id].images, before.variants[id].images))
      }
      state.draft = draft
      render()
      say('success', `Uploaded ${plural(files.length, 'file')}.`)
    } catch (error) {
      if (mine !== state.generation) return
      say('danger', error.status === 403 ? 'This computer’s PIM token cannot upload (Pim → upload).' : `Upload failed: ${error.message}`)
    }
  }

  function uploadButton(label, to, accept, cls = 'btn-primary') {
    const input = el('input', { type: 'file', accept, multiple: true, style: 'display:none' })
    input.addEventListener('change', () => {
      void uploadFiles(to, [...input.files])
      input.value = ''
    })
    return el('span', {}, input, button(label, () => input.click(), cls))
  }

  /** Open the preview; `variantId` previews the parent with that variant chosen. */
  async function preview(variantId) {
    if (isDirty()) {
      if (!confirm('The preview shows the product as last saved. Save your changes first?')) return
      if (!(await save())) return
    }
    // Read after any save: it brings fresh signed links.
    const { product, variants } = state.data
    const url = variantId ? variants.find((v) => v.documentId === variantId)?.previewUrl : product.previewUrl
    window.open(url ?? product.previewUrl, '_blank', 'noopener')
  }

  // ---------------------------------------------------------------- controls

  /**
   * A field the way TradePeg lays them out: the control, its label underneath,
   * in a Bootstrap column. `top` puts the label above instead, for lists and
   * questions. A hint shows on hovering the label, not as more text.
   */
  function field(label, control, help, cols = 12, { top = false } = {}) {
    const name = el('div', { class: `help-block${top ? ' fpim-label-top' : ''}`, title: help || null }, label)
    return el('div', { class: `col-md-${cols} fpim-field` }, top ? name : null, control, top ? null : name)
  }

  /** A value from TradePeg, shown as TradePeg shows its own read-only fields: changed there, not here. */
  function readOnly(label, value, help, cols = 12) {
    return field(
      label,
      el('div', { class: 'form-control fpim-ro-box', title: 'From TradePeg — change it there' }, el('span', {}, value ?? '—'), icon('fa-lock text-muted')),
      help ?? 'From TradePeg',
      cols
    )
  }

  function text(obj, key, { multiline = false, rows = 3, placeholder, max } = {}) {
    const input = el(multiline ? 'textarea' : 'input', {
      class: 'form-control',
      rows: multiline ? rows : null,
      placeholder,
      maxlength: max,
      disabled: state.readOnly,
      value: obj[key] ?? '',
    })
    input.addEventListener('input', () => {
      obj[key] = input.value
      changed()
    })
    return input
  }

  function toggle(key, label) {
    const box = el('input', { type: 'checkbox', disabled: state.readOnly })
    box.checked = Boolean(state.draft[key])
    box.addEventListener('change', () => {
      state.draft[key] = box.checked
      changed()
    })
    return el('div', { class: 'checkbox', style: 'margin: 0 0 8px' }, el('label', {}, box, ' ', label))
  }

  /**
   * A search box over one of the PIM's lists (GET /api/pim/options/:kind).
   * `allowNew` offers what was typed as a new name.
   */
  function picker({ kind, placeholder, allowNew = false, onPick }) {
    const input = el('input', { class: 'form-control', placeholder, autocomplete: 'off', spellcheck: 'false', disabled: state.readOnly })
    const list = el('ul', { class: 'fpim-options', style: 'display:none' })
    let items = []
    let hi = 0
    let timer = null
    let asked = 0

    const close = () => { list.style.display = 'none' }
    const choose = (item) => {
      input.value = ''
      close()
      onPick(item)
    }
    const paint = () => {
      fill(list, 
        ...items.map((item, i) =>
          el(
            'li',
            { class: i === hi ? 'fpim-hi' : null, onmousedown: (e) => { e.preventDefault(); choose(item) } },
            item.isNew ? `Add “${item.name}”` : item.path ?? item.name,
            item.code ? el('span', { class: 'text-muted' }, ` (${item.code})`) : null
          )
        )
      )
      if (!items.length) list.append(el('li', { class: 'fpim-note' }, 'Nothing matches'))
      list.style.display = ''
    }
    const search = async () => {
      const q = input.value.trim()
      const mine = ++asked
      try {
        const found = await request('GET', `/api/pim/options/${kind}?q=${encodeURIComponent(q)}&limit=30`)
        if (mine !== asked) return
        items = found
        if (allowNew && q && !found.some((f) => (f.name ?? '').toLowerCase() === q.toLowerCase())) items = [{ name: q, isNew: true }, ...found]
        hi = 0
        paint()
      } catch (error) {
        if (mine !== asked) return
        fill(list, el('li', { class: 'fpim-note' }, error.status === 403 ? 'This token cannot search the PIM’s lists (Pim → options).' : error.message))
        list.style.display = ''
      }
    }
    input.addEventListener('input', () => {
      clearTimeout(timer)
      timer = setTimeout(search, 200)
    })
    input.addEventListener('focus', () => void search())
    input.addEventListener('blur', () => setTimeout(close, 150))
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        hi = Math.max(0, Math.min(items.length - 1, hi + (e.key === 'ArrowDown' ? 1 : -1)))
        paint()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (items[hi]) choose(items[hi])
      } else if (e.key === 'Escape') {
        close()
      }
    })
    return el('div', { class: 'fpim-picker' }, input, list)
  }

  /**
   * A dropdown to type in, the way TradePeg's own are (selectize): typing
   * filters the list, and what is chosen sits inside the box — one value, or
   * several each with ×. Items are { id?, name, path?, code? }; `value` is an
   * item or null, or a list when `multiple`. `onChange` gets the new value;
   * `exclude` names never offered (a brand that is the manufacturer).
   */
  function selectBox({ kind, multiple = false, value, allowNew = false, placeholder = '', max = Infinity, exclude = [], short = null, onChange, disabled = state.readOnly }) {
    const chosen = multiple ? [...(value ?? [])] : value ? [value] : []
    const text = (x) => x.path ?? x.name ?? ''
    const isChosen = (o) => chosen.some((c) => (c.id && o.id ? c.id === o.id : text(c).toLowerCase() === text(o).toLowerCase()))
    const barred = new Set(exclude.filter(Boolean).map((x) => x.toLowerCase()))
    const input = el('input', { type: 'text', autocomplete: 'off', spellcheck: 'false', disabled, 'aria-label': placeholder || kind, role: 'combobox', 'aria-autocomplete': 'list' })
    const box = el('div', { class: 'selectize-input items' })
    const content = el('div', { class: 'selectize-dropdown-content', role: 'listbox' })
    const drop = el('div', { class: `selectize-dropdown ${multiple ? 'multi' : 'single'}`, style: 'display:none' }, content)
    const root = el('div', { class: `selectize-control ${multiple ? 'multi' : 'single'} plugin-remove_button fpim-select` }, box, drop)
    let items = []
    let hi = 0
    let asked = 0
    let timer = null

    const commit = () => onChange(multiple ? [...chosen] : chosen[0] ?? null)
    function paintBox() {
      const full = chosen.length >= (multiple ? max : 1)
      fill(
        box,
        chosen.map((x, i) =>
          el(
            'div',
            { class: 'item', 'data-value': x.id ?? text(x), title: short ? text(x) : null },
            short ? short(x) : text(x),
            x.code ? el('span', { class: 'text-muted' }, ` (${x.code})`) : null,
            disabled ? null : el('a', { href: '#', class: 'remove', tabindex: '-1', title: `Remove ${text(x)}`, 'aria-label': `Remove ${text(x)}`, onmousedown: (e) => e.preventDefault(), onclick: (e) => { e.preventDefault(); e.stopPropagation(); chosen.splice(i, 1); paintBox(); commit() } }, '×')
          )
        ),
        input
      )
      box.classList.toggle('has-items', chosen.length > 0)
      box.classList.toggle('full', full && multiple)
      box.classList.toggle('disabled', Boolean(disabled))
      input.placeholder = chosen.length ? '' : placeholder
      // Single: typing hides the current value until something else is picked.
      root.classList.toggle('fpim-typing', !multiple && Boolean(input.value))
      input.style.display = multiple && full ? 'none' : ''
    }
    const close = () => {
      drop.style.display = 'none'
      box.classList.remove('dropdown-active')
    }
    function paintList() {
      fill(
        content,
        items.map((o, i) =>
          el(
            'div',
            { class: `${o.isNew ? 'create' : 'option'}${i === hi ? ' active' : ''}`, role: 'option', 'aria-selected': String(i === hi), onmousedown: (e) => { e.preventDefault(); choose(o) } },
            o.isNew ? ['Add ', el('strong', {}, o.name), '…'] : [text(o), o.code ? el('span', { class: 'text-muted' }, ` (${o.code})`) : null]
          )
        ),
        items.length ? null : el('div', { class: 'option fpim-none' }, 'Nothing matches')
      )
      drop.style.display = ''
      box.classList.add('dropdown-active')
    }
    async function search() {
      const q = input.value.trim()
      const mine = ++asked
      try {
        const found = await request('GET', `/api/pim/options/${kind}?q=${encodeURIComponent(q)}&limit=50`)
        if (mine !== asked || document.activeElement !== input) return
        items = found.filter((o) => !isChosen(o) && !barred.has(text(o).toLowerCase()))
        if (allowNew && q && !barred.has(q.toLowerCase()) && !found.some((o) => text(o).toLowerCase() === q.toLowerCase()) && !isChosen({ name: q })) items.unshift({ name: q, isNew: true })
        hi = 0
        paintList()
      } catch (error) {
        if (mine !== asked) return
        fill(content, el('div', { class: 'option fpim-none' }, error.status === 403 ? 'This token cannot search the PIM’s lists (Pim → options).' : error.message))
        drop.style.display = ''
      }
    }
    function choose(o) {
      const item = o.isNew ? { name: o.name, isNew: true } : o
      if (multiple) chosen.push(item)
      else chosen.splice(0, chosen.length, item)
      input.value = ''
      paintBox()
      commit()
      if (multiple && chosen.length < max) {
        input.focus()
        void search()
      } else {
        close()
        input.blur()
      }
    }

    input.addEventListener('input', () => {
      root.classList.toggle('fpim-typing', !multiple && Boolean(input.value))
      clearTimeout(timer)
      timer = setTimeout(search, 150)
    })
    input.addEventListener('focus', () => {
      box.classList.add('focus', 'input-active')
      void search()
    })
    input.addEventListener('blur', () => {
      box.classList.remove('focus', 'input-active')
      setTimeout(() => {
        close()
        input.value = ''
        root.classList.remove('fpim-typing')
      }, 150)
    })
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        hi = Math.max(0, Math.min(items.length - 1, hi + (e.key === 'ArrowDown' ? 1 : -1)))
        paintList()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (items[hi]) choose(items[hi])
      } else if (e.key === 'Escape') {
        close()
      } else if (e.key === 'Backspace' && !input.value && multiple && chosen.length) {
        chosen.pop()
        paintBox()
        commit()
      }
    })
    box.addEventListener('mousedown', (e) => {
      if (disabled || e.target === input || e.target.closest('.remove')) return
      e.preventDefault()
      input.focus()
    })
    paintBox()
    return root
  }

  /** A part of the form that redraws itself when rows are added, removed or picked. */
  function block(build) {
    const holder = el('div')
    const draw = () => fill(holder, ...[build(redraw)].flat().filter(Boolean))
    const redraw = () => {
      draw()
      changed()
    }
    draw()
    return holder
  }

  const move = (list, i, by) => {
    const j = i + by
    if (j < 0 || j >= list.length) return false
    list.splice(j, 0, ...list.splice(i, 1))
    return true
  }

  /** Rows of inputs with Up / Down / Remove and an Add button. */
  function rows(list, { make, blank, addLabel, extra }) {
    return block((redraw) => [
      ...list.map((row, i) =>
        el(
          'div',
          { class: 'fpim-row' },
          make(row, i),
          state.readOnly
            ? null
            : el(
                'div',
                { class: 'btn-group fpim-row-tools' },
                iconButton('fa-arrow-up', 'Move up', () => move(list, i, -1) && redraw(), { disabled: i === 0 }),
                iconButton('fa-arrow-down', 'Move down', () => move(list, i, 1) && redraw(), { disabled: i === list.length - 1 }),
                iconButton('fa-times', 'Remove', () => { list.splice(i, 1); redraw() })
              )
        )
      ),
      state.readOnly ? null : el('div', {}, button(`+ ${addLabel}`, () => { list.push(blank()); redraw() }), extra ? [' ', extra] : null),
    ])
  }

  function rowInput(row, key, attrs = {}) {
    const input = el('input', { class: `form-control ${attrs.class ?? ''}`, placeholder: attrs.placeholder, type: attrs.type, min: attrs.min, disabled: state.readOnly || attrs.disabled, value: row[key] ?? '' })
    input.addEventListener('input', () => {
      row[key] = input.value
      changed()
    })
    return input
  }

  /** A row of pictures with Left / Right / Remove; the first is the thumbnail. */
  function pictures(list, { small = false } = {}) {
    return block((redraw) =>
      list.length
        ? el(
            'div',
            { class: 'fpim-images' },
            list.map((img, i) =>
              el(
                'div',
                { class: `fpim-image${small ? ' fpim-small' : ''}` },
                el('a', { href: img.url, target: '_blank', rel: 'noreferrer' }, el('img', { src: img.thumb, alt: img.alt ?? '' })),
                i === 0 ? el('div', { class: 'fpim-first' }, 'Thumbnail') : el('div', { class: 'fpim-help' }, `#${i + 1}`),
                state.readOnly
                  ? null
                  : el(
                      'div',
                      { class: 'btn-group' },
                      iconButton('fa-arrow-left', 'Move left', () => move(list, i, -1) && redraw(), { disabled: i === 0 }),
                      iconButton('fa-arrow-right', 'Move right', () => move(list, i, 1) && redraw(), { disabled: i === list.length - 1 }),
                      iconButton('fa-times', 'Remove', () => { list.splice(i, 1); redraw() })
                    )
              )
            )
          )
        : el('p', { class: 'text-muted', style: 'margin:0 0 6px' }, 'No pictures yet.')
    )
  }

  /** A group of fields as TradePeg's Details tab draws one: a purple title, then columns. */
  function section(title, ...children) {
    const cells = children.flat(Infinity).filter(Boolean).map((c) => (/\bcol-md-/.test(c.className ?? '') ? c : el('div', { class: 'col-md-12' }, c)))
    return el('div', { class: 'formRow fpim-part', 'data-title': title }, el('div', { class: 'help-block fpim-part-title' }, `${title}:`), cells, el('div', { class: 'clear' }))
  }

  /** Buttons that jump to each section: a parent with 80 variants is a long page. */
  function jumpLinks(sections) {
    return el(
      'div',
      { class: 'fpim-jump', role: 'navigation', 'aria-label': 'Sections' },
      sections.map((sec) => button(sec.dataset.title, () => sec.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })))
    )
  }

  // ---------------------------------------------------------------- render

  function render() {
    message = null
    const p = state.data.product
    paintSaveBar()
    fill(body, 
      p.archived
        ? el('div', { class: 'alert alert-danger fpim-message' }, 'Archived: none of this product’s SKUs are in TradePeg’s SELECT range any more, so it is not on the website.')
        : null,
      el('div', { class: 'fpim-editor' }, summaryBox(p), mainColumn(p))
    )
  }

  function mainColumn(p) {
    const variants = variantsSection()
    const sections = [productSection(), contentSection(), moreFieldsSection(p), mediaSection(), classificationSection(), channelsSection(p)].filter(Boolean)
    const all = [...sections, variants]
    return el('div', {}, jumpLinks(all), sections, variants)
  }

  /** Where each completeness check is fixed, so a missing item jumps there. */
  const FIX_IN = {
    'website title': 'Product',
    description: 'Content',
    specs: 'Content',
    images: 'Media',
    category: 'Classification',
    'SEO title': 'Channels',
    'SEO description': 'Channels',
    'variation values': 'Variants',
  }

  /** The top row, as TradePeg shows values (value, label underneath): how complete, what is left, where listed, Preview. */
  function summaryBox(p) {
    const colour = p.completeness >= 80 ? '#3c763d' : p.completeness >= 50 ? '#8a6d3b' : '#a94442'
    const jump = (name) => {
      const sec = [...body.querySelectorAll('.fpim-part')].find((x) => x.dataset.title.startsWith(FIX_IN[name]))
      sec?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
    }
    const stat = (cls, value, label, extra = {}) => el('div', { class: `fpim-statcell ${cls}` }, el('div', { class: 'fpim-stat', ...extra }, value), el('div', { class: 'help-block' }, label))
    return el(
      'div',
      { class: 'fpim-summary', role: 'region', 'aria-label': 'Completeness' },
      stat('fpim-score-cell', `${p.completeness}%`, 'Complete', { style: `color:${colour}`, title: 'As last saved' }),
      stat(
        'fpim-grow',
        p.missing.length
          ? p.missing.map((m, i) => [i ? ' · ' : '', FIX_IN[m] ? el('a', { href: '#', onclick: (e) => { e.preventDefault(); jump(m) }, title: `Go to ${FIX_IN[m]}` }, m) : el('span', { class: 'text-muted', title: 'Fixed in TradePeg' }, `${m} (TradePeg)`)])
          : el('span', { class: 'text-success' }, icon('fa-check'), ' Nothing'),
        'Still to do'
      ),
      stat('', ['web', 'google', 'ebay'].map((c) => el('span', { class: `label ${p.channels[c] ? 'label-success' : 'label-default'}`, style: 'margin-right:4px' }, c)), 'Listed on', { title: 'Google and eBay take only products marked Ready' }),
      el(
        'div',
        { class: 'fpim-statcell' },
        button([icon('fa-eye'), ' Preview'], () => void preview(), 'btn-primary'),
        p.slug ? el('a', { class: 'btn btn-default btn-sm', style: 'margin-left:4px', href: `${WEBSITE_URL}${p.slug}`, target: '_blank', rel: 'noreferrer', title: 'Open it on the website' }, icon('fa-globe')) : null
      ),
      el('div', { class: 'clear' })
    )
  }

  function productSection() {
    const d = state.draft
    const p = state.data.product
    // Status: Ready is greyed out while the parent cannot be Ready (variants, prices), the reason underneath.
    const readyOption = el('option', { value: 'ready' }, 'Ready')
    const status = el('select', { class: 'form-control', disabled: state.readOnly }, el('option', { value: 'draft' }, 'Draft'), readyOption)
    status.value = d.status
    status.addEventListener('change', () => {
      d.status = status.value
      changed()
    })
    const badge = el('span')
    const statusLabel = el('div', { class: 'help-block' }, 'Status')
    const statusNote = el('div', { class: 'fpim-help text-warning fpim-ready-note' })
    const paintStatus = () => {
      if (!status.isConnected && state.paintStatus !== paintStatus) return
      const block = readyBlock()
      readyOption.disabled = Boolean(block) && d.status !== 'ready'
      const hint = block && d.status !== 'ready' ? block : 'Ready sends it to Google and eBay'
      status.title = statusLabel.title = hint
      fill(statusNote, block && d.status !== 'ready' ? block : null)
      const pr = state.pricing?.sku === p.sku ? state.pricing : null
      fill(badge, pr?.state === 'ok' ? pricingBadge(pr.units, pr.priced) : null)
    }
    state.paintStatus = paintStatus
    paintStatus()
    const statusField = el('div', { class: 'col-md-2 fpim-field' }, el('div', { class: 'fpim-row', style: 'margin:0' }, status, badge), statusLabel, statusNote)

    // Website title, with an AI suggestion from the parts' TradePeg titles (put in the box, not saved).
    const title = text(d, 'label', { placeholder: 'What the website calls this product' })
    const suggest = button([icon('fa-magic'), ' Suggest'], async () => {
      suggest.disabled = true
      fill(suggest, icon('fa-spinner fa-spin'), ' Suggest')
      try {
        const [r] = (await request('POST', adminPath('/ai/titles/suggest'), { json: { ids: [p.documentId] }, timeout: 120000 })) ?? []
        if (!r?.suggestion) toast('info', 'The AI had no title to suggest.')
        else if (title.isConnected) {
          d.label = title.value = r.suggestion
          changed()
          toast('success', 'Title suggested — check it, then Save.')
        }
      } catch (error) {
        toast('danger', error.status === 403 ? 'AI suggestions need a token with Pim → admin.' : error.message)
      } finally {
        suggest.disabled = state.readOnly
        fill(suggest, icon('fa-magic'), ' Suggest')
      }
    }, 'btn-default', { disabled: state.readOnly, title: 'Suggest a website title with AI (not saved until you Save)' })
    const titleBox = el('div', { class: 'input-group' }, title, el('span', { class: 'input-group-btn' }, suggest))

    const maker = state.data.product.manufacturer?.name ?? state.data.product.manufacturer ?? ''
    const brand = selectBox({
      kind: 'brands',
      value: d.brand ? { name: d.brand } : null,
      allowNew: true,
      placeholder: 'Choose or type a brand',
      // A brand is never the manufacturer's own name.
      exclude: [typeof maker === 'string' ? maker : ''],
      onChange: (b) => {
        d.brand = b?.name ?? ''
        changed()
      },
    })
    return section(
      'Product',
      field('Website title', titleBox, null, 6),
      statusField,
      field('Brand', brand, 'The brand customers see. A new name is added to the brand list. Never the manufacturer.', 4),
      readOnly('SKU', p.sku, null, 4),
      readOnly('Manufacturer', maker || null, null, 4),
      readOnly('Department', p.farlaBranded ? 'Farla Branded' : 'Other Branded', null, 4)
    )
  }

  /** The fields made in Settings → Product fields, each as its kind needs. */
  function moreFieldsSection(p) {
    const fields = p.customFields ?? []
    if (!fields.length) return null
    const d = state.draft
    const control = (f) => {
      const set = (v) => { d.custom[f.key] = v; changed() }
      const v = d.custom[f.key]
      if (f.type === 'yesno' || f.type === 'choice') {
        const options = f.type === 'yesno' ? [['', '—'], [true, 'Yes'], [false, 'No']] : [['', '—'], ...(f.options ?? []).map((o) => [o, o])]
        const select = el('select', { class: 'form-control', disabled: state.readOnly }, options.map(([value, label]) => el('option', { value: String(value) }, label)))
        select.value = String(v)
        select.addEventListener('change', () => set(f.type === 'yesno' ? (select.value === '' ? '' : select.value === 'true') : select.value))
        return select
      }
      if (f.type === 'long') {
        const area = el('textarea', { class: 'form-control', rows: 3, disabled: state.readOnly })
        area.value = v ?? ''
        area.addEventListener('input', () => set(area.value))
        return area
      }
      const input = el('input', { class: 'form-control', disabled: state.readOnly, type: { number: 'number', date: 'date', link: 'url' }[f.type] ?? 'text', value: v ?? '', placeholder: f.type === 'link' ? 'https://…' : '' })
      if (f.type === 'number') input.step = 'any'
      input.addEventListener('input', () => set(input.value))
      return input
    }
    return section('More fields', fields.map((f) => field(f.label, control(f), f.typeLabel, f.type === 'long' ? 12 : 4)))
  }

  function contentSection() {
    const d = state.draft
    return section(
      'Content',
      field('Description', text(d, 'longDescription', { multiline: true, rows: 7, placeholder: 'Markdown: **bold**, a blank line between paragraphs, "- " for a list' })),
      field('Key features', rows(d.bullets, {
        make: (_, i) => {
          const input = el('input', { class: 'form-control', disabled: state.readOnly, value: d.bullets[i], placeholder: 'One short line' })
          input.addEventListener('input', () => { d.bullets[i] = input.value; changed() })
          return input
        },
        blank: () => '',
        addLabel: 'Key feature',
      }), 'Three or more counts as done', 6, { top: true }),
      field('Specifications', rows(d.specs, {
        make: (row) => el('div', { class: 'fpim-row fpim-grow', style: 'margin:0' }, rowInput(row, 'label', { placeholder: 'Label' }), rowInput(row, 'value', { placeholder: 'Value' })),
        blank: () => ({ label: '', value: '' }),
        addLabel: 'Specification',
      }), null, 6, { top: true }),
      field('What’s in the box', rows(d.contents, {
        make: (row) => el('div', { class: 'fpim-row fpim-grow', style: 'margin:0' }, rowInput(row, 'qty', { type: 'number', min: 1, class: 'fpim-narrow' }), rowInput(row, 'item', { placeholder: 'Item' })),
        blank: () => ({ item: '', qty: 1 }),
        addLabel: 'Item',
      }), null, 6, { top: true })
    )
  }

  function mediaSection() {
    const d = state.draft
    const fileLabel = (f) => el('a', { href: f.url, target: '_blank', rel: 'noreferrer', class: 'fpim-grow', style: 'padding:5px 0' }, icon('fa-file-o'), ' ', f.name || 'Uploaded file')
    // Pictures and videos: the same editor as a part's Images tab, for the part chosen here —
    // tagged to the parent (every part shows it), the part, or one of its units. Saved at once.
    const parts = [...state.data.variants].sort((a, b) => Number(a.eol) - Number(b.eol) || a.sku.localeCompare(b.sku))
    const holder = el('div')
    const partSelect = el('select', { class: 'form-control', 'aria-label': 'Part' }, parts.map((x) => el('option', { value: x.sku }, `${x.sku}${x.tradepegTitle ? ` — ${x.tradepegTitle}` : ''}${x.eol ? ' (EOL)' : ''}`)))
    if (state.picturePart && parts.some((x) => x.sku === state.picturePart)) partSelect.value = state.picturePart
    const show = () => {
      state.picturePart = partSelect.value
      if (partSelect.value) void loadPictures(holder, partSelect.value)
    }
    partSelect.addEventListener('change', show)
    if (parts.length) show()
    else fill(holder, el('p', { class: 'text-muted' }, 'This parent has no parts.'))
    return section(
      'Media',
      parts.length > 1 ? field('Part', partSelect, 'Its pictures, its units’ and the parent’s', 6) : null,
      el('div', { class: 'col-md-12 fpim-field' }, holder),
      field('Documents', rows(d.documentation, {
        make: (row) => el('div', { class: 'fpim-row fpim-grow', style: 'margin:0' }, rowInput(row, 'name', { placeholder: 'Name, e.g. User manual' }), row.file ? fileLabel(row.file) : rowInput(row, 'link', { placeholder: 'Link' })),
        blank: () => ({ name: '', link: '', file: null }),
        addLabel: 'Document link',
        extra: state.readOnly ? null : uploadButton('Upload…', 'document', '', 'btn-default'),
      }), 'Manuals, leaflets, certificates', 6, { top: true })
    )
  }

  function classificationSection() {
    const d = state.draft
    const categories = selectBox({
      kind: 'categories',
      multiple: true,
      value: d.categories,
      placeholder: 'Type to find a category',
      // In the box, a category's own name; its full path on hover and in the list.
      short: (c) => String(c.path).split(' > ').at(-1),
      onChange: (list) => {
        d.categories = list.map((c) => ({ id: c.id, path: c.path }))
        changed()
      },
    })
    const tags = selectBox({
      kind: 'tags',
      multiple: true,
      value: d.tags.map((name) => ({ name })),
      allowNew: true,
      placeholder: 'Type to find or add a tag',
      onChange: (list) => {
        d.tags = list.map((t) => t.name)
        changed()
      },
    })
    return section('Classification', field('Categories', categories, 'Where it sits on the website; pick the most specific', 8), field('Tags', tags, null, 4))
  }

  /** A Google or eBay category: the product's own, or the one it inherits from its categories. */
  function channelCategory(key, kind, inherited) {
    const d = state.draft
    return selectBox({
      kind,
      value: d[key],
      placeholder: inherited?.inheritedFrom ? `${inherited.path} (from ${inherited.inheritedFrom})` : 'Type a name or number',
      short: (c) => String(c.path).split(' > ').at(-1),
      onChange: (c) => {
        d[key] = c ? { id: c.id, path: c.path } : null
        changed()
      },
    })
  }

  /**
   * One channel as a coloured tile: its name and an On / Off switch in the
   * coloured band, its settings underneath. A channel that is off is greyed.
   */
  function channelTile(key, name, iconName, colour, ...fields) {
    const d = state.draft
    const box = el('input', { type: 'checkbox', disabled: state.readOnly, 'aria-label': `${name}: on or off` })
    box.checked = Boolean(d[key])
    const state_ = el('span', { class: 'fpim-switch-text' })
    const tile = el(
      'div',
      { class: `fpim-tile fpim-tile-${colour}` },
      el('div', { class: 'fpim-tile-head' }, icon(iconName), el('span', { class: 'fpim-tile-name' }, name), el('label', { class: 'fpim-switch' }, box, el('span', { class: 'fpim-switch-track' }), state_)),
      el('div', { class: 'fpim-tile-body row' }, fields)
    )
    const paint = () => {
      tile.classList.toggle('fpim-off', !box.checked)
      fill(state_, box.checked ? 'On' : 'Off')
    }
    box.addEventListener('change', () => {
      d[key] = box.checked
      paint()
      changed()
    })
    paint()
    return el('div', { class: 'col-md-4' }, tile)
  }

  function channelsSection(p) {
    const d = state.draft
    return section(
      'Channels',
      channelTile(
        'channelWeb',
        'Website',
        'fa-globe',
        'web',
        field('SEO title', text(d, 'seoTitle', { max: 70, placeholder: 'Empty uses the website title' }), 'Up to about 60 characters'),
        field('SEO description', text(d, 'seoDescription', { multiline: true, rows: 3, max: 160 }), 'Up to about 155 characters')
      ),
      channelTile('channelGoogle', 'Google Shopping', 'fa-google', 'google', field('Google category', channelCategory('googleCategory', 'google', p.googleCategory), 'Only Ready products go to Google')),
      channelTile(
        'channelEbay',
        'eBay',
        'fa-shopping-cart',
        'ebay',
        field('eBay category', channelCategory('ebayCategory', 'ebay', p.ebayCategory), 'Only Ready products go to eBay'),
        field('eBay item number', text(d, 'ebayItemNumber', { placeholder: 'Filled in once it is listed' }))
      )
    )
  }

  /**
   * Variation types (what the variants differ by, in order) and each variant's
   * title and values: what the parent decides. A variant's pictures and units
   * are on its own part page in TradePeg (Images tab).
   */
  function variantsSection() {
    const data = state.data
    const d = state.draft
    const variants = [...data.variants].sort((a, b) => Number(a.eol) - Number(b.eol) || a.sku.localeCompare(b.sku))
    if (state.variantView?.sku !== data.product.sku) state.variantView = { sku: data.product.sku, q: '', eol: false }
    const view = state.variantView
    const eolCount = variants.filter((v) => v.eol).length
    const tableHolder = el('div')

    const addType = async (t) => {
      if (d.variationTypes.some((x) => x.id === t.id || x.name.toLowerCase() === t.name.toLowerCase())) return
      if (t.isNew) {
        try {
          t = await request('POST', adminPath('/variation-types'), { json: { name: t.name } })
        } catch (error) {
          return say('danger', error.status === 403 ? 'Making a new variation type needs a token with Pim → admin.' : error.message)
        }
      }
      d.variationTypes.push({ id: t.id, name: t.name })
    }

    const typesHolder = el('div')
    const paintTypes = () =>
      fill(
        typesHolder,
        selectBox({
          kind: 'variation-types',
          multiple: true,
          max: 4,
          value: d.variationTypes,
          allowNew: true,
          placeholder: 'Size, Colour…',
          onChange: async (list) => {
            d.variationTypes = list.filter((t) => !t.isNew)
            for (const t of list.filter((x) => x.isNew)) await addType(t)
            paintTypes()
            paintTable()
            changed()
          },
        })
      )
    paintTypes()
    const types = typesHolder

    const find = el('input', { class: 'form-control', placeholder: 'Find a variant: SKU, title or value', value: view.q, style: 'max-width:320px' })
    find.addEventListener('input', () => {
      view.q = find.value
      paintTable()
    })
    const showEol = el('input', { type: 'checkbox' })
    showEol.checked = view.eol
    showEol.addEventListener('change', () => {
      view.eol = showEol.checked
      paintTable()
    })

    // Values other parents already use, offered while typing (one list per variation type).
    view.open ??= new Set()
    const valueLists = el('div')
    const paintValueLists = () =>
      fill(valueLists, d.variationTypes.map((t) => el('datalist', { id: `fpim-values-${t.id}` }, (view.suggestions?.[t.id] ?? []).map((x) => el('option', { value: x })))))
    view.paintLists = paintValueLists // the newest drawing gets the answer
    if (!view.suggestions) {
      view.suggestions = {}
      request('GET', adminPath(`/variations/${encodeURIComponent(data.product.documentId)}`))
        .then((r) => {
          view.suggestions = r?.suggestions ?? {}
          view.paintLists?.()
        })
        .catch(() => { /* no suggestions, then */ })
    }

    const size = (u) => (u.lengthMm && u.widthMm && u.heightMm ? `${u.lengthMm}×${u.widthMm}×${u.heightMm} mm` : '—')
    /** A part's units, read-only: they are TradePeg's. */
    const unitsTable = (v) =>
      v.uoms?.length
        ? [
            el(
              'table',
              { class: 'table-grid table-bordered fpim-units' },
              el('thead', {}, el('tr', {}, ['Unit', 'SKU', 'Qty', 'GTIN', 'Weight (g)', 'Size (L×W×H mm)'].map((h) => el('th', {}, h)))),
              el(
                'tbody',
                {},
                v.uoms.map((u) =>
                  el(
                    'tr',
                    {},
                    el('td', {}, UOM_NAME[u.type] ?? u.type),
                    el('td', { class: 'fpim-sku' }, u.uomSku),
                    el('td', { class: 'text-right' }, u.qty ?? '—'),
                    el('td', { class: `fpim-sku${u.gtin ? '' : ' fpim-amber'}` }, u.gtin || 'missing'),
                    el('td', { class: 'text-right' }, u.weightG ?? '—'),
                    el('td', {}, size(u).replace(/ mm$/, ''))
                  )
                )
              )
            ),
            el('div', { class: 'fpim-help' }, 'Units, GTINs, weights and sizes are edited in TradePeg.'),
          ]
        : el('p', { class: 'text-muted', style: 'margin:0' }, 'No units in TradePeg yet.')

    function paintTable() {
      const cols = d.variationTypes
      const term = view.q.trim().toLowerCase()
      const matches = (v) =>
        !term || [v.sku, v.tradepegTitle, ...Object.values(d.variants[v.documentId].values)].some((x) => String(x ?? '').toLowerCase().includes(term))
      const list = variants.filter((v) => (view.eol || !v.eol) && matches(v))
      const width = 5 + cols.length
      paintValueLists()
      fill(
        tableHolder,
        el(
          'table',
          { class: 'table-grid table-bordered fpim-vtable' },
          el('thead', {}, el('tr', {}, el('th', { class: 'fpim-chev' }), el('th', { class: 'fpim-vthumb' }), el('th', {}, 'SKU'), el('th', {}, 'TradePeg title'), cols.map((t) => el('th', {}, t.name)), el('th', {}, 'Units'))),
          el(
            'tbody',
            {},
            list.length
              ? list.map((v) => {
                  const draft = d.variants[v.documentId]
                  const open = view.open.has(v.documentId)
                  const thumb = draft.images[0] ?? v.uomImages?.[0]?.image
                  const chevron = iconButton(open ? 'fa-chevron-down' : 'fa-chevron-right', `${open ? 'Hide' : 'Show'} ${v.sku}’s units`, () => {
                    if (open) view.open.delete(v.documentId)
                    else view.open.add(v.documentId)
                    paintTable()
                  }, { 'aria-expanded': String(open) })
                  const valueInput = (t) => {
                    const input = text(draft.values, t.id, { placeholder: t.name })
                    input.setAttribute('list', `fpim-values-${t.id}`)
                    input.setAttribute('aria-label', `${t.name} of ${v.sku}`)
                    const need = () => input.classList.toggle('fpim-need', !v.eol && !input.value.trim())
                    input.addEventListener('input', need)
                    need()
                    return input
                  }
                  return [
                    el(
                      'tr',
                      { class: v.eol ? 'fpim-eol' : null },
                      el('td', { class: 'fpim-chev' }, chevron),
                      el('td', { class: 'fpim-vthumb' }, thumb ? el('img', { src: thumb.thumb ?? thumb.url, alt: '' }) : el('span', { class: 'fpim-noimg', title: 'No picture yet' }, icon('fa-picture-o'))),
                      el('td', { class: 'fpim-sku', style: 'white-space:nowrap' }, partLink(v.sku), v.eol ? el('span', { class: 'label label-danger', style: 'margin-left:6px' }, 'EOL') : null),
                      el('td', { class: 'text-muted', title: v.tradepegTitle || null }, v.tradepegTitle || ''),
                      cols.map((t) => el('td', {}, valueInput(t))),
                      el('td', { class: 'text-muted', style: 'white-space:nowrap' }, v.uoms?.length ? v.uoms.map((u) => `${UOM_NAME[u.type] ?? u.type} ×${u.qty ?? 1}`).join(' · ') : 'None')
                    ),
                    open ? el('tr', { class: 'fpim-detail' }, el('td', { colspan: width }, unitsTable(v))) : null,
                  ]
                })
              : el('tr', {}, el('td', { colspan: width, class: 'text-muted' }, 'No variant matches.'))
          )
        ),
        list.length < variants.length ? el('p', { class: 'fpim-help' }, `Showing ${list.length} of ${variants.length}.`) : null
      )
    }
    paintTable()

    return section(
      `Variants (${variants.length})`,
      field('Variation types', types, 'What shoppers choose between, in order (up to 4). Every live variant needs a value for each.', 12),
      el(
        'div',
        { class: 'fpim-vtools' },
        find,
        eolCount ? el('label', { style: 'font-weight:normal;margin:0' }, showEol, ` Show ${plural(eolCount, 'end-of-life variant')}`) : null
      ),
      tableHolder,
      valueLists
    )
  }

  /**
   * A part code that opens the part's own page in TradePeg. TradePeg's pages go
   * by its own id, which the PIM does not keep, so the click asks TradePeg's
   * Parts search (in this session) for it; failing that, the search itself opens.
   */
  const PARTS_SEARCH = (sku) => `/wapp/en-gb/inventory/products/?q=1&ref1=${encodeURIComponent(sku)}`
  function partLink(sku) {
    return el(
      'a',
      {
        href: PARTS_SEARCH(sku),
        title: `Open ${sku} in TradePeg`,
        onclick: async (e) => {
          if (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1) return
          e.preventDefault()
          if (!leaveEditorOk()) return
          let to = PARTS_SEARCH(sku)
          try {
            const html = await (await fetch(to, { credentials: 'same-origin' })).text()
            const doc = new DOMParser().parseFromString(html, 'text/html')
            const a = [...doc.querySelectorAll('a.toolTip[href*="/inventory/products/details/"]')].find((x) => x.textContent.trim() === sku)
            if (a) to = a.getAttribute('href')
          } catch { /* the search page will do */ }
          location.href = to
        },
      },
      sku
    )
  }

  // ---------------------------------------------------------------- prices (the Ready gate)

  /**
   * Whether the repricer has a price for each unit (POST /pricing-status). A
   * parent cannot be Ready until every live unit has. Resolves { units }, or
   * null when this PIM is too old to ask (then nothing is shown or gated);
   * throws when the repricer cannot be asked. Answers are kept a minute.
   */
  let pricingRoute = true
  const pricingCache = new Map()
  async function pricingStatus(uomSkus) {
    const skus = [...new Set(uomSkus.filter(Boolean))].sort()
    if (!skus.length) return { units: {} }
    if (!pricingRoute) return null
    const key = skus.join('|')
    const hit = pricingCache.get(key)
    if (hit && Date.now() - hit.at < 60000) return hit.value
    try {
      const value = await request('POST', adminPath('/pricing-status'), { json: { uomSkus: skus } })
      pricingCache.set(key, { at: Date.now(), value })
      return value
    } catch (error) {
      if (error.status === 404) {
        pricingRoute = false
        return null
      }
      throw error
    }
  }
  /** Of these units, the ones without a price; null while unknown. */
  const unpricedOf = (units, priced) => (!units.length ? [] : priced ? units.filter((u) => !priced[u]?.priced) : null)
  /** "Priced", "Not priced" or "2 of 5 not priced", next to Draft / Ready. */
  function pricingBadge(units, priced) {
    const unpriced = unpricedOf(units, priced)
    if (unpriced === null || !units.length) return null
    const ok = !unpriced.length
    return el(
      'span',
      { class: `label ${ok ? 'label-success' : 'label-warning'} ml5 fpim-priced`, title: ok ? 'Every unit has its price set in the repricer' : `Not priced in the repricer: ${unpriced.join(', ')}` },
      ok ? 'Priced' : unpriced.length === units.length ? 'Not priced' : `${unpriced.length} of ${units.length} not priced`
    )
  }
  /** The parent's live units: the unit SKUs of the parts not at end of life. */
  const liveUnits = (data) => data.variants.filter((v) => !v.eol).flatMap((v) => (v.uoms ?? []).map((u) => u.uomSku)).filter(Boolean)

  /** Ask the repricer about the open parent's units; the Status box redraws when it answers. */
  async function checkPricing() {
    const data = state.data
    if (!data) return
    const sku = data.product.sku
    const units = liveUnits(data)
    state.pricing = { sku, units, state: units.length ? 'loading' : 'ok', priced: units.length ? null : {} }
    if (!units.length) return state.paintStatus?.()
    state.paintStatus?.()
    try {
      const r = await pricingStatus(units)
      if (state.data?.product.sku !== sku) return
      state.pricing = r ? { sku, units, state: 'ok', priced: r.units ?? {} } : { sku, units, state: 'none', priced: null }
    } catch (error) {
      if (state.data?.product.sku !== sku) return
      state.pricing = { sku, units, state: 'error', error: error.message, priced: null }
    }
    state.paintStatus?.()
  }

  /** Why the open parent cannot be made Ready, or null when it can (exactly as Farla Tools decides). */
  function readyBlock() {
    const p = state.data.product
    if (p.status === 'ready') return null
    if ((p.missing ?? []).includes('variation values')) return 'Fix the variants first: every part needs its variation values, and no two parts the same.'
    const pr = state.pricing?.sku === p.sku ? state.pricing : null
    const units = pr?.units ?? liveUnits(state.data)
    if (!units.length || pr?.state === 'none') return null
    if (!pr || pr.state === 'loading') return 'Checking prices…'
    if (pr.state === 'error') return `Could not check prices: ${pr.error}`
    const unpriced = unpricedOf(units, pr.priced)
    return unpriced?.length ? `Set the price in the repricer first: ${unpriced.join(', ')}` : null
  }

  // ---------------------------------------------------------------- website queue

  /**
   * What has changed in the PIM and not reached the website yet (the PIM's push
   * queue, src/pim/search.js): a count on the Publish menu entry and on every
   * PIM page's "Push to website" button, read every 20 seconds.
   */
  let pushes = null
  const pushButtons = new Set()
  async function readPushes() {
    if (!hasToken()) return null
    try {
      pushes = await request('GET', adminPath('/pushes'))
    } catch {
      return pushes
    }
    paintPushCounts()
    return pushes
  }
  const pushBadge = (n) => (n ? el('span', { class: 'badge fpim-push-badge' }, String(n)) : null)
  function paintPushCounts() {
    const n = pushes?.waiting?.length ?? 0
    for (const b of [...pushButtons]) {
      if (!b.isConnected) {
        pushButtons.delete(b)
        continue
      }
      fill(b, icon(pushes?.sending ? 'fa-spinner fa-spin' : 'fa-cloud-upload'), ' Push to website', pushBadge(n))
      b.className = `btn ${n ? 'btn-warning' : 'btn-default'}`
      b.title = n ? `${plural(n, 'change')} not on the website yet` : 'Everything is on the website'
    }
    for (const a of document.querySelectorAll('li.fpim-menu-publish > a, .fpim-menu-button a[href="#pim/publish"]')) {
      const ic = a.querySelector('i.fa')
      fill(a, ic, ic ? ' Publish' : 'Publish', pushBadge(n))
    }
  }
  function pushButton() {
    const b = el('a', { href: '#', role: 'button', onclick: (e) => { e.preventDefault(); pushDialog() } })
    pushButtons.add(b)
    paintPushCounts()
    return b
  }
  setInterval(() => { if (document.visibilityState === 'visible') void readPushes() }, 20000)
  setTimeout(() => void readPushes(), 1500)

  /** One queue entry in words: the parent and its title, or what else changed. */
  const pushWhat = (e) =>
    e.kind === 'product' ? [el('span', { class: 'fpim-sku' }, e.sku ?? '…'), ' ', el('span', { class: 'text-muted' }, e.label ?? '')]
      : e.kind === 'removed' ? [el('span', { class: 'fpim-sku' }, e.sku), ' ', el('span', { class: 'text-muted' }, 'deleted')]
        : el('strong', {}, e.label)
  const PUSH_ICON = {
    waiting: () => el('span', { class: 'text-muted' }, icon('fa-clock-o'), ' Waiting'),
    sending: () => el('span', { class: 'text-info' }, icon('fa-spinner fa-spin'), ' Sending'),
    done: () => el('span', { class: 'text-success' }, icon('fa-check'), ' Sent'),
    failed: (e) => el('span', { class: 'text-danger', title: e?.error ?? '' }, icon('fa-times'), ' Failed'),
  }
  const modeLine = () =>
    pushes?.mode === 'manual'
      ? 'Changes wait here until someone presses Push.'
      : 'Changes go to the website by themselves a few seconds after each save; Push sends anything still waiting now.'
  const progressBar = (done, total) =>
    el('div', { class: 'progress', style: 'margin:8px 0' }, el('div', { class: 'progress-bar progress-bar-success', style: `width:${total ? Math.round((done / total) * 100) : 100}%;min-width:2em` }, total ? `${done} / ${total}` : '…'))

  /** Push what is waiting (or every product), showing each change go. */
  function pushDialog() {
    const body = el('div', {}, spinner())
    const foot = el('span')
    const d = dialog('Push to the website', [body], [foot])
    let mine = null // { keys, at, all } once Push is pressed
    const rowsOf = (list, statusOf) =>
      el(
        'table',
        { class: 'fpim-table' },
        el('thead', {}, el('tr', {}, el('th', {}, 'What changed'), el('th', {}, 'Saved'), el('th', {}, 'Status'))),
        el(
          'tbody',
          {},
          list.slice(0, 300).map((e) => el('tr', {}, el('td', {}, pushWhat(e)), el('td', { class: 'text-muted' }, ago(e.lastAt), e.count > 1 ? ` · ${e.count} saves` : ''), el('td', {}, PUSH_ICON[statusOf(e)](e))))
        ),
        list.length > 300 ? el('tfoot', {}, el('tr', {}, el('td', { colspan: 3, class: 'text-muted' }, `and ${list.length - 300} more`))) : null
      )

    async function go(all) {
      if (all && !confirm('Send every product in the PIM to the website again? This takes a few minutes.')) return
      fill(foot, button([icon('fa-spinner fa-spin'), ' Starting…'], () => {}, 'btn-success', { disabled: true }))
      try {
        const keys = all ? ['all'] : pushes.waiting.map((e) => e.key)
        // "Since" by the server's own clock: the newest entry it had sent before this.
        mine = { keys: new Set(keys), since: pushes.history?.[0]?.doneAt ?? '', all, entries: new Map((pushes.waiting ?? []).map((e) => [e.key, e])) }
        await request('POST', adminPath('/pushes'), { json: { all, by: tpUser() || null } })
      } catch (error) {
        mine = null
        body.prepend(el('div', { class: 'alert alert-danger' }, error.message))
      }
      void tick()
    }

    function paint() {
      const waiting = pushes?.waiting ?? []
      const sending = pushes?.sending
      if (!mine) {
        const n = waiting.length
        fill(
          body,
          el('p', { class: 'fpim-help' }, modeLine()),
          sending ? el('div', { class: 'alert alert-info' }, icon('fa-spinner fa-spin'), ` A push is going now (${sending.by ?? 'automatic'})`, progressBar(sending.done, sending.total)) : null,
          n ? rowsOf(waiting, () => 'waiting') : el('div', { class: 'alert alert-success' }, icon('fa-check'), ' Nothing is waiting: the website has every change.')
        )
        fill(
          foot,
          button('Close', () => d.close()),
          button([icon('fa-refresh'), ' Push every product'], () => void go(true), 'btn-default', { title: 'Send the whole catalogue again, changed or not' }),
          button([icon('fa-cloud-upload'), n ? ` Push ${plural(n, 'change')}` : ' Push'], () => void go(false), 'btn-success', { disabled: !n })
        )
        return
      }
      // After Push: each of ours, by where it is now.
      const inSending = new Map((sending?.entries ?? []).map((e) => [e.key, e]))
      const inWaiting = new Map(waiting.map((e) => [e.key, e]))
      const done = new Map((pushes?.history ?? []).filter((e) => e.doneAt > mine.since).map((e) => [e.key, e]))
      const statusOf = (e) => {
        const h = done.get(e.key)
        if (h?.status === 'failed') return 'failed'
        if (inSending.has(e.key)) return inSending.get(e.key).status
        if (inWaiting.has(e.key)) return 'waiting'
        return 'done'
      }
      const list = [...mine.keys].map((k) => ({ ...(mine.entries.get(k) ?? { key: k, kind: 'all', label: 'Every product', lastAt: new Date().toISOString(), count: 1 }), ...(inSending.get(k) ?? done.get(k) ?? {}) }))
      const states = list.map(statusOf)
      const finished = states.every((s) => s === 'done' || s === 'failed')
      const failed = list.filter((e, i) => states[i] === 'failed')
      const products = list.filter((e) => e.kind === 'product')
      const total = mine.all ? sending?.total : products.length
      const sent = mine.all ? (finished ? total : sending?.done ?? 0) : products.filter((e) => statusOf(e) === 'done').length
      fill(
        body,
        finished
          ? failed.length
            ? el('div', { class: 'alert alert-danger' }, `${plural(failed.length, 'change')} could not be sent: ${failed[0].error ?? 'unknown error'}. ${failed.length === 1 ? 'It is' : 'They are'} back in the queue — try Push again.`)
            : el('div', { class: 'alert alert-success' }, icon('fa-check'), ' Sent. The website shows it within about two minutes, once it rebuilds.')
          : el('div', { class: 'alert alert-info' }, icon('fa-spinner fa-spin'), ' Sending to the website…'),
        mine.all || products.length ? progressBar(sent ?? 0, total) : null,
        rowsOf(list, statusOf)
      )
      fill(foot, button('Close', () => d.close(), finished ? 'btn-primary' : 'btn-default'))
      return finished
    }

    async function tick() {
      await readPushes()
      if (!d.modal.isConnected) return
      const finished = paint()
      if (mine && finished) return
      // Every second while ours is going, every five while just looking.
      setTimeout(() => void tick(), mine ? 1000 : 5000)
    }
    void tick()
  }

  /** The Publish page: when changes go to the website, what is waiting, what went lately. */
  async function publishTool(content, alive) {
    const out = el('div')
    fill(content, out)
    async function paint() {
      if (!alive()) return
      await readPushes()
      if (!pushes) return fill(out, el('div', { class: 'alert alert-danger' }, 'Could not read the website queue.'))
      if (!pushes.enabled) return fill(out, el('div', { class: 'alert alert-warning' }, 'Pushing to the website is off on this PIM (MEILISEARCH_URL is not set).'))
      const mode = (value, label, help) =>
        el(
          'label',
          { class: 'radio', style: 'display:block;margin:6px 0' },
          el('input', {
            type: 'radio',
            name: 'fpim-push-mode',
            checked: pushes.mode === value,
            onchange: async () => {
              try {
                await request('PUT', adminPath('/pushes/mode'), { json: { mode: value } })
                toast('success', value === 'manual' ? 'Changes now wait for Push to website.' : 'Changes now go to the website by themselves.')
              } catch (error) {
                toast('danger', error.message)
              }
              void paint()
            },
          }),
          ` ${label}`,
          el('div', { class: 'help-block' }, help)
        )
      const history = pushes.history ?? []
      fill(
        out,
        tpPanel(
          'When changes go to the website',
          null,
          el(
            'div',
            { class: 'formRow fluid' },
            el(
              'div',
              { class: 'col-md-12' },
              mode('auto', 'Automatically', 'A few seconds after each save.'),
              mode('manual', 'Only when someone presses Push to website', 'Changes wait in the list below. The TradePeg sync still sends its own changes straight away.')
            )
          )
        ),
        tpPanel(
          `Waiting (${pushes.waiting.length})`,
          [pushButton()],
          pushes.sending ? el('div', { class: 'alert alert-info', style: 'margin:10px 12px' }, icon('fa-spinner fa-spin'), ` Sending now (${pushes.sending.by ?? 'automatic'})`, progressBar(pushes.sending.done, pushes.sending.total)) : null,
          pushes.waiting.length
            ? el('table', { class: 'fpim-table' }, el('thead', {}, el('tr', {}, el('th', {}, 'What changed'), el('th', {}, 'First saved'), el('th', {}, 'Last saved'), el('th', {}, 'Saves'))), el('tbody', {}, pushes.waiting.map((e) => el('tr', {}, el('td', {}, pushWhat(e)), el('td', {}, ago(e.firstAt)), el('td', {}, ago(e.lastAt)), el('td', {}, String(e.count))))))
            : el('p', { class: 'text-muted', style: 'margin:10px 12px' }, icon('fa-check text-success'), ' Nothing waiting: the website has every change.')
        ),
        tpPanel(
          'Sent lately',
          null,
          history.length
            ? el('table', { class: 'fpim-table' }, el('thead', {}, el('tr', {}, el('th', {}, 'What changed'), el('th', {}, 'Sent'), el('th', {}, 'By'), el('th', {}, 'Status'))), el('tbody', {}, history.map((e) => el('tr', {}, el('td', {}, pushWhat(e)), el('td', {}, ago(e.doneAt)), el('td', { class: 'text-muted' }, e.by ?? ''), el('td', {}, PUSH_ICON[e.status](e), e.status === 'failed' && e.error ? el('div', { class: 'text-danger fpim-help' }, e.error) : null)))))
            : el('p', { class: 'text-muted', style: 'margin:10px 12px' }, 'Nothing sent since the PIM last started.')
        )
      )
      setTimeout(() => void paint(), 5000)
    }
    void paint()
  }

  // ================================================================ PIM pages

  /**
   * The PIM's pages live in TradePeg's own page area and look like its pages:
   * the title with a Manage menu on the right, then green panels. They are
   * reached from a PIM section in the menu. The address keeps #pim/<page> so
   * Back, reload and bookmarks work.
   */
  const PAGES = [
    ['overview', 'Overview', 'fa-dashboard'],
    ['products', 'Parents', 'fa-sitemap'],
    ['categories', 'Categories', 'fa-folder-open-o'],
    ['brands', 'Brands', 'fa-tag'],
    ['import', 'Import', 'fa-upload'],
    ['ai', 'AI', 'fa-magic'],
    ['publish', 'Publish', 'fa-cloud-upload'],
    ['settings', 'Settings', 'fa-cog'],
  ]
  // Settings holds the rarer pages, switched between at its top.
  const SETTINGS_TABS = [
    ['settings', 'General', 'fa-cog'],
    ['fields', 'Product fields', 'fa-list-alt'],
    ['sync', 'TradePeg sync', 'fa-refresh'],
    ['export', 'Export', 'fa-download'],
  ]
  const inSettings = (key) => SETTINGS_TABS.some(([k]) => k === key)
  /** The menu entry a page sits under. */
  const menuKey = (key) => (key === 'parent' ? 'products' : inSettings(key) ? 'settings' : key)
  // Pages that were folded into others: old bookmarks still land somewhere sensible.
  const MOVED = { issues: 'sync', channels: 'settings' }
  const PAGE_HASH = /^#pim\/([\w-]+)(?:\/(.+))?$/

  /** What the pages remember between visits: the grid's filter, the tree's open branches. */
  const toolState = {}
  let page = null
  let pageGeneration = 0

  const pageContent = () => document.querySelector('.page-content')

  /** Unsaved edits are lost by leaving: ask first, and drop them if the answer is yes. */
  function leaveEditorOk() {
    if (!isDirty()) return true
    if (!confirm('You have unsaved PIM changes. Leave without saving them?')) return false
    state.draft = clone(state.base)
    paintSaveBar()
    return true
  }

  /** Go to a PIM page; openTools('parent', 'FM-VARPAR-002') opens one parent. */
  function openTools(key = 'products', arg) {
    if (!leaveEditorOk()) return
    const hash = `#pim/${key}${arg ? `/${encodeURIComponent(arg)}` : ''}`
    if (location.hash !== hash) history.pushState(null, '', `${location.pathname}${location.search}${hash}`)
    renderPage(key, arg)
  }

  /** A TradePeg panel: green heading with its buttons on the right, then the body. */
  function tpPanel(title, tools, ...body) {
    return el(
      'div',
      { class: 'panel panel-parts fluid mt10' },
      el('div', { class: 'panel-heading' }, title, tools && [].concat(tools).filter(Boolean).length ? el('div', { class: 'btns pull-right' }, tools) : null),
      el('div', { class: 'panel-body p0' }, body)
    )
  }
  /** A button for a panel heading, TradePeg's size and colours. */
  const headButton = (label, onclick, cls = 'btn-info', attrs = {}) =>
    el('a', { href: '#', class: `btn btn-sm ${cls} ml5`, role: 'button', onclick: (e) => { e.preventDefault(); if (!e.currentTarget.classList.contains('disabled')) onclick(e) }, ...attrs }, label)

  /** TradePeg's "Manage" button: every PIM page, as its Items page lists Brands, Categories… */
  function manageMenu(current) {
    const group = el('div', { class: 'btn-group fpim-menu-button' })
    group.append(
      el(
        'button',
        { type: 'button', class: 'btn btn-default dropdown-toggle w140', 'aria-haspopup': 'true', onclick: (e) => { e.stopPropagation(); group.classList.toggle('open') } },
        el('span', { class: 'glyphicon glyphicon-list pull-left' }),
        'Manage ',
        el('span', { class: 'caret' })
      ),
      el(
        'ul',
        { class: 'dropdown-menu pull-right', role: 'menu' },
        PAGES.map(([k, label, ic]) => [
          k === 'settings' ? el('li', { role: 'presentation', class: 'divider' }) : null,
          el('li', { class: k === current ? 'active' : null }, el('a', { href: `#pim/${k}`, onclick: (e) => { e.preventDefault(); group.classList.remove('open'); openTools(k) } }, icon(ic), ` ${label}`)),
        ])
      )
    )
    return group
  }

  /** Buttons beside Manage in the page header (a page's main action, in green). */
  function headerActions(...nodes) {
    if (page?.actions) fill(page.actions, nodes)
  }

  function renderPage(key, arg) {
    const host = pageContent()
    if (!host) return
    key = MOVED[key] ?? key
    if (key === 'parent' && !arg) key = 'products'
    if (key !== 'parent' && !PAGES.some(([k]) => k === key) && !inSettings(key)) key = 'products'
    const title = key === 'parent' ? arg : inSettings(key) ? 'Settings' : PAGES.find(([k]) => k === key)[1]
    // Whatever the page area held — a product and its PIM tab — is gone now.
    state.generation++
    Object.assign(state, { host: 'tab', data: null, base: null, draft: null, saving: false })
    body = null
    saveBar = null
    paintSaveBar()

    const generation = ++pageGeneration
    const content = el('div', { class: 'fpim fpim-page', id: 'fpim-page' })
    const actions = el('span')
    fill(
      host,
      el(
        'div',
        { class: 'module-header-holder' },
        el('h3', { class: 'page-title pull-left' }, title),
        el('div', { class: 'btns-mod-header pull-right' }, manageMenu(menuKey(key)), ' ', pushButton(), ' ', actions),
        el('div', { class: 'clear' })
      ),
      el('div', { class: 'clear' }),
      content
    )
    shieldKeys(host)
    page = { key, arg, content, actions, generation }
    document.title = `${title} · PIM`
    markMenu()
    const alive = () => page?.generation === generation && content.isConnected
    if (!hasToken() && key !== 'settings') {
      fill(content, tpPanel('PIM token', null, el('div', { class: 'formRow fluid' }, el('p', { class: 'col-md-12' }, 'The PIM needs an API token once on this computer.'), el('div', { class: 'col-md-12' }, settingsForm(() => renderPage(key))))))
      return
    }
    if (key === 'parent') {
      headerActions(el('a', { href: '#pim/products', class: 'btn btn-default', onclick: (e) => { e.preventDefault(); openTools('products') } }, icon('fa-arrow-left'), ' All parents'))
      const inner = el('div', { class: 'panel-body' })
      fill(content, el('div', { class: 'panel panel-parts fluid mt10' }, inner))
      return editInTools(arg, inner)
    }
    // Settings' pages: General, TradePeg sync, Export, switched at the top.
    let target = content
    if (inSettings(key)) {
      target = el('div')
      fill(
        content,
        el(
          'div',
          { class: 'btn-group fpim-settings-tabs', role: 'tablist' },
          SETTINGS_TABS.map(([k, label, ic]) =>
            el('a', { href: `#pim/${k}`, role: 'tab', 'aria-selected': String(k === key), class: `btn ${k === key ? 'btn-primary' : 'btn-default'}`, onclick: (e) => { e.preventDefault(); openTools(k) } }, icon(ic), ` ${label}`)
          )
        ),
        target
      )
    }
    ;({
      overview: overviewTool,
      products: productsTool,
      categories: categoriesTool,
      import: importTool,
      sync: syncTool,
      export: exportTool,
      settings: settingsTool,
      fields: fieldsTool,
      ai: aiTool,
      brands: brandsTool,
      publish: publishTool,
    })[key](target, alive, ...(key === 'ai' ? [arg] : []))
  }

  /** The page in the address, drawn if it is not already on screen. */
  function routePage() {
    const m = PAGE_HASH.exec(location.hash)
    if (!m || !pageContent()) return
    const arg = m[2] ? decodeURIComponent(m[2]) : undefined
    if (page?.content.isConnected && page.key === m[1] && page.arg === arg) return
    renderPage(m[1], arg)
  }

  window.addEventListener('popstate', () =>
    setTimeout(() => {
      if (PAGE_HASH.test(location.hash)) return routePage()
      // Back from a PIM page to the TradePeg page under it: TradePeg may not redraw it.
      if (document.getElementById('fpim-page')) location.reload()
    }, 300)
  )

  // Leaving with unsaved edits through any TradePeg link asks first.
  document.addEventListener(
    'click',
    (e) => {
      const a = e.target.closest?.('a[href]')
      if (!a || a.target === '_blank' || a.closest('.fpim') || !isDirty()) return
      const href = a.getAttribute('href') || ''
      if (href.startsWith('#') || href.startsWith('javascript')) return
      if (!leaveEditorOk()) {
        e.preventDefault()
        e.stopImmediatePropagation()
      }
    },
    true
  )

  const menuLink = (key, label) =>
    el('a', { href: `#pim/${key}`, 'data-pim': key, onclick: (e) => { e.preventDefault(); openTools(key) } }, label)

  /**
   * TradePeg's left-hand menu: a PIM section after Inventory with every page. (TradePeg draws the menu twice,
   * for wide and narrow screens; both get them.)
   */
  function installMenu() {
    for (const inventory of document.querySelectorAll('li.vert_menu_inventory')) {
      if (inventory.parentElement.querySelector(':scope > li.fpim-menu')) continue
      const sub = el('ul', { class: 'sub-menu' }, PAGES.map(([k, label]) => el('li', { class: `fpim-menu-item fpim-menu-${k}` }, menuLink(k, label))))
      const group = el(
        'li',
        { class: 'fpim-menu' },
        el(
          'a',
          {
            href: '#pim/products',
            onclick: (e) => {
              e.preventDefault()
              // TradePeg's menu script may open it too; open or close it only if it did not.
              const wasOpen = getComputedStyle(sub).display !== 'none'
              setTimeout(() => {
                if ((getComputedStyle(sub).display !== 'none') !== wasOpen) return
                sub.style.display = wasOpen ? 'none' : 'block'
                group.classList.toggle('open', !wasOpen)
              }, 260)
            },
          },
          el('i', { class: 'fa fa-cubes' }),
          el('span', { class: 'title' }, ' PIM'),
          el('span', { class: 'arrow' })
        ),
        sub
      )
      inventory.after(group)
    }
    markMenu()
  }

  /** Highlight the menu entries for the PIM page on screen, and only then. */
  function markMenu() {
    const key = document.getElementById('fpim-page') && page ? menuKey(page.key) : null
    const ours = document.querySelectorAll('li.fpim-menu-item, li.fpim-menu')
    if (!key) {
      for (const li of ours) li.classList.remove('active')
      return
    }
    for (const li of document.querySelectorAll('li.active')) if (li.closest('.page-sidebar, .page-sidebar-menu, ul.sub-menu') || /vert_menu_/.test(li.className)) li.classList.remove('active')
    for (const li of ours) {
      const a = li.querySelector(':scope > a[data-pim]')
      li.classList.toggle('active', a?.dataset.pim === key || (li.classList.contains('fpim-menu') && true))
    }
  }

  /** Edit one parent inside a PIM page, with the same editor as the tab. */
  function editInTools(sku, content) {
    const bar = el('span')
    const host = el('div', { class: 'fpim-tools-editor' })
    fill(content, 
      el(
        'div',
        { class: 'fpim-row', style: 'margin-bottom:10px' },
        el('span', { class: 'fpim-grow' }),
        bar,
        button([icon('fa-refresh'), ' Reload'], () => void load())
      ),
      host
    )
    Object.assign(state, { host: 'tools', data: null, base: null, draft: null, saving: false })
    body = host
    saveBar = bar
    void load(sku)
  }

  /** Hand the editor back to the tab, which reloads its own product when it is open. */
  function leaveToolsEditor() {
    if (state.host !== 'tools') return
    state.generation++
    Object.assign(state, { host: 'tab', data: null, base: null, draft: null, saving: false })
    body = tabHost?.body ?? null
    saveBar = tabHost?.saveBar ?? null
    paintSaveBar()
    if (!body?.isConnected) return
    if (pane?.classList.contains('active')) void load()
    else fill(body, )
  }

  // ---------------------------------------------------------------- dialogs, menus, notes

  /** A TradePeg-looking dialog. Returns { close }. */
  function dialog(title, bodyNodes, footerNodes) {
    const backdrop = el('div', { class: 'modal-backdrop fade in fpim-backdrop' })
    const close = () => {
      modal.remove()
      backdrop.remove()
    }
    const modal = el(
      'div',
      { class: 'modal fade in fpim fpim-modal', style: 'display:block', role: 'dialog', 'aria-modal': 'true', 'aria-label': title, tabindex: '-1' },
      el(
        'div',
        { class: 'modal-dialog modal-lg' },
        el(
          'div',
          { class: 'modal-content' },
          el('div', { class: 'modal-header' }, el('button', { type: 'button', class: 'close', 'aria-label': 'Close', onclick: close }, '\u00D7'), el('h4', { class: 'modal-title' }, title)),
          el('div', { class: 'modal-body' }, ...bodyNodes),
          el('div', { class: 'modal-footer' }, ...footerNodes)
        )
      )
    )
    modal.addEventListener('mousedown', (e) => { if (e.target === modal) close() })
    modal.addEventListener('keydown', (e) => { if (e.key === 'Escape') close() })
    shieldKeys(modal)
    document.body.append(backdrop, modal)
    setTimeout(() => modal.querySelector('select, input, textarea, button.btn')?.focus(), 0)
    return { close, modal }
  }

  /** A button with a list under it (opened by this script, not by TradePeg's Bootstrap). */
  function menuButton(label, items, cls = 'btn-default', { up = false, right = false } = {}) {
    const group = el('div', { class: `btn-group fpim-menu-button${up ? ' dropup' : ''}` })
    group.append(
      el('button', { type: 'button', class: `btn btn-sm ${cls}`, 'aria-haspopup': 'true', onclick: (e) => { e.stopPropagation(); group.classList.toggle('open'); e.currentTarget.setAttribute('aria-expanded', String(group.classList.contains('open'))) } }, label, ' ', el('span', { class: 'caret' })),
      el(
        'ul',
        { class: `dropdown-menu${right ? ' dropdown-menu-right' : ''}`, role: 'menu' },
        items.map(([text, act]) => el('li', {}, el('a', { href: '#', onclick: (e) => { e.preventDefault(); group.classList.remove('open'); act() } }, text)))
      )
    )
    return group
  }
  document.addEventListener('click', (e) => {
    for (const g of document.querySelectorAll('.fpim-menu-button.open')) if (!g.contains(e.target)) g.classList.remove('open')
  })

  /** A short note in the corner, gone by itself. */
  function toast(kind, text) {
    document.getElementById('fpim-toast')?.remove()
    const note = el('div', { id: 'fpim-toast', class: `alert alert-${kind}`, role: 'status' }, text)
    document.body.append(note)
    setTimeout(() => note.remove(), 6000)
  }

  /** What a tool shows when the PIM says no. */
  function toolError(content, error, retry) {
    fill(content, 
      el(
        'div',
        { class: 'alert alert-danger' },
        error.status === 403 || error.status === 401 ? 'This computer’s PIM token is not allowed to do this. PIM tools need Pim → admin ticked on the token (see Settings).' : error.message
      ),
      retry ? button('Try again', retry) : null
    )
  }

  /**
   * Resync with TradePeg, in a dialog that shows each step until it is done:
   * the PIM starts the sync, TradePeg's pipeline writes a fresh file, the PIM
   * imports what changed. `onDone` runs after a finished run (to reload a list).
   */
  function resyncDialog({ onDone } = {}) {
    const STEPS = [
      ['start', 'Starting the sync', /strapi booted/],
      ['trigger', 'Asking TradePeg for a fresh file', /triggered|pipeline file written|not rewritten|pipeline file .*rows/],
      ['file', 'File received from TradePeg', /pipeline file .*rows|not rewritten|contents unchanged/],
      ['import', 'Importing into the PIM', /done in|nothing to import|FAILED/],
    ]
    const list = el('ol', { class: 'fpim-steps' })
    const clock = el('span', { class: 'text-muted' })
    const note = el('div')
    const pre = el('div', { class: 'fpim-pre' }, 'Starting…')
    const details = el('details', {}, el('summary', {}, 'Details'), pre)
    const closeBtn = button('Close', () => close(), 'btn-default')
    const d = dialog('Resync with TradePeg', [note, list, el('p', {}, clock), details], [closeBtn])
    const started = Date.now()
    let open = true
    const close = () => {
      open = false
      d.close()
    }
    d.modal.querySelector('.close')?.addEventListener('click', () => { open = false })

    const paint = (output, finished, ok) => {
      let reached = 0
      STEPS.forEach(([, , done], i) => { if (done.test(output)) reached = i + 1 })
      if (finished && ok) reached = STEPS.length
      fill(
        list,
        STEPS.map(([key, label], i) => {
          const state = i < reached ? 'done' : i === reached && !finished ? 'now' : finished && !ok && i === reached ? 'failed' : 'todo'
          const mark = { done: icon('fa-check-circle text-success'), now: icon('fa-spinner fa-spin text-info'), failed: icon('fa-times-circle text-danger'), todo: icon('fa-circle-o text-muted') }[state]
          return el('li', { class: `fpim-step fpim-step-${state}`, 'data-step': key }, mark, ' ', label)
        })
      )
      const s = Math.round((Date.now() - started) / 1000)
      fill(clock, finished ? `Took ${span(s)}.` : `${span(s)} so far — usually a minute or two. You can close this; the sync carries on.`)
      pre.textContent = output || 'Working…'
      pre.scrollTop = pre.scrollHeight
    }

    ;(async () => {
      try {
        await request('POST', adminPath('/sync'))
      } catch (error) {
        // 409: one is already running, so follow that one.
        if (error.status !== 409) {
          fill(note, el('div', { class: 'alert alert-danger' }, error.status === 403 ? 'This computer’s PIM token cannot run the sync (Pim → admin).' : error.message))
          return paint('', true, false)
        }
      }
      paint('', false, false)
      for (;;) {
        await sleep(2500)
        let r
        try {
          r = await request('GET', adminPath('/sync'))
        } catch {
          continue
        }
        const output = r.output ?? ''
        if (!r.running) {
          const ok = r.exitCode === 0 && !/FAILED/.test(output)
          if (open) {
            paint(output, true, ok)
            const nothing = /nothing to import/.test(output)
            fill(note, el('div', { class: `alert alert-${ok ? 'success' : 'danger'}` }, ok ? (nothing ? 'Done — TradePeg had nothing new.' : 'Done — the PIM has TradePeg’s latest.') : `The sync failed${r.exitCode ? ` (exit ${r.exitCode})` : ''}. The details say why.`))
            fill(closeBtn, 'Close')
            closeBtn.className = 'btn btn-sm btn-primary'
          }
          if (ok) await onDone?.()
          return
        }
        if (open) paint(output, false, false)
      }
    })()
    return d
  }

  const kv = (pairs) => el('div', { class: 'fpim-kv' }, pairs.filter(([, v]) => v != null && v !== '').flatMap(([k, v]) => [el('div', {}, k), el('div', {}, v)]))

  const spinner = (text = ' Loading…') => el('p', { class: 'text-muted' }, icon('fa-spinner fa-spin'), text)
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

  /** Start a background job (category imports) and wait for it, showing progress in `out`. */
  async function runJob(start, out, alive) {
    fill(out, spinner(' Working… this can take a minute.'))
    try {
      let job = await start()
      while (job.status === 'running' && alive()) {
        await sleep(1500)
        job = await request('GET', adminPath(`/jobs/${job.id}`))
      }
      if (!alive()) return null
      if (job.status === 'failed') fill(out, el('div', { class: 'alert alert-danger' }, job.error))
      else {
        const r = job.result ?? {}
        fill(out, 
          el('div', { class: 'alert alert-success' }, 'Done.'),
          typeof r === 'object' ? kv(Object.entries(r).filter(([, v]) => typeof v !== 'object').map(([k, v]) => [k, String(v)])) : null
        )
      }
      return job
    } catch (error) {
      if (alive()) fill(out, el('div', { class: 'alert alert-danger' }, error.message))
      return null
    }
  }

  // ---------------------------------------------------------------- overview

  GM_addStyle(`
    .fpim .fpim-kpis .fpim-statcell { padding-top: 8px; padding-bottom: 8px; }
    .fpim .fpim-kpis .fpim-stat { font-size: 26px; font-weight: 600; line-height: 1.1; font-variant-numeric: tabular-nums; }
    .fpim .fpim-kpis .fpim-sub { font-size: 12px; color: #777; }
    .fpim .fpim-kpis .fpim-bar { margin: 6px 0 0; height: 6px; max-width: 220px; }
    .fpim .fpim-misslist { list-style: none; margin: 0; padding: 4px 0; }
    .fpim .fpim-misslist a { display: grid; grid-template-columns: 200px 1fr 56px; gap: 12px; align-items: center; padding: 5px 12px; color: inherit; text-decoration: none; }
    .fpim .fpim-misslist a:hover, .fpim .fpim-misslist a:focus { background: #f5f5f5; }
    .fpim .fpim-misslist a > span:first-child::first-letter { text-transform: uppercase; }
    .fpim .fpim-misslist .fpim-bar { margin: 0; height: 8px; }
    .fpim .fpim-misslist .fpim-bar > div { background: #3c8dbc; opacity: .75; }
    .fpim .fpim-misslist .fpim-count { text-align: right; color: #777; font-variant-numeric: tabular-nums; }
    .fpim .fpim-dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 6px; vertical-align: 0; }
    .fpim .fpim-ovbox { padding: 10px 12px; }
    .fpim .fpim-ovbox p { margin: 0 0 6px; }
    .fpim .fpim-listed { display: flex; align-items: center; padding: 3px 0; }
    .fpim .fpim-listed > span:nth-child(2) { flex: 1; }
    .fpim .fpim-score { display: inline-block; min-width: 42px; padding: 2px 4px; border-radius: 3px; color: #fff; font-weight: 600; font-size: 12px; text-align: center; }
    .fpim .fpim-worst td { vertical-align: middle; }
    .fpim .fpim-ro-box { display: flex; align-items: center; justify-content: space-between; gap: 6px; background: #f5f5f5; color: #555; cursor: default; overflow: hidden; white-space: nowrap; }
    .fpim .fpim-ro-box > span { overflow: hidden; text-overflow: ellipsis; }
    .fpim .fpim-ready-note { margin-top: 2px; }
    .fpim .form-control.fpim-need { border-color: #f0ad4e; box-shadow: inset 0 0 0 1px rgba(240,173,78,.35); }
    .fpim .fpim-vtable tr.fpim-eol > td { opacity: .6; }
    .fpim .fpim-vtable td.fpim-chev, .fpim .fpim-vtable th.fpim-chev { width: 30px; text-align: center; }
    .fpim .fpim-vtable td.fpim-vthumb, .fpim .fpim-vtable th.fpim-vthumb { width: 46px; text-align: center; }
    .fpim .fpim-vtable .fpim-noimg { display: inline-block; width: 36px; height: 36px; line-height: 34px; border: 1px dashed #ccc; color: #bbb; }
    .fpim .fpim-units { width: auto; min-width: 60%; background: #fff; margin-bottom: 4px; }
    .fpim .fpim-units td, .fpim .fpim-units th { padding: 4px 10px !important; }
    .fpim .fpim-amber { color: #c77c02; }
    .fpim .fpim-dragtile { cursor: grab; }
    .fpim .fpim-dragtile.fpim-dragging { opacity: .4; }
    .fpim .fpim-dragtile.fpim-dropon { box-shadow: 0 0 0 2px #3c8dbc; }
  `)

  const scoreColour = (n) => (n >= 80 ? '#5cb85c' : n >= 50 ? '#f0ad4e' : '#d9534f')

  /**
   * The PIM's front page, as a TradePeg dashboard: the catalogue in numbers,
   * what is missing most (each opens Parents filtered to it), the TradePeg
   * sync, where products are listed, and the least complete parents.
   */
  async function overviewTool(content, alive) {
    headerActions(el('a', { href: '#pim/products', class: 'btn btn-default', onclick: (e) => { e.preventDefault(); openTools('products') } }, 'Parents ', icon('fa-arrow-right')))
    const kpis = el('div', {}, spinner())
    const missing = el('div', {}, spinner())
    const sync = el('div', { class: 'fpim-ovbox' }, spinner())
    const listed = el('div', { class: 'fpim-ovbox' }, spinner())
    const worst = el('div', {}, spinner())
    fill(
      content,
      tpPanel('Catalogue', null, kpis),
      el(
        'div',
        { class: 'row' },
        el('div', { class: 'col-md-8' }, tpPanel(el('span', { title: 'Click one to see the parents it affects' }, 'What is missing most'), null, missing)),
        el(
          'div',
          { class: 'col-md-4' },
          tpPanel('TradePeg sync', headButton([icon('fa-refresh'), ' Sync details'], () => openTools('sync'), 'btn-info', { title: 'Codes, units and GTINs come in from TradePeg' }), sync),
          tpPanel('Listed on', null, listed)
        )
      ),
      tpPanel(el('span', { title: 'The quickest wins' }, 'Least complete'), null, worst)
    )

    const paintSync = (s) => {
      const tp = s.tradepeg
      const running = s.tradepegRunning
      const failed = tp?.status === 'failed'
      const partial = tp?.status === 'partial'
      const [colour, words] = running
        ? ['#5bc0de', 'Syncing now…']
        : failed
          ? ['#d9534f', 'Last sync failed']
          : partial
            ? ['#f0ad4e', 'Synced with problems']
            : ['#5cb85c', tp ? `Up to date — synced ${ago(tp.lastSuccessAt ?? tp.finishedAt)}` : 'Not synced yet']
      const issues = (s.issues?.errors ?? 0) + (s.issues?.warnings ?? 0)
      fill(
        sync,
        el('p', {}, el('span', { class: 'fpim-dot', style: `background:${colour}` }), el('strong', {}, tp || running ? words : 'Not synced yet')),
        el('p', { class: 'text-muted' }, `Last checked ${ago(tp?.checkedAt ?? tp?.finishedAt)}`),
        issues
          ? el('p', {}, el('a', { href: '#pim/sync', class: 'text-warning', onclick: (e) => { e.preventDefault(); openTools('sync') } }, icon('fa-exclamation-triangle'), ` ${s.issues.errors ?? 0} errors, ${s.issues.warnings ?? 0} warnings to fix`))
          : null
      )
    }
    const loadSync = async () => {
      try {
        const s = await request('GET', adminPath('/state'))
        if (alive()) paintSync(s)
      } catch (error) {
        if (alive()) fill(sync, el('p', { class: 'text-danger' }, error.message))
      }
    }
    void loadSync()
    const timer = setInterval(() => (alive() ? void loadSync() : clearInterval(timer)), 60000)

    let s
    try {
      s = await request('GET', adminPath('/status'))
    } catch (error) {
      if (!alive()) return
      const box = el('div', { class: 'fpim-ovbox' })
      toolError(box, error, () => overviewTool(content, alive))
      fill(kpis, box)
      for (const x of [missing, listed, worst]) fill(x)
      return
    }
    if (!alive()) return
    const live = s.products.total - s.products.archived
    const ready = s.products.byStatus?.ready ?? 0
    const avg = s.completeness.average
    const kpi = (label, value, sub, extra = null) =>
      el('div', { class: 'col-md-3 fpim-field fpim-statcell' }, el('div', { class: 'fpim-stat' }, value), sub ? el('div', { class: 'fpim-sub' }, sub) : null, extra, el('div', { class: 'help-block' }, label))
    fill(
      kpis,
      el(
        'div',
        { class: 'formRow fluid fpim-kpis' },
        kpi('Products', live.toLocaleString('en-GB'), `${s.products.archived} archived`),
        kpi('Ready', ready.toLocaleString('en-GB'), live ? `${Math.round((ready / live) * 100)}% of live products` : null),
        kpi('Average completeness', `${avg}%`, null, el('div', { class: 'fpim-bar' }, el('div', { style: `width:${avg}%;background:${scoreColour(avg)}` }))),
        kpi('Variants', (s.variants.total - s.variants.eol).toLocaleString('en-GB'), `${s.variants.eol} end-of-life${s.variants.withoutUnits ? ` · ${s.variants.withoutUnits} without units` : ''}`),
        el('div', { class: 'clear' })
      )
    )

    const top = (s.completeness.missing ?? []).slice(0, 9)
    fill(
      missing,
      top.length
        ? el(
            'ul',
            { class: 'fpim-misslist' },
            top.map((m) =>
              el(
                'li',
                {},
                el(
                  'a',
                  { href: '#pim/products', title: `Show the ${plural(m.count, 'parent')} missing ${m.check}`, onclick: (e) => { e.preventDefault(); openParentsFiltered({ missing: [m.check] }) } },
                  el('span', {}, m.check),
                  el('span', { class: 'fpim-bar' }, el('div', { style: `width:${(m.count / Math.max(1, live)) * 100}%` })),
                  el('span', { class: 'fpim-count' }, m.count.toLocaleString('en-GB'))
                )
              )
            )
          )
        : el('div', { class: 'fpim-ovbox text-success' }, icon('fa-check-circle'), ' Every live product is complete.')
    )

    fill(
      listed,
      [
        ['web', 'Website', '#5cb85c'],
        ['google', 'Google Shopping', '#5bc0de'],
        ['ebay', 'eBay', '#f0ad4e'],
      ].map(([key, label, colour]) =>
        el('div', { class: 'fpim-listed' }, el('span', { class: 'fpim-dot', style: `background:${colour}` }), el('span', {}, label), el('span', { class: 'text-muted' }, (s.products.channels?.[key] ?? '—').toLocaleString('en-GB')))
      )
    )

    const open = (sku) => (e) => { e.preventDefault(); openTools('parent', sku) }
    fill(
      worst,
      el(
        'table',
        { class: 'table-grid table-bordered table-hover fpim-worst' },
        el('thead', {}, el('tr', {}, el('th', { style: 'width:70px' }, 'Complete'), el('th', { style: 'width:170px' }, 'Reference'), el('th', {}, 'Title'), el('th', {}, 'Missing'))),
        el(
          'tbody',
          {},
          (s.completeness.worst ?? []).slice(0, 10).map((w) =>
            el(
              'tr',
              {},
              el('td', {}, el('span', { class: 'fpim-score', style: `background:${scoreColour(w.score)}` }, `${w.score}%`)),
              el('td', { class: 'fpim-sku' }, el('a', { href: `#pim/parent/${encodeURIComponent(w.sku)}`, onclick: open(w.sku) }, w.sku)),
              el('td', {}, w.label || el('span', { class: 'text-muted' }, 'No title')),
              el('td', { class: 'text-muted' }, (w.missing ?? []).join(' · '))
            )
          )
        )
      )
    )
  }

  // ---------------------------------------------------------------- products

  const FACETS = [
    ['status', 'Status'],
    ['missing', 'Missing'],
    ['categories', 'Category'],
    ['brand', 'Brand'],
    ['manufacturer', 'Manufacturer'],
    ['channels', 'Channels'],
    ['tags', 'Tags'],
    ['kind', 'Type'],
  ]
  const NICE = { draft: 'Draft', ready: 'Ready', varpar: 'VARPAR', solopar: 'SOLOPAR', single: 'Single part' }
  const facetLabel = (o) => o.label ?? NICE[o.value] ?? String(o.value)
  const shown = (v) => (Array.isArray(v) ? v.join(', ') || '—' : v === true ? 'on' : v === false ? 'off' : v == null || v === '' ? '—' : String(v))

  const BULK = [
    ['status', 'Set status'],
    ['brand', 'Set brand'],
    ['channels', 'Turn channels on or off'],
    ['categories-add', 'Add categories'],
    ['categories-remove', 'Remove categories'],
    ['categories-replace', 'Replace categories'],
    ['tags-add', 'Add tags'],
    ['tags-remove', 'Remove tags'],
    ['google', 'Set Google category'],
    ['ebay', 'Set eBay category'],
    ['replace', 'Find and replace text'],
  ]
  const bulkLabel = (k) => BULK.find(([key]) => key === k)?.[1] ?? k

  /** The bulk actions as a row of buttons, grouped so the row stays short. */
  function bulkButtons(open) {
    const pick = (keys) => keys.map((k) => [bulkLabel(k), () => open(k)])
    return [
      button('Status', () => open('status')),
      button('Brand', () => open('brand')),
      button('Channels', () => open('channels')),
      menuButton('Categories', pick(['categories-add', 'categories-remove', 'categories-replace']), 'btn-default', { up: true }),
      menuButton('Tags', pick(['tags-add', 'tags-remove']), 'btn-default', { up: true }),
      menuButton('Google / eBay', pick(['google', 'ebay']), 'btn-default', { up: true }),
      button('Find & replace', () => open('replace')),
    ]
  }

  /**
   * One bulk change, in a dialog: choose it, see exactly what would change
   * (nothing is saved yet), then apply.
   */
  function bulkDialog({ action, count, target, intro, onDone }) {
    let current = action
    let inputs = null
    const box = el('div')
    const out = el('div')
    const select = el('select', { class: 'form-control', style: 'max-width:280px' }, BULK.map(([k, l]) => el('option', { value: k }, l)))
    select.value = action
    const paintInputs = () => {
      inputs = bulkInputs(current)
      fill(box, inputs.node)
      fill(out, )
    }
    select.addEventListener('change', () => {
      current = select.value
      paintInputs()
      stale()
    })
    paintInputs()
    // A preview describes the inputs as they were: change them and Apply waits for a new one.
    box.addEventListener('input', () => stale())
    box.addEventListener('click', (e) => { if (e.target.closest('.fpim-chip button, .fpim-options li')) setTimeout(stale, 0) })
    box.addEventListener('mousedown', (e) => { if (e.target.closest('.fpim-options li')) setTimeout(stale, 0) })
    const applyBtn = button('Apply', () => void send(true), 'btn-success', { style: 'display:none' })
    const previewBtn = button('Preview the change', () => void send(false), 'btn-primary')
    function stale() {
      if (applyBtn.style.display === 'none') return
      applyBtn.style.display = 'none'
      previewBtn.className = 'btn btn-sm btn-primary'
      const note = out.querySelector('.alert')
      if (note) fill(note, 'You changed the choice since the preview. Preview again to see what would change.')
    }

    async function send(apply) {
      let job
      try {
        job = inputs.read()
      } catch (error) {
        return fill(out, el('div', { class: 'alert alert-warning' }, error.message))
      }
      fill(out, spinner(apply ? ' Saving…' : ' Working out what would change…'))
      applyBtn.disabled = previewBtn.disabled = true
      try {
        const r = await request('POST', adminPath('/products/bulk'), { json: { ...job, ...target, apply }, timeout: 600000 })
        applyBtn.disabled = previewBtn.disabled = false
        if (apply) {
          d.close()
          if (r.failed?.length) failedReport(r)
          else toast('success', `Changed ${plural(r.changed, 'parent')}.`)
          return onDone?.(r)
        }
        fill(out, 
          el(
            'div',
            { class: `alert ${r.changing ? 'alert-info' : 'alert-warning'}` },
            r.changing ? `${plural(r.changing, 'parent')} of ${r.selected} would change. Nothing is saved yet — check the list, then Apply.` : `None of the ${r.selected} would change.`
          ),
          r.sample.length
            ? el(
                'table',
                { class: 'fpim-table' },
                el('thead', {}, el('tr', {}, el('th', {}, 'SKU'), el('th', {}, 'Field'), el('th', {}, 'Now'), el('th', {}, 'Will be'))),
                el(
                  'tbody',
                  {},
                  r.sample.flatMap((x) =>
                    Object.entries(x.diff).map(([name, [was, next]]) =>
                      el('tr', {}, el('td', { class: 'fpim-sku' }, x.sku), el('td', {}, name), el('td', {}, shown(was)), el('td', {}, shown(next)))
                    )
                  )
                )
              )
            : null,
          r.changing > r.sample.length ? el('p', { class: 'fpim-help' }, `Showing the first ${r.sample.length}.`) : null
        )
        fill(applyBtn, icon('fa-check'), ` Apply to ${plural(r.changing, 'parent')}`)
        applyBtn.style.display = r.changing ? '' : 'none'
        previewBtn.className = `btn btn-sm ${r.changing ? 'btn-default' : 'btn-primary'}`
        if (r.changing) applyBtn.focus()
      } catch (error) {
        applyBtn.disabled = previewBtn.disabled = false
        fill(out, el('div', { class: 'alert alert-danger' }, error.status === 403 ? 'This computer’s PIM token cannot bulk edit (Pim → admin).' : error.message))
      }
    }

    const d = dialog(
      `Change ${plural(count, 'parent')}`,
      [intro ?? null, el('div', { class: 'row' }, field('Change', select, null, 5), field('To', box, null, 7)), out],
      [button('Cancel', () => d.close()), previewBtn, applyBtn]
    )
    return d
  }

  /**
   * What a bulk change could not save, grouped by reason: "Not priced in the
   * repricer yet — 98 parents", each parent with its details, and a CSV of it
   * all (one row per parent and reason) to work through or pass on.
   */
  const FAIL_REASONS = [
    { key: 'unpriced', label: 'Not priced in the repricer yet', fix: 'Price these units in Farla Tools → Repricer, then try again.', test: /^Not priced in the repricer yet:\s*/i },
    { key: 'missing', label: 'Parts missing variation values', fix: 'Give each part a value for every variation type (parent page, or AI → Variations).', test: /^Missing variation values on\s*/i },
    { key: 'same', label: 'Parts with the same variation values', fix: 'No two parts may have the same values: change one, or add a variation type.', test: /\s*have the same variation values$/i },
    { key: 'unitdesc', label: 'Units without a description', fix: 'Give each unit its description in TradePeg (e.g. "Box of 100"); the PIM picks it up at the next sync.', test: /^Unit descriptions missing in TradePeg:\s*/i },
    { key: 'notypes', label: 'Several parts but no variation types', fix: 'Choose what the parts differ by (Size, Colour…), or AI → Variations.', test: /several parts but no variation types/i },
    { key: 'noparts', label: 'No live parts', fix: 'Every part has ended in TradePeg.', test: /no live parts/i },
  ]
  function failedReport(r) {
    // The server sends each reason on its own; an older one, one sentence to split.
    const reasonsOf = (x) =>
      (x.problems?.length ? x.problems : String(x.message ?? '').replace(/^It cannot be Ready yet\.\s*/, '').replace(/\.$/, '').split(/\.\s+(?=[A-Z0-9])/))
        .map((t) => String(t).trim())
        .filter(Boolean)
    const rows = r.failed.flatMap((x) =>
      reasonsOf(x).map((text) => {
        const reason = FAIL_REASONS.find((g) => g.test.test(text))
        const detail = reason ? text.replace(reason.test, '').trim() : text
        return { sku: x.sku, reason: reason?.key ?? 'other', label: reason?.label ?? 'Other', detail: reason?.key === 'notypes' || reason?.key === 'noparts' ? '' : detail }
      })
    )
    const groups = [...FAIL_REASONS, { key: 'other', label: 'Other', fix: '' }]
      .map((g) => ({ ...g, rows: rows.filter((x) => x.reason === g.key) }))
      .filter((g) => g.rows.length)
    const short = (text) => {
      const parts = text.split(/,\s*/)
      return parts.length > 6 ? `${parts.slice(0, 6).join(', ')} and ${parts.length - 6} more` : text
    }
    const csv = () => {
      const cell = (v) => (/[",\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
      const lines = [['Parent', 'Reason', 'Details'], ...rows.map((x) => [x.sku, x.label, x.detail])].map((l) => l.map(cell).join(','))
      // With the byte-order mark Excel needs to read it as UTF-8.
      saveFile({ blob: new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), name: `pim-not-saved-${new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-')}.csv` })
    }
    const d = dialog(
      `${plural(r.failed.length, 'parent')} not saved`,
      [
        el('div', { class: 'alert alert-warning' }, `Changed ${plural(r.changed, 'parent')}. ${plural(r.failed.length, 'parent')} could not be saved, for the reasons below. Download the list to work through it.`),
        groups.map((g) =>
          el(
            'details',
            { class: 'fpim-issue', open: groups.length === 1 },
            el('summary', {}, el('span', { class: 'label label-warning' }, new Set(g.rows.map((x) => x.sku)).size), ' ', g.label),
            el(
              'div',
              { class: 'fpim-issue-body' },
              g.fix ? el('p', { class: 'text-muted' }, g.fix) : null,
              el(
                'table',
                { class: 'fpim-table' },
                el('tbody', {}, g.rows.map((x) => el('tr', {}, el('td', { class: 'fpim-sku', style: 'white-space:nowrap;width:150px' }, el('a', { href: `#pim/parent/${encodeURIComponent(x.sku)}`, onclick: (e) => { e.preventDefault(); d.close(); openTools('parent', x.sku) } }, x.sku)), el('td', { title: x.detail.length > 80 ? x.detail : null }, short(x.detail) || '—'))))
              )
            )
          )
        ),
      ],
      [button([icon('fa-download'), ' Download the list (CSV)'], csv, 'btn-primary'), button('Close', () => d.close())]
    )
  }

  /**
   * The inputs for one bulk action. Returns the element, and `read()` — the
   * request it describes, or an error saying what is missing.
   */
  function bulkInputs(action) {
    if (action === 'status') {
      const select = el('select', { class: 'form-control', style: 'max-width:200px' }, el('option', { value: 'ready' }, 'Ready'), el('option', { value: 'draft' }, 'Draft'))
      return { node: select, read: () => ({ action: 'status', params: { status: select.value } }) }
    }
    if (action === 'channels') {
      const pick = (label) => {
        const select = el('select', { class: 'form-control' }, el('option', { value: '' }, 'No change'), el('option', { value: 'on' }, 'On'), el('option', { value: 'off' }, 'Off'))
        return { select, node: el('label', { style: 'font-weight:normal' }, label, select) }
      }
      const web = pick('Website')
      const google = pick('Google Shopping')
      const ebay = pick('eBay')
      return {
        node: el('div', { class: 'fpim-row' }, web.node, google.node, ebay.node),
        read: () => {
          const set = {}
          for (const [key, p] of [['channelWeb', web], ['channelGoogle', google], ['channelEbay', ebay]]) if (p.select.value) set[key] = p.select.value === 'on'
          if (!Object.keys(set).length) throw new Error('Choose On or Off for at least one channel.')
          return { action: 'fields', params: { set } }
        },
      }
    }
    if (action === 'replace') {
      const find = el('input', { class: 'form-control', placeholder: 'Find' })
      const replace = el('input', { class: 'form-control', placeholder: 'Replace with (empty removes it)' })
      return {
        node: el('div', { class: 'fpim-row fpim-grow' }, find, replace, el('span', { class: 'fpim-help' }, 'In titles, descriptions, key features, specs and SEO text. Not case sensitive.')),
        read: () => {
          if (!find.value) throw new Error('Type what to find.')
          return { action: 'replace', params: { find: find.value, replace: replace.value } }
        },
      }
    }
    // Everything else picks from one of the PIM's lists.
    const [kind, mode] = action.split('-')
    const listKind = { brand: 'brands', categories: 'categories', tags: 'tags', google: 'google', ebay: 'ebay' }[kind]
    const single = ['brand', 'google', 'ebay'].includes(kind)
    let chosen = []
    const node = el(
      'div',
      {},
      selectBox({
        kind: listKind,
        multiple: !single,
        value: single ? null : [],
        placeholder: { brands: 'Choose or type a brand', categories: 'Type to find categories', tags: 'Type to find or add tags', google: 'Type a Google category name or number', ebay: 'Type an eBay category name or number' }[listKind],
        allowNew: kind === 'brand' || (kind === 'tags' && mode === 'add'),
        short: kind === 'categories' ? (c) => String(c.path).split(' > ').at(-1) : null,
        disabled: false,
        onChange: (v) => {
          chosen = single ? (v ? [v] : []) : v
          node.dispatchEvent(new Event('input', { bubbles: true }))
        },
      })
    )
    node.classList.add('fpim-grow')
    return {
      node,
      read: () => {
        if (!chosen.length) throw new Error('Pick something first.')
        if (kind === 'brand') return { action: 'fields', params: { set: { brand: chosen[0].name } } }
        if (kind === 'google') return { action: 'fields', params: { set: { googleCategory: { id: chosen[0].id, path: chosen[0].path } } } }
        if (kind === 'ebay') return { action: 'fields', params: { set: { ebayCategory: { id: chosen[0].id, path: chosen[0].path } } } }
        if (kind === 'categories') return { action: 'categories', params: { ids: chosen.map((c) => c.id), mode: mode === 'replace' ? 'replace' : mode } }
        return { action: 'tags', params: { names: chosen.map((c) => c.name), mode } }
      },
    }
  }

  // ---------------------------------------------------------------- each user's own choices

  /** The TradePeg user signed in, as TradePeg's top bar shows them. */
  const tpUser = () => document.querySelector('.profile-dropdown-text .username, span.username')?.textContent.trim() || ''
  const PREF_KEY = (key) => `pimPref:${key}`

  /**
   * A choice kept per TradePeg user in the PIM, so it follows them to any
   * computer; this browser keeps a copy for when the PIM cannot be asked.
   */
  async function loadPref(key, fallback) {
    const local = GM_getValue(PREF_KEY(key))
    const user = tpUser()
    if (!user || !hasToken()) return local ?? fallback
    try {
      const mine = await request('GET', adminPath(`/prefs/${encodeURIComponent(user)}`))
      if (mine?.[key] !== undefined) {
        GM_setValue(PREF_KEY(key), mine[key])
        return mine[key]
      }
    } catch { /* the copy here will do */ }
    return local ?? fallback
  }
  async function savePref(key, value) {
    if (value == null) GM_deleteValue(PREF_KEY(key))
    else GM_setValue(PREF_KEY(key), value)
    const user = tpUser()
    if (!user || !hasToken()) return
    try {
      await request('PUT', adminPath(`/prefs/${encodeURIComponent(user)}`), { json: { key, value: value ?? null } })
    } catch (error) {
      toast('warning', `Saved on this computer only: ${error.message}`)
    }
  }

  // ---------------------------------------------------------------- the parents list's columns

  const CHANNEL_NAMES = { web: 'Website', google: 'Google', ebay: 'eBay' }
  /** Every column the parents list can show. `sort` is the PIM's sort key, when it sorts. */
  function parentColumns(customFields = [], priced = null) {
    const nowrap = { style: 'white-space:nowrap' }
    return [
      // As on TradePeg's Parts list: the picture opens the parent (a click elsewhere ticks the row).
      { key: 'image', label: 'Image', cell: (r) => el('td', { class: 'fpim-thumb' }, el('a', { href: `#pim/parent/${encodeURIComponent(r.sku)}`, title: `Open ${r.sku}`, onclick: (e) => { e.preventDefault(); openTools('parent', r.sku) } }, r.thumbnail ? el('img', { src: r.thumbnail, alt: '' }) : el('span', { class: 'fpim-noimg', title: 'No picture yet' }, icon('fa-picture-o')))) },
      { key: 'sku', label: 'Reference', sort: 'sku', locked: true, cell: (r) => el('td', nowrap, el('a', { href: `#pim/parent/${encodeURIComponent(r.sku)}`, onclick: (e) => { e.preventDefault(); openTools('parent', r.sku) } }, r.sku), r.archived ? el('span', { class: 'label label-danger ml5' }, 'Archived') : null) },
      { key: 'label', label: 'Title', sort: 'label', cell: (r) => el('td', {}, r.label) },
      { key: 'status', label: 'Status', sort: 'status', cell: (r) => el('td', { style: 'white-space:nowrap' }, el('span', { class: `label ${r.status === 'ready' ? 'label-success' : 'label-default'}` }, NICE[r.status] ?? r.status), pricingBadge(r.units ?? [], priced)) },
      { key: 'kind', label: 'Type', sort: 'kind', cell: (r) => el('td', {}, NICE[r.kind] ?? r.kind ?? '') },
      { key: 'brand', label: 'Brand', sort: 'brand', cell: (r) => el('td', {}, r.brand ?? '') },
      { key: 'manufacturer', label: 'Manufacturer', sort: 'manufacturer', cell: (r) => el('td', {}, r.manufacturer ?? '') },
      { key: 'farlaBranded', label: 'Farla branded', cell: (r) => el('td', {}, r.farlaBranded ? 'Yes' : 'No') },
      { key: 'completeness', label: 'Complete', sort: 'completeness', cell: (r) => el('td', { title: r.missing.length ? `Missing: ${r.missing.join(', ')}` : 'Nothing missing' }, `${r.completeness}%`) },
      { key: 'missing', label: 'Missing', cell: (r) => el('td', { class: 'text-muted' }, r.missing.join(', ')) },
      { key: 'channels', label: 'Channels', cell: (r) => el('td', {}, ['web', 'google', 'ebay'].filter((c) => r.channels[c]).map((c) => CHANNEL_NAMES[c]).join(', ')) },
      { key: 'categories', label: 'Categories', cell: (r) => el('td', {}, r.categories.map((c) => String(c).split(' > ').at(-1)).join(', ')) },
      { key: 'tags', label: 'Tags', cell: (r) => el('td', {}, r.tags.join(', ')) },
      { key: 'googleCategory', label: 'Google category', cell: (r) => el('td', { title: r.googleCategory ?? '' }, String(r.googleCategory ?? '').split(' > ').at(-1)) },
      { key: 'ebayCategory', label: 'eBay category', cell: (r) => el('td', { title: r.ebayCategory ?? '' }, String(r.ebayCategory ?? '').split(' > ').at(-1)) },
      { key: 'variationTypes', label: 'Variation types', cell: (r) => el('td', {}, (r.variationTypes ?? []).join(', ')) },
      // Filled or empty, at a glance.
      ...[
        ['description', 'Description', (n) => `${n} characters`],
        ['bullets', 'Key features', (n) => plural(n, 'key feature')],
        ['specs', 'Specs', (n) => plural(n, 'spec')],
        ['contents', 'In the box', (n) => plural(n, 'item')],
      ].map(([key, label, says]) => ({
        key: `has-${key}`,
        label,
        cell: (r) => {
          const n = r.content?.[key] ?? 0
          return el('td', { class: 'text-center', title: n ? says(n) : 'Empty' }, n ? el('span', { class: 'text-success' }, icon('fa-check'), ' Yes') : el('span', { class: 'label label-default' }, 'Empty'))
        },
      })),
      { key: 'variants', label: 'Variants', sort: 'variants', cell: (r) => el('td', {}, r.variants) },
      ...customFields.map((x) => ({
        key: `custom.${x.key}`,
        label: x.label,
        sort: `custom.${x.key}`,
        cell: (r) => {
          const v = r.custom?.[x.key]
          return el('td', {}, v == null || v === '' ? '' : x.type === 'yesno' ? (v ? 'Yes' : 'No') : x.type === 'link' ? el('a', { href: v, target: '_blank', rel: 'noreferrer' }, 'Open') : String(v))
        },
      })),
      { key: 'createdAt', label: 'Created', sort: 'createdAt', cell: (r) => el('td', nowrap, when(r.createdAt)) },
      { key: 'updatedAt', label: 'Modified', sort: 'updatedAt', cell: (r) => el('td', nowrap, when(r.updatedAt)) },
    ]
  }
  const DEFAULT_PARENT_COLUMNS = ['image', 'sku', 'label', 'status', 'brand', 'has-description', 'has-bullets', 'has-specs', 'has-contents', 'completeness', 'channels', 'variants', 'updatedAt']

  /** Like TradePeg's column chooser: tick the columns to show, drag them into order. */
  function columnsDialog(all, chosen, onSave) {
    const order = [...chosen.filter((k) => all.some((c) => c.key === k)), ...all.map((c) => c.key).filter((k) => !chosen.includes(k))]
    const on = new Set(chosen)
    const list = el('ul', { class: 'fpim-colpicker' })
    let dragging = null
    const paint = () =>
      fill(
        list,
        order.map((key, i) => {
          const c = all.find((x) => x.key === key)
          const box = el('input', { type: 'checkbox', disabled: c.locked })
          box.checked = on.has(key) || c.locked
          box.addEventListener('change', () => { if (box.checked) on.add(key); else on.delete(key); paint() })
          const li = el(
            'li',
            { draggable: 'true', class: on.has(key) || c.locked ? 'fpim-on' : '' },
            el('span', { class: 'fpim-grip', title: 'Drag to move' }, icon('fa-bars')),
            el('label', {}, box, ' ', c.label, c.locked ? el('span', { class: 'text-muted' }, ' (always shown)') : null),
            el(
              'span',
              { class: 'btn-group' },
              iconButton('fa-arrow-up', `Move ${c.label} up`, () => { if (i) { order.splice(i - 1, 0, ...order.splice(i, 1)); paint() } }, { disabled: i === 0 }),
              iconButton('fa-arrow-down', `Move ${c.label} down`, () => { if (i < order.length - 1) { order.splice(i + 1, 0, ...order.splice(i, 1)); paint() } }, { disabled: i === order.length - 1 })
            )
          )
          li.addEventListener('dragstart', () => { dragging = key; li.classList.add('fpim-dragging') })
          li.addEventListener('dragend', () => { dragging = null; paint() })
          li.addEventListener('dragover', (e) => {
            e.preventDefault()
            if (!dragging || dragging === key) return
            const from = order.indexOf(dragging)
            order.splice(from, 1)
            order.splice(order.indexOf(key) + (from <= i ? 1 : 0), 0, dragging)
            paint()
          })
          return li
        })
      )
    paint()
    const d = dialog(
      'Columns',
      [el('p', { class: 'text-muted' }, `Tick what the list shows; drag to put them in order. Saved for ${tpUser() || 'you'}.`), list],
      [
        button('Default columns', () => { d.close(); void onSave(null) }, 'btn-link'),
        button('Cancel', () => d.close()),
        button([icon('fa-check'), ' Save'], () => { d.close(); void onSave(order.filter((k) => on.has(k) || all.find((c) => c.key === k)?.locked)) }, 'btn-success'),
      ]
    )
  }

  /** Archived parents in the list: 'hide' (the default), 'show' (with the rest) or 'only'. An old `true` means 'show'. */
  function archivedMode(v) {
    return v === true ? 'show' : v === 'show' || v === 'only' ? v : 'hide'
  }
  /** The Parents list's filter as the PIM takes it (query, bulk, export, saved queues). "Only archived" is a condition. */
  function listFilter(g) {
    const mode = archivedMode(g?.archived)
    return {
      search: g?.search ?? '',
      facets: g?.facets ?? {},
      queue: g?.queue || null,
      archived: mode !== 'hide',
      conditions: mode === 'only' ? [{ field: 'archived', op: 'is_true' }] : [],
    }
  }
  const ARCHIVED_CHOICES = [['hide', 'Hide archived'], ['show', 'Include archived'], ['only', 'Only archived']]

  /**
   * The catalogue, laid out like TradePeg's Items page: a Search panel (search
   * box, then the filters as dropdowns labelled underneath) and a results panel
   * whose rows open the parent. Ticked rows get a bar of bulk changes, always
   * previewed first.
   */
  function productsTool(content, alive) {
    const f = (toolState.grid ??= { search: '', facets: {}, sort: 'sku', direction: 'asc', page: 1, picked: new Set(), all: false, action: 'status' })
    const search = el('input', { class: 'form-control', type: 'search', value: f.search, 'aria-label': 'Search' })
    const searchTools = el('span')
    const facetsTop = el('div', { style: 'display:contents' })
    const facetsMore = el('div', { style: 'display:contents' })
    const notice = el('div')
    const bulkBox = el('div')
    const resultTitle = el('span', {}, 'Parents')
    // The columns this user chose (or the default), read once per visit.
    let columns = f.columns ?? DEFAULT_PARENT_COLUMNS
    const columnsReady = f.columns ? Promise.resolve() : loadPref('parentColumns', null).then((saved) => {
      if (Array.isArray(saved) && saved.length) columns = f.columns = saved
    })
    const columnsBtn = headButton(icon('fa-columns'), () => {
      const all = parentColumns(result?.customFields)
      columnsDialog(all, columns, async (picked) => {
        columns = f.columns = picked ?? DEFAULT_PARENT_COLUMNS
        if (result) paintTable()
        await savePref('parentColumns', picked)
      })
    }, 'btn-warning', { class: 'btn btn-sm btn-warning', title: 'Choose columns', 'aria-label': 'Choose columns' })
    const resultTools = el('span')
    const table = el('div', {}, spinner())
    const resultsPanel = el(
      'div',
      { class: 'panel panel-parts fluid mt10' },
      el('div', { class: 'panel-heading' }, columnsBtn, resultTitle, el('div', { class: 'btns pull-right' }, resultTools)),
      el('div', { class: 'panel-body p0' }, table)
    )
    let result = null
    // The repricer's word on the units of the rows on this page (null until it answers, or on an old PIM).
    let priced = null
    let pricedAsked = 0
    async function askPricing(rows) {
      const mine = ++pricedAsked
      priced = null
      const units = rows.flatMap((r) => r.units ?? [])
      if (!units.length) return
      try {
        const r = await pricingStatus(units)
        if (!r || !alive() || mine !== pricedAsked) return
        priced = r.units ?? {}
        paintTable()
      } catch { /* no badges, then */ }
    }
    let openFacet = null
    const facetFind = {} // what is typed in each filter's find box
    let timer = null
    let asked = 0

    const filter = () => listFilter(f)
    // As TradePeg's "Include EOL": archived parents (no longer in SELECT) are hidden unless asked for.
    f.archived = archivedMode(f.archived)
    const archivedBox = el('select', { class: 'form-control', 'aria-label': 'Archived parents' }, ARCHIVED_CHOICES.map(([k, label]) => el('option', { value: k }, label)))
    archivedBox.value = f.archived
    archivedBox.addEventListener('change', () => {
      f.archived = archivedBox.value
      refilter()
    })

    // Work queues: the built-in lists (No description, No pictures…) with counts, and saved ones.
    const queueBox = el('div', { class: 'col-md-2 fpim-field' })
    let queues = null
    async function loadQueues() {
      try {
        queues = await request('GET', adminPath('/products/queues'))
      } catch {
        queues = { builtIn: [], saved: [] }
      }
      if (alive()) paintQueue()
    }
    function paintQueue() {
      const select = el(
        'select',
        { class: 'form-control', 'aria-label': 'Work queue' },
        el('option', { value: '' }, 'All parents'),
        el('optgroup', { label: 'Work queues' }, (queues?.builtIn ?? []).map((q) => el('option', { value: `q:${q.key}` }, `${q.label} (${q.count})`))),
        queues?.saved?.length ? el('optgroup', { label: 'Saved queues' }, queues.saved.map((q) => el('option', { value: `s:${q.id}` }, `${q.name} (${q.count})${q.by ? ` — ${q.by}` : ''}`))) : null
      )
      select.value = f.savedId ? `s:${f.savedId}` : f.queue ? `q:${f.queue}` : ''
      select.addEventListener('change', () => {
        const [kind, id] = select.value.split(':')
        f.savedId = null
        if (kind === 's') {
          // A saved queue is a set of filters: they all come back as they were saved.
          const q = queues.saved.find((x) => x.id === id)
          f.search = q?.filter?.search ?? ''
          f.facets = q?.filter?.facets ?? {}
          f.queue = q?.filter?.queue ?? null
          f.archived = (q?.filter?.conditions ?? []).some((c) => c?.field === 'archived' && c.op === 'is_true') ? 'only' : archivedMode(q?.filter?.archived)
          archivedBox.value = f.archived
          search.value = f.search
          refilter()
          f.savedId = id
        } else {
          f.queue = kind === 'q' ? id : null
          refilter()
        }
        paintQueue()
      })
      fill(queueBox, select, el('div', { class: 'help-block', title: 'Lists to work through: products missing a description, pictures and so on. Save your own filters as a queue too.' }, 'Work queue'))
    }
    async function saveQueue() {
      const name = prompt('Name this queue (everyone sees it):')
      if (!name?.trim()) return
      try {
        const saved = await request('POST', adminPath('/filters'), { json: { name: name.trim(), filter: filter(), by: tpUser() || null } })
        f.savedId = saved.id
        toast('success', `Saved the queue “${saved.name}”.`)
        await loadQueues()
      } catch (error) {
        toast('danger', error.message)
      }
    }
    async function deleteQueue() {
      const q = queues?.saved.find((x) => x.id === f.savedId)
      if (!q || !confirm(`Delete the saved queue “${q.name}” for everyone?`)) return
      try {
        await request('DELETE', adminPath(`/filters/${encodeURIComponent(q.id)}`))
        f.savedId = null
        await loadQueues()
      } catch (error) {
        toast('danger', error.message)
      }
    }

    async function run() {
      const mine = ++asked
      table.style.opacity = '.5'
      try {
        const r = await request('POST', adminPath('/products/query'), { json: { ...filter(), sort: f.sort, direction: f.direction, page: f.page, pageSize: f.pageSize ?? 50 } })
        await columnsReady
        if (!alive() || mine !== asked) return
        result = r
        table.style.opacity = ''
        paintFacets()
        priced = null
        paintTable()
        paintBulk()
        void askPricing(r.rows ?? [])
      } catch (error) {
        if (alive() && mine === asked) {
          table.style.opacity = ''
          toolError(table, error, run)
        }
      }
    }
    // After "Tick all that match", f.picked holds the ones unticked since; otherwise the ones ticked.
    const isTicked = (id) => f.all !== f.picked.has(id)
    const setTicked = (id, on) => (on !== f.all ? f.picked.add(id) : f.picked.delete(id))
    const refilter = () => {
      f.savedId = null
      f.page = 1
      f.all = false
      f.picked.clear()
      fill(notice)
      void run()
    }

    search.addEventListener('input', () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        f.search = search.value.trim()
        refilter()
      }, 250)
    })

    /** One filter: a box that looks like TradePeg's dropdowns, its label under it. */
    function facet(key, label) {
      const chosen = f.facets[key] ?? []
      // A to Z, as the names read (categories by their full path).
      const options = [...(result.facets?.[key] ?? [])].sort((a, b) => facetLabel(a).localeCompare(facetLabel(b), 'en', { sensitivity: 'base', numeric: true }))
      const names = chosen.map((v) => facetLabel(options.find((o) => o.value === v) ?? { value: v }))
      // A long list gets a box to type in, which narrows it (and stays as typed while ticking).
      const searchable = options.length > 8
      const find = searchable ? el('input', { class: 'form-control input-sm fpim-facet-find', type: 'search', placeholder: `Type to find a ${label.toLowerCase()}…`, 'aria-label': `Find a ${label.toLowerCase()}`, value: facetFind[key] ?? '' }) : null
      const matching = (o) => {
        const term = (facetFind[key] ?? '').trim().toLowerCase()
        return !term || chosen.includes(o.value) || facetLabel(o).toLowerCase().includes(term)
      }
      const list = el('div', { class: 'fpim-facet-list' })
      const paintList = () => {
        const shownOptions = options.filter(matching)
        fill(
          list,
          shownOptions.length
            ? shownOptions.slice(0, 400).map((o) => {
                const box = el('input', { type: 'checkbox' })
                box.checked = chosen.includes(o.value)
                box.addEventListener('change', () => {
                  const next = new Set(chosen)
                  if (box.checked) next.add(o.value)
                  else next.delete(o.value)
                  f.facets = { ...f.facets, [key]: [...next] }
                  refilter()
                })
                return el('label', {}, box, el('span', {}, facetLabel(o)), el('em', { class: 'text-muted' }, o.count))
              })
            : el('span', { class: 'text-muted' }, options.length ? 'Nothing matches.' : 'Nothing to choose'),
          shownOptions.length > 400 ? el('div', { class: 'fpim-help' }, `${shownOptions.length} — type to narrow them down`) : null
        )
      }
      paintList()
      find?.addEventListener('input', () => {
        facetFind[key] = find.value
        paintList()
      })
      // Enter ticks the only match.
      find?.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return
        e.preventDefault()
        const boxes = list.querySelectorAll('input[type=checkbox]:not(:checked)')
        if (boxes.length === 1) boxes[0].click()
      })
      const details = el(
        'details',
        { class: `fpim-facet${chosen.length ? ' fpim-on' : ''}`, open: openFacet === key },
        el('summary', { class: 'form-control', 'aria-label': label }, el('span', { class: 'fpim-facet-value' }, names.join(', ')), el('span', { class: 'caret' })),
        el(
          'div',
          {},
          find,
          list,
          chosen.length
            ? button('Clear', () => {
                const { [key]: _gone, ...rest } = f.facets
                f.facets = rest
                facetFind[key] = ''
                refilter()
              })
            : null
        )
      )
      details.addEventListener('toggle', () => {
        if (details.open) {
          openFacet = key
          for (const other of content.querySelectorAll('.fpim-facet')) if (other !== details) other.open = false
          find?.focus()
        } else if (openFacet === key) openFacet = null
      })
      // Redrawn open after a tick: the cursor goes back into the box.
      if (openFacet === key && find) setTimeout(() => { find.focus(); find.setSelectionRange(find.value.length, find.value.length) }, 0)
      return el('div', { class: 'col-md-2 fpim-field' }, details, el('div', { class: 'help-block' }, label))
    }

    function paintFacets() {
      const anyFilter = f.search || f.queue || f.archived !== 'hide' || Object.values(f.facets).some((v) => v.length)
      const byKey = Object.fromEntries(FACETS)
      fill(facetsTop, ['status', 'categories', 'manufacturer'].map((k) => facet(k, byKey[k])))
      fill(facetsMore, ['brand', 'channels', 'tags', 'kind', 'missing'].map((k) => facet(k, byKey[k])))
      fill(
        searchTools,
        f.savedId ? headButton([icon('fa-trash'), ' Delete this queue'], () => void deleteQueue(), 'btn-default') : null,
        anyFilter && !f.savedId ? headButton([icon('fa-bookmark'), ' Save as a queue'], () => void saveQueue(), 'btn-default', { title: 'Keep these filters as a queue everyone can pick' }) : null,
        anyFilter
          ? headButton('Clear filters', () => {
              f.facets = {}
              f.search = ''
              f.queue = null
              f.archived = 'hide'
              archivedBox.value = 'hide'
              search.value = ''
              refilter()
              paintQueue()
            })
          : null
      )
    }

    function paintTable() {
      paintPager()
      const { rows, total, of, page: at, pageSize } = result
      const pages = Math.max(1, Math.ceil(total / pageSize))
      fill(resultTitle, total === of ? plural(total, 'parent') : `${total} of ${plural(of, 'parent')}`)
      fill(
        resultTools,
        // The pager is one button group, the same height as the heading's other buttons.
        pages > 1
          ? el(
              'div',
              { class: 'btn-group fpim-pager' },
              headButton(icon('fa-chevron-left'), () => { f.page--; void run() }, 'btn-info', { class: `btn btn-sm btn-info${at <= 1 ? ' disabled' : ''}`, 'aria-label': 'Previous page', title: 'Previous page' }),
              el('span', { class: 'btn btn-sm btn-info fpim-pageno', 'aria-live': 'polite' }, `Page ${at} of ${pages}`),
              headButton(icon('fa-chevron-right'), () => { f.page++; void run() }, 'btn-info', { class: `btn btn-sm btn-info${at >= pages ? ' disabled' : ''}`, 'aria-label': 'Next page', title: 'Next page' })
            )
          : null,
        headButton([icon('fa-refresh'), ' Refresh'], () => resyncDialog({ onDone: () => alive() && run() }), 'btn-info', { title: 'Get TradePeg’s latest (runs its pipeline, then imports), then reload the list' }),
        headButton([icon('fa-download'), ' Export'], () => {
          toolState.exportScope = 'list'
          openTools('export')
        })
      )
      const sortable = (key, label) =>
        el(
          'th',
          {
            class: `header${f.sort === key ? (f.direction === 'asc' ? ' headerSortDown' : ' headerSortUp') : ''}`,
            title: `Sort by ${label.toLowerCase()}`,
            onclick: () => {
              f.direction = f.sort === key && f.direction === 'asc' ? 'desc' : 'asc'
              f.sort = key
              void run()
            },
          },
          label,
          f.sort === key ? (f.direction === 'asc' ? ' ▲' : ' ▼') : ''
        )
      const known = parentColumns(result.customFields, priced)
      const shownColumns = columns.map((k) => known.find((c) => c.key === k)).filter(Boolean)
      if (!shownColumns.some((c) => c.locked)) shownColumns.unshift(known.find((c) => c.locked))
      const pageBox = el('input', { type: 'checkbox', class: 'form-control', title: 'Tick every parent on this page' })
      pageBox.checked = rows.length > 0 && rows.every((r) => isTicked(r.id))
      pageBox.addEventListener('change', () => {
        for (const r of rows) setTicked(r.id, pageBox.checked)
        paintTable()
        paintBulk()
      })
      fill(
        table,
        el(
          'table',
          { class: 'table-grid table-bordered table-hover fpim-grid-table' },
          el(
            'thead',
            {},
            el(
              'tr',
              {},
              el('th', { class: 'no-sort fpim-tick' }, pageBox),
              shownColumns.map((c) => (c.sort ? sortable(c.sort, c.label) : el('th', { class: 'no-sort' }, c.label)))
            )
          ),
          el(
            'tbody',
            {},
            rows.length
              ? rows.map((r) => {
                  const box = el('input', { type: 'checkbox', class: 'form-control', 'aria-label': `Tick ${r.sku}` })
                  box.checked = isTicked(r.id)
                  box.addEventListener('change', () => {
                    setTicked(r.id, box.checked)
                    box.closest('tr').classList.toggle('fpim-picked', box.checked)
                    paintBulk()
                  })
                  const row = el(
                    'tr',
                    { class: `fpim-click${box.checked ? ' fpim-picked' : ''}` },
                    el('td', { class: 'fpim-tick' }, box),
                    shownColumns.map((c) => c.cell(r))
                  )
                  // As on TradePeg's Parts list: a click on the row ticks it; the picture and the reference open it.
                  row.addEventListener('click', (e) => {
                    if (e.target.closest('input, button, a, label')) return
                    box.checked = !box.checked
                    box.dispatchEvent(new Event('change'))
                  })
                  return row
                })
              : el('tr', {}, el('td', { colspan: shownColumns.length + 1, class: 'text-muted' }, 'No parents match.'))
          )
        )
      )
    }

    /** While anything is ticked, a bar under the list offers every bulk change. */
    /**
     * Under the list, as TradePeg's Parts page has it: « 1 2 3 … 23 », the page
     * size, and "Showing 50 records, From 1 To 50, Of 1,124 Records."
     */
    const pager = el('div')
    function paintPager() {
      const { total, page: at, pageSize } = result
      const pages = Math.max(1, Math.ceil(total / pageSize))
      const go = (p) => (e) => {
        e.preventDefault()
        f.page = p
        void run().then(() => resultsPanel.scrollIntoView({ block: 'start' }))
      }
      const item = (p, label, { current = false, extra = '' } = {}) =>
        p && !current
          ? el('li', {}, el('a', { href: '#', class: `page-link${extra}`, onclick: go(p), 'aria-label': `Page ${p}` }, label))
          : el('li', { class: current ? 'active' : 'disabled' }, el('span', { class: `current${extra}` }, label))
      // The first two, the last two, and two either side of this one.
      const shown = [...new Set([1, 2, at - 2, at - 1, at, at + 1, at + 2, pages - 1, pages])].filter((p) => p >= 1 && p <= pages).sort((a, b) => a - b)
      const numbers = []
      shown.forEach((p, i) => {
        if (i && p - shown[i - 1] > 1) numbers.push(el('li', { class: 'disabled' }, el('span', { class: 'ellipse' }, '…')))
        numbers.push(item(p, String(p), { current: p === at }))
      })
      const size = el('select', { class: 'form-control pagination-select', 'aria-label': 'Page size' }, [10, 20, 30, 40, 50, 100, 250, 500].map((n) => el('option', { value: n }, n)))
      size.value = String(pageSize)
      size.addEventListener('change', () => {
        f.pageSize = Number(size.value)
        f.page = 1
        void run()
      })
      const from = total ? (at - 1) * pageSize + 1 : 0
      const to = Math.min(total, at * pageSize)
      fill(
        pager,
        el(
          'div',
          { class: 'light-theme simple-pagination fpim-pagination' },
          el('ul', { class: 'pagination' }, item(at > 1 ? at - 1 : null, '«', { extra: ' prev' }), numbers, item(at < pages ? at + 1 : null, '»', { extra: ' next' })),
          el('div', { class: 'fluid pull-right w150 mt20' }, el('div', { class: 'grid6 pt5' }, el('label', { class: 'control-label pull-right' }, 'Page Size')), el('div', { class: 'grid6' }, size)),
          el('div', { class: 'pagination-text pull-right' }, `Showing ${to - from + (total ? 1 : 0)} records, From ${from} To ${to}, Of ${total.toLocaleString('en-GB')} Records.`),
          el('div', { class: 'clear' })
        )
      )
    }

    /** Keep the floating tick bar over the page area (TradePeg's menu is on the left). */
    function placeBar() {
      const bar = bulkBox.firstElementChild
      if (!bar || !content.isConnected) return
      const r = content.getBoundingClientRect()
      bar.style.left = `${r.left}px`
      bar.style.width = `${r.width}px`
    }
    const onResize = () => (alive() ? placeBar() : window.removeEventListener('resize', onResize))
    window.addEventListener('resize', onResize)

    function paintBulk() {
      const count = f.all ? Math.max(0, result.total - f.picked.size) : f.picked.size
      // Room under the list for the bar, so it never hides the last rows or the pages.
      content.style.paddingBottom = count ? '70px' : ''
      if (!count) return fill(bulkBox)
      const open = (action) =>
        bulkDialog({
          action,
          count,
          target: f.all ? { filter: filter(), except: [...f.picked] } : { ids: [...f.picked] },
          onDone: () => {
            f.picked.clear()
            f.all = false
            return run()
          },
        })
      fill(
        bulkBox,
        el(
          'div',
          { class: 'fpim-selbar', role: 'toolbar', 'aria-label': 'Change the ticked parents' },
          el('strong', {}, `${plural(count, 'parent')} ticked`),
          f.all ? f.picked.size > 0 : result.total > f.picked.size
            ? button(`Tick all ${result.total} that match`, () => {
                f.all = true
                f.picked.clear()
                paintTable()
                paintBulk()
              }, 'btn-link')
            : null,
          button('Clear', () => {
            f.all = false
            f.picked.clear()
            paintTable()
            paintBulk()
          }, 'btn-link'),
          el('span', { class: 'fpim-grow', style: 'flex:1' }),
          bulkButtons(open)
        )
      )
      placeBar()
    }

    fill(
      content,
      tpPanel(
        'Search',
        searchTools,
        el('div', { class: 'formRow fluid' }, el('div', { class: 'col-md-4 fpim-field' }, search, el('div', { class: 'help-block', title: 'SKU, title, brand, or any variant’s SKU' }, 'Search')), el('div', { class: 'col-md-2 fpim-field' }, archivedBox, el('div', { class: 'help-block', title: 'Parents none of whose parts are in TradePeg’s SELECT range any more' }, 'Archived')), facetsTop, el('div', { class: 'clear' })),
        el('div', { class: 'formRow fluid' }, facetsMore, queueBox, el('div', { class: 'clear' }))
      ),
      notice,
      resultsPanel,
      pager,
      bulkBox
    )
    paintQueue()
    void loadQueues()
    void run()
  }

  // ---------------------------------------------------------------- brands and manufacturers

  /** Parents, filtered by a brand or manufacturer (and optionally a work queue). */
  function openParentsFiltered(facets, queue = null) {
    toolState.grid = { search: '', facets, queue, sort: 'sku', direction: 'asc', page: 1, picked: new Set(), all: false, action: 'status', columns: toolState.grid?.columns }
    openTools('products')
  }

  /**
   * Brands and manufacturers, each with its logo, name and description, how
   * many products carry it and how many of those have no picture — with
   * filters for what is missing, and links to those products on Parents.
   */
  function brandsTool(content, alive) {
    const s = (toolState.brands ??= { kind: 'brands', search: '', missing: '' })
    const tabs = el('div', { class: 'btn-group fpim-trees', role: 'tablist' })
    const searchBox = el('input', { class: 'form-control', type: 'search', value: s.search, placeholder: 'Name' })
    const missing = el('select', { class: 'form-control' })
    const title = el('span')
    const table = el('div', {}, spinner())
    let timer = null
    let data = null

    const kindLabel = () => (s.kind === 'brands' ? 'brand' : 'manufacturer')
    function paintTabs() {
      fill(tabs, [['brands', 'Brands'], ['manufacturers', 'Manufacturers']].map(([k, l]) =>
        el('a', { href: '#', role: 'tab', 'aria-selected': String(s.kind === k), class: `btn btn-sm ${s.kind === k ? 'btn-primary' : 'btn-default'}`, onclick: (e) => { e.preventDefault(); s.kind = k; paintTabs(); headerActions(s.kind === 'brands' ? el('a', { href: '#', class: 'btn btn-success', onclick: (ev) => { ev.preventDefault(); newBrand() } }, 'New Brand') : null); void load() } }, l)
      ))
    }

    async function load() {
      table.style.opacity = '.5'
      try {
        data = await request('POST', adminPath(`/makers/${s.kind}/list`), { json: { search: s.search, missing: s.missing } })
      } catch (error) {
        return alive() && toolError(table, error, load)
      }
      table.style.opacity = ''
      if (alive()) paint()
    }

    function paint() {
      const t = data.totals
      const keep = missing.value || s.missing
      fill(
        missing,
        [['', `All (${t.all})`], ['logo', `No logo (${t.noLogo})`], ['description', `No description (${t.noDescription})`], ['pictures', `Products missing pictures (${t.noPictures})`], ['unused', 'No products']].map(([v, l]) => el('option', { value: v }, l))
      )
      missing.value = keep
      fill(title, `${s.kind === 'brands' ? 'Brands' : 'Manufacturers'} (${data.rows.length})`)
      fill(
        table,
        el(
          'table',
          { class: 'table-grid table-bordered fpim-grid-table' },
          el('thead', {}, el('tr', {}, ['Logo', 'Name', 'Description', 'Products', 'Without pictures', ''].map((h) => el('th', { class: 'no-sort' }, h)))),
          el(
            'tbody',
            {},
            data.rows.length
              ? data.rows.map((r) => {
                  const facet = { [s.kind === 'brands' ? 'brand' : 'manufacturer']: [r.name] }
                  return el(
                    'tr',
                    {},
                    el('td', { class: 'fpim-thumb' }, r.logo ? el('a', { href: r.logo.url, target: '_blank', rel: 'noreferrer' }, el('img', { src: r.logo.thumb, alt: `${r.name} logo` })) : el('span', { class: 'fpim-noimg', title: 'No logo' }, icon('fa-picture-o'))),
                    el('td', {}, el('strong', {}, r.name)),
                    el('td', { class: r.description ? '' : 'text-muted', style: 'max-width:420px' }, r.description ? `${r.description.slice(0, 160)}${r.description.length > 160 ? '…' : ''}` : 'No description'),
                    el('td', {}, r.products ? el('a', { href: '#pim/products', onclick: (e) => { e.preventDefault(); openParentsFiltered(facet) } }, plural(r.products, 'product')) : el('span', { class: 'text-muted' }, 'None')),
                    el('td', {}, r.noPictures ? el('a', { href: '#pim/products', class: 'text-danger', onclick: (e) => { e.preventDefault(); openParentsFiltered(facet, 'no-pictures') } }, `${r.noPictures} without pictures`) : el('span', { class: 'text-muted' }, r.products ? 'All have pictures' : '—')),
                    el(
                      'td',
                      { style: 'white-space:nowrap' },
                      button([icon('fa-pencil'), ' Edit'], () => editDialog(r)),
                      s.kind === 'brands' ? [' ', button([icon('fa-trash'), ' Delete'], () => deleteBrand(r), 'btn-danger')] : null
                    )
                  )
                })
              : el('tr', {}, el('td', { colspan: 6, class: 'text-muted' }, 'Nothing matches.'))
          )
        )
      )
    }

    function editDialog(r) {
      const name = el('input', { class: 'form-control', value: r.name, disabled: s.kind !== 'brands' })
      const description = el('textarea', { class: 'form-control', rows: 5, placeholder: `About ${r.name}: who they are, what they make` })
      description.value = r.description ?? ''
      const logoLink = el('input', { class: 'form-control', placeholder: 'https://… a link to the logo picture' })
      const logoFile = el('input', { type: 'file', accept: 'image/*', style: 'display:none' })
      const out = el('div')
      const preview = el('div', { class: 'fpim-logo-preview' }, r.logo ? el('img', { src: r.logo.url, alt: '' }) : el('span', { class: 'text-muted' }, 'No logo yet'))
      logoFile.addEventListener('change', () => {
        const f = logoFile.files[0]
        if (f) fill(preview, el('img', { src: URL.createObjectURL(f), alt: '' }), el('div', { class: 'fpim-help' }, `${f.name} — saved when you press Save`))
      })
      logoLink.addEventListener('change', () => { if (/^https?:\/\//.test(logoLink.value.trim())) fill(preview, el('img', { src: logoLink.value.trim(), alt: '' })) })
      const d = dialog(
        `${s.kind === 'brands' ? 'Brand' : 'Manufacturer'}: ${r.name}`,
        [
          el(
            'div',
            { class: 'row' },
            field('Name', name, s.kind === 'brands' ? 'Renaming changes it on every product with this brand' : 'From TradePeg (its brand field): change it there', 6),
            field('Logo', el('div', {}, preview, el('div', { class: 'fpim-row', style: 'margin-top:6px' }, logoFile, button([icon('fa-upload'), ' Upload a picture…'], () => logoFile.click()), logoLink)), 'Upload a file, or paste a link: it is downloaded and kept', 6, { top: true }),
            field('Description', description, null, 12)
          ),
          out,
        ],
        [
          button('Cancel', () => d.close()),
          button([icon('fa-check'), ' Save'], async () => {
            fill(out, spinner(' Saving…'))
            try {
              await request('PUT', adminPath(`/makers/${s.kind}/${r.id}`), { json: { ...(s.kind === 'brands' ? { name: name.value } : {}), description: description.value, logoUrl: logoLink.value.trim() || undefined } })
              if (logoFile.files[0]) {
                const form = new FormData()
                form.append('files', logoFile.files[0], logoFile.files[0].name)
                await request('POST', adminPath(`/makers/${s.kind}/${r.id}/logo`), { form })
              }
              d.close()
              toast('success', 'Saved.')
              void load()
            } catch (error) {
              fill(out, el('div', { class: 'alert alert-danger' }, error.message))
            }
          }, 'btn-success'),
        ]
      )
    }

    function deleteBrand(r) {
      const out = el('div')
      const d = dialog(
        `Delete the brand ${r.name}?`,
        [
          r.products
            ? el('div', { class: 'alert alert-warning' }, `${plural(r.products, 'product')} ${r.products === 1 ? 'has' : 'have'} this brand. ${r.products === 1 ? 'It is' : 'They are'} left with no brand, so the website shows ${r.products === 1 ? 'its' : 'their'} manufacturer instead.`)
            : el('p', {}, 'No product has this brand.'),
          el('p', { class: 'text-muted' }, 'Its logo stays in the media library.'),
          out,
        ],
        [
          button('Cancel', () => d.close()),
          button([icon('fa-trash'), ' Delete'], async () => {
            fill(out, spinner(' Deleting…'))
            try {
              const res = await request('DELETE', adminPath(`/makers/brands/${r.id}`))
              d.close()
              toast('success', `Deleted ${res.deleted}${res.products ? `; ${plural(res.products, 'product')} now ${res.products === 1 ? 'has' : 'have'} no brand` : ''}.`)
              void load()
            } catch (error) {
              fill(out, el('div', { class: 'alert alert-danger' }, error.message))
            }
          }, 'btn-danger'),
        ]
      )
    }

    async function newBrand() {
      const n = prompt('Name of the new brand:')
      if (!n?.trim()) return
      try {
        const b = await request('POST', adminPath('/makers/brands'), { json: { name: n.trim() } })
        toast('success', `Added ${b.name}.`)
        s.kind = 'brands'
        await load()
        const row = data?.rows.find((x) => x.id === b.id)
        if (row) editDialog(row)
      } catch (error) {
        toast('danger', error.message)
      }
    }

    searchBox.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { s.search = searchBox.value; void load() }, 250) })
    missing.addEventListener('change', () => { s.missing = missing.value; void load() })
    headerActions(s.kind === 'brands' ? el('a', { href: '#', class: 'btn btn-success', onclick: (e) => { e.preventDefault(); newBrand() } }, 'New Brand') : null)
    paintTabs()
    fill(
      content,
      tpPanel('Search', null, el('div', { class: 'formRow fluid' }, field('Search', searchBox, null, 6), field('Show', missing, null, 3), el('div', { class: 'clear' }))),
      el('div', { class: 'panel panel-parts fluid mt10' }, el('div', { class: 'panel-heading' }, tabs, title, el('div', { class: 'btns pull-right' })), el('div', { class: 'panel-body p0' }, table))
    )
    void load()
  }

  // ---------------------------------------------------------------- categories

  const TREES = [
    ['ours', 'Our categories'],
    ['google', 'Google Shopping'],
    ['ebay', 'eBay'],
  ]

  /** A slug as the PIM makes it: lower case, a dash for each run of anything but letters and digits. */
  const slugOf = (s) => String(s ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

  function categoriesTool(content, alive) {
    const t = (toolState.tree ??= { which: 'ours', open: new Set(), editing: null, q: '' })
    const area = el('div')
    const tools = el('span')
    fill(
      content,
      el(
        'div',
        { class: 'panel panel-parts fluid mt10' },
        el(
          'div',
          { class: 'panel-heading' },
          el(
            'div',
            { class: 'btn-group fpim-trees', role: 'tablist' },
            TREES.map(([key, label]) =>
              el('a', { href: '#', role: 'tab', 'aria-selected': String(t.which === key), class: `btn btn-sm ${t.which === key ? 'btn-primary' : 'btn-default'}`, onclick: (e) => { e.preventDefault(); t.which = key; t.editing = null; categoriesTool(content, alive) } }, label)
            )
          ),
          el('div', { class: 'btns pull-right' }, tools)
        ),
        el('div', { class: 'panel-body' }, area)
      )
    )
    headerActions()
    if (t.which === 'ours') void ourTree(area, alive, t, tools)
    else codedTree(area, alive, t.which)
  }

  /** A box to paste category lines into, imported in the background. */
  function importLines(tree, alive, after, example) {
    const lines = el('textarea', { class: 'form-control', rows: 5, placeholder: example })
    const out = el('div')
    return el(
      'details',
      { style: 'margin-top:15px' },
      el('summary', { style: 'cursor:pointer; font-weight:600' }, 'Import a list of categories'),
      el(
        'div',
        { style: 'margin-top:8px' },
        el('p', { class: 'fpim-help' }, 'One category per line, with its full path. Ones that already exist are reused, so it is safe to import the same list twice.'),
        lines,
        el('div', { style: 'margin-top:6px' }, button('Import', async () => {
          if (!lines.value.trim()) return
          const job = await runJob(() => request('POST', adminPath(`/trees/${tree}/import`), { json: { lines: lines.value } }), out, alive)
          if (job?.status === 'done') {
            lines.value = ''
            after?.()
          }
        }, 'btn-primary')),
        out
      )
    )
  }

  /**
   * Our categories, the way Strapi's admin draws them: one roomy row per
   * category, children indented under a guide line, and drag-and-drop to
   * reorder or nest (drop on the top or bottom edge of a row to go before or
   * after it, on the middle to go inside it). The grip also answers ↑ / ↓ for
   * the keyboard.
   */
  async function ourTree(area, alive, t, tools) {
    const listEl = el('div', { class: 'fpim-cats' }, spinner())
    const note = el('div')
    const q = el('input', { class: 'form-control', type: 'search', value: t.q, 'aria-label': 'Find a category' })
    let data = null
    let byId = new Map()
    let dragId = null

    const say_ = (kind, text) => fill(note, el('div', { class: `alert alert-${kind}` }, text))
    async function fetchTree() {
      try {
        data = await request('GET', adminPath('/trees/ours'))
      } catch (error) {
        if (alive()) toolError(listEl, error, fetchTree)
        return
      }
      if (!alive()) return
      byId = new Map()
      const index = (nodes, parentId) =>
        nodes.forEach((n, i) => {
          byId.set(n.id, { node: n, siblings: nodes, i, parentId })
          index(n.children, n.id)
        })
      index(data.roots, null)
      paint()
    }
    /** Run a change, then reread the tree. */
    async function act(work, done) {
      try {
        await work()
        t.editing = null
        if (done) say_('success', done)
        else fill(note)
        await fetchTree()
      } catch (error) {
        say_('danger', error.message)
      }
    }
    const tree = (path, json, method = 'POST') => request(method, adminPath(`/trees/ours${path}`), json === undefined ? {} : { json })
    /** Is `id` the category `ancestor` or somewhere under it? */
    const within = (id, ancestor) => {
      for (let at = id; at != null; at = byId.get(at)?.parentId) if (at === ancestor) return true
      return false
    }

    function move(id, target, zone) {
      const moving = byId.get(id)?.node
      if (!moving || within(target.id, id)) return
      const { siblings, i, parentId } = byId.get(target.id)
      if (zone === 'inside') {
        t.open.add(target.id)
        return void act(() => tree(`/${id}/move`, { parentId: target.id, beforeId: null }), `Moved ${moving.name} into ${target.name}.`)
      }
      const beforeId = zone === 'before' ? target.id : (siblings.slice(i + 1).find((s) => s.id !== id)?.id ?? null)
      void act(() => tree(`/${id}/move`, { parentId, beforeId }), `Moved ${moving.name}.`)
    }

    function editor(n, parentId) {
      const mode = t.editing.mode
      const cancel = () => { t.editing = null; paint() }
      if (mode === 'rename' || mode === 'add') {
        const input = el('input', { class: 'form-control', value: mode === 'rename' ? n?.name ?? '' : '', 'aria-label': mode === 'add' ? 'Name of the new category' : 'New name' })
        // The slug follows the name ("Cotton Balls" -> cotton-balls) until it is typed in by hand.
        const was = mode === 'rename' ? n?.slug ?? '' : ''
        const slug = el('input', { class: 'form-control', value: was || slugOf(input.value), 'aria-label': 'Slug', placeholder: 'cotton-balls' })
        let slugByHand = mode === 'rename' && was !== slugOf(n?.name ?? '')
        input.addEventListener('input', () => { if (!slugByHand) slug.value = slugOf(input.value) })
        slug.addEventListener('input', () => { slugByHand = true })
        slug.addEventListener('blur', () => { slug.value = slugOf(slug.value) || slugOf(input.value) })
        const go = () => {
          const name = input.value.trim()
          if (!name) return
          const s = slugOf(slug.value) || slugOf(name)
          if (mode === 'add' && n) t.open.add(n.id)
          const body = mode === 'rename' ? { name, ...(s !== was ? { slug: s } : {}) } : { name, slug: s, parentId: n?.id ?? null }
          void act(() => (mode === 'rename' ? tree(`/${n.id}`, body, 'PUT') : tree('', body)), mode === 'add' ? `Added ${name}.` : null)
        }
        for (const box of [input, slug]) {
          box.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') go()
            if (e.key === 'Escape') cancel()
          })
        }
        setTimeout(() => input.focus(), 0)
        return el(
          'div',
          { class: 'fpim-node-edit fpim-row' },
          el('div', { class: 'fpim-grow' }, input, el('div', { class: 'help-block' }, mode === 'rename' ? 'Name' : n ? `New category inside ${n.name}` : 'New top-level category')),
          el('div', { style: 'flex:0 0 260px' }, slug, el('div', { class: 'help-block', title: 'The end of the category’s web address. Filled from the name.' }, 'Slug')),
          button(mode === 'add' ? 'Add' : 'Save', go, 'btn-success'),
          button('Cancel', cancel)
        )
      }
      if (mode === 'move') {
        return el(
          'div',
          { class: 'fpim-node-edit' },
          picker({
            kind: 'categories',
            placeholder: 'Search for the category to move it into…',
            onPick: (c) => {
              if (within(c.id, n.id)) return say_('warning', 'A category cannot move into itself or one of its own children.')
              t.open.add(c.id)
              void act(() => tree(`/${n.id}/move`, { parentId: c.id, beforeId: null }), `Moved ${n.name} into ${c.path}.`)
            },
          }),
          el('div', { class: 'help-block' }, `Move ${n.name} and everything inside it`),
          el('div', { class: 'fpim-row', style: 'margin-top:6px' }, parentId ? button('Make it top level', () => void act(() => tree(`/${n.id}/move`, { parentId: null, beforeId: null }), `Moved ${n.name} to the top level.`)) : null, button('Cancel', cancel))
        )
      }
      // Defaults: the Google and eBay categories products here inherit.
      const row = (label, key, kind) =>
        field(
          label,
          selectBox({
            kind,
            value: n[key],
            placeholder: 'Type a name or number',
            disabled: false,
            onChange: (c) => void act(() => tree(`/${n.id}`, { [key]: c?.id ?? null }, 'PUT'), c ? `${label} for ${n.name} set to ${c.path}.` : `${label} for ${n.name} cleared.`),
          }),
          `Products in ${n.name}, or anywhere inside it, use this unless they set their own`,
          6
        )
      return el('div', { class: 'fpim-node-edit' }, el('div', { class: 'row' }, row('Google category', 'googleCategory', 'google'), row('eBay category', 'ebayCategory', 'ebay')), button('Done', cancel))
    }

    function renderNode(n) {
      const { siblings, i, parentId } = byId.get(n.id)
      const open = t.open.has(n.id)
      const dragOk = !t.q
      const toggle = () => {
        if (!n.children.length) return
        if (open) t.open.delete(n.id)
        else t.open.add(n.id)
        paint()
      }
      const edit = (mode) => {
        t.editing = t.editing?.id === n.id && t.editing.mode === mode ? null : { id: n.id, mode }
        paint()
      }
      const grip = dragOk
        ? el(
            'button',
            {
              type: 'button',
              class: 'fpim-grip',
              title: 'Drag to move (or ↑ / ↓)',
              'aria-label': `Move ${n.name}: drag, or press up or down`,
              onkeydown: (e) => {
                const to = e.key === 'ArrowUp' ? i - 1 : e.key === 'ArrowDown' ? i + 2 : null
                if (to == null || to < 0 || to > siblings.length) return
                e.preventDefault()
                void act(() => tree(`/${n.id}/move`, { parentId, beforeId: siblings[to]?.id ?? null })).then(() => [...listEl.querySelectorAll('.fpim-cat')].find((r) => r.dataset.id === n.id)?.querySelector('.fpim-grip')?.focus())
              },
            },
            icon('fa-bars')
          )
        : null
      const row = el(
        'div',
        { class: 'fpim-cat', 'data-id': n.id, draggable: dragOk ? 'true' : null },
        grip,
        el(
          'button',
          { type: 'button', class: 'fpim-twisty', 'aria-label': n.children.length ? `${open ? 'Close' : 'Open'} ${n.name}` : null, 'aria-expanded': n.children.length ? String(open) : null, disabled: !n.children.length, onclick: toggle },
          n.children.length ? icon(open ? 'fa-chevron-down' : 'fa-chevron-right') : null
        ),
        icon(`${open ? 'fa-folder-open' : 'fa-folder'} fpim-folder`),
        el('span', { class: 'fpim-name', onclick: toggle }, t.q ? n.path : n.name),
        n.children.length ? el('span', { class: 'fpim-count' }, `${n.children.length} ${n.children.length === 1 ? 'subcategory' : 'subcategories'}`) : null,
        el('span', { class: 'fpim-count' }, plural(n.total, 'product')),
        n.googleCategory ? el('span', { class: 'label label-info', title: `Google: ${n.googleCategory.path}` }, 'Google') : null,
        n.ebayCategory ? el('span', { class: 'label label-warning', title: `eBay: ${n.ebayCategory.path}` }, 'eBay') : null,
        el('span', { class: 'fpim-grow' }),
        el(
          'span',
          { class: 'fpim-cat-tools' },
          iconButton('fa-plus', `Add a category inside ${n.name}`, () => edit('add')),
          iconButton('fa-pencil', `Rename ${n.name}`, () => edit('rename')),
          iconButton('fa-share', `Move ${n.name} into another category`, () => edit('move')),
          iconButton('fa-globe', `Google and eBay categories for ${n.name}`, () => edit('defaults')),
          iconButton('fa-trash', `Delete ${n.name}`, () => {
            if (confirm(`Delete the category "${n.name}"?`)) void act(() => tree(`/${n.id}`, undefined, 'DELETE'), `Deleted ${n.name}.`)
          })
        )
      )
      if (dragOk) {
        const clear = () => row.classList.remove('fpim-drop-before', 'fpim-drop-after', 'fpim-drop-inside')
        const zoneOf = (e) => {
          const r = row.getBoundingClientRect()
          const y = (e.clientY - r.top) / (r.height || 1)
          return y < 0.3 ? 'before' : y > 0.7 ? 'after' : 'inside'
        }
        row.addEventListener('dragstart', (e) => {
          dragId = n.id
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', n.id)
          row.classList.add('fpim-dragging')
          listEl.classList.add('fpim-dnd')
        })
        row.addEventListener('dragend', () => {
          dragId = null
          row.classList.remove('fpim-dragging')
          listEl.classList.remove('fpim-dnd')
        })
        row.addEventListener('dragover', (e) => {
          if (!dragId || within(n.id, dragId)) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          clear()
          row.classList.add(`fpim-drop-${zoneOf(e)}`)
        })
        row.addEventListener('dragleave', clear)
        row.addEventListener('drop', (e) => {
          e.preventDefault()
          clear()
          const id = dragId
          dragId = null
          if (id && !within(n.id, id)) move(id, n, zoneOf(e))
        })
      }
      return el('div', {}, row, t.editing?.id === n.id ? editor(n, parentId) : null)
    }

    const renderList = (nodes) =>
      el('ul', {}, nodes.map((n) => el('li', {}, renderNode(n), t.open.has(n.id) && n.children.length ? renderList(n.children) : null)))

    function paint() {
      if (!data) return
      const term = t.q.toLowerCase()
      const top = t.editing?.id === 'top' ? editor(null, null) : null
      if (term) {
        const hits = [...byId.values()].map((x) => x.node).filter((n) => n.path.toLowerCase().includes(term)).sort((a, b) => a.path.localeCompare(b.path))
        return fill(listEl, top, hits.length ? el('ul', {}, hits.map((n) => el('li', {}, renderNode(n)))) : el('p', { class: 'text-muted' }, 'No category matches.'))
      }
      // Dropped here: to the end of the top level.
      const end = el('div', { class: 'fpim-cat-end' }, 'Drop here to make it a top-level category')
      end.addEventListener('dragover', (e) => { if (dragId) { e.preventDefault(); end.classList.add('fpim-over') } })
      end.addEventListener('dragleave', () => end.classList.remove('fpim-over'))
      end.addEventListener('drop', (e) => {
        e.preventDefault()
        const id = dragId
        dragId = null
        if (id) void act(() => tree(`/${id}/move`, { parentId: null, beforeId: null }), `Moved ${byId.get(id)?.node.name ?? ''} to the top level.`)
      })
      fill(listEl, top, data.roots.length ? renderList(data.roots) : el('p', { class: 'text-muted' }, 'No categories yet.'), end)
    }

    q.addEventListener('input', () => {
      t.q = q.value.trim()
      paint()
    })
    const addTop = () => {
      t.editing = { id: 'top', mode: 'add' }
      paint()
    }
    headerActions(el('a', { href: '#', class: 'btn btn-success', onclick: (e) => { e.preventDefault(); addTop() } }, 'New Category'))
    fill(
      tools,
      headButton('Open all', () => { for (const id of byId.keys()) t.open.add(id); paint() }, 'btn-default'),
      headButton('Close all', () => { t.open.clear(); paint() }, 'btn-default')
    )
    fill(
      area,
      el('div', { class: 'row' }, el('div', { class: 'col-md-6 fpim-field' }, q, el('div', { class: 'help-block' }, 'Find a category'))),
      note,
      listEl,
      importLines('ours', alive, fetchTree, 'Consumables > Cotton > Cotton Balls\nMobility > Rollators')
    )
    await fetchTree()
  }

  /**
   * Google's and eBay's trees, drawn like ours but read-only (they own them).
   * Only open branches are drawn, so thousands of categories stay quick;
   * finding shows each match with the categories above it.
   */
  function codedTree(area, alive, which) {
    const name = which === 'google' ? 'Google' : 'eBay'
    const LIMIT = 300
    const st = (toolState[`tree-${which}`] ??= { open: new Set(), q: '' })
    const q = el('input', { class: 'form-control', type: 'search', value: st.q, 'aria-label': `Find a ${name} category` })
    const list = el('div', { class: 'fpim-cats' }, spinner())
    const count = el('span', { class: 'fpim-count' })
    let rows = []
    let byId = new Map()

    const search = async () => {
      fill(list, spinner())
      let data
      try {
        data = await request('GET', adminPath(`/trees/${which}`))
      } catch (error) {
        if (alive()) toolError(list, error, search)
        return
      }
      if (!alive()) return
      rows = []
      byId = new Map()
      const index = (nodes, parentId) =>
        nodes.forEach((n) => {
          rows.push(n)
          byId.set(n.id, { node: n, parentId })
          index(n.children, n.id)
        })
      index(data.roots, null)
      fill(count, `${data.count.toLocaleString()} categories`)
      paint()
    }

    function renderNode(n, finding) {
      const open = finding || st.open.has(n.id)
      const toggle = () => {
        if (!n.children.length || finding) return
        if (open) st.open.delete(n.id)
        else st.open.add(n.id)
        paint()
      }
      return el(
        'div',
        { class: 'fpim-cat' },
        el(
          'button',
          { type: 'button', class: 'fpim-twisty', 'aria-label': n.children.length ? `${open ? 'Close' : 'Open'} ${n.name}` : null, 'aria-expanded': n.children.length ? String(open) : null, disabled: !n.children.length || finding, onclick: toggle },
          n.children.length ? icon(open ? 'fa-chevron-down' : 'fa-chevron-right') : null
        ),
        icon(`${open && n.children.length ? 'fa-folder-open' : 'fa-folder'} fpim-folder`),
        el('span', { class: 'fpim-name', title: n.path, onclick: toggle }, n.name),
        n.children.length ? el('span', { class: 'fpim-count' }, `${n.children.length} inside`) : null,
        el('span', { class: 'fpim-grow' }),
        el('span', { class: 'fpim-sku', title: `${name} category number` }, n.code ?? '')
      )
    }

    function paint() {
      const term = st.q.toLowerCase()
      if (!rows.length) return fill(list, el('p', { class: 'text-muted' }, `No ${name} categories yet — import them below.`))
      if (!term) {
        const draw = (nodes) => el('ul', {}, nodes.map((n) => el('li', {}, renderNode(n, false), st.open.has(n.id) && n.children.length ? draw(n.children) : null)))
        return fill(list, draw(rows.filter((n) => !byId.get(n.id).parentId)))
      }
      // Matches plus the categories above them, kept as a tree.
      const keep = new Set()
      for (const n of rows) {
        if (!n.path.toLowerCase().includes(term) && n.code !== term) continue
        for (let at = n.id; at != null && !keep.has(at); at = byId.get(at)?.parentId) keep.add(at)
      }
      let left = LIMIT
      const draw = (nodes) => el('ul', {}, nodes.filter((n) => keep.has(n.id) && left-- > 0).map((n) => el('li', {}, renderNode(n, true), draw(n.children))))
      fill(
        list,
        keep.size ? draw(rows.filter((n) => !byId.get(n.id).parentId)) : el('p', { class: 'text-muted' }, 'Nothing matches.'),
        keep.size > LIMIT ? el('p', { class: 'fpim-help' }, `Showing the first ${LIMIT} of ${keep.size.toLocaleString()}. Type more to narrow it down.`) : null
      )
    }

    let timer = null
    q.addEventListener('input', () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        st.q = q.value.trim()
        paint()
      }, 200)
    })
    const googleOut = el('div')
    fill(area, 
      el('p', { class: 'fpim-help' }, `${name}’s own category tree. Products pick from it on the product page, or inherit it from one of our categories (Our categories → Google / eBay).`),
      el(
        'div',
        { class: 'fpim-row' },
        el('div', { class: 'fpim-field', style: 'flex:0 1 420px' }, q, el('div', { class: 'help-block' }, 'Find by name or number')),
        headButton('Open all', () => { for (const id of byId.keys()) st.open.add(id); paint() }, 'btn-default'),
        headButton('Close all', () => { st.open.clear(); paint() }, 'btn-default'),
        count
      ),
      list,
      which === 'google'
        ? el(
            'div',
            { style: 'margin-top:15px' },
            button([icon('fa-download'), ' Import Google’s taxonomy (UK English)'], async () => {
              if (!confirm('Import Google’s full product taxonomy now? Existing categories are kept and updated.')) return
              await runJob(() => request('POST', adminPath('/trees/google/import-google')), googleOut, alive)
              void search()
            }),
            googleOut
          )
        : null,
      importLines(which, alive, search, '1234 - Health & Beauty > Health Care > First Aid')
    )
    void search()
  }

  // ---------------------------------------------------------------- settings

  /** Settings: this computer's connection to the PIM, then the channels (feed pricelists, eBay defaults). */
  function settingsTool(content, alive) {
    const url = el('input', { class: 'form-control', value: pimUrl() })
    const token = el('input', { class: 'form-control', type: 'password', placeholder: hasToken() ? 'Saved — paste a new one to replace it' : 'Paste the API token' })
    const channels = el('div')
    const save = () => {
      GM_setValue(URL_KEY, url.value.trim() || DEFAULT_PIM_URL)
      if (token.value.trim()) GM_setValue(TOKEN_KEY, token.value.trim())
      token.value = ''
      renderPage('settings')
      toast('success', 'Saved.')
    }
    headerActions()
    fill(
      content,
      tpPanel(
        'PIM connection',
        headButton([icon('fa-check'), ' Save'], save, 'btn-success'),
        el(
          'div',
          { class: 'formRow fluid' },
          field('PIM address', url, null, 6),
          field('API token', token, 'Kept in this browser only. Ask whoever runs the PIM for one; it needs Pim → lookup, update, upload, options and admin.', 6),
          el('div', { class: 'clear' })
        )
      ),
      channels
    )
    if (hasToken()) {
      void channelsSettings(channels, alive)
      const backups = el('div')
      content.append(backups)
      void backupsPanel(backups, alive)
    }
  }

  /**
   * The PIM's own backups: its whole database, every night, into a private R2
   * bucket (repos/pim src/pim/backup.js). The last one, Back up now, and the
   * newest files to download.
   */
  async function backupsPanel(holder, alive) {
    const MB = (n) => `${(n / 1e6).toFixed(1)} MB`
    let polling = false
    async function paint() {
      let s
      try {
        s = await request('GET', adminPath('/backups'))
      } catch (error) {
        const box = el('div', { class: 'col-md-12' })
        toolError(box, error, paint)
        return fill(holder, tpPanel('Backups', null, el('div', { class: 'formRow fluid' }, box)))
      }
      if (!alive()) return
      const now = headButton([icon(s.running ? 'fa-spinner fa-spin' : 'fa-cloud-upload'), s.running ? ' Backing up…' : ' Back up now'], async () => {
        try {
          await request('POST', adminPath('/backups'), { json: { by: tpUser() || null } })
        } catch (error) {
          return toast('danger', error.message)
        }
        void paint()
      }, 'btn-success', s.running || !s.ready ? { class: 'btn btn-sm btn-success disabled' } : {})
      const stat = (label, value, help, cols = 3) => el('div', { class: `col-md-${cols} fpim-field fpim-statcell` }, el('div', { class: 'fpim-stat' }, value), el('div', { class: 'help-block', title: help || null }, label))
      fill(
        holder,
        tpPanel(
          'Backups',
          now,
          el(
            'div',
            { class: 'formRow fluid fpim-syncrow' },
            !s.ready ? el('div', { class: 'col-md-12' }, el('div', { class: 'alert alert-warning' }, 'Backups need the R2 keys on the PIM.')) : null,
            stat('Last backup', s.last ? ago(s.last.finishedAt) : 'None yet', s.last ? `${when(s.last.finishedAt)} · ${MB(s.last.size)} · ${s.last.tables} tables, ${s.last.rows.toLocaleString('en-GB')} rows` : null),
            stat('Next', 'Tonight, 2am', `Every night at 2am UK time (${s.schedule})`),
            stat('Kept', `${s.total} backups`, `Forever, in the private bucket ${s.bucket}: no web address reaches it`),
            stat('Holds', 'The whole database', 'Every product, variant, category, setting and decision. Pictures are already in R2, so they are not copied.'),
            el('div', { class: 'clear' }),
            s.lastError && (!s.last || s.lastError.at > s.last.finishedAt) ? el('div', { class: 'col-md-12' }, el('div', { class: 'alert alert-danger' }, `The last backup failed ${ago(s.lastError.at)}: ${s.lastError.message}`)) : null,
            s.files.length
              ? el(
                  'div',
                  { class: 'col-md-12' },
                  el(
                    'details',
                    { class: 'fpim-more' },
                    el('summary', {}, `Newest backups (${Math.min(s.files.length, s.total)} of ${s.total})`),
                    el(
                      'table',
                      { class: 'fpim-table' },
                      el('tbody', {}, s.files.map((f) => el('tr', {}, el('td', {}, when(f.at)), el('td', { class: 'fpim-mono' }, f.key.split('/').pop()), el('td', {}, MB(f.size)), el('td', {}, button([icon('fa-download'), ' Download'], async (e) => {
                        const btn = e.currentTarget
                        btn.disabled = true
                        try {
                          saveFile(await request('GET', adminPath(`/backups/download?key=${encodeURIComponent(f.key)}`), { blob: true, timeout: 600000 }))
                        } catch (error) {
                          toast('danger', error.message)
                        } finally {
                          btn.disabled = false
                        }
                      })))))
                    ),
                    el('p', { class: 'fpim-help' }, 'To restore: node scripts/pim/restore-backup.js --to <a new, empty database> (repos/pim). Never over the live one.')
                  )
                )
              : null,
            el('div', { class: 'clear' })
          )
        )
      )
      if (s.running && !polling) {
        polling = true
        setTimeout(() => { polling = false; if (alive()) void paint() }, 4000)
      }
    }
    fill(holder, tpPanel('Backups', null, el('div', { class: 'formRow fluid' }, el('div', { class: 'col-md-12' }, spinner()))))
    await paint()
  }

  // ---------------------------------------------------------------- product fields

  /**
   * Settings → Product fields: fields the PIM's products get on top of its own
   * ("Latex free", "Sterile"…). Adding or removing one restarts the PIM so the
   * database gets (or loses) its column: everyone is warned first, and the page
   * waits until the PIM is back.
   */
  function fieldsTool(content, alive) {
    headerActions()
    const body = el('div', {}, spinner())
    const addBtn = headButton([icon('fa-plus'), ' Add a field'], () => addDialog(), 'btn-success')
    fill(content, tpPanel('Product fields', addBtn, el('div', { class: 'panel-body' }, body)))
    let info = null

    async function load() {
      try {
        info = await request('GET', adminPath('/fields'))
      } catch (error) {
        return alive() && toolError(body, error, load)
      }
      if (alive()) paint()
    }

    function paint() {
      const { fields } = info
      fill(
        body,
        info.restartDue ? el('div', { class: 'alert alert-warning' }, icon('fa-refresh'), ' A change is waiting for the PIM to restart. ', button('Restart now', () => void waitForRestart('Restarting the PIM…', true))) : null,
        fields.length
          ? el(
              'table',
              { class: 'table-grid table-bordered fpim-grid-table' },
              el('thead', {}, el('tr', {}, ['Name', 'Kind', 'Choices', 'Products using it', ''].map((h) => el('th', { class: 'no-sort' }, h)))),
              el(
                'tbody',
                {},
                fields.map((f) =>
                  el(
                    'tr',
                    {},
                    el('td', {}, el('strong', {}, f.label), f.pending ? el('span', { class: 'label label-warning ml5' }, 'After restart') : null),
                    el('td', {}, f.typeLabel),
                    el('td', { class: 'text-muted' }, (f.options ?? []).join(', ')),
                    el('td', {}, f.used ? plural(f.used, 'product') : el('span', { class: 'text-muted' }, 'None')),
                    el(
                      'td',
                      { style: 'white-space:nowrap;text-align:right' },
                      button([icon('fa-pencil'), ' Edit'], () => editDialog(f)),
                      ' ',
                      button([icon('fa-trash'), ' Remove'], () => removeDialog(f), 'btn-danger', f.used ? { disabled: true, title: `Empty it on all ${plural(f.used, 'product')} first` } : {})
                    )
                  )
                )
              )
            )
          : el('p', { class: 'text-muted' }, 'No extra fields yet. Products have the PIM’s own fields only.')
      )
    }

    const restartWarning = (what) =>
      el('div', { class: 'alert alert-warning' }, icon('fa-exclamation-triangle'), ` ${what} restarts the PIM so its database can change. It is unavailable for about a minute, for everyone. Nothing is lost; unsaved edits on other screens should be saved first.`)

    function addDialog() {
      const name = el('input', { class: 'form-control', placeholder: 'e.g. Latex free' })
      const kind = el('select', { class: 'form-control' }, info.types.map((t) => el('option', { value: t.value }, t.label)))
      const choices = el('textarea', { class: 'form-control', rows: 4, placeholder: 'One choice per line' })
      const choiceRow = field('Choices', choices, null, 12)
      choiceRow.style.display = 'none'
      kind.addEventListener('change', () => { choiceRow.style.display = kind.value === 'choice' ? '' : 'none' })
      const out = el('div')
      const d = dialog(
        'Add a product field',
        [restartWarning('Adding a field'), el('div', { class: 'row' }, field('Name', name, null, 7), field('Kind', kind, null, 5), choiceRow), out],
        [
          button('Cancel', () => d.close()),
          button([icon('fa-plus'), ' Add and restart the PIM'], async () => {
            if (!name.value.trim()) return fill(out, el('div', { class: 'alert alert-warning' }, 'Give the field a name.'))
            try {
              await request('POST', adminPath('/fields'), { json: { label: name.value, type: kind.value, options: choices.value } })
            } catch (error) {
              return fill(out, el('div', { class: 'alert alert-danger' }, error.message))
            }
            d.close()
            void waitForRestart(`Adding ${name.value.trim()}…`)
          }, 'btn-success'),
        ]
      )
    }

    function editDialog(f) {
      const name = el('input', { class: 'form-control', value: f.label })
      const choices = el('textarea', { class: 'form-control', rows: 4 })
      choices.value = (f.options ?? []).join('\n')
      const out = el('div')
      const d = dialog(
        `Edit ${f.label}`,
        [el('div', { class: 'row' }, field('Name', name, 'Renaming keeps every product’s value', 12), f.type === 'choice' ? field('Choices', choices, 'One per line', 12) : null), out],
        [
          button('Cancel', () => d.close()),
          button([icon('fa-check'), ' Save'], async () => {
            try {
              await request('PUT', adminPath(`/fields/${encodeURIComponent(f.key)}`), { json: { label: name.value, ...(f.type === 'choice' ? { options: choices.value } : {}) } })
            } catch (error) {
              return fill(out, el('div', { class: 'alert alert-danger' }, error.message))
            }
            d.close()
            toast('success', 'Saved.')
            void load()
          }, 'btn-success'),
        ]
      )
    }

    function removeDialog(f) {
      const out = el('div')
      const d = dialog(
        `Remove ${f.label}`,
        [restartWarning('Removing a field'), el('p', {}, 'No product has a value in it, so nothing is lost.'), out],
        [
          button('Cancel', () => d.close()),
          button([icon('fa-trash'), ' Remove and restart the PIM'], async () => {
            try {
              await request('DELETE', adminPath(`/fields/${encodeURIComponent(f.key)}`))
            } catch (error) {
              return fill(out, el('div', { class: 'alert alert-danger' }, error.message))
            }
            d.close()
            void waitForRestart(`Removing ${f.label}…`)
          }, 'btn-danger'),
        ]
      )
    }

    /** The PIM goes away and comes back; the page says so until it answers with the change applied. */
    async function waitForRestart(title, force = false) {
      if (force) {
        try { await request('POST', adminPath('/fields/restart')) } catch { /* it may already be going */ }
      }
      const started = Date.now()
      const steps = el('ol', { class: 'fpim-steps' })
      const state_ = { down: false }
      const paintSteps = (done) =>
        fill(
          steps,
          [['Change saved', true], ['PIM restarting', state_.down || done], ['PIM back with the change', done]].map(([label, ok], i, all) => {
            const now = !ok && (i === 0 || all[i - 1][1])
            return el('li', { class: `fpim-step fpim-step-${ok ? 'done' : now ? 'now' : 'todo'}` }, ok ? icon('fa-check-circle text-success') : now ? icon('fa-spinner fa-spin text-info') : icon('fa-circle-o text-muted'), ' ', label)
          })
        )
      const clock = el('p', { class: 'text-muted' })
      const d = dialog(title, [steps, clock], [])
      paintSteps(false)
      for (;;) {
        await sleep(3000)
        fill(clock, `${span(Math.round((Date.now() - started) / 1000))} so far — usually about a minute.`)
        let r = null
        try {
          r = await request('GET', adminPath('/fields'), { timeout: 8000 })
        } catch {
          state_.down = true
          paintSteps(false)
          continue
        }
        if (r && !r.restartDue && (state_.down || Date.now() - started > 20000)) {
          paintSteps(true)
          info = r
          setTimeout(() => d.close(), 1200)
          toast('success', 'Done. The PIM is back with the change.')
          return alive() && paint()
        }
        if (Date.now() - started > 6 * 60000) {
          d.close()
          return toast('danger', 'The PIM has not come back after 6 minutes. Check it on Railway.')
        }
      }
    }

    void load()
  }

  const EBAY_CONDITIONS = [
    ['1000', 'New'],
    ['1500', 'New (other)'],
    ['1750', 'New with defects'],
    ['2500', 'Seller refurbished'],
    ['3000', 'Used'],
  ]

  /** Which TradePeg pricelist each feed prices from, and eBay's listing defaults. */
  async function channelsSettings(holder, alive) {
    fill(holder, tpPanel('Channels', null, el('div', { class: 'formRow fluid' }, el('div', { class: 'col-md-12' }, spinner()))))
    let settings
    try {
      settings = await request('GET', adminPath('/settings'))
    } catch (error) {
      if (!alive()) return
      const box = el('div', { class: 'col-md-12' })
      toolError(box, error, () => channelsSettings(holder, alive))
      return fill(holder, tpPanel('Channels', null, el('div', { class: 'formRow fluid' }, box)))
    }
    let pricelists = null
    let pricelistError = null
    try {
      pricelists = await request('GET', adminPath('/pricelists'))
    } catch (error) {
      pricelistError = error.message
    }
    if (!alive()) return

    const form = { ...settings }
    const out = el('div')
    const input = (key, attrs = {}) => {
      const node = el('input', { class: 'form-control', value: form[key] ?? '', ...attrs })
      node.addEventListener('input', () => { form[key] = node.value })
      return node
    }
    const select = (key, options) => {
      const node = el('select', { class: 'form-control' }, options.map(([value, label]) => el('option', { value }, label)))
      if (form[key] && !options.some(([v]) => v === String(form[key]))) node.append(el('option', { value: form[key] }, form[key]))
      node.value = form[key] ?? ''
      node.addEventListener('change', () => { form[key] = node.value })
      return node
    }
    const pricelist = (key) =>
      pricelists ? select(key, [['', 'The website’s default pricelist'], ...pricelists.map((p) => [p.id, `${p.name}${p.isDefault ? ' (default)' : ''}`])]) : input(key, { placeholder: 'Pricelist id' })
    const save = async () => {
      const name = (id) => pricelists?.find((p) => p.id === id)?.name ?? null
      fill(out, spinner(' Saving…'))
      try {
        await request('PUT', adminPath('/settings'), {
          json: {
            googlePricelistId: form.googlePricelistId || '',
            googlePricelistName: name(form.googlePricelistId),
            ebayPricelistId: form.ebayPricelistId || '',
            ebayPricelistName: name(form.ebayPricelistId),
            ebayDispatchDays: Number(form.ebayDispatchDays ?? 2),
            ebayConditionId: form.ebayConditionId || '',
            ebayLocation: form.ebayLocation || '',
            ebayShippingProfile: form.ebayShippingProfile || '',
            ebayReturnProfile: form.ebayReturnProfile || '',
            ebayPaymentProfile: form.ebayPaymentProfile || '',
          },
        })
        if (alive()) fill(out, el('div', { class: 'alert alert-success' }, 'Saved. The feeds use it from their next rebuild (every 30 minutes).'))
      } catch (error) {
        if (alive()) fill(out, el('div', { class: 'alert alert-danger' }, error.message))
      }
    }

    fill(
      holder,
      tpPanel(
        'Channels',
        headButton([icon('fa-check'), ' Save'], () => void save(), 'btn-success'),
        out,
        section(
          'Feed pricelists',
          pricelistError ? el('div', { class: 'alert alert-warning' }, `Could not read TradePeg’s pricelists (${pricelistError}). Type the id instead.`) : null,
          field('Google Shopping', pricelist('googlePricelistId'), 'The TradePeg pricelist the Google feed prices from', 4),
          field('eBay', pricelist('ebayPricelistId'), 'The TradePeg pricelist eBay listings price from', 4)
        ),
        section(
          'eBay listing defaults',
          field('Dispatch time (working days)', input('ebayDispatchDays', { type: 'number', min: 0, max: 30 }), null, 4),
          field('Condition', select('ebayConditionId', [['', '—'], ...EBAY_CONDITIONS.map(([id, label]) => [id, `${label} (${id})`])]), null, 4),
          field('Item location (postcode)', input('ebayLocation'), null, 4),
          field('Shipping policy', input('ebayShippingProfile'), 'The name of the business policy in eBay', 4),
          field('Return policy', input('ebayReturnProfile'), 'The name of the business policy in eBay', 4),
          field('Payment policy', input('ebayPaymentProfile'), 'The name of the business policy in eBay', 4)
        )
      )
    )
  }

  // ---------------------------------------------------------------- sync

  /** "just now", "4 min", "2 h 10 min", "3 days" — how long a number of seconds is, roughly. */
  function span(seconds) {
    const s = Math.abs(seconds)
    if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min`
    if (s < 2 * 86400) {
      const h = Math.floor(s / 3600)
      const m = Math.round((s % 3600) / 60)
      return `${h} h${m ? ` ${m} min` : ''}`
    }
    return `${Math.round(s / 86400)} days`
  }
  /** "4 min ago" for the past, "in 3 min" for the future. */
  function ago(at) {
    if (!at) return '—'
    const s = (Date.now() - new Date(at).getTime()) / 1000
    if (Math.abs(s) < 45) return s < 0 ? 'any moment' : 'just now'
    return s < 0 ? `in ${span(s)}` : `${span(s)} ago`
  }

  /** When a five-field cron line next fires (the server runs on UTC). Handles *, lists, ranges and steps. */
  function nextCron(cron, from = new Date()) {
    const [min, hour, dom = '*', mon = '*', dow = '*'] = String(cron || '').trim().split(/\s+/)
    if (!min || !hour) return null
    const hit = (spec, v, lo) =>
      spec.split(',').some((part) => {
        const [range, every] = part.split('/')
        const step = Number(every || 1)
        let [a, b] = range === '*' ? [lo, 99] : range.split('-').map(Number)
        if (b === undefined) b = every ? 99 : a
        return v >= a && v <= b && (v - a) % step === 0
      })
    const t = new Date(from)
    t.setUTCSeconds(0, 0)
    for (let i = 0; i < 60 * 24 * 8; i++) {
      t.setUTCMinutes(t.getUTCMinutes() + 1)
      if (hit(min, t.getUTCMinutes(), 0) && hit(hour, t.getUTCHours(), 0) && hit(dom, t.getUTCDate(), 1) && hit(mon, t.getUTCMonth() + 1, 1) && hit(dow, t.getUTCDay(), 0)) return t
    }
    return null
  }
  /** "Every 5 minutes" for the usual lines; the line itself otherwise. */
  function cronWords(cron) {
    const m = /^\*\/(\d+) \* \* \* \*$/.exec(String(cron || '').trim())
    if (m) return `Every ${m[1]} minutes`
    if (String(cron).trim() === '* * * * *') return 'Every minute'
    return cron
  }

  async function syncTool(content, alive) {
    fill(content, tpPanel('TradePeg sync', null, el('div', { class: 'formRow fluid' }, el('div', { class: 'col-md-12' }, spinner()))))
    let s
    try {
      s = await request('GET', adminPath('/state'))
    } catch (error) {
      if (!alive()) return
      const box = el('div', { class: 'col-md-12' })
      toolError(box, error, () => syncTool(content, alive))
      return fill(content, tpPanel('TradePeg sync', null, el('div', { class: 'formRow fluid' }, box)))
    }
    if (!alive()) return
    const tp = s.tradepeg ?? {}
    const search = s.search ?? {}
    // What the last import did, in words; what did not change is left out.
    const SAID = {
      productsCreated: 'new parents', productsUpdated: 'parents updated', productsArchived: 'parents archived',
      variantsCreated: 'new variants', variantsUpdated: 'variants updated', variantsEol: 'variants no longer sold',
      manufacturersCreated: 'new manufacturers',
    }
    const counts = Object.entries(tp.counts ?? {}).filter(([k, v]) => Number(v) && SAID[k]).map(([k, v]) => `${v} ${SAID[k]}`).join(', ')
    const output = el('div')
    const resync = el('a', { href: '#', class: `btn btn-success${s.tradepegRunning ? ' disabled' : ''}`, title: 'Ask TradePeg for a fresh file and bring in what changed', onclick: (e) => { e.preventDefault(); if (!resync.classList.contains('disabled')) void run() } }, icon('fa-refresh'), ' Resync now')
    headerActions(resync)

    function run() {
      resync.classList.add('disabled')
      resyncDialog({ onDone: () => alive() && syncTool(content, alive) })
    }

    async function pushAll() {
      if (!confirm('Send every product to the website’s search again now? It takes a minute or two.')) return
      fill(output, el('div', { class: 'alert alert-info' }, icon('fa-spinner fa-spin'), ' Sending everything…'))
      try {
        const r = await request('POST', adminPath('/reindex'), { timeout: 600000 })
        if (alive()) fill(output, el('div', { class: 'alert alert-success' }, 'Sent. ', r?.count != null ? `${r.count} products.` : ''))
      } catch (error) {
        if (alive()) fill(output, el('div', { class: 'alert alert-danger' }, error.message))
      }
    }

    const busy = s.tradepegRunning || tp.status === 'running'
    const failed = !busy && tp.status === 'failed'
    const issues = (s.issues?.errors ?? 0) + (s.issues?.warnings ?? 0)
    const lastRun = tp.finishedAt || tp.checkedAt || tp.startedAt
    const next = s.schedule?.enabled ? nextCron(s.schedule.cron) : null

    // Times read "4 min ago" and keep counting while the page is open.
    const ticking = []
    const live = (fn) => {
      const node = el('span', {}, fn())
      ticking.push([node, fn])
      return node
    }
    const timer = setInterval(() => {
      if (!alive()) return clearInterval(timer)
      for (const [node, fn] of ticking) node.textContent = fn()
      // The scheduled run should have happened: look again.
      if (next && !busy && Date.now() > next.getTime() + 90000) {
        clearInterval(timer)
        void syncTool(content, alive)
      }
    }, 20000)

    const stat = (label, value, help, cls = '', cols = 2) =>
      el('div', { class: `col-md-${cols} fpim-field fpim-statcell` }, el('div', { class: `fpim-stat ${cls}` }, value), el('div', { class: 'help-block', title: help || null }, label))

    // Details: what needs fixing, then the technical side. Folded away until asked for.
    const detailsBody = el('div', { hidden: true })
    const issuesHolder = el('div')
    let issuesLoaded = false
    const toggleDetails = (show = detailsBody.hidden) => {
      detailsBody.hidden = !show
      fill(detailsButton, show ? 'Hide details' : 'Show details')
      if (show && !issuesLoaded) {
        issuesLoaded = true
        void paintIssues(issuesHolder, alive)
      }
    }
    const detailsButton = headButton('Show details', () => toggleDetails(), 'btn-default')
    const showIssues = (e) => {
      e.preventDefault()
      toggleDetails(true)
      issuesHolder.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }

    const statusText = busy ? 'Syncing…' : failed ? 'Failed' : 'Up to date'
    fill(
      content,
      tpPanel(
        'TradePeg sync',
        null,
        el(
          'div',
          { class: `formRow fluid fpim-syncrow ${busy ? 'fpim-busy' : failed ? 'fpim-bad' : 'fpim-good'}`, role: 'status' },
          stat('Status', [icon(busy ? 'fa-refresh fa-spin' : failed ? 'fa-exclamation-circle' : 'fa-check-circle'), ` ${statusText}`], failed ? tp.error : null, failed ? 'text-danger' : busy ? 'text-info' : 'text-success'),
          stat('Last run', live(() => ago(lastRun)), when(lastRun)),
          stat('Next run', s.schedule?.enabled ? live(() => (next ? ago(next) : '—')) : 'Not scheduled', s.schedule?.enabled ? `${cronWords(s.schedule.cron)} · ${when(next?.toISOString())}` : 'Automatic sync is off: use Resync now after changing items in TradePeg'),
          stat('Last change brought in', live(() => ago(tp.lastSuccessAt)), counts || null, '', 2),
          stat('Issues to fix', issues ? el('a', { href: '#', onclick: showIssues }, String(issues)) : 'None', issues ? 'Click to see them' : 'Everything came in cleanly', s.issues?.errors ? 'text-danger' : ''),
          stat('Website', search.enabled === false ? 'Not sending' : search.status === 'failed' ? 'Failing' : 'Sending', search.enabled === false ? 'This PIM does not send changes to the website yet' : search.error || `Every save goes to the website within a minute. Last sent ${when(search.finishedAt || search.updatedAt)}`),
          el('div', { class: 'clear' })
        ),
        failed && tp.error ? el('div', { class: 'formRow fluid' }, el('div', { class: 'col-md-12' }, el('div', { class: 'alert alert-danger', style: 'margin:0' }, tp.error))) : null,
        output
      ),
      el(
        'div',
        { class: 'panel panel-parts fluid mt10' },
        el('div', { class: 'panel-heading' }, 'Details', issues ? el('span', { class: `label ${s.issues?.errors ? 'label-danger' : 'label-warning'} ml5` }, plural(issues, 'issue')) : null, el('div', { class: 'btns pull-right' }, detailsButton)),
        el(
          'div',
          { class: 'panel-body p0' },
          detailsBody
        )
      )
    )
    fill(
      detailsBody,
      el('div', { class: 'formRow fluid fpim-part' }, el('div', { class: 'help-block fpim-part-title' }, 'Issues to fix:'), el('div', { class: 'col-md-12' }, issuesHolder), el('div', { class: 'clear' })),
      section(
        'Technical',
        kv([
          ['Last run', `${when(lastRun)}${tp.trigger ? ` (${tp.trigger})` : ''}`],
          ['Automatic sync', s.schedule ? (s.schedule.enabled ? `${cronWords(s.schedule.cron)} (${s.schedule.cron}, UTC)` : 'Off') : null],
          ['TradePeg wrote the file', when(tp.pipelineFileAt)],
          ['TradePeg pipeline', s.pipeline ? `${s.pipeline.name}${s.pipeline.runsAt.length ? ` at ${s.pipeline.runsAt.join(', ')}` : ''} · last ${when(s.pipeline.lastRunAt)} ${s.pipeline.lastStatus ?? ''}` : null],
          ['Search index', search.index],
        ]),
        (tp.recentErrors ?? []).length
          ? el('table', { class: 'fpim-table' }, el('tbody', {}, tp.recentErrors.slice(0, 5).map((e) => el('tr', {}, el('td', { style: 'white-space:nowrap' }, when(e.at)), el('td', {}, e.message)))))
          : null,
        search.enabled === false ? null : button('Send everything to the website again', () => void pushAll(), 'btn-default')
      )
    )
    if (location.hash.includes('issues')) toggleDetails(true)
  }

  /** What the TradePeg sync could not bring in cleanly, grouped by problem, each group folded. */
  async function paintIssues(holder, alive) {
    fill(holder, spinner())
    let r
    try {
      r = await request('GET', adminPath('/issues'))
    } catch (error) {
      return alive() && toolError(holder, error, () => paintIssues(holder, alive))
    }
    if (!alive()) return
    if (!r.items.length) return fill(holder, el('p', { class: 'text-success' }, icon('fa-check'), ' Nothing to fix.'))
    const groups = new Map()
    for (const item of r.items) {
      if (!groups.has(item.code)) groups.set(item.code, [])
      groups.get(item.code).push(item)
    }
    const sorted = [...groups].sort(([a], [b]) => Number(r.codes[a]?.severity !== 'error') - Number(r.codes[b]?.severity !== 'error'))
    fill(
      holder,
      sorted.map(([code, items]) => {
        const c = r.codes[code] ?? {}
        return el(
          'details',
          { class: 'fpim-issue' },
          el('summary', {}, el('span', { class: `label ${c.severity === 'error' ? 'label-danger' : 'label-warning'}` }, items.length), ' ', c.label ?? code),
          el(
            'div',
            { class: 'fpim-issue-body' },
            c.fix ? el('p', {}, c.fix) : null,
            el('table', { class: 'fpim-table' }, el('tbody', {}, items.slice(0, 200).map((i) => el('tr', {}, el('td', { class: 'fpim-sku', style: 'white-space:nowrap;width:160px' }, i.sku ?? i.product ?? ''), el('td', {}, i.message ?? i.detail ?? ''))))),
            items.length > 200 ? el('p', { class: 'fpim-help' }, `…and ${items.length - 200} more.`) : null
          )
        )
      }),
      el('p', { class: 'fpim-help', style: 'margin-top:8px' }, 'Each sync replaces this list, so a fixed issue disappears after the next one.')
    )
  }

  // ---------------------------------------------------------------- import

  /**
   * Bulk updates, laid out like TradePeg's own imports (Data → Importer): a
   * panel with Import at the top right, a dropzone for a spreadsheet, the
   * options, and a grid to type or paste rows into, with notes underneath.
   * A dropped file fills the grid; typing a SKU fills its row with what the PIM
   * has now, so only what you change is changed. Two steps: Check is a dry run
   * that colours the rows (problems red, changes green) and says what would
   * change; Import saves, and is offered only after a check that passed with
   * changes — editing any cell needs a new Check. Nothing is ever created —
   * SKUs come only from TradePeg.
   */
  /**
   * `preset` embeds the grid elsewhere: { kind, rows, columns?, title, note,
   * onDone } — locked to that import, showing only `columns`, filled with
   * `rows`, with its own Check and Import buttons. Its rows are not the Import
   * page's.
   */
  async function importTool(content, alive, preset = null) {
    fill(content, spinner())
    let kinds
    try {
      kinds = await request('GET', adminPath('/imports'))
    } catch (error) {
      return alive() && toolError(content, error, () => importTool(content, alive, preset))
    }
    if (!alive()) return

    // The grid survives moving between pages (and between import types).
    const st = preset
      ? { kind: preset.kind, rows: { [preset.kind]: preset.rows.map((r) => ({ ...r })) }, options: (toolState.importOptions ??= {}) }
      : (toolState.import ??= { kind: Object.keys(kinds)[0], rows: {} })
    if (!kinds[st.kind]) st.kind = Object.keys(kinds)[0]
    const SPARE = 3
    let checked = null // the last check's result, while the grid has not changed since
    const t = () => kinds[st.kind]
    const data = () => (st.rows[st.kind] ??= [])
    const cols = () => (preset?.columns ? t().columns.filter((c) => preset.columns.includes(c.header)) : t().columns)
    const keyCol = () => t().key

    const result = el('div')
    const tableHolder = el('div', { class: 'fpim-sheet' })
    const note = el('div')
    let busy = null // 'check' | 'import' while the PIM works on the rows
    const checkBtn = el('a', { class: 'btn btn-sm btn-info', href: '#', title: 'See what would change; nothing is saved', onclick: (e) => { e.preventDefault(); if (!checkBtn.classList.contains('disabled')) void go(false) } })
    const importBtn = el('a', { class: 'btn btn-sm btn-success', href: '#', onclick: (e) => { e.preventDefault(); if (!importBtn.classList.contains('disabled')) void go(true) } })
    /** Import is ready only after a check that passed with changes, while the grid is as it was checked. */
    const ready = () => Boolean(checked && !checked.applied && !(checked.errors ?? []).length && (checked.changes ?? []).length)
    const paintImportBtn = () => {
      fill(checkBtn, icon(busy === 'check' ? 'fa-spinner fa-spin' : 'fa-check-circle'), ' Check')
      checkBtn.classList.toggle('disabled', Boolean(busy))
      const n = ready() ? checked.changes.length : 0
      fill(importBtn, icon(busy === 'import' ? 'fa-spinner fa-spin' : 'fa-upload'), ` Import${n ? ` ${plural(n, 'change')}` : ''}`)
      importBtn.classList.toggle('disabled', Boolean(busy) || !n)
      importBtn.title = n ? '' : 'Check first: Import is ready once a check passes with changes'
    }
    /** Any edit makes the last check out of date: its result goes, and Import needs a new Check. */
    const changedGrid = () => {
      if (!checked) return
      checked = null
      paintImportBtn()
      fill(result)
      for (const tr of tableHolder.querySelectorAll('tr.danger, tr.success')) tr.classList.remove('danger', 'success')
      if (marks.size) {
        marks.clear()
        hot?.render()
      }
    }

    // ------------------------------------------------ the grid
    const filled = () => data().map((r, i) => ({ r, line: i + 1 })).filter(({ r }) => cols().some((c) => String(r[c.header] ?? '').trim()))

    // ------------------------------------------------ the choices a column offers
    // Yes / No and fixed lists are dropdowns; long lists (categories, tags,
    // Google and eBay) are typed with suggestions, several at once where allowed.
    const opts = (st.options ??= {})
    async function loadOptions() {
      if (opts[st.kind]) return
      try {
        opts[st.kind] = await request('GET', adminPath(`/imports/${st.kind}/options`))
        if (alive()) paintGrid()
      } catch {
        opts[st.kind] = {}
      }
    }
    const listOf = (c) => opts[st.kind]?.[c.options] ?? null
    const choicesOf = (c) => (c.kind === 'bool' ? [['Yes', 'Yes'], ['No', 'No']] : c.options === 'statuses' ? [['Draft', 'Draft'], ['Ready', 'Ready']] : (listOf(c) ?? []).map((v) => [v, v]))
    /** Fixed short lists are dropdowns; names (brands, manufacturers, variation names) are typed with suggestions. */
    const isDropdown = (c) => c.kind === 'bool' || c.options === 'statuses'
    const isTyped = (c) => c.kind === 'key' || c.kind === 'pick' || (c.kind === 'select' && !isDropdown(c))
    /**
     * A value as the cell holds it: "yes", "TRUE", "1", "on" → Yes; "draft" → Draft; "aurelia" → Aurelia
     * (a brand, manufacturer or category written in any case is the one on the list).
     */
    function normal(c, v) {
      const text = String(v ?? '').trim()
      if (!text || text === 'NULL') return text
      if (c.kind === 'bool') return /^(1|true|yes|y|on)$/i.test(text) ? 'Yes' : /^(0|false|no|n|off)$/i.test(text) ? 'No' : text
      if (c.kind === 'select' || c.kind === 'pick') return choicesOf(c).find(([value]) => value.toLowerCase() === text.toLowerCase())?.[0] ?? text
      if (c.kind === 'multi' && listOf(c)) {
        const sep = lined(c) ? '\n' : ', '
        return String(v).split(lined(c) ? /\n/ : /\s*,\s*/).map((x) => x.trim()).filter(Boolean).map((x) => listOf(c).find((y) => y.toLowerCase() === x.toLowerCase()) ?? x).join(sep)
      }
      return v
    }

    function choiceInput(rowIndex, c, value) {
      const choices = choicesOf(c)
      const select = el(
        'select',
        { class: 'fpim-cell' },
        el('option', { value: '' }, ''),
        choices.map(([v, label]) => el('option', { value: v }, label)),
      )
      // Whatever the cell holds stays visible, even if it is not one of the choices (Import then says why).
      if (value && !choices.some(([v]) => v === value) && value !== 'NULL') select.append(el('option', { value }, `${value} ?`))
      select.value = value
      return select
    }

    /** A cell for a long list: a single pick types with suggestions; a multi cell opens a list to tick. */
    function suggestInput(c, value) {
      const multi = c.kind === 'multi'
      const input = el('input', { class: 'fpim-cell', value, list: multi ? null : `fpim-list-${st.kind}-${c.options}`, autocomplete: 'off' })
      if (multi) {
        // Categories are kept one per line; a grid cell shows them with " | ".
        if (lined(c)) input.value = String(value).split('\n').filter(Boolean).join(' | ')
        input.title = `Click to choose; or type them, separated by ${lined(c) ? '|' : 'commas'}`
        input.addEventListener('focus', () => openMulti(input, c))
        input.addEventListener('click', () => openMulti(input, c))
      }
      return input
    }
    const lined = (c) => c.separator === '\n'
    const splitMulti = (c, text) => text.split(lined(c) ? /\s*\|\s*/ : /\s*,\s*/).map((v) => v.trim()).filter(Boolean)
    const cellValue = (c, input) => (c.kind === 'multi' && lined(c) ? splitMulti(c, input.value).join('\n') : input.value)

    // The tick list a multi cell opens, under the cell.
    let popover = null
    const closeMulti = () => {
      popover?.remove()
      popover = null
    }
    document.addEventListener('mousedown', (e) => {
      if (popover && !popover.contains(e.target) && e.target !== popover.input) closeMulti()
    })
    function openMulti(input, c) {
      const list = listOf(c)
      if (!list?.length || popover?.input === input) return
      closeMulti()
      const find = el('input', { class: 'form-control input-sm', type: 'search', placeholder: `Find ${c.header.toLowerCase()}…`, 'aria-label': `Find ${c.header}` })
      const items = el('div', { class: 'fpim-multi-list' })
      const paintItems = () => {
        const term = find.value.trim().toLowerCase()
        const now = new Set(splitMulti(c, input.value))
        const hits = list.filter((v) => !term || v.toLowerCase().includes(term))
        fill(
          items,
          hits.slice(0, 200).map((v) => {
            const box = el('input', { type: 'checkbox' })
            box.checked = now.has(v)
            box.addEventListener('change', () => {
              const next = splitMulti(c, input.value).filter((x) => x !== v)
              if (box.checked) next.push(v)
              input.value = next.join(lined(c) ? ' | ' : ', ')
              input.dispatchEvent(new Event('input'))
            })
            return el('label', {}, box, el('span', {}, v))
          }),
          hits.length > 200 ? el('div', { class: 'fpim-help' }, `${hits.length} match — type to narrow them down`) : !hits.length ? el('div', { class: 'text-muted' }, 'Nothing matches.') : null
        )
      }
      find.addEventListener('input', paintItems)
      find.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          closeMulti()
          input.focus()
        }
      })
      popover = el('div', { class: 'fpim-multi' }, find, items, el('div', { class: 'fpim-multi-foot' }, button('Done', () => { closeMulti(); input.focus() }, 'btn-default')))
      popover.input = input
      const td = input.closest('td')
      popover.style.top = `${td.offsetTop + td.offsetHeight}px`
      popover.style.left = `${td.offsetLeft}px`
      tableHolder.append(popover)
      paintItems()
    }

    function datalists() {
      return cols()
        .filter((c) => isTyped(c) && listOf(c))
        .map((c) => el('datalist', { id: `fpim-list-${st.kind}-${c.options}` }, listOf(c).slice(0, 8000).map((v) => el('option', { value: v }))))
    }

    function cell(rowIndex, c) {
      const row = data()[rowIndex] ?? {}
      const value = row[c.header] ?? ''
      if (c.kind === 'readonly') return el('td', { class: 'fpim-ro-cell', title: value }, value)
      const input =
        isDropdown(c)
          ? choiceInput(rowIndex, c, value)
          : c.kind === 'multi' || isTyped(c)
            ? suggestInput(c, value)
            : el(c.kind === 'long' ? 'textarea' : 'input', { class: 'fpim-cell', rows: c.kind === 'long' ? 1 : null, value, spellcheck: 'false' })
      input.setAttribute('aria-label', `${c.header}, row ${rowIndex + 1}`)
      input.dataset.row = rowIndex
      input.dataset.col = c.header
      const isSelect = input.tagName === 'SELECT'
      input.addEventListener(isSelect ? 'change' : 'input', () => {
        while (data().length <= rowIndex) data().push({})
        data()[rowIndex][c.header] = cellValue(c, input)
        topUpSpares()
        changedGrid()
      })
      if (c.kind === 'key') input.addEventListener('change', () => void prefill([rowIndex]))
      else if (isTyped(c)) input.addEventListener('change', () => {
        const fixed = normal(c, input.value)
        if (fixed !== input.value) {
          input.value = fixed
          data()[rowIndex][c.header] = fixed
        }
      })
      input.addEventListener('paste', (e) => {
        const text = e.clipboardData?.getData('text/plain') ?? ''
        if (!isSelect && !/[\t\n]/.test(text.replace(/\n$/, ''))) return
        e.preventDefault()
        pasteAt(rowIndex, c.header, text)
      })
      input.addEventListener('keydown', (e) => {
        const step = e.key === 'Enter' || (!isSelect && e.key === 'ArrowDown') ? 1 : !isSelect && e.key === 'ArrowUp' ? -1 : 0
        if (!step || (c.kind === 'long' && e.key !== 'Enter') || (e.key === 'Enter' && e.shiftKey)) return
        e.preventDefault()
        tableHolder.querySelector(`[data-row="${rowIndex + step}"][data-col="${CSS.escape(c.header)}"]`)?.focus()
      })
      return el('td', { class: isSelect ? 'fpim-select-cell' : null }, input)
    }

    function rowEl(i) {
      return el(
        'tr',
        { 'data-index': i },
        el(
          'th',
          { class: 'fpim-rownum' },
          i + 1,
          i < data().length
            ? el('button', { type: 'button', class: 'fpim-rowdel', title: `Remove row ${i + 1}`, 'aria-label': `Remove row ${i + 1}`, onclick: () => { data().splice(i, 1); changedGrid(); paintGrid() } }, '×')
            : null
        ),
        cols().map((c) => cell(i, c))
      )
    }

    // ------------------------------------------------ TradePeg's grid
    // TradePeg's pages carry Handsontable (its importers use it): the same grid,
    // with its range selection, drag-down fill, copy and paste. Without it (a
    // page that lacks it), the plain grid below does the job.
    const page$ = (() => {
      try {
        const $ = (typeof unsafeWindow !== 'undefined' ? unsafeWindow : window).jQuery
        return $?.fn?.handsontable ? $ : null
      } catch {
        return null
      }
    })()
    let hot = null
    let hotFor = null
    const marks = new Map() // row index -> 'danger' | 'success'
    const countNote = () => fill(note, data().length ? el('span', { class: 'fpim-help' }, `${plural(filled().length, 'row')} in the grid.`) : null)

    function paintHot() {
      if (hot && hotFor?.kind === st.kind && hotFor.rows === data() && hotFor.options === Boolean(opts[st.kind])) {
        hot.render()
        return countNote()
      }
      try { hot?.destroy() } catch { /* already gone */ }
      const holder = el('div', { class: 'fpim-hot' })
      fill(tableHolder, holder)
      const widthOf = (c) => (c.kind === 'long' || c.kind === 'multi' || c.kind === 'pick' ? 220 : c.kind === 'bool' ? 90 : 150)
      // The list under a dropdown cell is built while hidden and would measure itself 1px wide
      // (an old Handsontable's bug): give it its size up front.
      const list = (c, rows) => ({ handsontable: { width: Math.max(widthOf(c), 160), height: Math.min(rows, 8) * 24 + 2 } })
      const cell = (c) =>
        c.kind === 'readonly'
          ? { readOnly: true }
          : isDropdown(c)
            ? { type: 'dropdown', source: choicesOf(c).map(([v]) => v), ...list(c, choicesOf(c).length) }
            : (isTyped(c) || c.kind === 'multi') && listOf(c)
              ? { type: 'autocomplete', source: listOf(c), strict: false, filter: true, ...list(c, 8) }
              : {}
      page$(holder).handsontable({
        data: data(),
        dataSchema: Object.fromEntries(cols().map((c) => [c.header, null])),
        colHeaders: cols().map((c) => `${c.header}${c.required ? ' *' : ''}`),
        columns: cols().map((c) => ({ data: c.header, ...cell(c) })),
        colWidths: cols().map(widthOf),
        rowHeaders: true,
        minSpareRows: SPARE,
        columnSorting: false,
        contextMenu: false,
        width: null,
        afterChange(changes, source) {
          if (!changes || source === 'loadData' || source === 'pim') return
          // Typed or pasted names take the list's spelling; Yes / No and statuses their usual form.
          const fixes = []
          for (const [row, prop, , value] of changes) {
            const c = cols().find((x) => x.header === prop)
            const fixed = c ? normal(c, value) : value
            if (c && fixed !== value) fixes.push([row, prop, fixed])
          }
          if (fixes.length) this.setDataAtRowProp(fixes, null, null, 'pim')
          marks.clear()
          changedGrid()
          countNote()
          const keyRows = changes.filter(([, prop]) => prop === keyCol()).map(([row]) => row)
          if (keyRows.length) void prefill([...new Set(keyRows)])
        },
        afterRenderer(td, row) {
          const m = marks.get(row)
          td.style.backgroundColor = m === 'danger' ? '#f2dede' : m === 'success' ? '#dff0d8' : ''
        },
      })
      hot = page$(holder).handsontable('getInstance')
      hotFor = { kind: st.kind, rows: data(), options: Boolean(opts[st.kind]) }
      countNote()
    }

    function paintGrid() {
      if (page$) return paintHot()
      const body = el('tbody', {}, Array.from({ length: data().length + SPARE }, (_, i) => rowEl(i)))
      closeMulti()
      fill(
        tableHolder,
        datalists(),
        el(
          'table',
          { class: 'table-grid table-bordered fpim-sheet-table' },
          el('thead', {}, el('tr', {}, el('th', { class: 'fpim-rownum' }), cols().map((c) => el('th', { title: c.hint ?? (c.kind === 'readonly' ? 'Shown for reference, never imported' : '') }, c.header, c.required ? ' *' : '', c.kind === 'readonly' ? el('span', { class: 'fpim-help' }, ' (shown)') : null)))),
          body
        )
      )
      fill(note, data().length ? el('span', { class: 'fpim-help' }, `${plural(filled().length, 'row')} in the grid.`) : null)
    }

    /** Keep three empty rows under the last one in use, as TradePeg's grid does. */
    function topUpSpares() {
      const body = tableHolder.querySelector('tbody')
      for (let i = body.rows.length; i < data().length + SPARE; i++) body.append(rowEl(i))
      fill(note, el('span', { class: 'fpim-help' }, `${plural(filled().length, 'row')} in the grid.`))
    }

    /** Excel pastes as tab-separated lines; quoted cells may hold tabs and newlines. */
    function parseTsv(raw) {
      const records = []
      let row = []
      let value = ''
      let quoted = false
      for (let i = 0; i < raw.length; i++) {
        const ch = raw[i]
        if (quoted) {
          if (ch === '"' && raw[i + 1] === '"') { value += '"'; i++ } else if (ch === '"') quoted = false
          else value += ch
        } else if (ch === '"' && value === '') quoted = true
        else if (ch === '\t') { row.push(value); value = '' }
        else if (ch === '\n' || ch === '\r') {
          if (ch === '\r' && raw[i + 1] === '\n') i++
          row.push(value); records.push(row); row = []; value = ''
        } else value += ch
      }
      if (value || row.length) { row.push(value); records.push(row) }
      return records.filter((r) => r.some((x) => x.trim()))
    }

    /** A block pasted from Excel fills the grid from the cell it lands in; a header row is matched by name. */
    function pasteAt(rowIndex, header, text) {
      let records = parseTsv(text)
      if (!records.length) return
      const names = cols().map((c) => c.header.toLowerCase())
      const looksLikeHeader = records[0].filter((x) => names.includes(x.trim().replace(/\s*\*$/, '').toLowerCase())).length >= 2
      let targets
      if (looksLikeHeader) {
        targets = records[0].map((x) => cols().find((c) => c.header.toLowerCase() === x.trim().replace(/\s*\*$/, '').toLowerCase())?.header ?? null)
        records = records.slice(1)
      } else {
        const start = cols().findIndex((c) => c.header === header)
        targets = records[0].map((_, j) => cols()[start + j]?.header ?? null)
      }
      const touched = []
      records.forEach((rec, j) => {
        const at = rowIndex + j
        while (data().length <= at) data().push({})
        rec.forEach((v, k) => {
          const h = targets[k]
          const c = cols().find((x) => x.header === h)
          if (c && c.kind !== 'readonly') data()[at][h] = normal(c, v)
        })
        touched.push(at)
      })
      changedGrid()
      paintGrid()
      void prefill(touched)
    }

    /** Rows whose key was just typed or pasted: fill their empty cells with what the PIM has now. */
    async function prefill(indexes) {
      const key = keyCol()
      const keys = [...new Set(indexes.map((i) => String(data()[i]?.[key] ?? '').trim()).filter(Boolean))]
      if (!keys.length) return
      try {
        const { rows } = await request('POST', adminPath(`/imports/${st.kind}/prefill`), { json: { keys } })
        if (!alive()) return
        const unknown = []
        const moved = []
        for (const i of indexes) {
          const r = data()[i]
          const k = String(r?.[key] ?? '').trim()
          if (!k) continue
          const now = rows[k]
          if (!now) { unknown.push(k); continue }
          // A part code answered with its parent: the row edits the parent.
          if (now[key] && now[key] !== k) {
            moved.push(`${k} → ${now[key]}`)
            r[key] = now[key]
          }
          for (const c of cols()) if (c.kind === 'readonly' || !String(r[c.header] ?? '').trim()) r[c.header] = normal(c, now[c.header] ?? '')
        }
        paintGrid()
        fill(
          result,
          moved.length ? el('div', { class: 'alert alert-info' }, `Parts swapped for their parent (this import edits parents): ${moved.join(', ')}.`) : null,
          unknown.length ? el('div', { class: 'alert alert-warning' }, `Not in the PIM: ${unknown.join(', ')}. Those rows will be left out.`) : null
        )
      } catch (error) {
        fill(result, el('div', { class: 'alert alert-danger' }, error.message))
      }
    }

    // ------------------------------------------------ a dropped spreadsheet fills the grid
    const fileInput = el('input', { type: 'file', accept: '.xlsx,.csv', style: 'display:none' })
    async function readFile(file) {
      if (!file) return
      fill(result, spinner(` Reading ${file.name}…`))
      const form = new FormData()
      form.append('file', file, file.name)
      try {
        const r = await request('POST', adminPath(`/imports/${st.kind}/read`), { form, timeout: 300000 })
        if (!alive()) return
        const known = new Set(cols().map((c) => c.header))
        const ignored = r.headers.filter((h) => !known.has(h))
        st.rows[st.kind] = r.rows.map((row) => Object.fromEntries(cols().filter((c) => c.header in row).map((c) => [c.header, normal(c, row[c.header])])))
        changedGrid()
        paintGrid()
        fill(
          result,
          el(
            'div',
            { class: 'alert alert-info' },
            `Read ${plural(r.rows.length, 'row')} from ${r.file}. Check them in the grid, then press Check.`,
            r.more ? ` Only the first 5,000 are shown; ${r.more} more were left out — split the file.` : '',
            ignored.length ? el('div', { style: 'margin-top:4px' }, `Columns not used here: ${ignored.join(', ')}.`) : null
          )
        )
      } catch (error) {
        if (alive()) fill(result, el('div', { class: 'alert alert-danger' }, error.message))
      }
    }
    fileInput.addEventListener('change', () => {
      const file = fileInput.files[0]
      fileInput.value = ''
      void readFile(file)
    })
    const drop = el(
      'div',
      { class: 'dropzone mb5 fpim-dropzone', role: 'button', tabindex: '0', 'aria-label': 'Choose a spreadsheet', onclick: () => fileInput.click() },
      el('div', { class: 'dz-message' }, 'Drop ', el('span', { class: 'bold' }, 'Excel'), ' or CSV files here or click to upload')
    )
    drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click() } })
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('dz-drag-hover') })
    drop.addEventListener('dragleave', () => drop.classList.remove('dz-drag-hover'))
    drop.addEventListener('drop', (e) => {
      e.preventDefault()
      drop.classList.remove('dz-drag-hover')
      void readFile(e.dataTransfer?.files?.[0])
    })

    // ------------------------------------------------ Check, then Import
    const fieldsOf = (fields) => (Array.isArray(fields) ? fields : Object.keys(fields ?? {}))
    const changesTable = (changes) =>
      el(
        'div',
        { style: 'max-height:300px;overflow:auto' },
        el(
          'table',
          { class: 'fpim-table' },
          el('thead', {}, el('tr', {}, el('th', {}, keyCol()), el('th', {}, 'Fields changing'))),
          el('tbody', {}, changes.slice(0, 200).map((c) => el('tr', {}, el('td', { class: 'fpim-sku' }, c.sku), el('td', {}, fieldsOf(c.fields).join(', ')))))
        ),
        changes.length > 200 ? el('p', { class: 'fpim-help' }, `…and ${changes.length - 200} more.`) : null
      )

    /** Problem rows red (with the problem on hover), rows that change green — in the grid itself. */
    function markRows(r) {
      const bad = new Map()
      const add = (line, message) => bad.set(Number(line), [...(bad.get(Number(line)) ?? []), message])
      for (const e of r.errors ?? []) add(e.line, e.message)
      for (const u of r.unknown ?? []) add(u.line, `${u.sku} is not in the PIM`)
      const good = new Set((r.changes ?? []).map((c) => String(c.sku)))
      const isGood = (row) => good.has(String(row?.[keyCol()] ?? '').trim())
      if (hot) {
        marks.clear()
        data().forEach((row, i) => {
          if (bad.has(i + 1)) marks.set(i, 'danger')
          else if (isGood(row)) marks.set(i, 'success')
        })
        hot.render()
      }
      for (const tr of tableHolder.querySelectorAll('tbody tr')) {
        const i = Number(tr.dataset.index)
        tr.classList.toggle('danger', bad.has(i + 1))
        tr.classList.toggle('success', !bad.has(i + 1) && isGood(data()[i]))
        tr.title = (bad.get(i + 1) ?? []).join('; ')
      }
    }

    /** What a check found: ready, nothing to do, or rows to fix — and the table of changes or problems. */
    function showCheck(r) {
      const errors = r.errors ?? []
      const changes = r.changes ?? []
      const unknown = r.unknown ?? []
      const ok = !errors.length
      const sub = [
        r.unchanged ? `${r.unchanged} already match.` : null,
        unknown.length ? `${unknown.length} not in the PIM: ${unknown.slice(0, 8).map((u) => u.sku).join(', ')}${unknown.length > 8 ? '…' : ''}` : null,
      ].filter(Boolean)
      fill(
        result,
        el(
          'div',
          { class: `alert ${!ok ? 'alert-danger' : changes.length ? 'alert-success' : 'alert-warning'}`, role: 'status' },
          el('strong', {}, ok ? (changes.length ? `Ready: ${plural(changes.length, 'product')} will change` : 'Nothing would change') : `${plural(errors.length, 'row')} need fixing — nothing was saved`),
          sub.length ? el('div', {}, sub.join(' ')) : null
        ),
        errors.length
          ? el(
              'div',
              { style: 'max-height:300px;overflow:auto' },
              el('table', { class: 'fpim-table' }, el('thead', {}, el('tr', {}, el('th', {}, 'Row'), el('th', {}, keyCol()), el('th', {}, 'Problem'))), el('tbody', {}, errors.map((e) => el('tr', {}, el('td', {}, e.line ?? ''), el('td', { class: 'fpim-sku' }, e.sku ?? ''), el('td', { class: 'text-danger' }, e.message)))))
            )
          : changes.length
            ? changesTable(changes)
            : null
      )
    }

    /** apply = false: Check, a dry run. apply = true: Import, after a check that passed. */
    async function go(apply) {
      const rows = filled().map(({ r, line }) => ({ ...r, line }))
      if (!rows.length) return fill(result, el('div', { class: 'alert alert-warning' }, `Type or paste some rows first — at least the ${keyCol()} column.`))
      if (apply && !ready()) return
      busy = apply ? 'import' : 'check'
      paintImportBtn()
      fill(result, spinner(apply ? ' Importing…' : ' Checking…'))
      let r
      try {
        r = await request('POST', adminPath(`/imports/${st.kind}${apply ? '?apply=1' : ''}`), { json: { rows, apply }, timeout: 600000 })
      } catch (error) {
        busy = null
        paintImportBtn()
        if (alive()) fill(result, el('div', { class: 'alert alert-danger' }, error.message))
        return null
      }
      busy = null
      if (!alive()) return r
      if (r.applied) {
        const done = r.changes ?? []
        checked = null
        marks.clear()
        st.rows[st.kind] = []
        paintGrid()
        paintImportBtn()
        toast('success', `Imported ${plural(done.length, 'change')}`)
        fill(
          result,
          el('div', { class: 'alert alert-success' }, el('strong', {}, `Imported ${plural(done.length, 'change')}`), el('div', {}, 'The website picks them up within a few minutes.')),
          done.length ? changesTable(done) : null
        )
        preset?.onDone?.(r)
        return r
      }
      // A check (or an import the PIM refused): the grid and the panel say why, and Import waits for a clean check.
      checked = r
      markRows(r)
      paintImportBtn()
      showCheck(r)
      if ((r.errors ?? []).length) toast('danger', `${plural(r.errors.length, 'row')} need fixing — nothing was saved`)
      return r
    }

    // ------------------------------------------------ the page
    const kindSelect = el('select', { class: 'form-control' }, Object.entries(kinds).map(([k, x]) => el('option', { value: k }, x.label)))
    kindSelect.value = st.kind
    kindSelect.addEventListener('change', () => {
      st.kind = kindSelect.value
      checked = null
      fill(result)
      paint()
    })
    const heading = el('div', { class: 'panel-heading' })
    const options = el('div', { class: 'formRow fpim-import-options' })
    const well = el('div', { class: 'well' })

    function paint() {
      fill(
        heading,
        preset?.title ?? `Import ${t().label.toUpperCase()}`,
        el(
          'div',
          { class: 'btns pull-right' },
          el('a', { class: 'btn btn-sm btn-info', href: '#', onclick: async (e) => { e.preventDefault(); try { saveFile(await request('GET', adminPath(`/imports/${st.kind}/template?format=xlsx`), { blob: true })) } catch (error) { fill(result, el('div', { class: 'alert alert-danger' }, error.message)) } } }, icon('fa-download'), ' Template'),
          ' ',
          el('a', { class: 'btn btn-sm btn-default', href: '#', onclick: (e) => { e.preventDefault(); st.rows[st.kind] = []; checked = null; marks.clear(); paintImportBtn(); fill(result); paintGrid() } }, 'Clear'),
          ' ',
          checkBtn,
          ' ',
          importBtn
        )
      )
      fill(
        options,
        el('div', { class: 'fpim-import-option' }, kindSelect, el('div', { class: 'help-block' }, 'What to update')),
        el('div', { class: 'fpim-import-option fpim-grow' }, el('p', { class: 'form-control-static' }, t().hint), el('div', { class: 'help-block' }, 'What this import changes'))
      )
      fill(
        well,
        el('p', { class: 'bold' }, 'How it works:'),
        el(
          'p',
          { style: 'margin:0' },
          st.kind === 'images'
            ? 'One SKU per row — a parent (every part shows its pictures), a part, or a unit like FM-1-CASE — and one or more picture links, separated by commas. They are added after the pictures it has; a link already imported for that SKU is skipped. Check first; Import saves only if every row is right.'
            : `Typing a ${t().key} into an empty row fills in what the PIM has now, ready to edit. Only the columns you fill in change: an empty cell leaves that field as it is; NULL clears it. Imports only update — ${t().key}s not in the PIM are listed, not created. Check first: problem rows turn red and nothing is saved; Import is ready once a check passes.`
        )
      )
      paintImportBtn()
      paintGrid()
      void loadOptions()
    }

    if (!preset) headerActions()
    fill(
      content,
      el(
        'div',
        { class: 'panel panel-parts mt10 fpim-import' },
        heading,
        el(
          'div',
          { class: 'panel-body p0' },
          preset ? null : el('div', { class: 'formRow fluid', style: 'border-bottom: 2px solid gray;' }, fileInput, el('div', { style: 'zoom:.7' }, drop)),
          preset ? (preset.note ? el('div', { class: 'formRow fpim-import-options' }, el('p', { class: 'form-control-static', style: 'margin:0' }, preset.note)) : null) : options,
          result,
          el('div', { class: 'table-responsive' }, tableHolder),
          note,
          preset ? null : el('div', { class: 'formRow mt20' }, well)
        )
      )
    )
    paint()
  }

  // ---------------------------------------------------------------- export

  const EXPORT_KEY = 'pimExport'

  /**
   * Export, the way feed tools do it: which products, one row per parent or per
   * variant, which columns (remembered on this computer), then Excel or CSV.
   * SKU is always the first column, so the file can come back through Import;
   * CSVs are UTF-8 (with the mark Excel needs), one level per file.
   */
  async function exportTool(content, alive) {
    fill(content, tpPanel('Export', null, el('div', { class: 'formRow fluid' }, el('div', { class: 'col-md-12' }, spinner()))))
    let all
    try {
      all = await request('GET', adminPath('/export/columns'))
    } catch (error) {
      if (!alive()) return
      const box = el('div', { class: 'col-md-12' })
      toolError(box, error, () => exportTool(content, alive))
      return fill(content, tpPanel('Export', null, el('div', { class: 'formRow fluid' }, box)))
    }
    if (!alive()) return
    headerActions()

    let saved = {}
    try {
      saved = JSON.parse(GM_getValue(EXPORT_KEY) || '{}') ?? {}
    } catch { /* start from the defaults */ }
    const known = (list, keys) => (Array.isArray(keys) ? keys.filter((k) => list.some((c) => c.key === k)) : null)
    const x = {
      rows: ['products', 'variants', 'both'].includes(saved.rows) ? saved.rows : 'both',
      products: new Set(known(all.products, saved.products) ?? all.products.map((c) => c.key)),
      variants: new Set(known(all.variants, saved.variants) ?? all.variants.map((c) => c.key)),
    }
    const grid = toolState.grid
    const listFiltered = Boolean(grid && (grid.search || grid.queue || archivedMode(grid.archived) !== 'hide' || Object.values(grid.facets ?? {}).some((v) => v.length)))
    // After "Tick all that match" the list's filter says which; picked then holds the unticked.
    const ticked = grid?.all ? 0 : grid?.picked?.size ?? 0
    let scope = toolState.exportScope === 'list' && (ticked || listFiltered) ? (ticked ? 'ticked' : 'list') : 'all'
    toolState.exportScope = null
    const remember = () => {
      try {
        GM_setValue(EXPORT_KEY, JSON.stringify({ rows: x.rows, products: [...x.products], variants: [...x.variants] }))
      } catch { /* only a convenience */ }
    }

    const out = el('div')
    const summary = el('span')
    const chooser = el('div')
    const SCOPES = [
      ['all', 'All parents'],
      ['draft', 'Draft only'],
      ['ready', 'Ready only'],
      listFiltered ? ['list', 'As filtered on the Parents page'] : null,
      ticked ? ['ticked', `The ${plural(ticked, 'parent')} ticked on the Parents page`] : null,
    ].filter(Boolean)
    const scopeSelect = el('select', { class: 'form-control' }, SCOPES.map(([k, label]) => el('option', { value: k }, label)))
    scopeSelect.value = scope
    scopeSelect.addEventListener('change', () => { scope = scopeSelect.value })
    const rowsSelect = el(
      'select',
      { class: 'form-control' },
      el('option', { value: 'products' }, 'One row per parent'),
      el('option', { value: 'variants' }, 'One row per variant (part)'),
      el('option', { value: 'both' }, 'Both: parents and variants')
    )
    rowsSelect.value = x.rows
    rowsSelect.addEventListener('change', () => {
      x.rows = rowsSelect.value
      remember()
      paint()
    })

    const target = () =>
      ({
        all: {},
        draft: { filter: { facets: { status: ['draft'] } } },
        ready: { filter: { facets: { status: ['ready'] } } },
        list: { filter: listFilter(grid) },
        ticked: { ids: [...(grid?.picked ?? [])] },
      })[scope] ?? {}

    /** One level's columns as tick boxes, in the file's order; SKU is always in. */
    function columnBox(level, title) {
      const list = all[level]
      const chosen = x[level]
      const set = (keys) => {
        x[level] = new Set(keys)
        remember()
        paint()
      }
      return el(
        'div',
        { class: 'formRow fluid fpim-part' },
        el(
          'div',
          { class: 'help-block fpim-part-title' },
          `${title}: `,
          el('span', { class: 'fpim-colcount' }, `${list.filter((c, i) => i === 0 || chosen.has(c.key)).length} of ${list.length} columns`),
          el(
            'span',
            { class: 'fpim-colpresets' },
            button('All', () => set(list.map((c) => c.key)), 'btn-link'),
            button('Only what Import reads back', () => set(list.filter((c) => !c.readOnly).map((c) => c.key)), 'btn-link'),
            button('Just SKU', () => set([]), 'btn-link')
          )
        ),
        el(
          'div',
          { class: 'col-md-12 fpim-cols4' },
          list.map((c, i) => {
            const box = el('input', { type: 'checkbox', 'data-level': level, 'data-key': c.key, disabled: i === 0 })
            box.checked = i === 0 || chosen.has(c.key)
            box.addEventListener('change', () => {
              if (box.checked) chosen.add(c.key)
              else chosen.delete(c.key)
              remember()
              paintSummary()
              box.closest('.fpim-part').querySelector('.fpim-colcount').textContent = `${list.filter((y, j) => j === 0 || chosen.has(y.key)).length} of ${list.length} columns`
            })
            return el('label', { class: `fpim-colpick${c.readOnly ? ' fpim-ro-col' : ''}`, title: c.readOnly ? 'For reference: Import does not read this column back' : null }, box, ` ${c.header}`, c.readOnly ? el('i', { class: 'fa fa-lock', 'aria-hidden': 'true' }) : null)
          })
        ),
        el('div', { class: 'clear' })
      )
    }

    const columnsOf = (level) => all[level].filter((c, i) => i > 0 && x[level].has(c.key)).map((c) => c.key)
    function paintSummary() {
      const n = (level) => columnsOf(level).length + 1
      fill(summary, x.rows === 'products' ? `${n('products')} columns` : x.rows === 'variants' ? `${n('variants')} columns` : `${n('products')} + ${n('variants')} columns`)
    }
    function paint() {
      fill(chooser, x.rows !== 'variants' ? columnBox('products', 'Parent columns') : null, x.rows !== 'products' ? columnBox('variants', 'Variant columns') : null)
      paintSummary()
    }

    async function download(format, btn) {
      if (btn.classList.contains('disabled')) return
      const body = {
        format,
        columns: columnsOf('products'),
        variantColumns: columnsOf('variants'),
        products: x.rows !== 'variants',
        variants: x.rows !== 'products',
        ...target(),
      }
      // A CSV holds one level; "both" is two files.
      const sheets = format === 'csv' ? (x.rows === 'both' ? ['Products', 'Variants'] : [x.rows === 'variants' ? 'Variants' : 'Products']) : [x.rows === 'variants' ? 'Variants' : 'Products']
      btn.classList.add('disabled')
      fill(out, el('div', { class: 'alert alert-info' }, icon('fa-spinner fa-spin'), ' Building the file…'))
      try {
        for (const sheet of sheets) saveFile(await request('POST', adminPath('/export'), { json: { ...body, sheet }, blob: true, timeout: 600000 }))
        if (alive()) fill(out, el('div', { class: 'alert alert-success' }, sheets.length > 1 ? 'Downloaded two files: parents and variants.' : 'Downloaded.'))
      } catch (error) {
        if (alive()) fill(out, el('div', { class: 'alert alert-danger' }, error.status === 403 ? 'This token cannot export (Pim → admin).' : error.message))
      } finally {
        btn.classList.remove('disabled')
      }
    }
    const xlsx = headButton([icon('fa-file-excel-o'), ' Download Excel'], (e) => void download('xlsx', e.currentTarget), 'btn-success')
    const csv = headButton([icon('fa-file-text-o'), ' Download CSV'], (e) => void download('csv', e.currentTarget), 'btn-info')

    fill(
      content,
      tpPanel(
        'Export',
        [summary, xlsx, csv],
        el(
          'div',
          { class: 'formRow fluid' },
          field('Which parents', scopeSelect, null, 4),
          field('Rows', rowsSelect, 'Excel puts parents and variants on separate sheets; CSV makes one file for each', 4),
          el('div', { class: 'clear' })
        ),
        chooser,
        out,
        el('div', { class: 'formRow fluid' }, el('div', { class: 'col-md-12' }, el('div', { class: 'well', style: 'margin:0' }, el('p', { class: 'bold' }, 'Editing and bringing it back:'), el('p', { style: 'margin:0' }, 'Change the file and drop it on Import. Rows match on SKU; locked columns are for reference and are not read back. An empty cell changes nothing; NULL clears it.'))))
      )
    )
    paint()
  }

  // ================================================================ AI

  /**
   * PIM → AI: suggestions that a person checks and edits before anything is
   * saved. Four tabs: parent titles, variations, pictures, categories. Each
   * text tab ends with the prompt: the house rules (kept in the PIM, editable)
   * and this run's own request.
   */
  const AI_TABS = [
    ['titles', 'Parent titles', 'fa-header'],
    ['variations', 'Variations', 'fa-th-list'],
    ['pictures', 'Pictures', 'fa-picture-o'],
    ['categories', 'Categories', 'fa-folder-open-o'],
    ['channels', 'Google / eBay', 'fa-globe'],
  ]

  /**
   * `arg` comes from the address: #pim/ai/<tab> opens that tab, and
   * #pim/ai/pictures:<SKU>:<fileId> opens one picture in Pictures → Fix it.
   */
  function aiTool(content, alive, arg) {
    headerActions()
    const link = /^([\w-]+)(?::(.+?))?(?::(\d+))?$/.exec(arg ?? '')
    let open = null
    if (link && AI_TABS.some(([k]) => k === link[1])) {
      toolState.aiTab = link[1]
      if (link[1] === 'pictures' && link[2]) open = { sku: link[2], fileId: link[3] ? Number(link[3]) : null }
    }
    const tab = (toolState.aiTab ??= 'titles')
    const switchTab = (k) => {
      toolState.aiTab = k
      // The address follows the tab, so a reload comes back to it.
      const hash = `#pim/ai/${k}`
      if (location.hash !== hash) history.replaceState(null, '', `${location.pathname}${location.search}${hash}`)
      if (page?.key === 'ai') page.arg = k
      aiTool(content, alive)
    }
    const area = el('div', {}, spinner())
    const models = el('span', { class: 'text-muted pull-right', style: 'margin-top:18px;font-size:12px' })
    fill(
      content,
      models,
      el(
        'div',
        { class: 'btn-group fpim-settings-tabs', role: 'tablist' },
        AI_TABS.map(([k, label, ic]) =>
          el('a', { href: `#pim/ai/${k}`, role: 'tab', 'aria-selected': String(k === tab), class: `btn ${k === tab ? 'btn-primary' : 'btn-default'}`, onclick: (e) => { e.preventDefault(); switchTab(k) } }, icon(ic), ` ${label}`)
        )
      ),
      area
    )
    ;(async () => {
      let status, rules
      try {
        ;[status, rules] = await Promise.all([request('GET', adminPath('/ai/status')), request('GET', adminPath('/ai/rules'))])
      } catch (error) {
        return alive() && toolError(area, error, () => aiTool(content, alive, arg))
      }
      if (!alive()) return
      if (status.text?.model) fill(models, `Text by ${status.text.model}${status.vision?.model ? ` · pictures checked by ${status.vision.model}` : ''}`)
      const ctx = { area, alive, status, rules, open, again: () => aiTool(content, alive) }
      ;({ titles: aiTitles, variations: aiVariations, pictures: aiPictures, categories: aiAutocat, channels: aiCategories })[tab](ctx)
    })()
  }

  /** The prompt at the bottom of a text tab: the rules (saved for everyone) and this run's request. */
  function aiPrompt(ctx, kind, { action, onRun }) {
    const rules = el('textarea', { class: 'form-control fpim-mono', rows: 8 })
    rules.value = ctx.rules.rules[kind]
    const extra = el('textarea', { class: 'form-control', rows: 2, placeholder: 'Anything else for this run, e.g. "keep the word Sterile"' })
    const runBtn = el('a', { href: '#', class: 'btn btn-success btn-sm', onclick: (e) => { e.preventDefault(); if (!runBtn.classList.contains('disabled')) void onRun(extra.value) } }, icon('fa-magic'), ` ${action}`)
    const saveRules = async (text) => {
      try {
        const r = await request('PUT', adminPath(`/ai/rules/${kind}`), { json: { text } })
        ctx.rules.rules = r.rules
        rules.value = r.rules[kind]
        syncRules()
        toast('success', text ? 'Rules saved for everyone.' : 'Back to the default rules.')
      } catch (error) {
        toast('danger', error.message)
      }
    }
    const undoBtn = headButton([icon('fa-undo'), ' Undo changes'], () => { rules.value = ctx.rules.rules[kind]; syncRules() }, 'btn-default')
    const defaultBtn = headButton('Default rules', () => { if (confirm('Put back the default rules for everyone?')) void saveRules('') }, 'btn-default')
    const saveBtn = headButton([icon('fa-check'), ' Save rules'], () => void saveRules(rules.value), 'btn-info')
    // Undo and Save only while the rules differ from what is saved; Default only when they are not the default.
    function syncRules() {
      const changed = rules.value !== ctx.rules.rules[kind]
      undoBtn.style.display = changed ? '' : 'none'
      saveBtn.classList.toggle('disabled', !changed)
      defaultBtn.classList.toggle('disabled', ctx.rules.defaults?.[kind] != null && ctx.rules.rules[kind] === ctx.rules.defaults[kind])
    }
    rules.addEventListener('input', syncRules)
    syncRules()
    // The rules and request are folded away until asked for; Run is always in the heading.
    const ruleTools = el('span', { style: 'display:none' }, undoBtn, ' ', defaultBtn, ' ', saveBtn)
    const promptBody = el(
      'div',
      { class: 'formRow fluid', hidden: true },
      field('Our rules', rules, 'Sent first every time. Saved for everyone with Save rules.', 8),
      field('Request', extra, 'Only for this run', 4),
      el('div', { class: 'clear' })
    )
    const toggleBtn = headButton([icon('fa-chevron-down'), ' Show prompt'], () => {
      const show = promptBody.hidden
      promptBody.hidden = !show
      ruleTools.style.display = show ? '' : 'none'
      fill(toggleBtn, icon(show ? 'fa-chevron-up' : 'fa-chevron-down'), show ? ' Hide prompt' : ' Show prompt')
    }, 'btn-default')
    const panel = tpPanel('Prompt', [toggleBtn, ruleTools, runBtn], promptBody)
    return {
      panel,
      runBtn,
      request: () => extra.value,
      setBusy: (busy, label) => { runBtn.classList.toggle('disabled', busy); fill(runBtn, icon(busy ? 'fa-spinner fa-spin' : 'fa-magic'), ` ${busy ? label : action}`) },
    }
  }

  /** Not set up: say which key is missing, nothing else. */
  const aiNotReady = (ctx, what) => fill(ctx.area, el('div', { class: 'alert alert-warning mt10' }, `${what} needs a key on the PIM (Railway → farla-pim → Variables). `))

  /**
   * A tab's list: products that still need it (or all of them), a search box,
   * tick boxes, and each row's suggestion when there is one.
   * `init` adds the tab's own state; `filters(s)` is shown beside the search
   * while "Show all" is off and `body(s)` goes with the list request;
   * `actions` sit in the list's heading; `onPaint` runs after each paint.
   */
  function aiList(ctx, kind, { title, columns, row, init = {}, filters, body, actions, emptyHint, highlight, onPaint }) {
    const s = (toolState[`ai-${kind}`] ??= { search: '', all: false, picked: new Set(), results: new Map() })
    for (const [k, v] of Object.entries(init)) s[k] ??= v
    const search = el('input', { class: 'form-control', type: 'search', value: s.search, placeholder: 'SKU, title or brand' })
    const all = el('input', { type: 'checkbox' })
    all.checked = s.all
    const filterEl = filters ? filters(s) : null
    const syncFilters = () => { if (filterEl) filterEl.style.display = s.all ? 'none' : '' }
    syncFilters()
    const titleEl = el('span', {}, title)
    const tools = el('span')
    const table = el('div', {}, spinner())
    const refreshBtn = headButton([icon('fa-refresh'), ' Refresh'], () => void load(), 'btn-info', { title: 'Read the list again from the PIM' })
    let items = []
    let timer = null
    async function load() {
      table.style.opacity = '.5'
      try {
        items = await request('POST', adminPath(`/ai/${kind}/list`), { json: { ...(body?.(s) ?? {}), search: s.search, all: s.all } })
      } catch (error) {
        return ctx.alive() && toolError(table, error, load)
      }
      table.style.opacity = ''
      if (ctx.alive()) paint()
    }
    function paint() {
      fill(titleEl, `${title} (${items.length})`)
      const shown = items.slice(0, 300)
      const pageBox = el('input', { type: 'checkbox', class: 'form-control', title: 'Tick all shown' })
      pageBox.checked = shown.length > 0 && shown.every((x) => s.picked.has(x.id))
      pageBox.addEventListener('change', () => { for (const x of shown) pageBox.checked ? s.picked.add(x.id) : s.picked.delete(x.id); paint() })
      const empty = s.all || s.search ? 'Nothing matches.' : (typeof emptyHint === 'function' ? emptyHint(s) : emptyHint) ?? 'Nothing needs this. Tick “Show all” to see every product.'
      fill(
        table,
        el(
          'table',
          { class: 'table-grid table-bordered fpim-grid-table' },
          el('thead', {}, el('tr', {}, el('th', { class: 'no-sort fpim-tick' }, pageBox), columns.map((c) => el('th', { class: 'no-sort' }, c)))),
          el(
            'tbody',
            {},
            shown.length
              ? shown.map((x) => {
                  const box = el('input', { type: 'checkbox', class: 'form-control', 'aria-label': `Tick ${x.sku}` })
                  box.checked = s.picked.has(x.id)
                  box.addEventListener('change', () => { box.checked ? s.picked.add(x.id) : s.picked.delete(x.id); fill(tools, `${s.picked.size} ticked`) })
                  const lit = highlight ? highlight(x, s) : s.results.has(x.id)
                  return el('tr', { class: lit ? 'fpim-picked' : '' }, el('td', { class: 'fpim-tick' }, box), row(x, s.results.get(x.id)))
                })
              : el('tr', {}, el('td', { colspan: columns.length + 1, class: 'text-muted' }, empty))
          )
        ),
        items.length > shown.length ? el('p', { class: 'fpim-help' }, `Showing the first ${shown.length} of ${items.length}: search to narrow it.`) : null
      )
      fill(tools, s.picked.size ? `${s.picked.size} ticked` : '')
      onPaint?.()
    }
    search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { s.search = search.value.trim(); void load() }, 300) })
    all.addEventListener('change', () => { s.all = all.checked; syncFilters(); void load() })
    const panel = el(
      'div',
      {},
      tpPanel('Find', null, el('div', { class: 'formRow fluid' }, field('Search', search, null, 6), el('div', { class: 'col-md-3 fpim-field' }, el('label', { style: 'font-weight:normal;margin-top:8px' }, all, ' Show all, not only those that need it')), filterEl, el('div', { class: 'clear' }))),
      el('div', { class: 'panel panel-parts fluid mt10' }, el('div', { class: 'panel-heading' }, titleEl, el('div', { class: 'btns pull-right' }, tools, actions ?? null, refreshBtn)), el('div', { class: 'panel-body p0' }, table))
    )
    void load()
    return { panel, state: s, repaint: () => paint(), reload: load, items: () => items, picked: () => items.filter((x) => s.picked.has(x.id)) }
  }

  /** Run `work` over `list` in batches of `size`, saying how far it has got. */
  async function inBatches(list, size, setBusy, work) {
    for (let i = 0; i < list.length; i += size) {
      setBusy(true, list.length > size ? `Working… ${Math.min(i + size, list.length)} of ${list.length}` : 'Working…')
      await work(list.slice(i, i + size))
    }
  }

  // ---------------------------------------------------------------- parent titles

  /** The title a parent has now: none while it is only the sync's stand-in. */
  const aiSavedTitle = (x) => (x.standIn ? '' : x.label ?? '')

  /**
   * Titles are written and edited in the list itself: each row has its title
   * box (the TradePeg stand-in shows grey), the AI button and Save; "Write
   * titles for the ticked" fills the boxes, "Save all" saves every changed one.
   */
  function aiTitles(ctx) {
    if (!ctx.status.text.ready) return aiNotReady(ctx, 'Writing titles')
    const rowsById = new Map() // id -> what its row needs to show a new title
    const saveAllBtn = headButton('', () => void saveAll(), 'btn-success', { title: 'Save every title that has been typed or written and not saved yet' })
    const list = aiList(ctx, 'titles', {
      title: 'Parents without a proper title',
      init: { drafts: new Map(), writing: new Set(), saving: new Set(), savingAll: false },
      emptyHint: 'Every parent has a title. Tick “Show all” to rewrite any of them.',
      columns: ['Parent', 'Its parts in TradePeg', 'Title'],
      actions: [saveAllBtn, ' '],
      onPaint: () => paintSaveAll(),
      row: (x) => {
        const saved = aiSavedTitle(x)
        const input = el('input', { class: 'form-control input-sm', value: s.drafts.get(x.id) ?? saved, placeholder: x.standIn ? x.label : 'Type a title', 'aria-label': `Title for ${x.sku}` })
        const count = el('div', { class: 'help-block', style: 'margin:2px 0 0' })
        const saveBtn = button([icon('fa-check'), ' Save'], () => void saveOne(x, saveBtn), 'btn-success')
        const aiBtn = el('button', { type: 'button', class: 'btn btn-sm btn-default', style: 'color:#7c3aed', title: `Write a title for ${x.sku} with AI`, 'aria-label': `Write a title for ${x.sku} with AI`, onclick: () => void writeOne(x) })
        const sync = () => {
          const v = input.value
          saveBtn.style.display = (v.trim() !== '' && v.trim() !== saved) || s.saving.has(x.id) ? '' : 'none'
          aiBtn.disabled = s.writing.has(x.id)
          fill(aiBtn, icon(s.writing.has(x.id) ? 'fa-spinner fa-spin' : 'fa-magic'))
          fill(count, `${v.length} characters${x.standIn ? ' · grey text is the stand-in from TradePeg' : ''}`)
        }
        input.addEventListener('input', () => { s.drafts.set(x.id, input.value); sync(); paintSaveAll() })
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); void saveOne(x, saveBtn) } })
        rowsById.set(x.id, { input, sync })
        sync()
        return [
          el('td', {}, el('div', { class: 'fpim-sku', style: 'white-space:nowrap' }, x.sku), el('div', { style: 'max-width:280px' }, x.label)),
          el('td', { class: 'text-muted', style: 'font-size:12px;max-width:380px' }, (x.titles ?? []).slice(0, 3).map((t) => el('div', { title: t.title, style: 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis' }, t.title)), x.parts > 3 ? el('div', {}, `and ${x.parts - 3} more`) : null),
          el('td', { style: 'min-width:380px' }, el('div', { style: 'display:flex;gap:6px;align-items:center' }, aiBtn, input, saveBtn), count),
        ]
      },
    })
    const s = list.state

    const unsaved = () => list.items().filter((x) => { const t = (s.drafts.get(x.id) ?? '').trim(); return t !== '' && t !== aiSavedTitle(x) })
    function paintSaveAll() {
      const n = unsaved().length
      fill(saveAllBtn, icon(s.savingAll ? 'fa-spinner fa-spin' : 'fa-check'), ` Save all${n ? ` (${n})` : ''}`)
      saveAllBtn.classList.toggle('disabled', !n || s.savingAll)
    }
    paintSaveAll()

    /** A new title in a row's box, without redrawing the list. */
    function showDraft(id) {
      const r = rowsById.get(id)
      if (!r?.input.isConnected) return
      r.input.value = s.drafts.get(id) ?? r.input.value
      r.sync()
      r.input.closest('tr')?.classList.add('fpim-picked')
    }

    async function writeOne(x) {
      if (s.writing.has(x.id)) return
      s.writing.add(x.id)
      rowsById.get(x.id)?.sync()
      try {
        const [r] = await request('POST', adminPath('/ai/titles/suggest'), { json: { ids: [x.id], request: prompt.request() }, timeout: 240000 })
        if (!r?.suggestion?.trim()) toast('warning', `No title came back for ${x.sku}. Try again.`)
        else {
          s.drafts.set(x.id, r.suggestion)
          s.results.set(x.id, r)
        }
      } catch (error) {
        toast('danger', error.message)
      } finally {
        s.writing.delete(x.id)
        showDraft(x.id)
        paintSaveAll()
      }
    }

    async function saveOne(x, btn) {
      const title = (s.drafts.get(x.id) ?? '').trim()
      if (!title || title === aiSavedTitle(x) || s.saving.has(x.id)) return
      s.saving.add(x.id)
      btn.disabled = true
      fill(btn, icon('fa-spinner fa-spin'), ' Save')
      try {
        const r = await request('POST', adminPath('/ai/titles/apply'), { json: { items: [{ id: x.id, title }] } })
        if (r.failed?.length) throw new Error(r.failed[0].message)
        toast('success', `Saved the title of ${x.sku}`)
        s.drafts.delete(x.id)
        s.results.delete(x.id)
        if (ctx.alive()) void list.reload()
      } catch (error) {
        toast('danger', error.message)
        btn.disabled = false
        fill(btn, icon('fa-check'), ' Save')
      } finally {
        s.saving.delete(x.id)
      }
    }

    /** Every changed title at once, 50 to a request; ones that fail stay in their boxes. */
    async function saveAll() {
      const items = unsaved().map((x) => ({ id: x.id, sku: x.sku, title: s.drafts.get(x.id).trim() }))
      if (!items.length || s.savingAll) return
      s.savingAll = true
      paintSaveAll()
      const failed = []
      let saved = 0
      try {
        for (let i = 0; i < items.length; i += 50) {
          const batch = items.slice(i, i + 50)
          const r = await request('POST', adminPath('/ai/titles/apply'), { json: { items: batch.map(({ id, title }) => ({ id, title })) } })
          const bad = new Set((r.failed ?? []).map((f) => f.id))
          saved += r.saved ?? 0
          for (const f of r.failed ?? []) failed.push(`${batch.find((b) => b.id === f.id)?.sku ?? f.id}: ${f.message}`)
          for (const b of batch) if (!bad.has(b.id)) { s.drafts.delete(b.id); s.results.delete(b.id) }
        }
      } catch (error) {
        failed.push(error.message)
      } finally {
        s.savingAll = false
        paintSaveAll()
        if (ctx.alive()) void list.reload()
      }
      if (failed.length) toast('danger', `${saved ? `Saved ${plural(saved, 'title')}. ` : ''}${plural(failed.length, 'title')} not saved: ${failed.slice(0, 5).join('; ')}${failed.length > 5 ? '…' : ''}`)
      else if (saved) toast('success', `Saved ${plural(saved, 'title')}.`)
    }

    const prompt = aiPrompt(ctx, 'titles', {
      action: 'Write titles for the ticked',
      onRun: async (extra) => {
        const ids = list.picked().map((x) => x.id)
        if (!ids.length) return toast('warning', 'Tick the parents to write titles for.')
        try {
          await inBatches(ids, 15, prompt.setBusy, async (batch) => {
            const out = await request('POST', adminPath('/ai/titles/suggest'), { json: { ids: batch, request: extra }, timeout: 240000 })
            for (const r of out) {
              s.results.set(r.id, r)
              if (r.suggestion?.trim()) s.drafts.set(r.id, r.suggestion)
              showDraft(r.id)
            }
            paintSaveAll()
          })
        } catch (error) {
          toast('danger', error.message)
        } finally {
          prompt.setBusy(false)
        }
      },
    })
    headerActions()
    fill(ctx.area, list.panel, prompt.panel)
  }

  // ---------------------------------------------------------------- variations

  /**
   * One card per parent the AI worked out: the type names (renamable, in
   * order) and every part's values, saved or dismissed card by card. Asking
   * again clears the cards that were not saved.
   */
  function aiVariations(ctx) {
    if (!ctx.status.text.ready) return aiNotReady(ctx, 'Working out variations')
    const notes = el('div')
    const cardsHolder = el('div')
    const cardEls = new Map() // card -> its panel, on this page
    const list = aiList(ctx, 'variations', {
      title: 'VARPARs whose variations do not work',
      init: { cards: [], failures: [] },
      emptyHint: 'Every parent with several parts has its variations. Tick “Show all” to redo one.',
      highlight: (x, s) => s.cards.some((c) => c.id === x.id),
      columns: ['Parent', 'Title', 'Parts', 'Variation types now'],
      row: (x) => [el('td', { class: 'fpim-sku' }, x.sku), el('td', {}, x.label), el('td', {}, x.parts), el('td', { class: 'text-muted' }, x.types.join(', ') || '—', (x.problems ?? []).map((m) => el('div', { class: 'text-danger' }, m)))],
    })
    const s = list.state

    function paintNotes() {
      const noted = s.cards.filter((r) => r.note)
      fill(
        notes,
        s.failures.length ? el('div', { class: 'alert alert-danger mt10' }, el('strong', {}, 'Not worked out:'), s.failures.map((f) => el('div', {}, f))) : null,
        noted.length ? el('details', { class: 'fpim-more' }, el('summary', {}, 'What the AI noticed'), el('ul', {}, noted.map((r) => el('li', {}, el('strong', {}, r.sku), ` ${r.note}`)))) : null
      )
    }
    const cardEl = (card) => {
      if (!cardEls.has(card)) cardEls.set(card, variationCard(card))
      return cardEls.get(card)
    }
    const drop = (card) => {
      s.cards = s.cards.filter((c) => c !== card)
      cardEls.get(card)?.remove()
      cardEls.delete(card)
      paintNotes()
      list.repaint()
    }

    function variationCard(card) {
      const warn = el('span', { style: 'color:#8a6d3b' })
      const syncWarn = () => fill(warn, card.parts.some((p) => card.types.some((_, i) => !String(p.values[i] ?? '').trim())) ? 'Some parts have no value yet — every part needs one for each type.' : '')
      const amber = (input) => { input.style.borderColor = input.value.trim() ? '' : '#f0ad4e' }
      const saveBtn = headButton([icon('fa-check'), ' Save'], async () => {
        saveBtn.classList.add('disabled')
        fill(saveBtn, icon('fa-spinner fa-spin'), ' Save')
        try {
          await request('POST', adminPath('/ai/variations/apply'), { json: { id: card.id, types: card.types, parts: card.parts.map((p) => ({ id: p.id, values: p.values })) } })
          toast('success', `Saved the variations of ${card.sku}`)
          // New variation names are on the list now: the Import page reads it again.
          if (card.newTypes?.length) delete toolState.importOptions?.variations
          drop(card)
          if (ctx.alive()) void list.reload()
        } catch (error) {
          toast('danger', error.message)
          saveBtn.classList.remove('disabled')
          fill(saveBtn, icon('fa-check'), ' Save')
        }
      }, 'btn-success')
      const dismiss = headButton([icon('fa-times'), ' Dismiss'], () => drop(card), 'btn-default')
      const typeHeads = card.types.map((t, i) => {
        const input = el('input', { class: 'form-control input-sm', value: t, style: 'font-weight:bold;min-width:130px', 'aria-label': `Variation type ${i + 1}` })
        input.addEventListener('input', () => { card.types[i] = input.value })
        return el('th', { class: 'no-sort' }, input)
      })
      const rows = card.parts.map((p) =>
        el(
          'tr',
          {},
          el('td', { class: 'fpim-sku', style: 'white-space:nowrap' }, p.sku),
          el('td', { class: 'text-muted', title: p.title, style: 'max-width:360px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis' }, p.title),
          card.types.map((t, i) => {
            const input = el('input', { class: 'form-control input-sm', value: p.values[i] ?? '', 'aria-label': `${t} of ${p.sku}` })
            amber(input)
            input.addEventListener('input', () => { p.values[i] = input.value; amber(input); syncWarn() })
            return el('td', {}, input)
          })
        )
      )
      syncWarn()
      return tpPanel(
        [el('span', { class: 'fpim-sku' }, card.sku), ` — ${card.label ?? ''}`],
        [dismiss, saveBtn],
        el(
          'div',
          { class: 'formRow fluid' },
          el(
            'div',
            { class: 'col-md-12', style: 'display:flex;flex-wrap:wrap;gap:4px 24px' },
            card.current?.types?.length ? el('span', { class: 'text-muted' }, `Now: ${card.current.types.join(', ')}`) : null,
            card.newTypes?.length ? el('span', { class: 'text-info' }, `New to the list on save: ${card.newTypes.join(', ')}`) : null,
            warn
          ),
          el('div', { class: 'clear' })
        ),
        el('div', { class: 'table-responsive' }, el('table', { class: 'table-grid table-bordered fpim-grid-table' }, el('thead', {}, el('tr', {}, el('th', { class: 'no-sort' }, 'Part'), el('th', { class: 'no-sort' }, 'TradePeg title'), typeHeads)), el('tbody', {}, rows)))
      )
    }

    const prompt = aiPrompt(ctx, 'variations', {
      action: 'Suggest variations for the ticked',
      onRun: async (extra) => {
        const picked = list.picked()
        if (!picked.length) return toast('warning', 'Tick the VARPARs to work out.')
        // Asking again drops the suggestions that were not saved.
        s.cards = []
        s.failures = []
        cardEls.clear()
        fill(cardsHolder)
        paintNotes()
        try {
          // One parent to a request.
          await inBatches(picked, 1, prompt.setBusy, async ([x]) => {
            try {
              const r = await request('POST', adminPath('/ai/variations/suggest'), { json: { id: x.id, request: extra }, timeout: 240000 })
              const old = s.cards.find((c) => c.id === r.id)
              if (old) drop(old)
              s.cards.push(r)
              if (ctx.alive()) cardsHolder.append(cardEl(r))
            } catch (error) {
              s.failures.push(`${x.sku}: ${error.message}`)
            }
            if (ctx.alive()) {
              paintNotes()
              list.repaint()
            }
          })
        } finally {
          prompt.setBusy(false)
        }
      },
    })
    headerActions()
    fill(ctx.area, list.panel, prompt.panel, notes, cardsHolder)
    fill(cardsHolder, s.cards.map(cardEl))
    paintNotes()
  }

  // ---------------------------------------------------------------- Google / eBay

  const AI_CHANNELS = [['website', 'Website'], ['google', 'Google Shopping'], ['ebay', 'eBay']]
  const aiLeaf = (path, levels = 2) => String(path).split(' > ').slice(-levels).join(' > ')

  /**
   * Categories for the website, Google Shopping and eBay: the AI's suggestions
   * show in each row as tick boxes (sure ones, 70% and up, start ticked);
   * "Save the ticked suggestions" saves them. Website categories are added to
   * what a product has; Google and eBay replace theirs.
   */
  function aiCategories(ctx) {
    if (!ctx.status.text.ready) return aiNotReady(ctx, 'Suggesting categories')
    let saving = false
    const saveBtn = headButton('', () => void save(), 'btn-success')
    const paintSave = () => {
      fill(saveBtn, icon(saving ? 'fa-spinner fa-spin' : 'fa-check'), ' Save the ticked suggestions')
      saveBtn.classList.toggle('disabled', saving || !toSave().length)
    }
    const list = aiList(ctx, 'categories', {
      title: 'Products missing a category',
      init: { missing: AI_CHANNELS.map(([k]) => k), take: new Set() },
      body: (s) => ({ missing: s.missing }),
      emptyHint: (s) => (s.missing.length ? 'Every product has its categories. Tick “Show all” to check any of them.' : 'Tick Website, Google Shopping or eBay to see what is missing there.'),
      filters: (s) =>
        el(
          'div',
          { class: 'col-md-3 fpim-field' },
          el(
            'div',
            { style: 'margin-top:8px' },
            AI_CHANNELS.map(([k, label]) => {
              const box = el('input', { type: 'checkbox' })
              box.checked = s.missing.includes(k)
              box.addEventListener('change', () => {
                s.missing = AI_CHANNELS.map(([id]) => id).filter((id) => (id === k ? box.checked : s.missing.includes(id)))
                void list.reload()
              })
              return el('label', { style: 'font-weight:normal;margin-right:12px' }, box, ` ${label}`)
            })
          ),
          el('div', { class: 'help-block' }, 'Missing on')
        ),
      columns: ['Product', 'Website', 'Google', 'eBay'],
      actions: [saveBtn, ' '],
      onPaint: () => paintSave(),
      row: (x, r) => {
        const now = (v) => el('div', { class: 'text-muted', style: 'font-size:12px' }, v ? `Now: ${v}` : 'None yet')
        return [
          el('td', {}, el('div', { class: 'fpim-sku' }, x.sku), x.label),
          el('td', { style: 'min-width:220px' }, now((x.categories ?? []).map((c) => aiLeaf(c, 1)).join(', ')), r?.website.map((c) => choice(r, 'web', c)), r && !r.website.length ? el('div', { class: 'text-muted', style: 'font-size:12px' }, 'No suggestion') : null),
          el('td', { style: 'min-width:190px' }, now(x.google && aiLeaf(x.google, 1)), r?.google ? choice(r, 'google', r.google) : null),
          el('td', { style: 'min-width:190px' }, now(x.ebay && aiLeaf(x.ebay, 1)), r?.ebay ? choice(r, 'ebay', r.ebay) : null, r?.note ? el('div', { class: 'text-muted', style: 'font-size:12px;font-style:italic;margin-top:4px' }, r.note) : null),
        ]
      },
    })
    const s = list.state

    /** One suggestion: its tick box, the last two levels of its path, and how sure the AI is. */
    function choice(r, where, c) {
      const key = `${r.id}:${where}:${c.id}`
      const box = el('input', { type: 'checkbox', style: 'margin:2px 6px 0 0' })
      box.checked = s.take.has(key)
      box.addEventListener('change', () => { box.checked ? s.take.add(key) : s.take.delete(key); paintSave() })
      const sure = c.confidence >= 0.7
      return el(
        'label',
        { title: c.path, style: 'display:flex;align-items:flex-start;font-weight:normal;margin:2px 0;cursor:pointer' },
        box,
        el('span', {}, aiLeaf(c.path), ' ', el('span', { style: `font-size:12px;${sure ? 'color:#4e7d15;font-weight:bold' : 'color:#777'}` }, `${Math.round(c.confidence * 100)}%`))
      )
    }

    const toSave = () =>
      [...s.results.values()]
        .map((r) => ({
          id: r.id,
          add: r.website.filter((c) => s.take.has(`${r.id}:web:${c.id}`)).map((c) => c.id),
          google: r.google && s.take.has(`${r.id}:google:${r.google.id}`) ? r.google.id : null,
          ebay: r.ebay && s.take.has(`${r.id}:ebay:${r.ebay.id}`) ? r.ebay.id : null,
        }))
        .filter((x) => x.add.length || x.google || x.ebay)
    paintSave()

    async function save() {
      const items = toSave()
      if (!items.length || saving) return
      if (!confirm(`Save categories on ${plural(items.length, 'product')}? Website categories are added to what each has.`)) return
      saving = true
      paintSave()
      try {
        const r = await request('POST', adminPath('/ai/categories/apply'), { json: { items } })
        const failed = r.failed ?? []
        toast(failed.length ? 'warning' : 'success', `Saved ${plural(r.saved ?? 0, 'product')}${failed.length ? `, ${failed.length} failed: ${failed.slice(0, 3).map((f) => f.message).join('; ')}` : ''}`)
        const bad = new Set(failed.map((f) => f.id))
        for (const it of items) if (!bad.has(it.id)) s.results.delete(it.id)
        if (ctx.alive()) void list.reload()
      } catch (error) {
        toast('danger', error.message)
      } finally {
        saving = false
        paintSave()
      }
    }

    const prompt = aiPrompt(ctx, 'categories', {
      action: 'Suggest categories for the ticked',
      onRun: async (extra) => {
        const ids = list.picked().map((x) => x.id)
        if (!ids.length) return toast('warning', 'Tick the products to find categories for.')
        try {
          await inBatches(ids, 5, prompt.setBusy, async (batch) => {
            const out = await request('POST', adminPath('/ai/categories/suggest'), { json: { ids: batch, request: extra }, timeout: 300000 })
            // Sure suggestions start ticked; the rest are offered.
            for (const r of out) {
              s.results.set(r.id, r)
              for (const c of r.website) if (c.confidence >= 0.7) s.take.add(`${r.id}:web:${c.id}`)
              if (r.google?.confidence >= 0.7) s.take.add(`${r.id}:google:${r.google.id}`)
              if (r.ebay?.confidence >= 0.7) s.take.add(`${r.id}:ebay:${r.ebay.id}`)
            }
            if (ctx.alive()) list.repaint()
          })
        } catch (error) {
          toast('danger', error.message)
        } finally {
          prompt.setBusy(false)
        }
      },
    })
    headerActions()
    fill(ctx.area, list.panel, prompt.panel)
  }

  // ---------------------------------------------------------------- auto categories

  /**
   * Auto categories (repos/pim src/pim/autocat.js): the PIM suggests website
   * categories, a person accepts or rejects them — one by one or ticked in bulk —
   * and every decision is remembered. When categories are added, renamed or
   * moved, products are reassessed against them, and a product that no longer
   * fits a renamed category gets a "remove" suggestion. The buttons run it now.
   */
  function aiAutocat(ctx) {
    const s = (toolState['ai-autocat'] ??= { view: 'add', min: '0', search: '', picked: new Set() })
    const statusBody = el('div', { class: 'formRow fluid fpim-syncrow' })
    const statusTools = el('span')
    const listTitle = el('span', {}, 'Suggestions')
    const listTools = el('span')
    const table = el('div', {}, spinner())
    let polling = false
    let rows = []

    const run = (path, what) => async () => {
      try {
        await request('POST', adminPath(`/autocat/${path}`))
        toast('info', `${what} started.`)
      } catch (error) {
        return toast('danger', error.message)
      }
      void paintState()
    }

    async function paintState() {
      let st
      try {
        st = await request('GET', adminPath('/autocat/state'))
      } catch (error) {
        return toolError(statusBody, error, paintState)
      }
      if (!ctx.alive()) return
      const busy = st.job.running
      const c = st.counts
      const stat = (label, value, help, cols = 2) => el('div', { class: `col-md-${cols} fpim-field fpim-statcell` }, el('div', { class: 'fpim-stat' }, value), el('div', { class: 'help-block', title: help || null }, label))
      const auto = el('input', { type: 'checkbox' })
      auto.checked = st.auto
      auto.addEventListener('change', async () => {
        try { await request('PUT', adminPath('/autocat/auto'), { json: { auto: auto.checked } }) } catch (error) { toast('danger', error.message) }
      })
      const dis = busy || !st.ready ? { class: 'btn btn-sm btn-info disabled' } : {}
      fill(
        statusTools,
        headButton([icon('fa-folder-open-o'), ' Refresh categories'], run('refresh-categories', 'Refreshing categories'), 'btn-info', { ...dis, title: 'Read new, renamed or moved categories and reassess products against them' }),
        headButton([icon('fa-cubes'), ' Refresh products'], run('refresh-products', 'Refreshing products'), 'btn-info', { ...dis, title: 'Suggest categories for new products and products whose text changed' }),
        headButton([icon('fa-repeat'), ' Re-check every product'], () => { if (confirm('Ask about every product again? Your decisions stay; only open questions are asked. Takes a while and costs about 20p.')) void run('recheck-all', 'Re-checking every product')() }, 'btn-default', { ...(busy || !st.ready ? { class: 'btn btn-sm btn-default disabled' } : {}), title: 'Every product against its closest categories' })
      )
      fill(
        statusBody,
        !st.ready ? el('div', { class: 'col-md-12' }, el('div', { class: 'alert alert-warning' }, 'Needs OPENROUTER_API_KEY on the PIM.')) : null,
        stat('To add', String(c.pendingAdd), 'Suggested categories waiting for a person'),
        stat('To remove', String(c.pendingRemove), 'Products that no longer fit a renamed or moved category'),
        stat('Accepted', String(c.accepted)),
        stat('Rejected', String(c.rejected), 'Remembered: never suggested again'),
        stat('Read', `${c.productsIndexed} of ${c.products} products · ${c.categories} categories`, `Matched with ${st.models.embed}, checked by ${st.models.match}`, 4),
        el('div', { class: 'clear' }),
        busy || st.job.error || st.job.finishedAt
          ? el(
              'div',
              { class: 'col-md-12' },
              el(
                'div',
                { class: `alert ${st.job.error ? 'alert-danger' : busy ? 'alert-info' : 'alert-success'}`, style: 'margin:0 0 10px' },
                busy ? icon('fa-spinner fa-spin') : null,
                ` ${{ categories: 'Categories', products: 'Products', all: 'Every product' }[st.job.kind] ?? ''}: ${st.job.step}`,
                st.job.total ? ` — ${st.job.done} of ${st.job.total} checked` : '',
                st.job.suggested ? `, ${plural(st.job.suggested, 'new suggestion')}` : '',
                st.job.error ? ` — stopped: ${st.job.error}` : '',
                !busy && st.job.finishedAt ? el('span', { class: 'text-muted' }, ` (${ago(st.job.finishedAt)})`) : null
              )
            )
          : null,
        el(
          'div',
          { class: 'col-md-12', style: 'margin-bottom:10px' },
          el('label', { style: 'font-weight:normal;margin:0' }, auto, ' Run by itself: after a category is added, renamed or moved, and after each TradePeg sync'),
          el('span', { class: 'text-muted' }, ` · Last: categories ${ago(st.last.categories)}, products ${ago(st.last.products)}`)
        ),
        el('div', { class: 'clear' })
      )
      if (busy && !polling) {
        polling = true
        setTimeout(() => {
          polling = false
          if (!ctx.alive()) return
          void paintState()
          void loadList()
        }, 3000)
      }
    }

    // ---- the suggestions
    const view = el('select', { class: 'form-control' }, el('option', { value: 'add' }, 'To add'), el('option', { value: 'remove' }, 'To remove'), el('option', { value: 'decided' }, 'Decided (remembered)'))
    view.value = s.view
    const min = el('select', { class: 'form-control' }, [['0', 'Any'], ['0.5', '50% or more'], ['0.7', '70% or more'], ['0.9', '90% or more']].map(([v, l]) => el('option', { value: v }, l)))
    min.value = s.min
    const search = el('input', { class: 'form-control', type: 'search', value: s.search, placeholder: 'SKU, title or category' })
    let timer = null
    view.addEventListener('change', () => { s.view = view.value; s.picked.clear(); void loadList() })
    min.addEventListener('change', () => { s.min = min.value; void loadList() })
    search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { s.search = search.value; void loadList() }, 300) })

    const keyOf = (r) => `${r.productId}|${r.categoryId}`
    async function loadList() {
      table.style.opacity = '.5'
      try {
        const all = await request('POST', adminPath('/autocat/queue'), { json: { status: s.view === 'decided' ? 'decided' : 'pending', min: s.view === 'decided' ? 0 : Number(s.min), search: s.search, limit: 500 } })
        rows = s.view === 'decided' ? all : all.filter((r) => r.action === s.view)
      } catch (error) {
        return ctx.alive() && toolError(table, error, loadList)
      }
      table.style.opacity = ''
      if (ctx.alive()) paintList()
    }

    async function decide(items, accept) {
      if (!items.length) return toast('warning', 'Tick some suggestions first.')
      try {
        const r = await request('POST', adminPath('/autocat/decide'), { json: { items: items.map((x) => ({ productId: x.productId, categoryId: x.categoryId, accept })), by: tpUser() || null } })
        toast(r.failed.length ? 'warning' : 'success', `${accept ? 'Accepted' : 'Rejected'} ${plural(r.decided, 'suggestion')}${accept ? `; ${plural(r.changed, 'product')} changed` : ' — they will not be suggested again'}.${r.failed.length ? ` ${r.failed.length} failed.` : ''}`)
        for (const x of items) s.picked.delete(keyOf(x))
      } catch (error) {
        return toast('danger', error.message)
      }
      void loadList()
      void paintState()
    }

    function paintList() {
      const decided = s.view === 'decided'
      fill(listTitle, decided ? `Decided (${rows.length})` : `${s.view === 'add' ? 'Categories to add' : 'Categories to take off'} (${rows.length})`)
      const ticked = () => rows.filter((r) => s.picked.has(keyOf(r)))
      fill(
        listTools,
        decided
          ? null
          : [
              headButton([icon('fa-check'), ' Accept ticked'], () => void decide(ticked(), true), 'btn-success'),
              headButton([icon('fa-times'), ' Reject ticked'], () => void decide(ticked(), false), 'btn-default'),
              headButton(`Accept all 90%+`, () => {
                const sure = rows.filter((r) => r.confidence >= 0.9)
                if (!sure.length) return toast('warning', 'None is 90% or more.')
                if (confirm(`Accept ${plural(sure.length, 'suggestion')} at 90% or more?`)) void decide(sure, true)
              }, 'btn-info'),
            ]
      )
      const pageBox = el('input', { type: 'checkbox', class: 'form-control', title: 'Tick all shown' })
      pageBox.checked = rows.length > 0 && rows.every((r) => s.picked.has(keyOf(r)))
      pageBox.addEventListener('change', () => { for (const r of rows) pageBox.checked ? s.picked.add(keyOf(r)) : s.picked.delete(keyOf(r)); paintList() })
      const pct = (v) => `${Math.round((v ?? 0) * 100)}%`
      fill(
        table,
        el(
          'table',
          { class: 'table-grid table-bordered fpim-grid-table' },
          el(
            'thead',
            {},
            el('tr', {}, decided ? null : el('th', { class: 'no-sort fpim-tick' }, pageBox), ['Picture', 'Product', decided ? 'Category' : 'Suggested', decided ? 'Decision' : 'Sure', 'Why', ''].map((h) => el('th', { class: 'no-sort' }, h)))
          ),
          el(
            'tbody',
            {},
            rows.length
              ? rows.map((r) => {
                  const box = el('input', { type: 'checkbox', class: 'form-control', 'aria-label': `Tick ${r.sku}` })
                  box.checked = s.picked.has(keyOf(r))
                  box.addEventListener('change', () => (box.checked ? s.picked.add(keyOf(r)) : s.picked.delete(keyOf(r))))
                  const leaf = r.path.split(' > ')
                  return el(
                    'tr',
                    {},
                    decided ? null : el('td', { class: 'fpim-tick' }, box),
                    el('td', { class: 'fpim-thumb' }, r.thumbnail ? el('img', { src: r.thumbnail, alt: '' }) : el('span', { class: 'fpim-noimg' }, icon('fa-picture-o'))),
                    el(
                      'td',
                      {},
                      el('a', { href: `#pim/parent/${encodeURIComponent(r.sku)}`, class: 'fpim-sku', onclick: (e) => { e.preventDefault(); openTools('parent', r.sku) } }, r.sku),
                      el('div', {}, r.label),
                      r.current.length ? el('div', { class: 'text-muted', style: 'font-size:11px' }, `In: ${r.current.map((p) => p.split(' > ').at(-1)).join(', ')}`) : el('div', { class: 'text-muted', style: 'font-size:11px' }, 'In no category yet')
                    ),
                    el('td', { title: r.path }, el('span', { class: `label ${r.action === 'remove' ? 'label-danger' : 'label-success'}` }, r.action === 'remove' ? 'Take off' : 'Add'), ' ', el('strong', {}, leaf.at(-1)), el('div', { class: 'text-muted', style: 'font-size:11px' }, leaf.slice(0, -1).join(' > '))),
                    decided
                      ? el('td', {}, el('span', { class: `label ${r.status === 'accepted' ? 'label-success' : 'label-default'}` }, r.status === 'accepted' ? 'Accepted' : 'Rejected'), el('div', { class: 'text-muted', style: 'font-size:11px' }, [r.decidedBy, r.decidedAt ? when(r.decidedAt) : null].filter(Boolean).join(' · ')))
                      : el('td', {}, pct(r.confidence)),
                    el('td', { class: 'text-muted', style: 'font-size:12px;max-width:380px' }, r.reason || ''),
                    el(
                      'td',
                      { style: 'white-space:nowrap' },
                      decided
                        ? button('Forget', async () => {
                            if (!confirm('Forget this decision? The suggestion may come back; the product is not changed.')) return
                            await request('POST', adminPath('/autocat/forget'), { json: { items: [{ productId: r.productId, categoryId: r.categoryId }] } }).catch((e) => toast('danger', e.message))
                            void loadList()
                            void paintState()
                          })
                        : [button([icon('fa-check'), ' Accept'], () => void decide([r], true), 'btn-success'), ' ', button('Reject', () => void decide([r], false))]
                    )
                  )
                })
              : el('tr', {}, el('td', { colspan: 7, class: 'text-muted' }, decided ? 'No decisions yet.' : 'Nothing waiting. Refresh products or categories to look for more.'))
          )
        ),
        rows.length >= 500 ? el('p', { class: 'fpim-help' }, 'Showing the first 500.') : null
      )
    }

    fill(
      ctx.area,
      tpPanel('Auto categories', statusTools, statusBody),
      tpPanel('Find', null, el('div', { class: 'formRow fluid' }, field('Show', view, null, 3), field('How sure', min, 'How sure the model is', 3), field('Search', search, null, 6), el('div', { class: 'clear' }))),
      el('div', { class: 'panel panel-parts fluid mt10' }, el('div', { class: 'panel-heading' }, listTitle, el('div', { class: 'btns pull-right' }, listTools)), el('div', { class: 'panel-body p0' }, table))
    )
    void paintState()
    void loadList()
  }

  // ---------------------------------------------------------------- pictures

  /**
   * Like tools.farla.pro's AI Imaging: find a product, pick one of its
   * pictures, fix it (a white background, a cut-out…), compare, then use it in
   * place of the old one or as an extra. The old file is kept in the library.
   */
  function aiPictures(ctx) {
    const img = ctx.status.images
    if (!img.openrouter && !img.poof) return aiNotReady(ctx, 'Fixing pictures')
    const s = (toolState['ai-pictures'] ??= { sku: '', model: img.models[0].id, prompt: img.defaultPrompt, background: 'white' })
    const find = el('input', { class: 'form-control', value: s.sku, placeholder: 'Parent, part or unit SKU' })
    const gallery = el('div')
    const work = el('div')
    let product = null
    let picked = null
    let result = null

    async function load() {
      s.sku = find.value.trim()
      if (!s.sku) return
      fill(gallery, spinner())
      fill(work)
      try {
        product = await request('GET', adminPath(`/ai/pictures/${encodeURIComponent(s.sku)}`))
      } catch (error) {
        return fill(gallery, el('div', { class: 'alert alert-danger' }, error.message))
      }
      picked = null
      paintGallery()
    }
    find.addEventListener('keydown', (e) => { if (e.key === 'Enter') void load() })

    function paintGallery() {
      fill(
        gallery,
        el('p', {}, el('strong', {}, product.sku), ` — ${product.label}. Choose a picture to fix.`),
        product.pictures.length
          ? el(
              'div',
              { class: 'fpim-images' },
              product.pictures.map((p) =>
                el(
                  'button',
                  { type: 'button', class: `fpim-image fpim-tile fpim-pick${picked?.id === p.id ? ' fpim-on' : ''}`, onclick: () => { picked = p; result = null; paintGallery(); paintWork() } },
                  el('img', { src: p.thumb, alt: '' }),
                  el('div', { class: 'fpim-help' }, `${{ parent: 'Parent', part: 'Part', unit: 'Unit' }[p.where]} ${p.tag}`)
                )
              )
            )
          : el('p', { class: 'text-muted' }, 'This product has no pictures yet.')
      )
    }

    function paintWork() {
      if (!picked) return fill(work)
      const model = el('select', { class: 'form-control' }, img.models.filter((m) => (m.id.startsWith('poof') ? img.poof : img.openrouter)).map((m) => el('option', { value: m.id }, m.label)))
      model.value = s.model
      const prompt = el('textarea', { class: 'form-control', rows: 3, maxlength: 1000 })
      prompt.value = s.prompt
      const background = el('select', { class: 'form-control' }, el('option', { value: 'white' }, 'Solid white'), el('option', { value: 'transparent' }, 'Transparent (PNG)'))
      background.value = s.background
      const isPoof = () => model.value.startsWith('poof')
      const promptField = field('What to do', prompt, 'Up to 1000 characters', 8)
      const bgField = field('Background', background, null, 4)
      const sync = () => { promptField.style.display = isPoof() ? 'none' : ''; bgField.style.display = isPoof() ? '' : 'none' }
      model.addEventListener('change', () => { s.model = model.value; sync() })
      prompt.addEventListener('input', () => { s.prompt = prompt.value })
      background.addEventListener('change', () => { s.background = background.value })
      sync()
      const out = el('div')
      const go = button([icon('fa-magic'), ' Fix this picture'], async () => {
        go.disabled = true
        fill(out, spinner(' Working on it — up to a minute…'))
        try {
          result = await request('POST', adminPath('/ai/pictures/process'), { json: { fileId: picked.id, model: model.value, prompt: prompt.value, background: background.value }, timeout: 240000 })
          paintResult(out)
        } catch (error) {
          fill(out, el('div', { class: 'alert alert-danger' }, error.message))
        } finally {
          go.disabled = false
        }
      }, 'btn-success')
      const crop = button([icon('fa-crop'), ' Crop to the product (free)'], () => {
        const p = picked
        void cropDialog({ sku: product.sku, fileId: p.id, onSaved: (r, mode) => { showSaved(p.id, r, mode); picked = null; paintGallery(); fill(work, el('div', { class: 'alert alert-success mt10' }, 'Cropped.')) } })
      })
      fill(work, tpPanel('Fix it', null, el('div', { class: 'formRow fluid' }, field('Model', model, null, 4), promptField, bgField, el('div', { class: 'clear' })), el('div', { class: 'panel-body' }, go, ' ', crop, out)))
    }

    function paintResult(out) {
      const back = { white: '#fff', blue: '#086bc4', checker: 'repeating-conic-gradient(#e5e7eb 0 25%, #fff 0 50%) 0 0 / 16px 16px' }
      let bg = 'white'
      const boxes = el('div', { class: 'fpim-compare' })
      const paint = () =>
        fill(
          boxes,
          [['Before', picked.url], ['After', result.dataUrl]].map(([label, src]) => el('figure', {}, el('div', { class: 'fpim-compare-box', style: `background:${back[bg]}` }, el('img', { src, alt: label })), el('figcaption', { class: 'help-block' }, label)))
        )
      paint()
      const use = (mode) => async () => {
        fill(out, spinner(' Saving…'))
        try {
          const old = picked.id
          showSaved(old, await request('POST', adminPath('/ai/pictures/approve'), { json: { sku: product.sku, fileId: old, dataUrl: result.dataUrl, mode } }), mode)
          picked = null
          result = null
          paintGallery()
          fill(work, el('div', { class: 'alert alert-success mt10' }, mode === 'add' ? 'Added next to the old picture.' : 'Saved in place of the old picture. The old file stays in the media library.'))
        } catch (error) {
          fill(out, el('div', { class: 'alert alert-danger' }, error.message))
        }
      }
      fill(
        out,
        el('div', { class: 'fpim-row', style: 'margin:10px 0' }, el('span', { class: 'help-block', style: 'margin:0' }, 'Check it on:'), button('White', () => { bg = 'white'; paint() }), button('Blue', () => { bg = 'blue'; paint() }), button('Transparent', () => { bg = 'checker'; paint() }, 'btn-default', { title: 'A checker shows where the picture is see-through' })),
        boxes,
        el('div', { class: 'fpim-row' }, button([icon('fa-check'), ' Looks good — use it instead'], use('replace'), 'btn-success'), button([icon('fa-plus'), ' Add it as another picture'], use('add'), 'btn-primary'), button([icon('fa-times'), ' Discard'], () => { result = null; fill(out) }))
      )
    }

    /**
     * After a save, every copy of the old picture on this page shows the new one:
     * its row in the queue, and the product's pictures under "Find a product".
     */
    let queueItems = []
    function showSaved(oldId, r, mode) {
      const fresh = r?.pictures?.find((p) => p.id === r.saved)
      const q = queueItems.find((x) => x.fileId === oldId)
      if (q && fresh && mode !== 'add') {
        Object.assign(q, { fileId: fresh.id, url: fresh.url, thumb: fresh.thumb })
        const a = q.row?.querySelector('.fpim-thumb a')
        if (a) {
          a.href = fresh.url
          fill(a, el('img', { src: fresh.thumb, alt: '' }))
        }
      }
      if (r?.pictures && product?.sku === r.sku) {
        product = r
        if (picked?.id === oldId) picked = mode === 'add' ? picked : fresh ?? null
        paintGallery()
      }
    }

    /** Open one picture from the queue in "Fix it" below. */
    async function fixOne(pic) {
      find.value = pic.sku
      await load()
      picked = product?.pictures.find((p) => p.id === pic.fileId) ?? null
      if (!picked) return toast('warning', 'That picture is no longer on the product.')
      paintGallery()
      paintWork()
      work.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }

    // ---- the picture check: a cheap model looks at every picture; what it flags is queued here.
    const checkHead = el('span')
    const checkBody = el('div', { class: 'panel-body' }, spinner())
    let polling = false
    const picked2 = new Set()
    async function paintCheck() {
      let st, queue
      try {
        ;[st, queue] = await Promise.all([request('GET', adminPath('/ai/picture-check')), request('GET', adminPath('/ai/picture-queue'))])
      } catch (error) {
        return toolError(checkBody, error, paintCheck)
      }
      if (!ctx.alive()) return
      const left = st.pictures - st.checked
      const run = st.scan.running
      fill(
        checkHead,
        run ? null : headButton([icon('fa-eye'), left ? ` Check ${Math.min(left, 200)} more` : ' Check again later'], async () => {
          if (!left) return
          try {
            await request('POST', adminPath('/ai/picture-check'), { json: { limit: 200 } })
          } catch (error) {
            return toast('danger', error.message)
          }
          void paintCheck()
        }, 'btn-success', left ? {} : { class: 'btn btn-sm btn-success disabled' })
      )
      const rows = queue.slice(0, 200)
      queueItems = rows
      fill(
        checkBody,
        el(
          'p',
          {},
          `${st.checked} of ${plural(st.pictures, 'picture')} checked`,
          st.flagged ? ` · ${st.flagged} to fix` : ' · nothing to fix',
          el('span', { class: 'text-muted' }, ` (by ${st.model}, about $0.0001 a picture)`)
        ),
        run ? el('div', { class: 'alert alert-info' }, icon('fa-spinner fa-spin'), ` Checking: ${st.scan.done} of ${st.scan.total}${st.scan.flagged ? `, ${st.scan.flagged} flagged so far` : ''}…`) : null,
        st.scan.error ? el('div', { class: 'alert alert-danger' }, `The check stopped: ${st.scan.error}`) : null,
        rows.length
          ? el(
              'table',
              { class: 'table-grid table-bordered fpim-grid-table' },
              el('thead', {}, el('tr', {}, ['', 'Picture', 'Product', 'Where', 'What is wrong', ''].map((h) => el('th', { class: 'no-sort' }, h)))),
              el(
                'tbody',
                {},
                rows.map((q) => {
                  const box = el('input', { type: 'checkbox', class: 'form-control', 'aria-label': `Tick ${q.tag}` })
                  box.checked = picked2.has(q.fileId)
                  box.addEventListener('change', () => (box.checked ? picked2.add(q.fileId) : picked2.delete(q.fileId)))
                  const after = el('td', { class: 'fpim-thumb' })
                  q.row = el(
                    'tr',
                    {},
                    el('td', { class: 'fpim-tick' }, box),
                    el('td', { class: 'fpim-thumb' }, el('a', { href: q.url, target: '_blank', rel: 'noreferrer' }, el('img', { src: q.thumb, alt: '' }))),
                    el('td', {}, el('div', { class: 'fpim-sku' }, q.sku), q.label),
                    el('td', {}, `${{ parent: 'Parent', part: 'Part', unit: 'Unit' }[q.where]} ${q.where === 'parent' ? '' : q.tag}`, q.first ? el('span', { class: 'label label-info ml5' }, 'main') : null),
                    el('td', {}, el('div', {}, q.problems.join(', ') || '—'), el('div', { class: 'text-muted', style: 'font-size:12px' }, q.note)),
                    el(
                      'td',
                      { style: 'white-space:nowrap' },
                      button([icon('fa-magic'), ' Fix'], () => void fixOne(q), 'btn-primary'),
                      ' ',
                      button([icon('fa-crop'), ' Crop'], () => {
                        const old = q.fileId
                        void cropDialog({ sku: q.sku, fileId: old, onSaved: (r, mode) => { showSaved(old, r, mode); fill(q.row.lastElementChild, el('span', { class: 'text-success' }, icon('fa-check'), mode === 'add' ? ' Copy added' : ' Cropped')) } })
                      }),
                      ' ',
                      button('It’s fine', async () => {
                        await request('POST', adminPath('/ai/picture-queue/dismiss'), { json: { fileIds: [q.fileId] } }).catch((e) => toast('danger', e.message))
                        q.row.remove()
                      })
                    )
                  )
                  q.after = after
                  return q.row
                })
              )
            )
          : st.checked ? el('p', { class: 'text-success' }, icon('fa-check'), ' No picture waiting to be fixed.') : null,
        queue.length > rows.length ? el('p', { class: 'fpim-help' }, `Showing the first ${rows.length} of ${queue.length}.`) : null,
        rows.length && img.poof
          ? el(
              'div',
              { class: 'fpim-row', style: 'margin-top:8px' },
              button([icon('fa-magic'), ' Put the ticked on white (Poof)'], () => void bulkWhite(rows.filter((q) => picked2.has(q.fileId))), 'btn-success'),
              el('span', { class: 'fpim-help' }, 'Each result is shown in its row to use or skip; nothing is saved until you choose.')
            )
          : null
      )
      // While a check runs, follow it.
      if (run && !polling) {
        polling = true
        setTimeout(() => { polling = false; if (ctx.alive()) void paintCheck() }, 4000)
      }
    }

    /** Poof's white background for each ticked picture, one at a time; each is approved in its row. */
    async function bulkWhite(list) {
      if (!list.length) return toast('warning', 'Tick the pictures first.')
      for (const q of list) {
        const cell = q.row.lastElementChild
        fill(cell, spinner(' Working…'))
        try {
          const r = await request('POST', adminPath('/ai/pictures/process'), { json: { fileId: q.fileId, model: 'poof/remove-background', background: 'white' }, timeout: 240000 })
          fill(
            cell,
            el('img', { src: r.dataUrl, alt: 'After', style: 'width:72px;height:72px;object-fit:contain;border:1px solid #ddd;margin-right:6px;vertical-align:middle' }),
            button([icon('fa-check'), ' Use'], async () => {
              fill(cell, spinner(' Saving…'))
              try {
                const old = q.fileId
                showSaved(old, await request('POST', adminPath('/ai/pictures/approve'), { json: { sku: q.sku, fileId: old, dataUrl: r.dataUrl, mode: 'replace' } }), 'replace')
                fill(cell, el('span', { class: 'text-success' }, icon('fa-check'), ' Saved'))
              } catch (error) {
                fill(cell, el('span', { class: 'text-danger' }, error.message))
              }
            }, 'btn-success'),
            ' ',
            button('Skip', () => fill(cell, el('span', { class: 'text-muted' }, 'Skipped')))
          )
        } catch (error) {
          fill(cell, el('span', { class: 'text-danger' }, error.message))
        }
      }
    }

    fill(
      ctx.area,
      el(
        'div',
        { class: 'panel panel-parts fluid mt10' },
        el('div', { class: 'panel-heading' }, 'Pictures to fix', el('div', { class: 'btns pull-right' }, checkHead)),
        checkBody
      ),
      tpPanel('Find a product', headButton([icon('fa-search'), ' Find'], () => void load()), el('div', { class: 'formRow fluid' }, field('SKU', find, null, 6), el('div', { class: 'clear' })), el('div', { class: 'panel-body' }, gallery)),
      work
    )
    void paintCheck()
    // A link to one picture (#pim/ai/pictures:<SKU>:<fileId>) finds its product and opens it in Fix it.
    if (ctx.open) {
      find.value = ctx.open.sku
      if (ctx.open.fileId) void fixOne({ sku: ctx.open.sku, fileId: ctx.open.fileId })
      else void load()
    } else if (s.sku) void load()
  }

  // ---------------------------------------------------------------- crop (free, no AI)

  /**
   * Crop a picture to its product: the PIM fits a box around the product by
   * trimming the plain background (no AI, nothing to pay); drag the box or its
   * corners to change it, then save it in place or as an extra picture. Squared
   * on white with a margin by default, as shop pictures are.
   */
  async function cropDialog({ sku, fileId, onSaved }) {
    const stage = el('div', { class: 'fpim-crop' }, spinner(' Finding the product…'))
    const out = el('div')
    const square = el('input', { type: 'checkbox' })
    square.checked = true
    const margin = el('select', { class: 'form-control input-sm', style: 'flex:0 0 160px' }, [['0', 'No margin'], ['0.03', 'Small margin'], ['0.06', 'Margin'], ['0.1', 'Wide margin']].map(([v, l]) => el('option', { value: v }, l)))
    margin.value = '0.06'
    const options = el('div', { class: 'fpim-row', style: 'margin-top:10px' }, el('label', { style: 'font-weight:normal;margin:0' }, square, ' Make it square on white'), margin)
    // What Save will make, drawn as the box, the square and the margin change.
    const preview = el('canvas', { class: 'fpim-croppreview', width: 240, height: 240 })
    const previewFig = el('figure', {}, preview, el('figcaption', { class: 'help-block' }, 'What will be saved'))
    let drawPreview = () => {}
    square.addEventListener('change', () => { margin.disabled = !square.checked; drawPreview() })
    margin.addEventListener('change', () => drawPreview())
    const save = (mode) => async () => {
      fill(out, spinner(' Saving…'))
      try {
        const r = await request('POST', adminPath('/ai/pictures/crop'), { json: { sku, fileId, box, square: square.checked, margin: Number(margin.value), mode } })
        d.close()
        toast('success', mode === 'add' ? 'Cropped copy added after the picture.' : 'Cropped. The old file stays in the media library.')
        onSaved?.(r, mode)
      } catch (error) {
        fill(out, el('div', { class: 'alert alert-danger' }, error.message))
      }
    }
    const d = dialog(
      'Crop to the product',
      [el('p', { class: 'text-muted' }, 'The box is fitted around the product. Drag it, or its corners, to change it.'), el('div', { class: 'fpim-croparea' }, el('div', {}, stage), previewFig), options, out],
      [button('Cancel', () => d.close()), button('Fit again', () => { box = { ...suggested.box }; paintBox() }), button([icon('fa-plus'), ' Save as another picture'], save('add'), 'btn-primary'), button([icon('fa-check'), ' Save in place'], save('replace'), 'btn-success')]
    )

    let suggested
    try {
      suggested = await request('POST', adminPath('/ai/pictures/crop-suggest'), { json: { fileId } })
    } catch (error) {
      return fill(stage, el('div', { class: 'alert alert-danger' }, error.message))
    }
    let box = { ...suggested.box }
    const W = suggested.width
    const H = suggested.height
    const img = el('img', { src: suggested.url, alt: '', draggable: 'false' })
    const frame = el('div', { class: 'fpim-cropbox' }, ['nw', 'ne', 'sw', 'se'].map((c) => el('span', { class: `fpim-h fpim-h-${c}`, 'data-corner': c })))
    const size = el('div', { class: 'fpim-help' })
    fill(stage, img, frame)
    stage.after(size)
    const scale = () => img.clientWidth / W || 1
    function paintBox() {
      const k = scale()
      Object.assign(frame.style, { left: `${box.left * k}px`, top: `${box.top * k}px`, width: `${box.width * k}px`, height: `${box.height * k}px` })
      fill(size, `${box.width} × ${box.height} of ${W} × ${H} pixels${suggested.trimmed ? '' : ' — no plain background found to trim'}`)
      drawPreview()
    }
    drawPreview = () => {
      if (!img.complete || !img.naturalWidth) return
      const ctx = preview.getContext('2d')
      const MAX = 240
      const { left, top, width, height } = box
      if (square.checked) {
        // Squared on white, the box centred with the margin all round (as the PIM saves it).
        const side = Math.max(width, height) * (1 + 2 * Number(margin.value))
        const s = MAX / side
        preview.width = MAX
        preview.height = MAX
        ctx.fillStyle = '#fff'
        ctx.fillRect(0, 0, MAX, MAX)
        ctx.drawImage(img, left, top, width, height, ((side - width) / 2) * s, ((side - height) / 2) * s, width * s, height * s)
      } else {
        // Just the box, its own shape; a transparent background stays transparent.
        const s = MAX / Math.max(width, height)
        preview.width = Math.max(1, Math.round(width * s))
        preview.height = Math.max(1, Math.round(height * s))
        ctx.clearRect(0, 0, preview.width, preview.height)
        ctx.drawImage(img, left, top, width, height, 0, 0, preview.width, preview.height)
      }
    }
    img.addEventListener('load', paintBox)
    if (img.complete) paintBox()

    // Drag the box to move it; drag a corner to resize. Kept inside the picture.
    frame.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      const corner = e.target.dataset.corner
      const start = { x: e.clientX, y: e.clientY, ...box }
      const k = scale()
      frame.setPointerCapture(e.pointerId)
      const move = (ev) => {
        const dx = Math.round((ev.clientX - start.x) / k)
        const dy = Math.round((ev.clientY - start.y) / k)
        let { left, top, width, height } = start
        if (!corner) {
          left = Math.max(0, Math.min(W - width, left + dx))
          top = Math.max(0, Math.min(H - height, top + dy))
        } else {
          const right = start.left + start.width
          const bottom = start.top + start.height
          if (corner.includes('w')) { left = Math.max(0, Math.min(right - 10, start.left + dx)); width = right - left }
          if (corner.includes('e')) width = Math.max(10, Math.min(W - left, start.width + dx))
          if (corner.includes('n')) { top = Math.max(0, Math.min(bottom - 10, start.top + dy)); height = bottom - top }
          if (corner.includes('s')) height = Math.max(10, Math.min(H - top, start.height + dy))
        }
        box = { left, top, width, height }
        paintBox()
      }
      const up = () => {
        frame.removeEventListener('pointermove', move)
        frame.removeEventListener('pointerup', up)
      }
      frame.addEventListener('pointermove', move)
      frame.addEventListener('pointerup', up)
    })
  }

  // ================================================================ TradePeg's Parts list

  /**
   * Ticking parts in TradePeg's list shows its floating selection bar
   * (#toolbar-part). It gets what can be done to parts: "VARPAR / SOLOPAR"
   * (written to TradePeg), and "Edit in PIM" for what a part has of its own in
   * the PIM. A parent's fields (status, brand, categories…) are changed on
   * PIM → Parents, where its own rows are ticked.
   */
  function installPartsToolbar() {
    const bar = document.getElementById('toolbar-part')
    if (!bar || bar.querySelector('.fpim-parts-actions')) return
    const groups = [
      el('div', { class: 'btns pull-left ml5 fpim fpim-parts-actions' }, el('div', { class: 'btn-group' }, button([icon('fa-sitemap'), ' VARPAR / SOLOPAR'], () => void varparDialog(), 'btn-warning'))),
      el(
        'div',
        { class: 'btns pull-left ml5 fpim fpim-parts-actions' },
        menuButton(
          [icon('fa-cubes'), ' Edit in PIM'],
          [
            ['Set a variation value (Size, Colour…)', () => void variationFromParts()],
            ['Open the parent', () => void openFirstParent()],
          ],
          'btn-primary',
          { up: true, right: true }
        )
      ),
    ]
    const clear = bar.querySelector(':scope > .clear')
    if (clear) clear.before(...groups)
    else bar.append(...groups)
  }

  /** The ticked rows: part code (the Reference column's link) and TradePeg's own id (the tick box). */
  function tickedParts() {
    return [...document.querySelectorAll('input.rowSelect:checked')]
      .map((box) => ({ id: box.value, sku: box.closest('tr')?.querySelector('a.toolTip')?.textContent.trim() }))
      .filter((p) => p.sku)
  }

  async function resolveParts() {
    const skus = tickedParts().map((p) => p.sku)
    if (!skus.length) {
      toast('warning', 'Tick some parts first.')
      return null
    }
    if (!hasToken()) {
      openTools('settings')
      return null
    }
    try {
      return { skus, ...(await request('POST', adminPath('/products/resolve'), { json: { skus } })) }
    } catch (error) {
      toast('danger', error.status === 403 ? 'This computer’s PIM token cannot bulk edit (Pim → admin).' : error.message)
      return null
    }
  }

  const notInPim = (n) => {
    const d = dialog('Edit in PIM', [el('p', {}, `None of the ${plural(n, 'ticked part')} is in the PIM. Only SELECT items are synced.`)], [button('Close', () => d.close())])
  }

  async function openFirstParent() {
    const r = await resolveParts()
    if (!r) return
    if (!r.parents.length) return notInPim(r.skus.length)
    openTools('parent', r.parents[0].sku)
  }

  /**
   * One variation value (Size = Large) on every ticked part. Each part's parent
   * is saved as a whole, so the PIM's rules hold: a parent that gains a type
   * needs a value on all its live parts, and no two parts may end up the same.
   */
  async function variationFromParts() {
    const r = await resolveParts()
    if (!r) return
    if (!r.parents.length) return notInPim(r.skus.length)
    let type = null
    const value = el('input', { class: 'form-control', placeholder: 'Large, Blue, 10cm…' })
    const out = el('div')
    let plan = null
    const typeBox = selectBox({
      kind: 'variation-types',
      value: null,
      allowNew: true,
      placeholder: 'Size, Colour…',
      disabled: false,
      onChange: (t) => {
        type = t
        stale()
      },
    })
    const previewBtn = button('Preview the change', () => void preview(), 'btn-primary')
    const applyBtn = button('Apply', () => void apply(), 'btn-success', { style: 'display:none' })
    function stale() {
      plan = null
      applyBtn.style.display = 'none'
      previewBtn.className = 'btn btn-sm btn-primary'
    }
    value.addEventListener('input', stale)
    const partCode = (s) => s.replace(/-(UNIT|PACK|CASE)(-NA)?$/i, '')
    const parentOf = new Map(r.parents.flatMap((p) => p.parts.map((s) => [partCode(s), p.sku])))
    const PAIRS = 4 // the Variations import's Name / Value columns

    // The whole change is one Variations import: checked in one request, saved in another.
    async function preview() {
      if (!type) return fill(out, el('div', { class: 'alert alert-warning' }, 'Choose the variation type.'))
      if (!value.value.trim()) return fill(out, el('div', { class: 'alert alert-warning' }, 'Type the value.'))
      fill(out, spinner(' Reading the parts…'))
      previewBtn.disabled = true
      try {
        if (type.isNew) type = await request('POST', adminPath('/variation-types'), { json: { name: type.name } })
        const want = value.value.trim()
        const { rows: now } = await request('POST', adminPath('/imports/variations/prefill'), { json: { keys: [...parentOf.keys()] } })
        const lines = []
        const rows = []
        const adding = new Set()
        const full = new Set()
        for (const [sku, row] of Object.entries(now)) {
          const names = Array.from({ length: PAIRS }, (_, i) => row[`Variation ${i + 1} Name`] ?? '')
          let at = names.findIndex((n) => n.toLowerCase() === type.name.toLowerCase())
          if (at < 0) {
            at = names.findIndex((n) => !n)
            if (at < 0) { full.add(parentOf.get(sku)); continue }
            adding.add(parentOf.get(sku))
          }
          const was = names[at] ? row[`Variation ${at + 1} Value`] ?? '' : ''
          lines.push({ sku, parent: parentOf.get(sku), now: was })
          if (was !== want) rows.push({ ...row, [`Variation ${at + 1} Name`]: type.name, [`Variation ${at + 1} Value`]: want })
        }
        const check = rows.length ? await request('POST', adminPath('/imports/variations'), { json: { rows }, timeout: 600000 }) : null
        const errors = [...(check?.errors ?? []), ...(check?.unknown ?? []).map((u) => ({ sku: u.sku, message: 'not in the PIM' }))]
        previewBtn.disabled = false
        plan = rows.length && !errors.length ? rows : null
        const parents = check?.changes?.length ?? 0
        fill(
          out,
          errors.length
            ? el('div', { class: 'alert alert-danger' }, `Nothing can be saved yet:`, el('ul', {}, errors.map((e) => el('li', {}, `${e.sku}: ${e.message}`))))
            : el('div', { class: `alert ${plan ? 'alert-info' : 'alert-warning'}` }, plan ? `Nothing is saved yet — check the list, then Apply.` : `Every ticked part already has ${type.name} = ${want}.`),
          full.size ? el('div', { class: 'alert alert-warning' }, `${[...full].join(', ')} already ${full.size === 1 ? 'has' : 'have'} ${PAIRS} variation types, so ${full.size === 1 ? 'it is' : 'they are'} left out.`) : null,
          adding.size ? el('div', { class: 'alert alert-warning' }, `${[...adding].join(', ')} ${adding.size === 1 ? 'does' : 'do'} not use ${type.name} yet. It is added, so every live part of ${adding.size === 1 ? 'it' : 'them'} needs a ${type.name} — tick them all, or the save is refused.`) : null,
          el(
            'table',
            { class: 'fpim-table' },
            el('thead', {}, el('tr', {}, el('th', {}, 'Part'), el('th', {}, 'Parent'), el('th', {}, `${type.name} now`), el('th', {}, 'Will be'))),
            el('tbody', {}, lines.map((l) => el('tr', {}, el('td', { class: 'fpim-sku' }, l.sku), el('td', { class: 'fpim-sku' }, l.parent), el('td', {}, l.now || '—'), el('td', {}, want))))
          )
        )
        fill(applyBtn, icon('fa-check'), ` Apply to ${plural(parents, 'parent')}`)
        applyBtn.style.display = plan ? '' : 'none'
        previewBtn.className = `btn btn-sm ${plan ? 'btn-default' : 'btn-primary'}`
      } catch (error) {
        previewBtn.disabled = false
        fill(out, el('div', { class: 'alert alert-danger' }, error.status === 403 ? 'This computer’s PIM token cannot do this (Pim → admin).' : error.message))
      }
    }

    async function apply() {
      if (!plan) return
      applyBtn.disabled = previewBtn.disabled = true
      fill(applyBtn, icon('fa-spinner fa-spin'), ' Saving…')
      try {
        const res = await request('POST', adminPath('/imports/variations?apply=1'), { json: { rows: plan, apply: true }, timeout: 600000 })
        if (!res.applied) throw new Error([...(res.errors ?? []).map((e) => `${e.sku}: ${e.message}`), 'Nothing was saved.'].join(' '))
        d.close()
        toast('success', `Saved ${plural(res.changes.length, 'parent')}.`)
      } catch (error) {
        applyBtn.disabled = previewBtn.disabled = false
        fill(applyBtn, icon('fa-check'), ' Apply')
        out.prepend(el('div', { class: 'alert alert-danger' }, error.message))
      }
    }

    const d = dialog(
      `Set a variation value on ${plural(r.skus.length, 'part')}`,
      [
        r.missing.length ? el('div', { class: 'alert alert-warning' }, `Not in the PIM, so left out: ${r.missing.join(', ')}.`) : null,
        el('div', { class: 'row' }, field('Variation type', typeBox, null, 5), field('Value', value, null, 7)),
        out,
      ],
      [button('Cancel', () => d.close()), previewBtn, applyBtn]
    )
  }

  // ---------------------------------------------------------------- VARPAR / SOLOPAR

  /**
   * The ticked parts' VARPAR, written to TradePeg: one new VARPAR for them all,
   * an existing VARPAR they join, or a new SOLOPAR each. Codes are
   * PREFIX-VARPAR-nnn / PREFIX-SOLOPAR-nnn, the prefix being the part code's own
   * and the number the next free one in all of TradePeg (the PIM works it out).
   * Every part's before and after is shown first; nothing is saved until Save.
   */
  async function varparDialog() {
    const ticked = tickedParts()
    if (!ticked.length) return toast('warning', 'Tick some parts first.')
    if (!hasToken()) return openTools('settings')

    const choose = el('div')
    const out = el('div', {}, spinner(' Checking which codes are free…'))
    const saveBtn = button([icon('fa-check'), ' Save'], () => void save(), 'btn-success', { disabled: true, title: 'Saves the new codes to the parts in TradePeg' })
    const d = dialog(`VARPAR / SOLOPAR for ${plural(ticked.length, 'part')}`, [choose, out], [button('Cancel', () => d.close()), saveBtn])

    let info
    try {
      info = await request('POST', adminPath('/parts/codes'), { json: { skus: ticked.map((p) => p.sku) }, timeout: 180000 })
    } catch (error) {
      return fill(out, el('div', { class: 'alert alert-danger' }, error.status === 403 ? 'This computer’s PIM token cannot do this (Pim → admin).' : error.message), button([icon('fa-refresh'), ' Try again'], () => { d.close(); void varparDialog() }))
    }

    const known = new Map(info.parts.map((p) => [p.sku, p]))
    const parts = ticked.map((t) => ({ ...t, ...known.get(t.sku) }))
    const prefixes = Object.keys(info.prefixes)
    const common = (list) => [...list.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map())].sort((a, b) => b[1] - a[1])[0]?.[0]
    const pick = { mode: parts.length > 1 ? 'new' : 'solo', prefix: common(parts.map((p) => p.prefix).filter(Boolean)) ?? '', join: '' }
    const named = (pre) => `${pre}${info.prefixes[pre]?.name ? ` — ${info.prefixes[pre].name}` : ''}`

    const radio = (mode, label, help) => {
      const box = el('input', { type: 'radio', name: 'fpim-varpar-mode', value: mode })
      box.checked = pick.mode === mode
      box.addEventListener('change', () => {
        pick.mode = mode
        paint()
      })
      return el('label', { class: `fpim-tag${pick.mode === mode ? ' fpim-on' : ''}` }, box, el('span', {}, el('strong', {}, label), el('div', { class: 'fpim-help' }, help)))
    }
    const prefixSelect = el('select', { class: 'form-control' }, prefixes.map((pre) => el('option', { value: pre }, named(pre))))
    prefixSelect.value = pick.prefix
    prefixSelect.addEventListener('change', () => {
      pick.prefix = prefixSelect.value
      paint()
    })
    const joinInput = el('input', { class: 'form-control', list: 'fpim-varpars', placeholder: 'e.g. FM-VARPAR-002', value: pick.join })
    const joinList = el('datalist', { id: 'fpim-varpars' }, info.varpars.map((v) => el('option', { value: v.code }, `${plural(v.parts, 'part')} — ${v.title ?? ''}`)))
    joinInput.addEventListener('input', () => {
      pick.join = joinInput.value.trim().toUpperCase()
      paintPlan()
    })

    /** Each part with its VARPAR now and what it would be. */
    function plan() {
      if (pick.mode === 'new') {
        if (!pick.prefix) return { error: 'None of these part codes starts with a prefix (like FM-), so a VARPAR cannot be numbered.' }
        const code = `${pick.prefix}-VARPAR-${String(info.prefixes[pick.prefix].lastVarpar + 1).padStart(3, '0')}`
        return { rows: parts.map((p) => ({ ...p, next: code })) }
      }
      if (pick.mode === 'join') {
        if (!pick.join) return { error: 'Type or choose the VARPAR to add them to.' }
        if (!/^[A-Z0-9]{2,3}-VARPAR-\d{3,}$/.test(pick.join)) return { error: `${pick.join} is not a VARPAR code (like FM-VARPAR-002).` }
        return { rows: parts.map((p) => ({ ...p, next: pick.join })) }
      }
      // A SOLOPAR each, numbered on from the last one per prefix.
      const used = {}
      return {
        rows: parts.map((p) => {
          if (!p.prefix) return { ...p, next: null, why: 'No prefix in the part code' }
          used[p.prefix] = (used[p.prefix] ?? info.prefixes[p.prefix].lastSolopar) + 1
          return { ...p, next: `${p.prefix}-SOLOPAR-${String(used[p.prefix]).padStart(3, '0')}` }
        }),
      }
    }

    function paint() {
      fill(
        choose,
        el('div', { class: 'row' }, field(
          'What should they get?',
          el(
            'div',
            { class: 'fpim-tags', role: 'radiogroup', 'aria-label': 'What the parts get' },
            radio('new', 'A new VARPAR for them all', 'They become variants of one new parent'),
            radio('join', 'Add them to a VARPAR', 'One that already exists'),
            radio('solo', parts.length > 1 ? 'A new SOLOPAR each' : 'A new SOLOPAR', 'A part sold on its own')
          ),
          null,
          12,
          { top: true }
        )),
        pick.mode === 'new' && prefixes.length > 1 ? el('div', { class: 'row' }, field('Prefix of the new VARPAR', prefixSelect, null, 6)) : null,
        pick.mode === 'join' ? el('div', { class: 'row' }, field('VARPAR', el('div', {}, joinInput, joinList), null, 6)) : null
      )
      paintPlan()
    }

    let current = null
    function paintPlan() {
      current = plan()
      if (current.error) {
        saveBtn.disabled = true
        return fill(out, el('div', { class: 'alert alert-warning' }, current.error))
      }
      const rows = current.rows
      const changing = rows.filter((r) => r.next && r.found !== false && r.varpar !== r.next)
      // A VARPAR the parts leave, and how many parts it would keep.
      const left = new Map()
      for (const r of changing) if (/-VARPAR-/.test(r.varpar ?? '')) left.set(r.varpar, (left.get(r.varpar) ?? 0) + 1)
      const thin = [...left].map(([code, n]) => ({ code, keeps: (info.varpars.find((v) => v.code === code)?.parts ?? n) - n })).filter((x) => x.keeps < 2)
      const joining = pick.mode === 'join' ? info.varpars.find((v) => v.code === pick.join) : null
      saveBtn.disabled = !changing.length
      fill(saveBtn, icon('fa-check'), ' Save')
      fill(
        out,
        pick.mode === 'new' && parts.length === 1 ? el('div', { class: 'alert alert-warning' }, 'A VARPAR with one part is a parent with nothing to choose between. A part on its own is a SOLOPAR.') : null,
        pick.mode === 'solo' && parts.length > 1 ? el('div', { class: 'alert alert-info' }, `Each part gets its own SOLOPAR. To make them one product with variants, choose a VARPAR.`) : null,
        pick.mode === 'join' && !joining ? el('div', { class: 'alert alert-warning' }, `${pick.join} is not on any part with these prefixes yet. Check the code, or choose "A new VARPAR".`) : null,
        thin.length ? el('div', { class: 'alert alert-warning' }, thin.map((x) => `${x.code} would be left with ${x.keeps === 0 ? 'no parts' : 'one part'}. `)) : null,
        el(
          'table',
          { class: 'fpim-table' },
          el('thead', {}, el('tr', {}, el('th', {}, 'Part'), el('th', {}, 'Title'), el('th', {}, 'VARPAR now'), el('th', {}, 'Will be'))),
          el(
            'tbody',
            {},
            rows.map((r) =>
              el(
                'tr',
                {},
                el('td', { class: 'fpim-sku' }, r.sku),
                el('td', {}, r.title ?? ''),
                el('td', { class: 'fpim-sku' }, r.varpar || '—'),
                el(
                  'td',
                  { class: 'fpim-sku' },
                  r.found === false ? el('span', { class: 'text-danger' }, 'Not found in TradePeg') : !r.next ? el('span', { class: 'text-danger' }, r.why) : r.varpar === r.next ? el('span', { class: 'text-muted' }, 'No change') : el('strong', {}, r.next)
                )
              )
            )
          )
        ),
        el(
          'p',
          { class: 'fpim-help' },
          prefixes.map((pre) => {
            const x = info.prefixes[pre]
            const last = (kind, n) => (n ? `${pre}-${kind}-${String(n).padStart(3, '0')}` : 'none yet')
            return el('div', {}, el('strong', {}, named(pre)), ` — last VARPAR ${last('VARPAR', x.lastVarpar)}, last SOLOPAR ${last('SOLOPAR', x.lastSolopar)}`)
          }),
          `Free codes checked ${when(info.checkedAt)}, and again on Save.`
        )
      )
    }
    paint()

    async function save() {
      saveBtn.disabled = true
      fill(saveBtn, icon('fa-spinner fa-spin'), ' Checking…')
      // Someone may have taken the next number since: work it out again before writing.
      const shown = current.rows.map((r) => r.next).join()
      try {
        info = await request('POST', adminPath('/parts/codes'), { json: { skus: ticked.map((p) => p.sku), fresh: true }, timeout: 180000 })
      } catch (error) {
        saveBtn.disabled = false
        fill(saveBtn, icon('fa-check'), ' Save')
        return fill(out, el('div', { class: 'alert alert-danger' }, error.message))
      }
      for (const p of parts) Object.assign(p, info.parts.find((x) => x.sku === p.sku))
      paintPlan()
      // TradePeg already has them all (an earlier save went through after all): nothing to write.
      if (!current.error && !current.rows.some((r) => r.next && r.found !== false && r.varpar !== r.next)) {
        return out.prepend(el('div', { class: 'alert alert-success' }, 'Nothing to save: TradePeg already has these parts on these codes.'))
      }
      if (current.error || current.rows.map((r) => r.next).join() !== shown) {
        return out.prepend(el('div', { class: 'alert alert-warning' }, 'The codes changed since you opened this (someone else saved one). Check the list again, then Save.'))
      }

      const todo = current.rows.filter((r) => r.next && r.found !== false && r.varpar !== r.next)
      const results = []
      for (const [i, r] of todo.entries()) {
        fill(saveBtn, icon('fa-spinner fa-spin'), ` Saving ${i + 1} of ${todo.length}…`)
        try {
          await writeVarpar(r.id, r.next)
          results.push({ sku: r.sku, ok: true, code: r.next })
        } catch (error) {
          results.push({ sku: r.sku, ok: false, message: error.message })
          break // the rest are left as they are, so nothing half-done goes unnoticed
        }
      }
      const failed = results.find((x) => !x.ok)
      const untouched = todo.length - results.length
      fill(choose)
      fill(
        out,
        el(
          'div',
          { class: `alert ${failed ? 'alert-danger' : 'alert-success'}` },
          `${plural(results.filter((x) => x.ok).length, 'part')} saved in TradePeg.`,
          failed ? ` ${failed.sku} was not saved: ${failed.message}.` : '',
          untouched ? ` The ${untouched === 1 ? 'part after it was' : `${untouched} parts after it were`} not tried.` : ''
        ),
        el('table', { class: 'fpim-table' }, el('tbody', {}, results.map((x) => el('tr', {}, el('td', { class: 'fpim-sku' }, x.sku), el('td', {}, x.ok ? [icon('fa-check text-success'), ' ', x.code] : el('span', { class: 'text-danger' }, x.message)))))),
        el('p', {}, 'The PIM picks this up at its next TradePeg sync. ', button('Sync the PIM now', () => {
          d.close()
          resyncDialog()
        }, 'btn-info'))
      )
      saveBtn.parentElement.replaceChildren(button('Close', () => d.close(), 'btn-primary'))
    }
  }

  /**
   * Set one part's VARPAR the way TradePeg's own Edit Details → Save does: read
   * the edit form, change only the VARPAR box, and post the whole form back.
   * Then the form is read again: the VARPAR must be the new code and every other
   * field exactly as before, or it says so.
   */
  async function writeVarpar(partId, code) {
    const $ = unsafeWindow.jQuery
    if (!$) throw new Error('TradePeg’s page is not ready. Reload it and try again.')
    const readForm = async () => {
      const res = await fetch(`/wapp/en-gb/inventory/products/details/${encodeURIComponent(partId)}?em=1&_d=${Date.now()}`, { credentials: 'same-origin' })
      if (!res.ok) throw new Error(`TradePeg answered ${res.status} opening the part`)
      const doc = new DOMParser().parseFromString(await res.text(), 'text/html')
      const form = doc.querySelector('#tab_details form')
      if (!form || form.querySelector('[name="itemId"]')?.value !== partId) throw new Error('Could not open the part’s Edit Details')
      const help = [...form.querySelectorAll('.help-block.label_specs')].find((h) => h.textContent.trim().toUpperCase() === 'VARPAR')
      const input = help?.parentElement.querySelector('input')
      if (!input) throw new Error('The part’s Edit Details has no VARPAR box')
      // As TradePeg's Save does: disabled boxes are sent too.
      $(form).find(':input:disabled').removeAttr('disabled')
      return { form, input, scope: form.querySelector('.postform2')?.getAttribute('data-scope') || 'item' }
    }
    const fields = (form) => new URLSearchParams($(form).serialize())

    const before = await readForm()
    before.input.value = code
    const sent = fields(before.form)
    const post = `${unsafeWindow.user_config?.postUrl2 ?? '/wapp/en-gb/io/post/'}/${before.scope}`
    const res = await fetch(post, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
      body: sent.toString(),
    })
    if (!res.ok) throw new Error(`TradePeg answered ${res.status}`)
    let answer = null
    try { answer = await res.json() } catch { /* checked below by reading the part again */ }
    // Not `success`: TradePeg answers false on saves that worked. Only an error it names, or the part read back, counts.
    if (answer?.error && typeof answer.error === 'string') throw new Error(answer.error)

    const after = await readForm()
    if (after.input.value.trim().toUpperCase() !== code) {
      const said = answer?.message || answer?.notify
      throw new Error(`TradePeg did not keep the new VARPAR (it shows ${after.input.value || 'nothing'})${said ? `. It said: ${said}` : ''}`)
    }
    const now = fields(after.form)
    const moved = [...new Set([...sent.keys(), ...now.keys()])].filter((k) => sent.getAll(k).join('|') !== now.getAll(k).join('|'))
    if (moved.length) throw new Error(`Saved, but TradePeg now shows other fields differently too: ${moved.join(', ')}. Check the part.`)
  }

  // ================================================================ TradePeg's part page

  const UOM_NAME = { unit: 'Unit', pack: 'Pack', case: 'Case' }
  // The parent's tag in a part's Images tab. Not a SKU: a single part's parent has the part's own code.
  const PARENT = '@parent'

  /** A field on the part's Details tab by its label ("VARPAR", "SKU"…). */
  function partField(label) {
    for (const help of document.querySelectorAll('#tab_details .help-block')) {
      if (help.textContent.replace(/\s+/g, ' ').trim().toLowerCase() !== label.toLowerCase()) continue
      const value = help.parentElement?.querySelector('.form-control')
      if (value) return value
    }
    return null
  }

  function installPartPage() {
    linkVarpar()
    installPictures()
  }

  /** The part's VARPAR (Details) opens its parent in the PIM. */
  function linkVarpar() {
    const value = partField('VARPAR')
    if (!value || value.querySelector('.fpim-varpar')) return
    const sku = value.textContent.replace(/\u00a0/g, ' ').trim()
    if (!sku) return
    fill(
      value,
      el('a', { class: 'fpim-varpar', href: `#pim/parent/${encodeURIComponent(sku)}`, title: `Open ${sku} in the PIM`, onclick: (e) => { e.preventDefault(); openTools('parent', sku) } }, sku, icon('fa-pencil'))
    )
  }

  /**
   * "Website pictures" in the part's Images tab, above TradePeg's own: the
   * part's pictures and its units', each tagged with what it shows. Asked of
   * the PIM only when the tab is opened.
   */
  function installPictures() {
    const tab = document.getElementById('tab_images')
    if (!tab || tab.querySelector('.fpim-pics')) return
    const sku = productReference()
    const holder = el('div', { class: 'panel-body' })
    const reload = () => void loadPictures(holder, sku)
    tab.prepend(
      el(
        'div',
        { class: 'panel panel-parts fpim fpim-pics' },
        el(
          'div',
          { class: 'panel-heading' },
          'Website pictures & videos',
          el('span', { class: 'label label-info label-normal ml10' }, 'PIM'),
          el('div', { class: 'pull-right btns' }, el('div', { class: 'btn-group' }, el('a', { class: 'btn btn-info btn-sm', href: '#', onclick: (e) => { e.preventDefault(); reload() } }, icon('fa-refresh'), ' Reload')))
        ),
        holder
      )
    )
    shieldKeys(tab)
    let loaded = false
    const first = () => {
      if (loaded) return
      loaded = true
      reload()
    }
    document.querySelector('a[aria-controls="tab_images"]')?.addEventListener('click', first)
    if (tab.classList.contains('active')) first()
  }

  async function loadPictures(holder, sku) {
    if (!hasToken()) {
      return fill(holder, el('p', {}, 'The PIM needs an API token once on this computer. ', el('a', { href: '#pim/settings', onclick: (e) => { e.preventDefault(); openTools('settings') } }, 'PIM settings')))
    }
    fill(holder, spinner())
    try {
      paintPictures(holder, sku, await request('GET', skuPath(sku)))
    } catch (error) {
      if (error.status === 404) return fill(holder, el('p', {}, el('strong', {}, sku), ' is not in the PIM yet. Only SELECT items are synced.'))
      fill(
        holder,
        el('div', { class: 'alert alert-danger' }, error.status === 401 || error.status === 403 ? 'The PIM refused this computer’s token (PIM → Settings).' : error.message),
        button('Try again', () => void loadPictures(holder, sku))
      )
    }
  }

  /**
   * The part's pictures grouped by tag. Every change — upload, move, retag,
   * remove — is saved at once, like TradePeg's own gallery.
   */
  function paintPictures(holder, sku, data, chosen = null, note = null) {
    // On the parent page, a picture save moves the parent on: its own Save must not see that as someone else's.
    if (state.data?.product.sku === data.product.sku) state.data.product.updatedAt = data.product.updatedAt
    const v = data.variants.find((x) => x.sku === sku) ?? data.variants.find((x) => x.sku === data.variantSku)
    const parentLink = el('a', { href: `#pim/parent/${encodeURIComponent(data.product.sku)}`, onclick: (e) => { e.preventDefault(); openTools('parent', data.product.sku) } }, data.product.sku)
    if (!v) return fill(holder, el('p', {}, `${sku} is a parent: its pictures are on `, parentLink, '.'))

    // Tagged to the parent, a picture is the whole range's: every part of it shows it.
    const live = data.variants.filter((x) => !x.eol).length
    const tags = [
      { key: PARENT, sku: data.product.sku, name: 'The parent', help: live > 1 ? `Shown on all ${live} parts` : 'Shown on the part and its units' },
      { key: v.sku, sku: v.sku, name: 'The item', help: 'Shown for every unit that has no picture of its own' },
      ...v.uoms.map((u) => ({ key: u.uomSku, sku: u.uomSku, name: `${UOM_NAME[u.type] ?? u.type}${u.qty > 1 ? ` of ${u.qty}` : ''}`, help: u.description ?? '' })),
    ]
    const groups = new Map(tags.map((t) => [t.key, []]))
    for (const f of data.product.images) groups.get(PARENT).push(f)
    for (const f of v.images) groups.get(v.sku).push(f)
    for (const x of v.uomImages) {
      if (!groups.has(x.uomSku)) groups.set(x.uomSku, [])
      groups.get(x.uomSku).push(x.image)
    }
    let tag = chosen && groups.has(chosen) ? chosen : null
    const tagSku = (key) => (key === PARENT ? data.product.sku : key)
    const status = el('div', {}, note ? el('div', { class: 'alert alert-success' }, note) : null)

    async function save(next, done) {
      fill(status, spinner(' Saving…'))
      const ids = (key) => (next.get(key) ?? []).map((f) => f.id)
      const uomImages = [...next].filter(([t]) => t !== v.sku && t !== PARENT).flatMap(([t, files]) => files.map((f) => ({ uomSku: t, file: f.id })))
      try {
        const fresh = await request('PUT', skuPath(data.product.sku), { json: { updatedAt: data.product.updatedAt, images: ids(PARENT), variants: { [v.documentId]: { images: ids(v.sku), uomImages } } } })
        paintPictures(holder, sku, fresh, tag, done)
      } catch (error) {
        if (error.status === 409) return void loadPictures(holder, sku)
        fill(status, el('div', { class: 'alert alert-danger' }, error.status === 403 ? 'This computer’s PIM token cannot save (Pim → update).' : `Not saved: ${error.message}`))
      }
    }
    const change = (fn, done) => {
      const next = new Map([...groups].map(([t, files]) => [t, [...files]]))
      fn(next)
      void save(next, done)
    }

    const fileInput = el('input', { type: 'file', accept: 'image/*', multiple: true, style: 'display:none' })
    // No picture or video goes in untagged.
    const askForTag = () => {
      fill(status, el('div', { class: 'alert alert-warning' }, 'First choose what it shows: the parent, the item, or one of its units.'))
      tagBox.scrollIntoView({ block: 'nearest' })
      tagBox.querySelector('input')?.focus()
    }
    async function upload(files) {
      files = files.filter((f) => /^image\//.test(f.type))
      if (!files.length) return
      if (!tag) return askForTag()
      const form = new FormData()
      for (const f of files) form.append('files', f, f.name)
      const to = tag === PARENT ? 'images' : tag === v.sku ? `variant:${v.documentId}` : `uom:${v.documentId}:${tag}`
      const name = tagSku(tag)
      fill(status, spinner(` Uploading ${plural(files.length, 'picture')} as ${name}…`))
      try {
        const fresh = await request('POST', `${skuPath(data.product.sku)}/files?to=${encodeURIComponent(to)}`, { form })
        paintPictures(holder, sku, fresh, tag, `Added ${plural(files.length, 'picture')} to ${name}.`)
      } catch (error) {
        fill(status, el('div', { class: 'alert alert-danger' }, error.status === 403 ? 'This computer’s PIM token cannot upload (Pim → upload).' : `Upload failed: ${error.message}`))
      }
    }
    fileInput.addEventListener('change', () => {
      void upload([...fileInput.files])
      fileInput.value = ''
    })

    const tagBox = el(
      'div',
      { class: 'fpim-tags', role: 'radiogroup', 'aria-label': 'What the new pictures show' },
      tags.map((t) => {
        const radio = el('input', { type: 'radio', name: `fpim-tag-${v.sku}`, value: t.key })
        radio.checked = tag === t.key
        radio.addEventListener('change', () => {
          tag = t.key
          for (const l of tagBox.children) l.classList.toggle('fpim-on', l.querySelector('input').checked)
          drop.classList.remove('fpim-off')
          fill(dropText, `Drop pictures of ${t.sku} here, or click to choose them`)
          fill(status)
        })
        return el('label', { class: `fpim-tag${tag === t.key ? ' fpim-on' : ''}` }, radio, el('span', {}, el('span', { class: 'fpim-sku' }, t.sku), el('br'), el('strong', {}, t.name), t.help ? el('div', { class: 'fpim-help' }, t.help) : null))
      })
    )
    const dropText = el('span', {}, tag ? `Drop pictures of ${tagSku(tag)} here, or click to choose them` : 'Choose what the pictures show above, then drop them here')
    const drop = el(
      'div',
      { class: `fpim-drop${tag ? '' : ' fpim-off'}`, role: 'button', tabindex: '0', 'aria-label': 'Add pictures' },
      icon('fa-cloud-upload'),
      ' ',
      dropText
    )
    const pick = () => (tag ? fileInput.click() : askForTag())
    drop.addEventListener('click', pick)
    drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick() } })
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('fpim-over') })
    drop.addEventListener('dragleave', () => drop.classList.remove('fpim-over'))
    drop.addEventListener('drop', (e) => {
      e.preventDefault()
      drop.classList.remove('fpim-over')
      void upload([...(e.dataTransfer?.files ?? [])])
    })

    let dragging = null // the picture being dragged: { tag, index }
    const gallery = tags
      .concat([...groups.keys()].filter((t) => !tags.some((x) => x.key === t)).map((t) => ({ key: t, sku: t, name: 'No longer one of its units', help: '' })))
      .filter((t) => groups.get(t.key).length)
      .map((t) => {
        const files = groups.get(t.key)
        return el(
          'div',
          { class: 'fpim-group' },
          el('h5', {}, el('span', { class: 'fpim-sku' }, t.sku), ` \u2014 ${t.name} (${files.length})`),
          el(
            'div',
            { class: 'fpim-images' },
            files.map((f, i) => {
              const retag = el('select', { 'aria-label': `What ${f.name ?? 'this picture'} shows` }, tags.map((x) => el('option', { value: x.key }, x.key === PARENT ? `${x.sku} (parent)` : x.sku)))
              retag.value = t.key
              retag.addEventListener('change', () =>
                change((next) => {
                  next.get(t.key).splice(i, 1)
                  next.get(retag.value).push(f)
                }, `Moved the picture to ${tagSku(retag.value)}.`)
              )
              // Drag a picture onto another of the same tag to put it there.
              const tile = el(
                'div',
                { class: 'fpim-image fpim-tile fpim-dragtile', draggable: 'true', title: files.length > 1 ? 'Drag to change the order' : null },
                el('a', { href: f.url, target: '_blank', rel: 'noreferrer', draggable: 'false' }, el('img', { src: f.thumb, alt: f.alt ?? '', draggable: 'false' })),
                i === 0 ? el('div', { class: 'fpim-first' }, 'First') : el('div', { class: 'fpim-help' }, `#${i + 1}`),
                el(
                  'div',
                  { class: 'btn-group' },
                  iconButton('fa-arrow-left', 'Move left', () => change((next) => move(next.get(t.key), i, -1)), { disabled: i === 0 }),
                  iconButton('fa-arrow-right', 'Move right', () => change((next) => move(next.get(t.key), i, 1)), { disabled: i === files.length - 1 }),
                  iconButton('fa-crop', 'Crop to the product', () => void cropDialog({ sku: data.product.sku, fileId: f.id, onSaved: () => void loadPictures(holder, sku) })),
                  iconButton('fa-magic', 'Fix with AI', () => openTools('ai', `pictures:${data.product.sku}:${f.id}`)),
                  iconButton('fa-times', 'Remove', () => { if (confirm(t.key === PARENT ? `Remove this picture from every part of ${data.product.sku}?` : 'Remove this picture from the website?')) change((next) => next.get(t.key).splice(i, 1), 'Removed.') })
                ),
                retag
              )
              tile.addEventListener('dragstart', (e) => {
                if (e.target !== tile) return
                dragging = { tag: t.key, index: i }
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/plain', String(f.id))
                tile.classList.add('fpim-dragging')
              })
              tile.addEventListener('dragend', () => {
                dragging = null
                tile.classList.remove('fpim-dragging')
                for (const x of holder.querySelectorAll('.fpim-dropon')) x.classList.remove('fpim-dropon')
              })
              tile.addEventListener('dragover', (e) => {
                if (dragging?.tag !== t.key || dragging.index === i) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                tile.classList.add('fpim-dropon')
              })
              tile.addEventListener('dragleave', () => tile.classList.remove('fpim-dropon'))
              tile.addEventListener('drop', (e) => {
                if (dragging?.tag !== t.key || dragging.index === i) return
                e.preventDefault()
                const from = dragging.index
                dragging = null
                change((next) => next.get(t.key).splice(i, 0, ...next.get(t.key).splice(from, 1)))
              })
              return tile
            })
          )
        )
      })

    // ---- videos: the same tags; a link (YouTube / Vimeo) or an uploaded file.
    const vgroups = new Map(tags.map((t) => [t.key, []]))
    for (const x of data.product.videos ?? []) vgroups.get(PARENT).push(x)
    for (const x of v.videos ?? []) {
      const key = x.uomSku || v.sku
      if (!vgroups.has(key)) vgroups.set(key, [])
      vgroups.get(key).push(x)
    }
    const videoOut = (x, uomSku) => ({ title: x.title ?? '', url: x.file ? null : x.url, file: x.file?.id ?? null, ...(uomSku !== undefined ? { uomSku } : {}) })
    async function saveVideos(next, done) {
      fill(status, spinner(' Saving…'))
      const own = [...next].filter(([t]) => t !== PARENT).flatMap(([t, list]) => list.map((x) => videoOut(x, t === v.sku ? null : t)))
      try {
        const fresh = await request('PUT', skuPath(data.product.sku), { json: { updatedAt: data.product.updatedAt, videos: (next.get(PARENT) ?? []).map((x) => videoOut(x)), variants: { [v.documentId]: { videos: own } } } })
        paintPictures(holder, sku, fresh, tag, done)
      } catch (error) {
        if (error.status === 409) return void loadPictures(holder, sku)
        fill(status, el('div', { class: 'alert alert-danger' }, error.status === 403 ? 'This computer’s PIM token cannot save (Pim → update).' : `Not saved: ${error.message}`))
      }
    }
    const changeVideos = (fn, done) => {
      const next = new Map([...vgroups].map(([t, list]) => [t, [...list]]))
      fn(next)
      void saveVideos(next, done)
    }
    const videoTitle = el('input', { class: 'form-control', placeholder: 'Title (optional)' })
    const videoLink = el('input', { class: 'form-control', placeholder: 'YouTube or Vimeo link' })
    const addLink = () => {
      if (!tag) return askForTag()
      const url = videoLink.value.trim()
      if (!/^https?:\/\/(www\.)?(youtube\.com|youtu\.be|vimeo\.com|player\.vimeo\.com)\/.+/.test(url)) return fill(status, el('div', { class: 'alert alert-warning' }, 'Paste a YouTube or Vimeo link.'))
      changeVideos((next) => next.get(tag).push({ title: videoTitle.value.trim(), url, file: null }), `Added the video to ${tagSku(tag)}.`)
    }
    videoLink.addEventListener('keydown', (e) => { if (e.key === 'Enter') addLink() })
    const videoFile = el('input', { type: 'file', accept: 'video/*', multiple: true, style: 'display:none' })
    videoFile.addEventListener('change', async () => {
      const files = [...videoFile.files].filter((f) => /^video\//.test(f.type))
      videoFile.value = ''
      if (!files.length) return
      if (!tag) return askForTag()
      const form = new FormData()
      for (const f of files) form.append('files', f, f.name)
      const to = tag === PARENT ? 'video' : tag === v.sku ? `variant-video:${v.documentId}` : `variant-video:${v.documentId}:${tag}`
      fill(status, spinner(` Uploading ${plural(files.length, 'video')} as ${tagSku(tag)}…`))
      try {
        const fresh = await request('POST', `${skuPath(data.product.sku)}/files?to=${encodeURIComponent(to)}`, { form, timeout: 600000 })
        paintPictures(holder, sku, fresh, tag, `Added ${plural(files.length, 'video')} to ${tagSku(tag)}.`)
      } catch (error) {
        fill(status, el('div', { class: 'alert alert-danger' }, error.status === 403 ? 'This computer’s PIM token cannot upload (Pim → upload).' : `Upload failed: ${error.message}`))
      }
    })
    const videoList = tags
      .concat([...vgroups.keys()].filter((t) => !tags.some((x) => x.key === t)).map((t) => ({ key: t, sku: t, name: 'No longer one of its units' })))
      .filter((t) => vgroups.get(t.key).length)
      .flatMap((t) =>
        vgroups.get(t.key).map((x, i) => {
          const retag = el('select', { class: 'form-control input-sm', 'aria-label': 'What the video shows' }, tags.map((y) => el('option', { value: y.key }, y.key === PARENT ? `${y.sku} (parent)` : y.sku)))
          retag.value = t.key
          retag.addEventListener('change', () => changeVideos((next) => { next.get(t.key).splice(i, 1); next.get(retag.value).push(x) }, `Moved the video to ${tagSku(retag.value)}.`))
          const href = x.file?.url ?? x.url
          return el(
            'tr',
            {},
            el('td', { style: 'width:220px' }, retag),
            el('td', {}, x.title || el('span', { class: 'text-muted' }, 'No title')),
            el('td', {}, href ? el('a', { href, target: '_blank', rel: 'noreferrer' }, icon(x.file ? 'fa-file-video-o' : 'fa-youtube-play'), ' ', x.file ? x.file.name || 'Uploaded video' : x.url) : null),
            el('td', { style: 'width:40px' }, iconButton('fa-times', 'Remove', () => { if (confirm(t.key === PARENT ? `Remove this video from every part of ${data.product.sku}?` : 'Remove this video from the website?')) changeVideos((next) => next.get(t.key).splice(i, 1), 'Removed.') }))
          )
        })
      )

    fill(
      holder,
      el('p', {}, 'The pictures and videos the website shows for ', el('strong', {}, v.sku), '. Tag one to the parent, ', parentLink, ', and every part of it shows it.'),
      field('1. What do they show?', tagBox, null, 12, { top: true }),
      field('2. Add pictures', el('div', {}, fileInput, drop), null, 12, { top: true }),
      field(
        '3. Add a video',
        el('div', { class: 'fpim-row' }, el('div', { style: 'flex:0 0 220px' }, videoTitle), el('div', { class: 'fpim-grow' }, videoLink), button([icon('fa-plus'), ' Add link'], addLink, 'btn-primary'), videoFile, button([icon('fa-upload'), ' Upload a video…'], () => (tag ? videoFile.click() : askForTag()))),
        null,
        12,
        { top: true }
      ),
      status,
      gallery.length ? gallery : el('p', { class: 'text-muted' }, 'No pictures of this part yet.'),
      videoList.length ? el('div', { class: 'fpim-group' }, el('h5', {}, `Videos (${videoList.length})`), el('table', { class: 'table-grid table-bordered' }, el('tbody', {}, videoList))) : null
    )
  }

  // ================================================================ start

  // Keep watching for as long as the page is open: every product opened in
  // place brings a fresh tab strip. Checks are batched.
  const tryInstall = () => {
    try {
      installPartPage()
      installMenu()
      installPartsToolbar()
      routePage()
    } catch (error) {
      console.error('[Farla PIM]', VERSION, 'could not add the tab', error)
    }
  }
  tryInstall()
  let queued = false
  new MutationObserver(() => {
    if (queued) return
    queued = true
    // Not requestAnimationFrame: it never fires in a background browser tab.
    setTimeout(() => {
      queued = false
      tryInstall()
    }, 50)
  }).observe(document.body, { childList: true, subtree: true })
})()
