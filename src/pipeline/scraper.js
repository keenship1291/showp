import axios from 'axios';

const HTTP_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; AdCreativeBot/1.0)',
  'Accept': 'application/json, text/html',
};

/**
 * Scrape a Shopify product URL and return a normalized product object.
 * Tries the product's own domain first, then resolves the myshopify domain as fallback.
 */
export async function scrapeShopifyProduct(url) {
  const handle = extractHandle(url);
  if (!handle) throw new Error('URL does not contain a Shopify product handle (/products/...)');

  const origin = new URL(url).origin;
  const origins = [origin];

  const myshopify = await resolveMyShopifyDomain(url);
  if (myshopify && myshopify !== origin) origins.push(myshopify);

  for (const base of origins) {
    const product = await fetchProductJson(base, handle);
    if (product) return normalizeProduct(product, base);
  }

  throw new Error(`Could not fetch Shopify product JSON for: ${url}`);
}

// ── Helpers ────────────────────────────────────────────────────

function extractHandle(url) {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    const idx = parts.indexOf('products');
    if (idx !== -1 && parts[idx + 1]) return parts[idx + 1].split('?')[0];
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

async function fetchProductJson(baseUrl, handle) {
  try {
    const res = await axios.get(`${baseUrl}/products/${handle}.json`, {
      headers: HTTP_HEADERS,
      timeout: 15000,
    });
    if (res.data?.product) return res.data.product;
  } catch (_) {}
  return null;
}

function normalizeProduct(raw, storeUrl) {
  const images = (raw.images || []).map(img => ({
    src: img.src || '',
    width: img.width || 0,
    height: img.height || 0,
    alt: img.alt || '',
  })).filter(img => img.src);

  // Sort highest resolution first — these are the most useful for brand analysis
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
    // Top image URLs passed to Claude Vision and Kie.ai as reference images
    // Filter for reasonably high-res images (≥600px wide) to give Claude good detail
    top_image_urls: sortedImages
      .filter(img => img.width >= 600 || img.width === 0)
      .slice(0, 5)
      .map(img => img.src),
    image_count: images.length,
    created_at: raw.created_at || null,
  };
}
