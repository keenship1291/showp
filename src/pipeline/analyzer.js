import axios from 'axios';
import { config } from '../config.js';

const ANGLE_TYPES = [
  'benefit',
  'emotional',
  'social_proof',
  'urgency',
  'storytelling',
  'testimonial_ugc',
  'review_card',
  'stat_callout',
  'comparison_table',
  'us_vs_them',
];

// Maps each user-facing outcome to the 4 angle types used for concept generation
const OUTCOME_ANGLES = {
  highlight_benefits: ['benefit', 'stat_callout', 'comparison_table', 'emotional'],
  build_trust:        ['social_proof', 'testimonial_ugc', 'review_card', 'stat_callout'],
  crush_competitors:  ['comparison_table', 'us_vs_them', 'benefit', 'stat_callout'],
  show_results:       ['storytelling', 'stat_callout', 'testimonial_ugc', 'benefit'],
  drive_sales:        ['urgency', 'benefit', 'emotional', 'social_proof'],
  stop_scroll:        ['emotional', 'storytelling', 'urgency', 'benefit'],
};

// Full goal context injected into the concept prompt so the LLM aligns
// copy tone, hooks, image style, and CTA direction to the merchant's goal.
const OUTCOME_CONTEXT = {
  highlight_benefits: {
    label: 'HIGHLIGHT PRODUCT BENEFITS (Feature Breakdown)',
    directive: `The merchant's goal is to clearly communicate what this product does and why those features matter.
Every concept must:
- Lead with a specific, tangible benefit or feature — not vague praise
- Use copy that educates and excites: "Here's exactly what you get"
- Image style: clean, product-forward, features annotated or demonstrated
- Headlines should name the benefit directly (e.g. "Zero Waste. Zero Guilt.")
- Primary text should spell out the key advantage in plain language
- CTAs: "See How It Works", "Shop Features", "Learn More"`,
  },
  build_trust: {
    label: 'BUILD CUSTOMER TRUST (Community & Social Proof)',
    directive: `The merchant's goal is to make new customers feel safe buying — using real people, reviews, and community.
Every concept must:
- Lean heavily on social proof signals: star ratings, customer quotes, community size, verified reviews
- Copy tone: warm, relatable, peer-to-peer — NOT corporate
- Image style: authentic UGC aesthetic, real customer faces/quotes, review cards
- Headlines should reflect customer voice (e.g. "10,000+ Happy Customers")
- Primary text should include a real-sounding testimonial or aggregate stat
- CTAs: "Join the Community", "See Reviews", "Try Risk-Free"`,
  },
  crush_competitors: {
    label: 'CRUSH COMPETITORS (Compare Solutions)',
    directive: `The merchant's goal is to show why this product wins vs. alternatives — direct, confident, comparative.
Every concept must:
- Draw a clear contrast between this product and "the old way" or competitors
- Copy tone: bold, confident, slightly provocative — "Why settle for less?"
- Image style: comparison tables, side-by-side visuals, "us vs them" splits
- Headlines should set up the contrast (e.g. "Other Brands Guess. We Guarantee.")
- Primary text should name a specific shortcoming of alternatives and flip it
- CTAs: "See the Difference", "Compare Now", "Switch Today"`,
  },
  show_results: {
    label: 'SHOW REAL RESULTS (Transformations)',
    directive: `The merchant's goal is to prove the product works by showing before/after outcomes and real transformations.
Every concept must:
- Make the result the hero — lead with the outcome, not the product
- Copy tone: aspirational but grounded — "Real people, real results"
- Image style: transformation visuals, bold result stats, before/after layouts
- Headlines should state the transformation (e.g. "From Struggling to Thriving")
- Primary text should describe a specific, believable result
- CTAs: "Get Your Results", "Start Your Transformation", "See It Work"`,
  },
  drive_sales: {
    label: 'DRIVE IMMEDIATE SALES (Promote an Offer)',
    directive: `The merchant's goal is to convert right now — urgency, scarcity, and an irresistible offer are the levers.
Every concept must:
- Create a sense of urgency or scarcity: limited time, limited stock, exclusive deal
- Copy tone: direct, punchy, action-oriented — every word earns its place
- Image style: bold price callouts, countdown energy, offer badges, high contrast
- Headlines should trigger FOMO (e.g. "Sale Ends Tonight", "Only 12 Left")
- Primary text should state the offer clearly with a reason to act NOW
- CTAs: "Grab the Deal", "Shop Now — Ends Soon", "Claim Your Discount"`,
  },
  stop_scroll: {
    label: 'STOP THE SCROLL (Create Curiosity)',
    directive: `The merchant's goal is pattern interruption — these ads must be impossible to scroll past.
Every concept must:
- Open with a hook that creates an open loop or curiosity gap — the viewer MUST know more
- Copy tone: unexpected, slightly provocative, conversational — like a friend texting you
- Image style: bold, unexpected compositions, strong contrast, visual tension or surprise
- Headlines should be a question, bold claim, or unfinished thought (e.g. "You've been doing it wrong.")
- Primary text should deepen the curiosity without giving everything away
- CTAs: "Find Out Why", "See For Yourself", "Discover the Secret"`,
  },
};

