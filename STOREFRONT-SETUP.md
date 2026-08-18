# Team Store — Setup

The storefront is **not linked from the site nav**. It lives at:

- Store: `https://www.southernreignbaseball.com/store.html`
- Admin: `https://www.southernreignbaseball.com/store-admin.html`

Both pages are `noindex, nofollow` so search engines skip them. They're unlisted, not
secret — anyone with the URL can view the store. The admin page requires a password.

## How it fits together

```
store.html / store-admin.html      Cloudflare Worker            Google Sheet
   (GitHub Pages, static)   ──►   (holds all secrets)   ──►   Products + Orders
```

The browser never sees the Google credentials or the admin password — only the Worker does.

---

## 1. Create the Google Sheet

Make a new sheet with **two tabs**, named exactly `Products` and `Orders`.

**`Products` tab — row 1 is headers:**

| A | B | C | D | E | F | G | H | I |
|---|---|---|---|---|---|---|---|---|
| id | name | description | category | price | image | sizes | colors | active |

Leave `id` blank for new rows — the admin page fills it in. `sizes` and `colors` are
comma-separated (`YS, YM, YL, S, M, L`). `active` is `TRUE` or `FALSE`.

**`Orders` tab — row 1 is headers:**

| A | B | C | D | E | F | G | H | I | J | K | L | M | N |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| order_id | timestamp | parent_name | email | phone | player_name | item | size | color | qty | unit_price | line_total | notes | status |

Grab the Sheet ID from its URL:
`https://docs.google.com/spreadsheets/d/`**`THIS_PART`**`/edit`

## 2. Create a Google service account

1. Go to [console.cloud.google.com](https://console.cloud.google.com) → create or pick a project.
2. **APIs & Services → Library** → enable **Google Sheets API**.
3. **APIs & Services → Credentials → Create Credentials → Service account**. Name it
   anything (e.g. `southern-reign-store`).
4. Open the service account → **Keys → Add Key → Create new key → JSON**. Download it.
5. Open the JSON. You need two values: `client_email` and `private_key`.
6. **Share the Google Sheet with the `client_email` address, giving it Editor access.**
   This step is easy to forget and nothing works without it.

## 3. Deploy the Worker

```bash
cd worker
npm install -g wrangler      # if you don't have it
wrangler login
```

Edit `wrangler.toml` and set `SHEET_ID` to your sheet's ID.

Then set the four secrets:

```bash
wrangler secret put ADMIN_PASSWORD     # the store admin password
wrangler secret put SESSION_SECRET     # any long random string
wrangler secret put GOOGLE_SA_EMAIL    # client_email from the JSON
wrangler secret put GOOGLE_SA_KEY      # private_key from the JSON (paste the whole thing)
```

For `SESSION_SECRET`, generate something random:
```bash
openssl rand -base64 32
```

Deploy:
```bash
wrangler deploy
```

Wrangler prints a URL like `https://southern-reign-store.your-name.workers.dev`.

## 4. Point the site at the Worker

Edit `store-config.js` and replace the placeholder with that URL:

```js
window.STORE_API = 'https://southern-reign-store.your-name.workers.dev';
```

Commit and push. That's it.

## 5. Add products

Go to `/store-admin.html`, sign in with `ADMIN_PASSWORD`, and add products in the
Products tab. Click **Save Changes** and they appear on the store immediately.

For product photos, click **Upload** in the Image column and pick a file from your
computer. You can also paste a URL, or use a repo path like `assets/gear-hoodie.jpg`
for images committed to the site.

## Product image uploads

Uploaded images are stored in a Cloudflare KV namespace and served back by the Worker.
Create it once:

```bash
wrangler kv namespace create IMAGES
```

Paste the printed id into the `kv_namespaces` block in `wrangler.toml` (uncomment it)
and redeploy. In the dashboard instead: **Storage & Databases → KV → Create**, name it
`store-images`, then on the Worker go to **Settings → Bindings → Add → KV namespace**
with the variable name **`IMAGES`**.

Limits: JPG, PNG, WebP, and GIF up to 5 MB each. Uploads require an admin session.
Images are served from `/api/images/<id>` with a one-year immutable cache — every
upload gets a fresh id, so replacing a photo never serves a stale one.

Until the namespace is bound, the Upload button reports that uploads aren't configured
and the URL field keeps working as before.

---

## Giving someone else admin access

Share the admin URL and the password. Everyone shares one password — to revoke access,
change it with `wrangler secret put ADMIN_PASSWORD` and redeploy.

If you'd rather each person had their own login, that's a bigger change (real user
accounts) and worth doing only if one shared password becomes a problem.

## Where the orders go

Every submitted order appends **one row per line item** to the `Orders` tab, grouped by
an `order_id` like `SR-M2K4X9A`. Filter or sort that tab and hand it straight to your
producer, or use **Download CSV** on the admin Orders tab.

## Security notes

- Prices come from the Sheet, never from the browser — a parent can't edit a price in
  devtools and submit a cheaper order.
- Submitted text is prefixed if it starts with `=`, `+`, `-`, or `@` so nobody can
  inject a formula into your Sheet.
- Admin sessions are signed tokens that expire after 8 hours.
- CORS is locked to the two site origins listed in `wrangler.toml`.

## Making the store public later

When you're ready, add this to the `<ul id="navLinks">` block in each HTML page:

```html
<li><a href="store.html">Store</a></li>
```

and remove the `noindex` meta tag from `store.html`.
