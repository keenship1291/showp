import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';
import { config } from '../config.js';

const client = new Anthropic({ apiKey: config.anthropicApiKey });

const ANGLE_TYPES = ['benefit', 'emotional', 'social_proof', 'urgency', 'storytelling'];

// ── Public API ─────────────────────────────────────────────────

/**
 * Analyze product images with Claude Vision to extract brand identity.
 * Falls back to text-only analysis if images cannot be loaded.
 */
export async function analyzeBrand(product) {
  const imageData = await downloadImagesAsBase64(product.top_image_urls.slice(0, 3));

  if (imageData.length > 0) {
    return analyzeBrandWithVision(product, imageData);
  }
  return analyzeBrandTextOnly(product);
}

/**
 * Generate N ad creative concepts using the brand identity.
 * Batches in groups of 10 to stay within Claude's output token limits.
 */
export async function generateConceptsForBrand(product, brandIdentity, count) {
  const angleAssignments = buildAngleAssignments(count);
  const batches = chunkArray(angleAssignments, 10);
  const allConcepts = [];

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const startIdx = i * 10;
    const batchConcepts = await generateConceptBatch(product, brandIdentity, batch, startIdx);
    allConcepts.push(...batchConcepts);
  }

  // Re-number IDs sequentially after batching
  return allConcepts.map((c, i) => ({
    ...c,
    id: `creative_${String(i + 1).padStart(3, '0')}`,
  }));
}

// ── Brand analysis ─────────────────────────────────────────────

async function analyzeBrandWithVision(product, imageData) {
  const content = [
    ...imageData.map(img => ({
      type: 'image',
      source: { type: 'base64', media_type: img.mediaType, data: img.base64 },
    })),
    {
      type: 'text',
      text: buildBrandVisionPrompt(product),
    },
  ];

  const response = await client.messages.create({
    model: config.anthropicModel,
    max_tokens: 1200,
    messages: [{ role: 'user', content }],
  });

  return parseJSON(response.content[0].text, 'brand vision analysis');
}

async function analyzeBrandTextOnly(product) {
  const response = await client.messages.create({
    model: config.anthropicModel,
    max_tokens: 900,
    messages: [{
      role: 'user',
      content: buildBrandTextPrompt(product),
    }],
  });

  return parseJSON(response.content[0].text, 'brand text analysis');
}

function buildBrandVisionPrompt(product) {
  return `You are a brand identity specialist analyzing product images for an ad creative system.

Product: "${product.title}"
Vendor: ${product.vendor || 'unknown'}
Category: ${product.product_type || 'general'}
Price: ${product.price}${product.price_range ? ` (range: ${product.price_range})` : ''}
Tags: ${product.tags.slice(0, 10).join(', ') || 'none'}

Examine all ${product.top_image_urls.length > 1 ? 'images' : 'image'} carefully. Extract the complete visual brand identity.

Return ONLY valid JSON (no markdown, no explanation):
{
  "brand_colors": {
    "primary": "#HEXCODE",
    "secondary": "#HEXCODE",
    "accent": "#HEXCODE",
    "background": "#HEXCODE",
    "text": "#HEXCODE"
  },
  "visual_style": "one of exactly: luxury-minimalist | bold-energetic | warm-organic | clinical-clean | playful-vibrant | rustic-natural | modern-tech | elegant-premium",
  "aesthetic_keywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"],
  "product_hero_description": "Precise visual description of the product — material, finish, shape, dimensions context, distinctive design elements. 3-4 sentences. This is used verbatim in image generation prompts.",
  "packaging_description": "Typography style on label/packaging (serif/sans/script), label colors, logo style, text hierarchy, any embossing/foil/matte effects. 2 sentences.",
  "photography_style": "The exact lighting type, background treatment, shadow style, shooting angle, depth of field. 2 sentences.",
  "brand_personality": "Exactly 4 personality adjectives, comma-separated (e.g. trustworthy, premium, innovative, approachable)",
  "dominant_color_mood": "e.g. warm earthy tones | cool clinical whites | bold high-contrast | soft blush pastels | deep rich jewel tones",
  "recommended_ad_backgrounds": ["#HEX1", "#HEX2", "#HEX3"]
}

Be extremely precise with hex codes — sample from the product surface, label, packaging, and background areas.`;
}

