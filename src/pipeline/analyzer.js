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

// Per-angle image layout templates. Two options per angle — LLM picks the best fit
// for the specific concept and fills every [PLACEHOLDER] with real product data.
const ANGLE_IMAGE_TEMPLATES = {
  benefit: `
TEMPLATE A — Features/Benefits Point-Out (Educational diagram style):
Use the attached product images as brand reference. Create: an educational diagram-style ad on white background. Top: bold [BRAND COLOR] text "[HEADER like What Makes [PRODUCT] Different]". Below: [PRODUCT] centered, even studio lighting. Four callout boxes with connecting lines: "[BENEFIT 1–4 from product USPs]". Each has a small [BRAND COLOR] circle. "[WEBSITE/DOMAIN]" bottom center. [BRAND] logo bottom right. Scientific diagram redesigned by a luxury agency.

TEMPLATE B — Feature Arrow Callout / Product Annotation:
Use the attached product images as brand reference. Create: a product annotation ad on a [warm cream/light background matching brand] background. Top: italic serif headline "[BENEFIT STATEMENT from product USPs]" in [BRAND COLOR]. Below in massive bold sans-serif: "[VALUE PROP — 2-4 words]". Center: [PERSON'S HAND] holding [PRODUCT] at a natural angle. Four curved arrows in [BRAND COLOR] pointing from the product outward to four benefit callout labels arranged around it: "[CALLOUT 1–4 from product features]". Arrows feel hand-drawn or editorial. Bottom: full-width [CONTRAST COLOR] banner with promo/claim text in bold.

TEMPLATE C — Faux iPhone Notes / App Screenshot (Educational benefit list):
Use the attached product images as brand reference. Create: a static ad disguised as an iPhone Notes app screenshot. Top: realistic iOS status bar (time, signal bars, wifi, battery). Below: iOS Notes navigation — blue "< All iCloud" back arrow left, share icon and three-dot menu right. Below nav: small gray timestamp. Main content area on white: bold black serif headline "[HEADLINE — In Just [USAGE] / What [PRODUCT] Does In [TIMEFRAME]]". Below: [3–4 BENEFIT ROWS], each with a [BRAND COLOR] filled circle checkmark + [RELEVANT EMOJI] + bold black text using equivalency or plain-language format: "[BENEFIT 1 from product USPs]" / "[BENEFIT 2]" / "[BENEFIT 3]" / "[BENEFIT 4]". Right side, overlapping the benefit text slightly: [PRODUCT] at a slight angle with [DETAIL like key ingredients or product contents] spilling at the base. Product casually placed into the note layout, breaking the frame slightly. Clean white background throughout.

Pick whichever template best suits this concept's angle_subtype. Fill ALL placeholders with real product data.`,

  emotional: `
TEMPLATE A — Bold Statement / Reaction Headline:
Use the attached product images as brand reference. Create: a static ad on a vibrant [gradient matching brand — e.g. coral-pink to golden-yellow OR brand primary to secondary] gradient background, flowing diagonally. Upper left: oversized playful [rounded retro font style] headline in white reading "[BOLD PROVOCATIVE STATEMENT — emotional, under 10 words, no asterisks]". Right side: [PERSON'S HAND or LIFESTYLE ACTION] interacting with [PRODUCT]. Product sits center-right. Bottom left: [BRAND] logo with "[SHORT PRODUCT DESCRIPTOR]" below. No stats, no badges. The gradient and the headline do all the work.

TEMPLATE B — Negative Marketing / Bait & Switch (Scroll-stopper):
Use the attached product images as brand reference. Create: background is close-up of [PRODUCT], slightly blurred. Center: white rounded-rectangle review card (platform-style). Gray user icon, "[REVIEWER NAME]", one gold star + four gray, orange "Verified Purchase" badge, bold text: "[BAIT HEADLINE — sounds negative but is actually a rave, e.g. 'I'm FURIOUS this worked so fast']". Bottom: bold white sans-serif "[PUNCHLINE — 4–6 words, punchy]". [BRAND] logo bottom right.

TEMPLATE C — Curiosity Gap / Scroll-Stopper Hook (No product visible):
Do NOT include any product, logo, or branding. Create: a scroll-stopping curiosity ad designed to look like a truncated social media post. Top 35%: clean white background with large bold black sans-serif text (heavy weight, tight leading): "[HOOK HEADLINE — Most [TARGET PERSONA] don't realize THIS is why [PAIN POINT related to product category]... but did you know]". The last few words followed by "...more" in lighter gray text, mimicking a truncated caption requiring a click to expand. Bottom 65%: a close-up, slightly uncomfortable or attention-grabbing editorial photo of [PROBLEM VISUAL — the specific physical symptom or struggle the product solves, shown on subject, no product]. Slightly shallow depth of field, real and editorial — not stock. No text on photo. No CTA. The entire purpose is to provoke curiosity and earn the click.

Pick whichever template best suits this concept's angle_subtype. Fill ALL placeholders with real product data.`,

  social_proof: `
TEMPLATE A — Social Proof Stack (Trust + Community):
Use the attached product images as brand reference. Create: a social proof ad on [warm cream or brand-light background]. Top: "[HEADLINE — Join X+ Members / Trusted by X / Rated #1 for X]" in bold [BRAND COLOR]. Five filled stars with "Rated [X] out of 5". Center: [PRODUCT] at 50mm f/4. Below: frosted white card with five-star rating, "[REVIEW TITLE]", "[2–3 sentence review]", "[REVIEWER ATTRIBUTION]" in italic. Below card: "As Seen In" or "As Featured In" with five grayscale publication/media logo placeholders. [BRAND] logo bottom right.

TEMPLATE B — Faux Press / News Article Screenshot:
Use the attached product images as brand reference. Create: a static ad designed to look like a real online news article screenshot. Top 25%: white background with a realistic publication masthead in large bold black serif text [e.g. "TODAY" or "INSIDER" style — do NOT use real publication names, invent a plausible-looking one]. Below: thin gray horizontal rule. Small gray text "Latest Headlines". Then: bold black serif headline: "['It's my holy grail': The $[PRICE] [PRODUCT CATEGORY] with [SOCIAL PROOF STAT like 'thousands of 5-star reviews']]". Bottom 60%: two side-by-side casual UGC-style photos of [PEOPLE — two different customers] each holding [PRODUCT] in casual selfie poses — natural light. Should look like an organic article someone would share.

Pick whichever template better suits this concept's angle_subtype. Fill ALL placeholders with real product data.`,

  urgency: `
TEMPLATE A — Offer/Promotion (The money-maker):
Use the attached product images as brand reference. Create: a promotional ad with a split background. Top 60% is [PRIMARY BRAND COLOR] and bottom 40% is [CONTRAST COLOR like warm cream]. [PRODUCT] sits centered where colors meet, soft studio lighting. Upper area: large [CONTRAST TEXT] sans-serif reading "[OFFER HEADLINE — e.g. YOUR FIRST MONTH FREE / SAVE 40% TODAY ONLY]". Below: "[OFFER DETAILS — specific, clear]". Lower section: small [BRAND COLOR] text with [VALUE ADDS — e.g. free shipping, guarantee]. [BRAND] logo bottom right.

TEMPLATE B — Hero Statement + Icon Bar + Offer Burst:
Use the attached product images as brand reference. Create: a promotional variant on a [dark charcoal/moody OR brand dark color] background. Top: white banner with massive bold uppercase headline: "[PROVOCATIVE 2–3 WORD STATEMENT]" with a period for punch. Upper area: a [BRIGHT ACCENT COLOR like neon green/lime] comic-style starburst badge rotated slightly, reading "GET UP TO [DISCOUNT]% OFF" or "[OFFER]". Center: [PERSON'S HAND] gripping [PRODUCT] from above. Bottom: three evenly spaced icon-and-text benefit columns. Very bottom: full-width [BRIGHT ACCENT COLOR] banner: "[PROMO NAME — e.g. FLASH SALE / LIMITED OFFER]".

Pick whichever template better suits this concept's angle_subtype. Fill ALL placeholders with real product data.`,

  storytelling: `
TEMPLATE A — Before & After (UGC Native / TikTok-style):
Use the attached product images as brand reference for product color ONLY. This should look like a real person's post. Create: TikTok-style before-and-after. LEFT: grainy iPhone mirror selfie, [PERSON] in dimly lit setting, [BEFORE STATE — the problem/struggle], harsh lighting. White handwritten text: "[BEFORE DATE or BEFORE STATE label]". RIGHT: same person, same setting, bright natural light, [AFTER STATE — the transformation], [PRODUCT] visible. White text: "[AFTER DATE or AFTER STATE label]". Top center: "[TIMEFRAME] with [BRAND]" with emoji. Should look stitched in CapCut — organic, not polished.

TEMPLATE B — Whiteboard Before/After + Product Hold:
Use the attached product images as brand reference for product packaging ONLY. This should look like a real person's photo. Create: a lifestyle photo in [REAL SETTING like bright kitchen or bathroom]. In background: small tabletop dry-erase whiteboard propped on [SURFACE]. On the whiteboard: two simple hand-drawn marker illustrations — left labeled "[BEFORE LABEL]" showing [BEFORE STATE sketch], arrow pointing right, labeled "[AFTER LABEL]" showing [AFTER STATE sketch]. Below drawings: handwritten "[CTA or KEY MESSAGE]". Foreground: [PERSON'S HAND] holding [PRODUCT] next to whiteboard. Shot on iPhone, natural lighting, casual and educational.

TEMPLATE C — Advertorial / Editorial Content Card (Looks like organic content):
Use the attached product images as brand reference for tone ONLY. Do NOT use polished ad layouts. This should look like organic editorial content. Create: a full-bleed moody portrait or lifestyle photo of [PERSON or SCENE relevant to the product's use case — e.g. someone using the product in a natural context], warm amber-toned lighting, shot on 50mm f/1.8, shallow depth of field, cinematic color grade with warm highlights and cool shadows. Lower 45% is a text overlay zone: a prominent white rounded-rectangle pill label reading "[CATEGORY TAG — e.g. HOT TOPIC / TRENDING / MUST READ]" in centered uppercase sans-serif. Below: very large, dominant, bold all-caps condensed sans-serif headline filling the width in white with key words in [BRAND COLOR]: "[HEADLINE — [BRAND] IS [DOING SOMETHING RELEVANT] — HERE'S WHY EVERYONE'S [RESULT/ACTION]]". Headline should be at least 35% of total frame height. Bottom center: "[@BRAND_HANDLE]" in small white text. No product shot, no CTA button, no stars. Reads like a culture/lifestyle account post, not a paid ad.

TEMPLATE D — UGC + Viral Post Overlay (Reddit/Twitter screenshot):
Use the attached product images as brand reference for product color ONLY. Do NOT use ad layouts or polish. Create: a casual selfie of [PERSON — relatable to target persona, doing something mundane like making coffee or cooking]. iPhone front camera, slightly grainy, natural indoor lighting. Overlaid in the center: a realistic screenshot of a [Reddit or Twitter/X] post. Post details: [SUBREDDIT or USERNAME], [TIMESTAMP], [UPVOTE COUNT]. Post title in bold: "[PROVOCATIVE OPINION HEADLINE — related to the product's problem/benefit space, sounds organic not promotional]". Post body in regular text: "[2–3 sentences expanding on the opinion]". The person looks like they're reacting to or sharing the post — NOT selling a product. No product visible in frame. No brand logo. No CTA. The hook is the opinion.

Pick whichever template best suits this concept's angle_subtype. Fill ALL placeholders with real product data.`,

  testimonial_ugc: `
TEMPLATE A — Social Comment Screenshot + Product:
Use the attached product images as brand reference. Create: a static ad on clean white background. Top: oversized bold black sans-serif hook headline reading "[HOOK HEADLINE — provocative, emotional, relatable to the target persona]". Center: a social media comment card with light gray rounded-rectangle background containing: a small circular profile avatar, bold name "[REVIEWER NAME]", and a multi-sentence review: "[FULL REVIEW TEXT — 3–4 sentences, conversational, emotional, touches a specific pain point and the product as the solution]". Small gray timestamp below. Bottom center: [PRODUCT] photographed at slight angle on white, soft studio lighting. Feels like someone screenshotted a real comment and dropped the product below.

TEMPLATE B — Highlighted / Annotated Testimonial:
Use the attached product images as brand reference. Create: a static ad on clean white background. Top left: circular customer headshot photo of [PERSON DESCRIPTION — generic, relatable to target persona]. To the right: bold name "[REVIEWER NAME]" with a [blue checkmark verified icon]. Below: a long-form customer quote in large regular-weight black sans-serif spanning most of the frame: "[FULL QUOTE — 3–5 sentences, authentic customer voice]". Key phrases highlighted with [HIGHLIGHT COLOR — bright lime green or neon yellow] rectangular fills: "[HIGHLIGHTED PHRASE 1]", "[HIGHLIGHTED PHRASE 2]". Bottom right: [PRODUCT] at slight angle. To the left: circular [TRUST BADGE — e.g. "100% MONEY BACK / 90 DAYS GUARANTEE"] seal.

Pick whichever template better suits this concept's angle_subtype. Fill ALL placeholders with real product data.`,

  review_card: `
TEMPLATE A — Pull-Quote Review Card (Emotional quote + truncated review):
Use the attached product images as brand reference. Create: a review-driven ad with a solid [BRAND COLOR — soft, muted tone] color block background filling the entire image. Top half: large bold italic serif text in white with curly quotation marks: "[PULL-QUOTE — the most emotional 4–8 word phrase from a review, e.g. 'I finally found something that works!']". Below quote: five large filled gold star icons in a row. Bottom left, overlapping the color background: a white rounded-corner review card with subtle shadow containing: gray circular avatar icon, bold name "[FIRST NAME + LAST INITIAL]" with [FLAG EMOJI], blue checkmark "[VERIFIED BUYER]" in small blue text, review body text in 4–6 lines of authentic customer voice trailing off with "...Read more" in bold [BRAND COLOR]. Below review: "Was this review helpful? 👍 [COUNT]". Bottom right, overlapping: [PRODUCT — full packaging] angled slightly, soft shadow.

TEMPLATE B — Verified Review Card (Platform-style):
Use the attached product images as brand reference. Create: a static ad on a solid [PRIMARY BRAND COLOR] background. Top: large bold white serif pull-quote: "[HEADLINE QUOTE — emotional, under 10 words]" in quotation marks. Below: five filled gold stars, large. Center-left: a white rounded-rectangle review card with subtle shadow: gray circular avatar, bold name "[REVIEWER NAME]" with [FLAG EMOJI], blue checkmark "[VERIFIED REVIEWER]" in brand color, 3–4 sentences of review body in regular-weight dark text. Bottom of card: "[...Read more]" in blue and "Was this review helpful? 👍 [COUNT]". Right side, overlapping the card edge: [PRODUCT] at a slight angle, soft studio lighting, gentle shadow.

Pick whichever template better suits this concept's angle_subtype. Fill ALL placeholders with real product data.`,

  stat_callout: `
TEMPLATE A — Stat Surround / Callout Radial (Product Hero):
Use the attached product images as brand reference. Create: a static ad on a white-to-[LIGHT GRADIENT COLOR matching brand — e.g. warm golden beige] gradient background, fading top to bottom. Top: large bold [BRAND TEXT COLOR] sans-serif headline: "[HEADLINE — benefit-led, one punchy sentence]". Center: [PRODUCT] on white background, soft studio lighting. Floating near product: a small circular badge reading "[PRICE POINT or KEY OFFER]". Flanking the product on both sides: four stat callouts with curved hand-drawn-style arrows pointing toward the product. Left top: "[STAT 1 — key metric]" oversized bold + "[LABEL]" below. Left bottom: "[STAT 2]" + "[LABEL]". Right top: "[STAT 3]" + "[LABEL]". Right bottom: "[STAT 4]" + "[LABEL]" with five filled gold stars beneath. Arrows are simple curved lines in [ARROW COLOR like black]. Bottom: [INGREDIENT/FLAVOR PROPS] scattered for appetite/lifestyle appeal.

TEMPLATE B — Stat Surround / Callout Radial (Lifestyle Flatlay):
Use the attached product images as brand reference. Create: a static ad on white background with lifestyle flatlay. Top: bold [ACCENT COLOR] filled banner bar full width, white all-caps sans-serif: "[HEADLINE — benefit action statement]". Center: [PERSON'S HAND] holding [PRODUCT] in mid-frame. Scattered around edges: [FLATLAY PROPS related to product use — slightly out of focus] filling corners organically. Four stat callouts with curved [ACCENT COLOR] arrows pointing toward the held product: "[STAT 1] / [LABEL]", "[STAT 2] / [LABEL]", "[STAT 3] / [LABEL]", "[STAT 4] / [LABEL]" with five small gold stars on the review stat. Stats in bold black, labels in all-caps regular weight. Bright, flat studio lighting.

Pick whichever template better suits this concept's angle_subtype. Fill ALL placeholders with real product data.`,

  comparison_table: `
TEMPLATE A — Comparison Grid / Table (Viral meme format):
Use the attached product images as brand reference. Create: a structured comparison grid ad on white background. Top row divided 50/50: Left: [PRODUCT] packaging on white, slightly styled. Right: generic/unbranded competitor product on white. Below: three horizontal rows spanning full width, each divided 50/50 by a thin black vertical line and separated by thin black horizontal lines. Each row compares one attribute: Row 1: "[YOUR ADVANTAGE — specific, factual]" vs "[COMPETITOR WEAKNESS]". Row 2: "[YOUR ADVANTAGE 2]" vs "[COMPETITOR WEAKNESS 2]". Row 3: "[YOUR ADVANTAGE 3]" vs "[COMPETITOR WEAKNESS 3]". All text in bold black serif, centered in each cell. No icons, no colors, no checkmarks — the copy contrast does the work. Should feel like a meme-format comparison.

TEMPLATE B — Benefit Checklist Showcase (Split product + info):
Use the attached product images as brand reference. Create: an information-dense benefit ad, split composition. Left 45%: product shot — [PRODUCT DISPLAY with key details visible]. Shot on 50mm f/4, clean surface. Right 55%: white background. Top: [STAR RATING] with "[REVIEW COUNT like 10,000+ REVIEWS]" in [BRAND COLOR]. Brand logo. Below: [BRAND COLOR] headline: "[HEADLINE — product category benefit statement]". Then 3–4 checkmark benefit rows, each with filled [BRAND COLOR] circle checkmark + bold text: "[BENEFIT 1–4 from product USPs]". Bottom right: large rounded [ACCENT COLOR] CTA button: "[CTA like SHOP NOW]".

Pick whichever template better suits this concept's angle_subtype. Fill ALL placeholders with real product data.`,

  us_vs_them: `
TEMPLATE A — Us vs. Them Color Split (The definitive comparison):
Use the attached product images as brand reference. Create: a side-by-side comparison ad divided vertically into two equal halves. Left half: [MUTED/GREY/NEUTRAL color] background. Generic unbranded competitor product [DESCRIPTION]. Header: "[COMPETITOR CATEGORY — generic label]". Below: vertical stack of 4 weaknesses, each with a red circle ✗: "[WEAKNESS 1–4 — specific, factual from product knowledge]" in bold dark uppercase. Right half: [PRIMARY BRAND COLOR] background. [PRODUCT] with dynamic energy [DETAIL — e.g. ingredient spilling, liquid pouring]. [BRAND] logo in bold white. Below product: vertical stack of 4 strengths, each with green circle ✓: "[STRENGTH 1–4 from product USPs]" in bold white uppercase. Center divider: comic-style "VS" burst graphic in [ACCENT COLOR].

TEMPLATE B — Us vs Them Classic Split (Photography quality gap):
Use the attached product images as brand reference. Create: a side-by-side divided vertically. Left: muted gray-blue background. Right: [PRIMARY BRAND COLOR]. Center top: white circle with "VS". Left header: "[COMPETITOR CATEGORY]" + generic competitor product + list with ✗ marks: "[WEAKNESS 1–5 — factual disadvantages of alternatives]". Right header: "[YOUR BRAND]" + [PRODUCT] + list with ✓ checkmarks: "[STRENGTH 1–5 from product USPs]". [BRAND] logo bottom right.

Pick whichever template better suits this concept's angle_subtype. Fill ALL placeholders with real product data.`,
};

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

  // Build per-concept angle assignments AND collect unique angle types for template injection
  const conceptAngles = Array.from({ length: count }, (_, i) => outcomeAngles[(startIdx + i) % outcomeAngles.length]);
  const anglesStr = conceptAngles.map((angleType, i) => `${startIdx + i + 1}. angle_type: ${angleType}`).join('\n');

  // Inject the relevant layout templates for every unique angle type in this batch
  const uniqueAngles = [...new Set(conceptAngles)];
  const templateSection = uniqueAngles
    .filter(a => ANGLE_IMAGE_TEMPLATES[a])
    .map(a => `--- LAYOUT TEMPLATES FOR angle_type: ${a} ---\n${ANGLE_IMAGE_TEMPLATES[a]}`)
    .join('\n\n');

  const knowledgeStr = knowledge ? JSON.stringify(knowledge, null, 2).substring(0, 12000) : '{}';
  const outcomeCtx = OUTCOME_CONTEXT[outcome] || OUTCOME_CONTEXT.highlight_benefits;
  const productName = knowledge?.product_summary?.name || 'the product';
  const brandName = knowledge?.product_summary?.name?.split(' ')[0] || 'Brand';

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