const ASPECT_RATIO_LABELS = {
  '1:1':  'Square 1:1',
  '9:16': 'Vertical 9:16 (Story/Reel)',
  '16:9': 'Landscape 16:9',
  '4:5':  'Portrait 4:5 (Feed)',
};

// ── Phase 2: Product Knowledge Analysis ────────────────────────
// Mirrors skill's analyze.js — runs LLM on product data to extract
// USPs, personas, psychology hooks, and ad angle pool.
// `count` controls how many ad_angle_ideas to generate (saves tokens on free model).

export async function analyzeProductKnowledge(product, count) {
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
  }, null, 2).substring(0, 15000);

  // Distribute angles evenly across the 10 types — at least 1 per type, total = count
  const angleCount = Math.max(count, 10);
  const perType = Math.ceil(angleCount / 10);

  const prompt = `You are an expert direct-response advertising strategist and consumer psychologist. Analyze this Shopify product data and generate deep, actionable marketing intelligence.

STRICT RULE — NO HALLUCINATION:
Only extract facts, claims, and attributes that are explicitly stated or strongly implied by the product data above.
Do NOT invent: customer counts, review numbers, certifications, partnerships, awards, causes (e.g. military support, charity donations), or any specific statistics unless they appear in the product data.
If a field has no factual basis from the data, write a general truthful statement or leave it as an empty array — never fabricate.

PRODUCT DATA:
${productDataStr}

Generate a comprehensive product knowledge JSON with this EXACT structure:
{
  "product_summary": {
    "name": "...",
    "price": "...",
    "category": "...",
    "one_liner": "One sentence describing what this product does"
  },
  "core_usps": [
    "USP 1 - specific and compelling",
    "USP 2",
    "USP 3",
    "USP 4",
    "USP 5"
  ],
  "target_personas": [
    {
      "id": "persona_1",
      "name": "Persona name (e.g. Busy Mom Sarah)",
      "age_range": "25-35",
      "motivations": ["motivation 1", "motivation 2"],
      "pain_points": ["pain 1", "pain 2"],
      "language_style": "How they speak and what resonates"
    },
    {
      "id": "persona_2",
      "name": "...",
      "age_range": "...",
      "motivations": [],
      "pain_points": [],
      "language_style": "..."
    },
    {
      "id": "persona_3",
      "name": "...",
      "age_range": "...",
      "motivations": [],
      "pain_points": [],
      "language_style": "..."
    }
  ],
  "psychology_hooks": {
    "scarcity": ["hook 1", "hook 2"],
    "fomo": ["hook 1", "hook 2"],
    "identity": ["hook 1", "hook 2"],
    "social_proof": ["hook 1", "hook 2"],
    "authority": ["hook 1", "hook 2"]
  },
  "emotional_triggers": [
    "trigger 1",
    "trigger 2",
    "trigger 3",
    "trigger 4",
    "trigger 5"
  ],
  "competitor_positioning": {
    "likely_alternatives": ["alternative 1", "alternative 2"],
    "key_differentiators": ["differentiator 1", "differentiator 2"],
    "positioning_statement": "Why this beats alternatives"
  },
  "market_trends": [
    "trend 1 this product fits",
    "trend 2",
    "trend 3"
  ],
  "power_words": [
    "word/phrase 1",
    "word/phrase 2",
    "word/phrase 3",
    "word/phrase 4",
    "word/phrase 5",
    "word/phrase 6",
    "word/phrase 7",
    "word/phrase 8"
  ],
  "ad_angle_ideas": [
    {
      "angle_type": "benefit",
      "angle_subtype": "problem_solution",
      "title": "Angle title",
      "hook": "Opening hook line",
      "target_persona": "persona_1"
    },
    {
      "angle_type": "emotional",
      "angle_subtype": "aspiration",
      "title": "Angle title",
      "hook": "Opening hook line",
      "target_persona": "persona_2"
    },
    {
      "angle_type": "social_proof",
      "angle_subtype": "aggregate_proof",
      "title": "Angle title",
      "hook": "Opening hook line",
      "target_persona": "persona_1"
    },
    {
      "angle_type": "urgency",
      "angle_subtype": "scarcity",
      "title": "Angle title",
      "hook": "Opening hook line",
      "target_persona": "persona_3"
    },
    {
      "angle_type": "storytelling",
      "angle_subtype": "transformation",
      "title": "Angle title",
      "hook": "Opening hook line",
      "target_persona": "persona_2"
    },
    {
      "angle_type": "testimonial_ugc",
      "angle_subtype": "customer_quote",
      "title": "Angle title",
      "hook": "Real customer voice hook",
      "target_persona": "persona_1"
    },
    {
      "angle_type": "review_card",
      "angle_subtype": "star_review",
      "title": "Angle title",
      "hook": "5-star review excerpt hook",
      "target_persona": "persona_2"
    },
    {
      "angle_type": "stat_callout",
      "angle_subtype": "bold_number",
      "title": "Angle title",
      "hook": "Striking statistic or result hook",
      "target_persona": "persona_3"
    },
    {
      "angle_type": "comparison_table",
      "angle_subtype": "feature_matrix",
      "title": "Angle title",
      "hook": "Side-by-side comparison hook",
      "target_persona": "persona_1"
    },
    {
      "angle_type": "us_vs_them",
      "angle_subtype": "direct_competitor",
      "title": "Angle title",
      "hook": "Why we win vs the alternative",
      "target_persona": "persona_2"
    }
  ]
}

Generate AT LEAST ${angleCount} ad_angle_ideas total (${perType} per angle_type: benefit, emotional, social_proof, urgency, storytelling, testimonial_ugc, review_card, stat_callout, comparison_table, us_vs_them).
Return ONLY valid JSON, no markdown fences, no explanation.`;

  const text = await callLLM(prompt, 4000);
  return parseJSON(text, 'product knowledge');
}

