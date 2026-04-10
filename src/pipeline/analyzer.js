import axios from 'axios';
import { config } from '../config.js';

const ANGLE_TYPES = ['benefit', 'emotional', 'social_proof', 'urgency', 'storytelling'];

// ── Public API ─────────────────────────────────────────────────

/**
 * Analyze product to extract brand identity using OpenRouter (text-only).
 */
export async function analyzeBrand(product) {
  const imageUrls = (product.top_image_urls || []).slice(0, 3).filter(Boolean);
  if (imageUrls.length > 0) {
    return analyzeBrandWithImages(product, imageUrls);
  }
  return analyzeBrandTextOnly(product);
}

/**
 * Deep product knowledge analysis — USPs, personas, psychology hooks.
 * Mirrors the skill's analyze.js step. Run this before concept generation.
 */
export async function analyzeProductKnowledge(product) {
  const productDataStr = JSON.stringify({
    title: product.title,
    vendor: product.vendor,
    product_type: product.product_type,
    price: product.price,
    price_range: product.price_range,
    tags: product.tags,
    description: product.description.substring(0, 8000),
    variants: product.variants,
    store_domain: product.store_domain,
  }, null, 2).substring(0, 12000);

  const prompt = `You are an expert direct-response advertising strategist and consumer psychologist. Analyze this Shopify product and generate deep, actionable marketing intelligence.

PRODUCT DATA:
${productDataStr}

Return ONLY valid JSON (no markdown):
{
  "product_summary": {
    "name": "...",
    "price": "...",
    "category": "...",
    "one_liner": "One sentence describing what this product does"
  },
  "core_usps": ["USP 1", "USP 2", "USP 3", "USP 4", "USP 5"],
  "target_personas": [
    {
      "id": "persona_1",
      "name": "Persona name",
      "age_range": "25-35",
      "motivations": ["motivation 1", "motivation 2"],
      "pain_points": ["pain 1", "pain 2"],
      "language_style": "How they speak and what resonates"
    },
    { "id": "persona_2", "name": "...", "age_range": "...", "motivations": [], "pain_points": [], "language_style": "..." },
    { "id": "persona_3", "name": "...", "age_range": "...", "motivations": [], "pain_points": [], "language_style": "..." }
  ],
  "psychology_hooks": {
    "scarcity": ["hook 1", "hook 2"],
    "fomo": ["hook 1", "hook 2"],
    "identity": ["hook 1", "hook 2"],
    "social_proof": ["hook 1", "hook 2"],
    "authority": ["hook 1", "hook 2"]
  },
  "emotional_triggers": ["trigger 1", "trigger 2", "trigger 3", "trigger 4", "trigger 5"],
  "power_words": ["word 1", "word 2", "word 3", "word 4", "word 5", "word 6", "word 7", "word 8"],
  "ad_angle_ideas": [
    { "angle_type": "benefit", "angle_subtype": "problem_solution", "title": "...", "hook": "Opening hook line", "target_persona": "persona_1" },
    { "angle_type": "emotional", "angle_subtype": "aspiration", "title": "...", "hook": "...", "target_persona": "persona_2" },
    { "angle_type": "social_proof", "angle_subtype": "testimonial", "title": "...", "hook": "...", "target_persona": "persona_1" },
    { "angle_type": "urgency", "angle_subtype": "scarcity", "title": "...", "hook": "...", "target_persona": "persona_3" },
    { "angle_type": "storytelling", "angle_subtype": "transformation", "title": "...", "hook": "...", "target_persona": "persona_2" }
  ]
}
Generate AT LEAST 20 ad_angle_ideas (4 per angle_type). Return ONLY valid JSON.`;

  const text = await callLLM(prompt, 4000);
  return parseJSON(text, 'product knowledge');
}

/**
 * Generate N ad creative concepts using the brand identity.
 * Batches in groups of 10 to stay within Claude's output token limits.
 */
export async function generateConceptsForBrand(product, brandIdentity, count, productKnowledge = null) {
  const angleAssignments = buildAngleAssignments(count);
  const batches = chunkArray(angleAssignments, 10);
  const allConcepts = [];

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const startIdx = i * 10;
    const batchConcepts = await generateConceptBatch(product, brandIdentity, batch, startIdx, productKnowledge);
    allConcepts.push(...batchConcepts);
  }

  // Re-number IDs sequentially after batching
  return allConcepts.map((c, i) => ({
    ...c,
    id: `creative_${String(i + 1).padStart(3, '0')}`,
  }));
}

