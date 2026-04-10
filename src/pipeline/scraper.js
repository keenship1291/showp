import axios from 'axios';

// Browser-like headers to avoid blocks from Cloudflare-protected stores
const HTTP_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
};

/**
 * Scrape a Shopify product URL.
 * Strategy order:
 * 1. /products/{handle}.json  (fastest, works on most stores)
 * 2. JSON-LD schema from page HTML (works on stores that block JSON endpoint)
 * 3. Shopify window.__st / meta tags from HTML (last resort)
 */
export async function scrapeShopifyProduct(url) {
  const handle = extractHandle(url);
  if (!handle) throw new Error('URL does not contain a Shopify product handle (/products/...)');

  const origin = new URL(url).origin;

  // Strategy 1: standard Shopify product JSON endpoint
  const jsonProduct = await fetchProductJson(origin, handle);
  if (jsonProduct) return normalizeProduct(jsonProduct, origin);

  // Strategy 2: try myshopify domain for the JSON endpoint
  const myshopify = await resolveMyShopifyDomain(url);
  if (myshopify && myshopify !== origin) {
    const jsonProduct2 = await fetchProductJson(myshopify, handle);
    if (jsonProduct2) return normalizeProduct(jsonProduct2, myshopify);
  }

  // Strategy 3: extract from page HTML (JSON-LD / embedded JSON)
  const htmlProduct = await scrapeFromHtml(url, origin);
  if (htmlProduct) return htmlProduct;

  throw new Error(`Could not fetch product data from: ${url}. The store may block server-side requests.`);
}

// ── Strategy implementations ───────────────────────────────────

async function fetchProductJson(baseUrl, handle) {
  try {
    const res = await axios.get(`${baseUrl}/products/${handle}.json`, {
      headers: { ...HTTP_HEADERS, Accept: 'application/json' },
      timeout: 15000,
    });
    if (res.data?.product) return res.data.product;
  } catch (_) {}
  return null;
}

async function resolveMyShopifyDomain(pageUrl) {
  try {
    const res = await axios.get(pageUrl, {
      headers: HTTP_HEADERS,
      timeout: 12000,
      maxRedirects: 5,
    });
    const match = String(res.data).match(/["']([a-zA-Z0-9-]+\.myshopify\.com)["']/);
    if (match) return `https://${match[1]}`;
  } catch (_) {}
  return null;
}

async function scrapeFromHtml(url, origin) {
  let html;
  try {
    const res = await axios.get(url, {
      headers: HTTP_HEADERS,
      timeout: 20000,
      maxRedirects: 5,
    });
    html = String(res.data);
  } catch (_) {
    return null;
  }

  // Try JSON-LD schema first — most reliable
  const jsonLd = extractJsonLd(html);
  if (jsonLd) return normalizeFromJsonLd(jsonLd, origin);

  // Try embedded Shopify product JSON (window.ShopifyAnalytics or similar)
  const embedded = extractEmbeddedJson(html);
  if (embedded) return normalizeProduct(embedded, origin);

  return null;
}

function extractJsonLd(html) {
  const matches = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const match of matches) {
    try {
      const data = JSON.parse(match[1].trim());
      const items = Array.isArray(data) ? data : [data];
      // Handle @graph arrays
      const allItems = items.flatMap(item => item['@graph'] || [item]);
      const product = allItems.find(item =>
        item['@type'] === 'Product' || item['@type'] === 'product'
      );
      if (product?.name) return product;
    } catch (_) {}
  }
  return null;
}

function extractEmbeddedJson(html) {
  // Some Shopify themes embed product JSON in a script tag
  const patterns = [
    /var\s+meta\s*=\s*(\{[\s\S]*?"product"[\s\S]*?\});/,
    /window\.productJSON\s*=\s*(\{[\s\S]*?\});/,
    /"product"\s*:\s*(\{[\s\S]*?"title"[\s\S]*?\})\s*[,}]/,
  ];
  for (const pattern of patterns) {
    try {
      const match = html.match(pattern);
      if (match) {
        const data = JSON.parse(match[1]);
        if (data.title || data.product?.title) return data.product || data;
      }
    } catch (_) {}
  }
  return null;
}

// ── Normalizers ────────────────────────────────────────────────

function normalizeFromJsonLd(raw, storeUrl) {
  const offers = Array.isArray(raw.offers) ? raw.offers[0] : raw.offers;
  const imgList = Array.isArray(raw.image) ? raw.image : (raw.image ? [raw.image] : []);
  const images = imgList.map(src => ({
    src: typeof src === 'string' ? src : (src.url || src.contentUrl || ''),
    width: 800,
    height: 800,
    alt: raw.name || '',
  })).filter(img => img.src);

  const price = offers?.price ? `$${parseFloat(offers.price).toFixed(2)}` : 'N/A';
  const description = (raw.description || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    title: raw.name || '',
    handle: (raw.name || '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
    vendor: raw.brand?.name || '',
    product_type: raw.category || raw['@type'] || '',
    tags: [],
    store_url: storeUrl,
    store_domain: new URL(storeUrl).hostname,
    description,
    price,
    price_range: null,
    variants: offers ? [{ title: 'Default', price: String(offers.price || ''), sku: '', available: offers.availability !== 'OutOfStock' }] : [],
    images,
    top_image_urls: images.slice(0, 5).map(img => img.src),
    image_count: images.length,
    created_at: null,
  };
}

function normalizeProduct(raw, storeUrl) {
  const images = (raw.images || []).map(img => ({
    src: img.src || '',
    width: img.width || 0,
    height: img.height || 0,
    alt: img.alt || '',
  })).filter(img => img.src);

  const sortedImages = [...images].sort((a, b) => (b.width * b.height) - (a.width * a.height));

  const variants = raw.variants || [];
  const prices = variants.map(v => parseFloat(v.price)).filter(p => !isNaN(p) && p > 0);
  const minPrice = prices.length ? Math.min(...prices) : null;
  const maxPrice = prices.length ? Math.max(...prices) : null;

  const description = (raw.body_html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    title: raw.title || '',
    handle: raw.handle || '',
    vendor: raw.vendor || '',
    product_type: raw.product_type || '',
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    store_url: storeUrl,
    store_domain: new URL(storeUrl).hostname,
    description,
    price: minPrice ? `$${minPrice.toFixed(2)}` : 'N/A',
    price_range: (minPrice && maxPrice && minPrice !== maxPrice)
      ? `$${minPrice.toFixed(2)} – $${maxPrice.toFixed(2)}`
      : null,
    variants: variants.slice(0, 10).map(v => ({
      title: v.title,
      price: v.price,
      sku: v.sku || '',
      available: v.available !== false,
    })),
    images: sortedImages,
    top_image_urls: sortedImages
      .filter(img => img.width >= 600 || img.width === 0)
      .slice(0, 5)
      .map(img => img.src),
    image_count: images.length,
    created_at: raw.created_at || null,
  };
}

function extractHandle(url) {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    const idx = parts.indexOf('products');
    if (idx !== -1 && parts[idx + 1]) return parts[idx + 1].split('?')[0];
  } catch (_) {}
  return null;
}