CRITICAL PRODUCT IDENTITY:
- The product is "${productName}". You MUST refer to it by this exact name and product type in every image prompt.
- Never substitute a different product type (do NOT call a cup a bottle, a mug a jar, etc.)
- Brand name to use: "${brandName}"
- Canvas size: ${canvasLabel}

HOW TO WRITE THE image_prompt:
For each concept, use the layout templates provided below for that angle_type. Choose the template (A or B) that best matches the concept's angle_subtype and the product's nature.

Fill EVERY [PLACEHOLDER] in the template with specific, real values derived from the product knowledge:
- Replace [BRAND COLOR] with an actual hex or color description derived from the product's packaging or brand
- Replace [PRODUCT] with "${productName}" — never a generic substitute
- Replace [BRAND] with "${brandName}"
- Replace [BENEFIT 1–4], [STAT 1–4], [REVIEW TEXT], etc. with actual product USPs, features, and data from the product knowledge
- Replace [HEADLINE], [PULL-QUOTE], [HOOK HEADLINE] with the exact text from the concept's headline or image_text_overlay
- Specify exact hex colors, font styles (e.g. "bold condensed sans-serif"), lighting (e.g. "soft diffused studio light"), and camera angles (e.g. "85mm f/2.8 from slightly above")
- The prompt goes directly to an AI image model — be extremely specific, 200–300 words

LAYOUT TEMPLATES BY ANGLE TYPE:
${templateSection}

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