// ── Phase 3: Creative Concept Generation ───────────────────────
// Mirrors skill's concepts.js — generates exactly `count` ad_graphic concepts.
// Uses the skill's exact prompt format for superior output quality.

export async function generateConceptsForBrand(product, knowledge, count, aspectRatio = '1:1', outcome = 'highlight_benefits') {
  const indices = Array.from({ length: count }, (_, i) => i);
  const batches = chunkArray(indices, 10);
  const allConcepts = [];

  for (let b = 0; b < batches.length; b++) {
    const startIdx = b * 10;
    const batchSize = batches[b].length;
    const batchConcepts = await generateConceptBatch(knowledge, batchSize, startIdx, aspectRatio, outcome);
    allConcepts.push(...batchConcepts);
  }

  // Re-number IDs sequentially after batching
  return allConcepts.map((c, i) => ({
    ...c,
    id: `creative_${String(i + 1).padStart(3, '0')}`,
    creative_type: 'ad_graphic',
  }));
}

async function generateConceptBatch(knowledge, count, startIdx, aspectRatio, outcome = 'highlight_benefits') {
  const canvasLabel = (ASPECT_RATIO_LABELS[aspectRatio] || aspectRatio) + ' ad canvas';

  const outcomeAngles = OUTCOME_ANGLES[outcome] || OUTCOME_ANGLES.highlight_benefits;
  const anglesStr = Array.from({ length: count }, (_, i) => {
    const angleType = outcomeAngles[(startIdx + i) % outcomeAngles.length];
    return `${startIdx + i + 1}. angle_type: ${angleType}`;
  }).join('\n');

  const knowledgeStr = knowledge ? JSON.stringify(knowledge, null, 2).substring(0, 12000) : '{}';
  const outcomeCtx = OUTCOME_CONTEXT[outcome] || OUTCOME_CONTEXT.highlight_benefits;

  const prompt = `You are an expert Meta/Facebook ad creative director and graphic designer. Using the product knowledge below, generate exactly ${count} ad creative concepts.

CAMPAIGN GOAL: ${outcomeCtx.label}
${outcomeCtx.directive}

STRICT RULE — FACTS ONLY, NO HALLUCINATION:
Every claim in headline, primary_text, image_text_overlay, and image_prompt MUST be grounded in the product knowledge provided.
NEVER invent: specific review counts ("10,000+ reviews"), star ratings, customer testimonials, certifications, partnerships, causes (charity, military, etc.), awards, or statistics that are not present in the product knowledge.
If writing a testimonial-style or social-proof angle and no real reviews exist in the data, write a believable but clearly general statement — do NOT fabricate a specific person, quote, or number.
Treat unverified superlatives ("best", "#1", "proven") with caution — only use them if the product data supports it.

PRODUCT KNOWLEDGE:
${knowledgeStr}

Requirements:
- The CAMPAIGN GOAL above is the north star — every concept (copy, image, tone, CTA) must serve it
- All claims must be grounded in the product knowledge above — no invented facts
- Follow these assigned angles exactly (in order):
${anglesStr}
- Each concept must be unique with a different hook/angle
- headline: under 40 characters, ideally ~27 chars — punchy Facebook feed headline
- primary_text: under 125 characters — the Meta Ads "Primary Text" caption that appears above the ad; direct, conversational, no truncation on mobile
- image_text_overlay: exactly 3–5 punchy words shown as the hero text ON the image itself (e.g. "Stop Wasting Your Time", "Finally. Real Results.")
- ALL concepts must be "ad_graphic" type (full designed ad)

IMAGE PROMPT RULES — this is the most important part:

CRITICAL: The product is "${knowledge?.product_summary?.name || 'the product'}". You MUST refer to it by this exact name and product type in every image prompt. Never substitute a different product type (e.g. do NOT call a cup a bottle, do NOT call a mug a jar).

Describe a COMPLETE designed ad graphic exactly as it should look on a ${canvasLabel} — as if briefing a designer. Always include:
1. BACKGROUND: color, gradient, or texture (e.g. "warm cream linen background #F5F0E8")
2. PRODUCT PLACEMENT: where the ${knowledge?.product_summary?.name || 'product'} sits, angle, size, any shadow/glow. ALWAYS name the product correctly.
3. HEADLINE TEXT: exact text, font style, color, position
4. CTA ELEMENT: button or badge with exact text, colors, position
5. OVERALL STYLE: e.g. "clean DTC brand aesthetic", "bold high-contrast performance"

Then apply these ANGLE-SPECIFIC layout rules:

- testimonial_ugc: Design as a UGC-style ad. Show a raw, authentic customer photo or selfie context in the background. Overlay a speech-bubble or caption card with a real-sounding customer quote in conversational language. Include the customer's first name and a small avatar or profile photo element. Feels organic, not polished.

- review_card: Design as a review screenshot card. Show a styled card with 5 gold stars at the top, a 2-3 sentence verified review quote in quotation marks, reviewer name and location below, and the product image small in the corner. Clean white card on colored background.

- stat_callout: Lead with ONE massive bold statistic (e.g. "97%", "2x faster", "10,000+ sold") as the hero element — huge numerals dominating the canvas. Supporting micro-copy explains the stat. Minimal design, maximum impact. Product image secondary.

- comparison_table: Design a clean 2-column comparison table. Left column header = "Others" (with ✗ marks for missing features). Right column header = product name (with ✓ checkmarks for each feature). 4-5 rows of features. Bold border or highlight on the product column. Product image above or beside the table.

- us_vs_them: Split the canvas into two halves. Left side = dull/grey/frustrated scenario without the product. Right side = vibrant/bright/happy scenario with the product. A bold dividing line or "VS" badge in the center. Product image featured prominently on the right side.

Be extremely specific. This prompt goes directly to an AI image model. 200-300 words.

Return a JSON array of exactly ${count} objects with this structure:
[
  {
    "id": "creative_${String(startIdx + 1).padStart(3, '0')}",
    "angle_type": "benefit",
    "angle_subtype": "problem_solution | aspiration | aggregate_proof | scarcity | transformation | customer_quote | star_review | bold_number | feature_matrix | direct_competitor",
    "creative_type": "ad_graphic",
    "headline": "Under 40 chars, ideally ~27 — Facebook feed headline",
    "primary_text": "Under 125 chars — Meta Ads primary text caption, no truncation",
    "image_text_overlay": "3-5 punchy words for hero text ON the image",
    "cta": "Shop Now",
    "image_prompt": "Full detailed prompt as described above. MUST include the image_text_overlay text as the large hero text prominently displayed on the image.",
    "target_persona": "persona_1"
  }
]

Number IDs sequentially from creative_${String(startIdx + 1).padStart(3, '0')}.
Return ONLY valid JSON array, no markdown fences, no explanation.`;

  const text = await callLLM(prompt, 8000);
  const concepts = parseJSON(text, `concept batch ${startIdx + 1}–${startIdx + count}`);
  return Array.isArray(concepts) ? concepts : [];
}

