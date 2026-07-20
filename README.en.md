<p align="center">
  <img src="https://img.shields.io/badge/userscript-Violentmonkey%20%7C%20Tampermonkey-orange?style=flat-square" alt="userscript badge" />
  <img src="https://img.shields.io/badge/game-Upland-blueviolet?style=flat-square" alt="upland badge" />
  <img src="https://img.shields.io/github/license/WallCod/upland-bulk-list?style=flat-square" alt="license badge" />
  <img src="https://img.shields.io/badge/version-1.4.1-brightgreen?style=flat-square" alt="version badge" />
</p>

<p align="center">
  <a href="./README.md">🇧🇷 Português</a> · 🇺🇸 English (this file)
</p>

# 🛠️ Upland Tools

A userscript with tools for Upland's Showroom. It currently ships **📦 Bulk List**: lists multiple units of the same item at the same price, automating the repetitive "select → price → confirm → close" flow for each unit. It also has **🐛 Report Issue**, to report a problem straight from the game without needing a GitHub account.

Built for anyone who already uses a factory-to-Showroom mover and then has to list everything one by one manually — this script takes care of the listing part.

⭐ If this script helped you, consider starring the repository.

## 📥 Installation

**Quick install (if you already have Violentmonkey or Tampermonkey):**

[📥 Click here to install directly](https://raw.githubusercontent.com/WallCod/upland-bulk-list/master/bulk-list-items.user.js)

Your userscript manager will detect the link automatically and open the install screen.

**Full setup (if you don't have a userscript manager yet):**

1. Install a userscript manager: [Violentmonkey](https://violentmonkey.github.io/) (recommended) or [Tampermonkey](https://www.tampermonkey.net/).
2. Click the [quick install link](https://raw.githubusercontent.com/WallCod/upland-bulk-list/master/bulk-list-items.user.js) above — the manager opens the install screen on its own.
3. Make sure the script is **enabled specifically for `play.upland.me`** — some managers (Violentmonkey included) have a per-site toggle separate from the script's general toggle, found in the extension popup while you're on the game's tab. If the button doesn't show up after installing, this is the most likely reason.
4. The script will auto-update from here on (via `@downloadURL`). To force a manual check, use the refresh button next to the script in your manager's dashboard.

## ⚠️ Requirements (read before using)

- **🌐 Game language set to English.** The script looks for exact text like `"List for sale"`, `"List my ..."`, `"Search"`. If your Upland account is set to another language, the script won't find the buttons and will fail.
- **💰 Pick the currency in the form.** The script supports listing in either UPX or USD — select the right one in the form before running, and it switches the "OFFER TYPE" automatically on the game's screen.
- **🏬 Works in any Showroom with the same layout.** Tested on map assets, structure ornaments, and other categories that follow the same "select → price → confirm" flow.
- **🔗 You understand this lists real items, on the real marketplace.** This is not a simulation. Every unit listed by the script creates a real, irreversible on-chain transaction (you can still remove the listing manually afterward, like any other).

## ▶️ How to use

1. Go to the Showroom in-game, on the home screen (before clicking "List my..." — the script handles that).
2. Click the **"Upland Tools"** button in the bottom-right corner and pick **"Bulk List"** from the menu.
3. Fill in the form: exact item name (as it appears in the list, e.g. `BLUE TARGET MARKER`), currency (UPX or USD), price per unit, and quantity to list.
4. The script checks that the item exists in your Showroom before starting, and shows a confirmation screen with the expected total (plus a warning if the available quantity looks lower than requested).
5. Confirm, and the script runs on its own, listing one unit at a time, with a pause between each to give the transaction time to confirm on-chain.
6. At the end, a summary shows how many units were listed successfully and how many were skipped.

## 🔁 How it handles problems mid-run

- **Server error on a unit (HTTP 4xx/5xx):** retries up to 3 times, with increasing backoff (8s, 16s, 24s, 32s) — momentary Upland server instability is common and usually resolves itself within a few minutes.
- **If the same unit keeps failing** after all retries: the script marks that specific unit (by its MINT#) and skips to the next one, instead of halting the whole run or getting stuck retrying the same problematic unit.
- **If the script loses track of the UI** (an expected button doesn't show up — a sign the game's layout changed or something unexpected happened): the run stops completely and the log shows exactly where.

## 🐛 Reporting a problem

If something goes wrong, you don't need to open a GitHub issue or have an account. Click **"Upland Tools" → "Report Issue"**, describe what happened, and send it. The recent session log gets attached automatically, so the report already arrives with enough technical context to investigate.

If you prefer, you can also [open an issue on GitHub](https://github.com/WallCod/upland-bulk-list/issues) directly.

## 📌 Known limitations

- **Relies on fixed text and selectors from Upland's UI.** If the game updates the Showroom/listing screen layout, the script may stop working until it's updated.
- **Doesn't decide price or quantity for you.** Always check the confirmation screen before accepting.
- **The "how many units exist" check is approximate.** The item list is virtualized (only renders what's near the visible area), so the number shown in the confirmation may be lower than what's actually available.
- **Tested mainly with one account, English language, and one screen resolution.** If you run into different behavior on your setup, use Report Issue or open an issue.

## 🆘 If it gets stuck

The script shows a detailed log in the small box next to the button, and also in the browser Console (F12). If it stops midway, the log shows exactly at which step and why (`item-not-found`, `price-input-not-found`, `submit-rejected`, etc). Check how many items were actually listed in the "FOR SALE" tab before running again, to avoid duplicating.

## ⚖️ Disclaimer

This project is not affiliated with Upland Interactive. Use at your own risk — test with small quantities before running large batches. No account credentials or tokens are used or stored by the script: it only interacts with the page that's already open and logged in in your browser.

## 📄 License

MIT — see [LICENSE](./LICENSE).

## 👤 Author

Made by **[WallCod](https://github.com/WallCod)**.