// ── Brand analysis ─────────────────────────────────────────────

async function analyzeBrandTextOnly(product) {
  const text = await callLLM(buildBrandTextPrompt(product), 1200);
  return parseJSON(text, 'brand analysis');
}

async function analyzeBrandWithImages(product, imageUrls) {
  const content = [
    { type: 'text', text: buildBrandVisionPrompt(product) },
    ...imageUrls.map(url => ({ type: 'image_url', image_url: { url } })),
  ];
  const text = await callLLM(content, 1200);
  return parseJSON(text, 'brand analysis');
}

function buildBrandVisionPrompt(product) {
  return `You are a brand identity specialist. Analyze the product images provided AND the product details below to extract an accurate visual brand identity.

Product: "${product.title}"
Vendor: ${product.vendor || 'unknown'}
Category: ${product.product_type || 'general'}
Price: ${product.price}
Tags: ${product.tags.slice(0, 10).join(', ') || 'none'}
Description: ${product.description.substring(0, 400)}

Look at the actual product images to extract real brand colors, packaging style, and visual aesthetic. Be precise — extract exact hex codes from what you see.

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
  "product_hero_description": "Describe exactly how the product looks based on the images. 2-3 sentences.",
  "packaging_description": "Describe the actual packaging style visible in the images.",
  "photography_style": "Describe the photography style used in the product images.",
  "brand_personality": "4 personality adjectives derived from the visual identity",
  "dominant_color_mood": "color mood based on the actual colors seen in the images",
  "recommended_ad_backgrounds": ["#HEXCODE", "#HEXCODE", "#HEXCODE"]
}`;
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

async function generateConceptBatch(product, brand, assignments, startIdx, productKnowledge = null) {
  const batchSize = assignments.length;
  const anglesStr = assignments
    .map(a => `${a.index}. angle_type: ${a.angle_type} | creative_type: ${a.creative_type}`)
    .join('\n');

  const prompt = buildConceptsPrompt(product, brand, batchSize, anglesStr, startIdx, productKnowledge);
  const text = await callLLM(prompt, 8000);
  const concepts = parseJSON(text, `concept batch (${startIdx + 1}-${startIdx + batchSize})`);
  return Array.isArray(concepts) ? concepts : [];
}

function buildConceptsPrompt(product, brand, count, anglesStr, startIdx, productKnowledge = null) {
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

  const knowledgeStr = productKnowledge ? `
DEEP PRODUCT INTELLIGENCE (use this to write better hooks, copy, and prompts):
USPs: ${(productKnowledge.core_usps || []).join(' | ')}
Power Words: ${(productKnowledge.power_words || []).join(', ')}
Emotional Triggers: ${(productKnowledge.emotional_triggers || []).join(', ')}
Personas: ${(productKnowledge.target_personas || []).map(p => `${p.name} (${p.age_range}): ${p.language_style}`).join(' | ')}
Psychology Hooks — Scarcity: ${(productKnowledge.psychology_hooks?.scarcity || []).join(', ')}
Psychology Hooks — FOMO: ${(productKnowledge.psychology_hooks?.fomo || []).join(', ')}
Psychology Hooks — Identity: ${(productKnowledge.psychology_hooks?.identity || []).join(', ')}
Suggested Ad Angles: ${(productKnowledge.ad_angle_ideas || []).slice(0, 10).map(a => `[${a.angle_type}] ${a.hook}`).join(' | ')}
` : '';

  return `You are a world-class Meta/Instagram ad creative director specializing in high-converting DTC brand ads.

PRODUCT:
${productStr}
${knowledgeStr}

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

⚠️ PRODUCT FIDELITY RULE — applies to BOTH types:
The image generation model will receive the actual product photo as a reference image.
The generated image MUST show the product looking IDENTICAL to that reference photo.
Same packaging design, same label artwork, same colors, same logo, same text on packaging.
NEVER invent, simplify, or reimagine the product. It must be photo-accurate.
Start every image prompt with: "Using the provided reference image as the exact product — reproduce the product with 100% accuracy, preserving all packaging details, label design, colors, logo, and text exactly as shown."

FOR "product_shot" creative_type — write 180-220 words:
A hyperrealistic commercial product photography brief. MUST include all of:
1. FIDELITY LINE: Start with the fidelity rule above verbatim.
2. SUBJECT: Describe product count/arrangement (e.g., "single can", "three cans grouped") matching ${b.product_hero_description}
3. LIGHTING: Be ultra-specific (e.g., "large 120cm octabox at 45° camera-left, silver V-flat fill at 1:3 ratio, hair light from above-right")
4. BACKGROUND: Use brand background color ${b.brand_colors?.background || '#FFFFFF'} — specify texture/material (e.g., "seamless white paper sweep", "soft warm concrete")
5. COMPOSITION: Specific framing (e.g., "product off-center right at rule-of-thirds, 15° tilt, 30% negative space left for text overlay")
6. COLOR GRADING: Match ${b.dominant_color_mood} palette — "no color grading that alters product colors"
7. SURFACE/PROPS: What the product sits on, minimal accent props matching brand — "props must never obscure product label"
8. FINAL LINE: "Photorealistic commercial photography, Phase One IQ4 150MP, 80mm macro, f/8, ISO 100. Zero digital artifacts. Product label must be sharp and fully legible."

FOR "ad_graphic" creative_type — write 230-270 words:
A complete designed ad layout. MUST include all of:
1. FIDELITY LINE: Start with the fidelity rule above verbatim.
2. CANVAS: "Square 1:1 ad canvas, ${b.recommended_ad_backgrounds?.[0] || b.brand_colors?.background || '#FFFFFF'} background."
3. BACKGROUND: Describe gradient, texture, or pattern using brand colors — must not clash with product
4. PRODUCT PLACEMENT: The EXACT product from reference image, size (e.g., "60% of canvas height"), centered or slightly offset, with soft drop shadow ("12px blur, 20% opacity, 6px down") — product label fully visible and legible
5. HEADLINE TEXT: Exact headline in quotes, font weight (e.g., "Black 68pt sans-serif"), color ${b.brand_colors?.text || '#1A1A1A'}, position (e.g., "upper third, left-aligned, 10% margin")
6. SUBHEADLINE: Exact supporting copy, 60% headline size, same color family, positioned below headline
7. CTA BUTTON: Exact CTA text in quotes, pill-shaped button, background ${b.brand_colors?.accent || b.brand_colors?.primary || '#000000'}, white text, bottom-center, 48px height
8. BRAND MARK: Brand name or logo top-left corner, 8% canvas width
9. OVERALL: "Clean ${b.visual_style} DTC ad. Product is the hero. No clutter. All text legible at mobile size."

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

async function callLLM(promptOrContent, maxTokens = 4096, retries = 4) {
  const timeoutMs = maxTokens >= 6000 ? 150000 : 90000;
  // Accept either a plain string or a structured content array (for vision)
  const content = Array.isArray(promptOrContent)
    ? promptOrContent
    : promptOrContent;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await axios.post(
        `${config.llmBaseUrl}/messages`,
        {
          model: 'claude-sonnet-4-6',
          stream: false,
          messages: [{ role: 'user', content }],
        },
        {
          headers: {
            Authorization: `Bearer ${config.kieAiApiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: timeoutMs,
        },
      );

      // Anthropic messages format: content is an array of blocks
      const text = res.data?.content?.[0]?.text || '';

      if (!text) {
        console.error('[analyzer] Claude Haiku empty response. Raw:', JSON.stringify(res.data).substring(0, 400));
        throw new Error(`Claude Haiku returned empty response. Raw: ${JSON.stringify(res.data).substring(0, 300)}`);
      }
      return text;

    } catch (err) {
      const status = err.response?.status;
      const isRateLimit = status === 429;
      const isServerError = status >= 500;

      if ((isRateLimit || isServerError) && attempt < retries) {
        // Exponential backoff: 5s, 10s, 20s, 40s
        const waitMs = 5000 * Math.pow(2, attempt);
        console.warn(`[analyzer] Claude Haiku ${status} — retrying in ${waitMs / 1000}s (attempt ${attempt + 1}/${retries})`);
        await sleep(waitMs);
        continue;
      }

      throw err;
    }
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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