// ── LLM client (OpenRouter — OpenAI-compatible format) ──────────

async function callLLM(prompt, maxTokens = 4096, retries = 4) {
  const timeoutMs = maxTokens >= 6000 ? 150000 : 90000;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await axios.post(
        `${config.llmBaseUrl}/chat/completions`,
        {
          model: config.llmModel,
          max_tokens: maxTokens,
          messages: [{ role: 'user', content: prompt }],
        },
        {
          headers: {
            Authorization: `Bearer ${config.openRouterApiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': config.imageBaseUrl || 'https://localhost',
            'X-Title': 'Ad Creative Generator',
          },
          timeout: timeoutMs,
        },
      );

      const text = res.data?.choices?.[0]?.message?.content || '';
      if (!text) {
        throw new Error(`LLM returned empty response. Raw: ${JSON.stringify(res.data).substring(0, 300)}`);
      }
      return text;

    } catch (err) {
      const status = err.response?.status;
      const isRateLimit = status === 429;
      const isServerError = status >= 500;

      if ((isRateLimit || isServerError) && attempt < retries) {
        const waitMs = 5000 * Math.pow(2, attempt);
        console.warn(`[analyzer] LLM ${status} — retrying in ${waitMs / 1000}s (attempt ${attempt + 1}/${retries})`);
        await sleep(waitMs);
        continue;
      }

      throw err;
    }
  }
}

// ── Utilities ──────────────────────────────────────────────────

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
  // Strip markdown code fences if the LLM wrapped the JSON
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

  // Try array first (concept batches), then object (product knowledge)
  const arrStr = extractOuter(text, '[', ']');
  if (arrStr) { try { return JSON.parse(arrStr); } catch (_) {} }

  const objStr = extractOuter(text, '{', '}');
  if (objStr) { try { return JSON.parse(objStr); } catch (_) {} }

  try { return JSON.parse(text); } catch (e) {
    throw new Error(`Failed to parse ${label} JSON: ${e.message}`);
  }
}