function buildBrandTextPrompt(product) {
  return `You are a brand identity specialist. Infer the visual brand identity from this product's name, vendor, category, price point, and description.

Product: "${product.title}"
Vendor: ${product.vendor || 'unknown'}
Category: ${product.product_type || 'general'}
Price: ${product.price}
Tags: ${product.tags.slice(0, 10).join(', ') || 'none'}
Description: ${product.description.substring(0, 600)}

Return ONLY valid JSON (no markdown):
{
  "brand_colors": {
    "primary": "#HEXCODE",
    "secondary": "#HEXCODE",
    "accent": "#HEXCODE",
    "background": "#FFFFFF",
    "text": "#1A1A1A"
  },
  "visual_style": "one of: luxury-minimalist | bold-energetic | warm-organic | clinical-clean | playful-vibrant | rustic-natural | modern-tech | elegant-premium",
  "aesthetic_keywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"],
  "product_hero_description": "Infer how the product likely looks based on its name and category. 2-3 sentences.",
  "packaging_description": "Infer likely packaging style for this price point and category.",
  "photography_style": "Infer appropriate photography style for this product category.",
  "brand_personality": "4 personality adjectives for this price/category combination",
  "dominant_color_mood": "inferred color mood based on product category and price",
  "recommended_ad_backgrounds": ["#FFFFFF", "#F5F5F5", "#000000"]
}`;
}

// ── Concept generation ─────────────────────────────────────────

function buildAngleAssignments(count) {
  return Array.from({ length: count }, (_, i) => ({
    index: i + 1,
    angle_type: ANGLE_TYPES[i % ANGLE_TYPES.length],
    creative_type: i % 2 === 0 ? 'product_shot' : 'ad_graphic',
  }));
}

async function generateConceptBatch(product, brand, assignments, startIdx) {
  const batchSize = assignments.length;
  const anglesStr = assignments
    .map(a => `${a.index}. angle_type: ${a.angle_type} | creative_type: ${a.creative_type}`)
    .join('\n');

  const prompt = buildConceptsPrompt(product, brand, batchSize, anglesStr, startIdx);

  const response = await client.messages.create({
    model: config.anthropicModel,
    max_tokens: 8192,
    messages: [{ role: 'user', content: prompt }],
  });

  const concepts = parseJSON(response.content[0].text, `concept batch (${startIdx + 1}-${startIdx + batchSize})`);
  return Array.isArray(concepts) ? concepts : [];
}

