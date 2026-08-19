// Base URL of the Cloudflare Worker that backs the storefront.
// After running `wrangler deploy`, replace this with the URL wrangler prints
// (or your custom route, e.g. https://api.southernreignbaseball.com).
window.STORE_API = 'https://southern-reign-store.nicholas-vastano.workers.dev';

// Where parents send payment after ordering. Change `app` to "Cash App" or
// "Zelle" and update `url` if the payment method ever changes.
window.STORE_PAYMENT = {
  app: 'Venmo',
  name: 'Alyssa Kushnir',
  handle: '@alyssakushnir',
  url: 'https://venmo.com/u/alyssakushnir',
};