function buildConceptsPrompt(product, brand, count, anglesStr, startIdx) {
  const b = brand;
  const productStr = JSON.stringify({
    title: product.title,
    vendor: product.vendor,
    price: product.price,
    price_range: product.price_range,
    description: product.description.substring(0, 1500),
    tags: product.tags.slice(0, 15),
    variants: product.variants.slice(0, 5),
    store_domain: product.store_domain,
  }, null, 2);

  return `You are a world-class Meta/Instagram ad creative director specializing in high-converting DTC brand ads.

PRODUCT:
${productStr}

BRAND IDENTITY (use these EXACTLY in every image prompt — do not deviate):
Visual Style: ${b.visual_style}
Primary Color: ${b.brand_colors?.primary || '#000000'}
Secondary Color: ${b.brand_colors?.secondary || '#FFFFFF'}
Accent Color: ${b.brand_colors?.accent || '#888888'}
Background Color: ${b.brand_colors?.background || '#FFFFFF'}
Text Color: ${b.brand_colors?.text || '#1A1A1A'}
Recommended Ad Backgrounds: ${(b.recommended_ad_backgrounds || []).join(', ')}
Aesthetic Keywords: ${(b.aesthetic_keywords || []).join(', ')}
Product Hero: ${b.product_hero_description || 'the product'}
Packaging: ${b.packaging_description || 'clean modern packaging'}
Photography Style: ${b.photography_style || 'clean studio photography'}
Brand Personality: ${b.brand_personality || 'premium, trustworthy'}
Color Mood: ${b.dominant_color_mood || 'clean neutral tones'}

ASSIGNED ANGLES (generate exactly these ${count} concepts in this order):
${anglesStr}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
IMAGE PROMPT REQUIREMENTS — most critical part:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

FOR "product_shot" creative_type — write 180-220 words:
A hyperrealistic commercial product photography brief. MUST include all of:
1. SUBJECT: Use the exact product_hero_description above verbatim, then add relevant prop context
2. LIGHTING: Be ultra-specific (e.g., "large 120cm octabox at 45° camera-left, silver V-flat fill at 1:3 ratio, hair light from above-right")
3. BACKGROUND: Use brand background color ${b.brand_colors?.background || '#FFFFFF'} or a lifestyle context matching ${b.visual_style} — specify texture/material
4. COMPOSITION: Specific framing (e.g., "product off-center right at rule-of-thirds intersection, 15° tilt, 30% negative space left")
5. COLOR GRADING: Match ${b.dominant_color_mood} palette exactly
6. SURFACE/PROPS: What the product sits on, any accent props (matching brand aesthetic, never distracting)
7. FINAL LINE: "Photorealistic commercial photography, Phase One IQ4 150MP camera, 80mm macro lens, f/8, ISO 100, zero digital artifacts."

FOR "ad_graphic" creative_type — write 230-270 words:
A complete designed ad layout brief for an AI image model. MUST include all of:
1. CANVAS: "Square 1:1 ad canvas."
2. BACKGROUND: Exact hex code ${b.recommended_ad_backgrounds?.[0] || b.brand_colors?.primary || '#FFFFFF'} with gradient or texture description
3. PRODUCT PLACEMENT: Size (e.g., "55% of canvas height"), position (e.g., "centered, slightly right of center"), treatment (drop shadow: "soft 20px blur, 30% opacity, offset 8px down", or glow effect)
4. HEADLINE TEXT: Exact ad headline text in quotes, typographic weight (e.g., "Extra-Bold 72pt"), font aesthetic (matching ${b.packaging_description}), color ${b.brand_colors?.text || '#000000'}, position (e.g., "top third, centered, 12% margin sides")
5. SUBHEADLINE/COPY: Exact supporting text, size relative to headline, color, position
6. CTA BUTTON: Exact CTA text, button background ${b.brand_colors?.accent || b.brand_colors?.primary || '#000000'}, text color, corner radius, size, position ("bottom center, 16px from edge")
7. BRAND ELEMENT: Small logo/brand name placement (top-left, 8% canvas width)
8. OVERALL: "Clean premium ${b.visual_style} DTC ad aesthetic. No clutter. Professional print-ready quality."

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Return ONLY a JSON array of exactly ${count} objects (no markdown, no explanation, no trailing commas):
[
  {
    "id": "creative_${String(startIdx + 1).padStart(3, '0')}",
    "angle_type": "benefit",
    "angle_subtype": "problem_solution",
    "creative_type": "product_shot",
    "headline": "Punchy headline, max 8 words",
    "body_copy": "2-3 sentence ad copy in the brand voice. Ends with hook.",
    "cta": "Shop Now",
    "image_prompt": "Full 180-270 word prompt as specified above"
  }
]

Number IDs sequentially from creative_${String(startIdx + 1).padStart(3, '0')}.
Headlines must be under 40 characters. CTA under 20 characters.`;
}

// ── Utilities ──────────────────────────────────────────────────

async function downloadImagesAsBase64(urls) {
  const results = [];
  for (const url of urls) {
    try {
      const res = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 20000,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AdCreativeBot/1.0)' },
        maxContentLength: 10 * 1024 * 1024, // 10MB max per image
      });
      const rawType = res.headers['content-type'] || 'image/jpeg';
      // Claude Vision only accepts these media types
      const mediaType = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
        .find(t => rawType.startsWith(t)) || 'image/jpeg';

      const base64 = Buffer.from(res.data).toString('base64');
      results.push({ base64, mediaType });

      if (results.length >= 3) break; // Claude Vision: max 3 images per call
    } catch (err) {
      console.warn(`[analyzer] Could not download image ${url}: ${err.message}`);
    }
  }
  return results;
}

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

function parseJSON(text, label) {
  // Strip markdown code fences if Claude wrapped the JSON
  text = text.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();

  function extractOuter(str, openCh, closeCh) {
    const start = str.indexOf(openCh);
    if (start === -1) return null;
    let depth = 0, inString = false, escaped = false;
    for (let i = start; i < str.length; i++) {
      const ch = str[i];
      if (escaped) { escaped = false; continue; }
      if (ch === '\\' && inString) { escaped = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === openCh) depth++;
      if (ch === closeCh) { depth--; if (depth === 0) return str.slice(start, i + 1); }
    }
    return null;
  }

  // Try array first (concept batches), then object (brand identity)
  const arrStr = extractOuter(text, '[', ']');
  if (arrStr) { try { return JSON.parse(arrStr); } catch (_) {} }

  const objStr = extractOuter(text, '{', '}');
  if (objStr) { try { return JSON.parse(objStr); } catch (_) {} }

  try { return JSON.parse(text); } catch (e) {
    throw new Error(`Failed to parse ${label} JSON: ${e.message}`);
  }
}
