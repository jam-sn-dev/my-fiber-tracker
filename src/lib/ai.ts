import Anthropic from '@anthropic-ai/sdk';

/** What Claude extracts from a photo of a Nutrition Facts panel. */
export interface LabelExtraction {
  productName: string | null;
  brand: string | null;
  servingLabel: string; // e.g. "1 slice (45 g)"
  fiberGramsPerServing: number;
  confidence: 'high' | 'medium' | 'low';
  notes: string | null; // anything the user should double-check
  /**
   * Meal-kit recipe cards (Home Chef etc.) often print a nutrition URL
   * instead of a Nutrition Facts panel — e.g. "View nutritional information
   * at www.homechef.com/53562". When the photo shows one, it lands here so
   * the caller can follow it with extractMealFromUrl.
   */
  nutritionUrl: string | null;
}

export class AiError extends Error {
  kind: 'auth' | 'network' | 'rate' | 'refused' | 'other';
  constructor(kind: AiError['kind'], message: string) {
    super(message);
    this.kind = kind;
  }
}

const MODEL = 'claude-opus-4-8';

const LABEL_SCHEMA = {
  type: 'object',
  properties: {
    productName: {
      type: ['string', 'null'],
      description: 'Product name if visible anywhere in the photo, else null',
    },
    brand: { type: ['string', 'null'], description: 'Brand name if visible, else null' },
    servingLabel: {
      type: 'string',
      description: 'Serving size exactly as printed, e.g. "1 slice (45g)" or "2/3 cup (55g)"',
    },
    fiberGramsPerServing: {
      type: 'number',
      description: 'Dietary fiber in grams per serving, as printed on the label',
    },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    notes: {
      type: ['string', 'null'],
      description:
        'Only if something needs double-checking (blurry value, per-container vs per-serving ambiguity), else null',
    },
    nutritionUrl: {
      type: ['string', 'null'],
      description:
        'A nutrition-information URL printed on the photo (e.g. "www.homechef.com/53562"), exactly as printed; null if none',
    },
  },
  required: [
    'productName',
    'brand',
    'servingLabel',
    'fiberGramsPerServing',
    'confidence',
    'notes',
    'nutritionUrl',
  ],
  additionalProperties: false,
} as const;

const PROMPT = `Read this photo of a food package's Nutrition Facts panel (or a meal-kit recipe card) and extract the dietary fiber information.

Rules:
- fiberGramsPerServing is the DIETARY FIBER line (not total carbohydrate, not sugar), per serving.
- If the label shows both per-serving and per-container columns, use the per-serving column and mention this in notes.
- servingLabel is the serving size exactly as printed.
- If you cannot clearly read the dietary fiber value, set confidence to "low" and explain in notes.
- Meal-kit recipe cards (Home Chef and similar) often have NO Nutrition Facts panel and instead print a link like "View nutritional information at www.homechef.com/53562". If the photo shows such a URL, put it in nutritionUrl exactly as printed. If the card also shows no readable fiber value, set fiberGramsPerServing to 0 and confidence to "low" — the app will follow the link. Set productName to the dish name if it appears anywhere on the card, and brand to the meal-kit service name if identifiable.`;

interface DecodedPhoto {
  source: CanvasImageSource;
  width: number;
  height: number;
  cleanup: () => void;
}

/**
 * Decode a picked photo, falling back from createImageBitmap to an
 * HTMLImageElement (some platforms lack createImageBitmap, and it rejects on
 * formats the <img> pipeline can still handle). If neither path can decode
 * it — e.g. an original HEIC on Android/desktop Chrome — throw an actionable
 * AiError instead of the generic retry message.
 */
async function decodePhoto(file: Blob): Promise<DecodedPhoto> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        cleanup: () => bitmap.close(),
      };
    } catch {
      // fall through to the <img> decode path
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      cleanup: () => URL.revokeObjectURL(url),
    };
  } catch {
    URL.revokeObjectURL(url);
    throw new AiError(
      'other',
      'That photo format could not be read (HEIC originals are not supported here) — retake it with the camera, or export it as JPEG/PNG and try again.',
    );
  }
}

/** Downscale + JPEG-encode a photo so it uploads fast and stays within vision limits. */
async function preparePhoto(file: Blob): Promise<{ data: string; mediaType: 'image/jpeg' }> {
  const photo = await decodePhoto(file);
  try {
    const maxEdge = 1568;
    const scale = Math.min(1, maxEdge / Math.max(photo.width, photo.height));
    const w = Math.round(photo.width * scale);
    const h = Math.round(photo.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new AiError('other', 'Could not process the photo.');
    ctx.drawImage(photo.source, 0, 0, w, h);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    return { data: dataUrl.split(',')[1], mediaType: 'image/jpeg' };
  } finally {
    photo.cleanup();
  }
}

/**
 * Send a nutrition-label photo to Claude and get back structured fiber data.
 * The caller must show a confirm step before saving — AI output never writes
 * to the library directly.
 */
export async function extractNutritionLabel(
  photo: Blob,
  apiKey: string,
): Promise<LabelExtraction> {
  const { data, mediaType } = await preparePhoto(photo);

  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      output_config: { format: { type: 'json_schema', schema: LABEL_SCHEMA } },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
            { type: 'text', text: PROMPT },
          ],
        },
      ],
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      throw new AiError('auth', 'The API key was rejected. Check it in Settings.');
    }
    if (err instanceof Anthropic.RateLimitError) {
      throw new AiError('rate', 'Too many scans in a short time — wait a moment and retry.');
    }
    if (err instanceof Anthropic.APIConnectionError) {
      throw new AiError('network', 'No connection. Label scanning needs internet.');
    }
    if (err instanceof Anthropic.APIError) {
      throw new AiError('other', `Scan failed (${err.status ?? 'API error'}). Try again.`);
    }
    throw new AiError('other', 'Scan failed. Try again or enter the food manually.');
  }

  if (response.stop_reason === 'refusal') {
    throw new AiError('refused', 'The photo could not be read. Try a clearer shot of the label.');
  }

  const text = response.content.find((b) => b.type === 'text')?.text;
  if (!text) throw new AiError('other', 'No result came back. Try again.');

  let parsed: LabelExtraction;
  try {
    parsed = JSON.parse(text) as LabelExtraction;
  } catch {
    throw new AiError('other', 'The result could not be read. Try again.');
  }

  parsed.nutritionUrl = parsed.nutritionUrl?.trim() || null;
  const fiberOk =
    typeof parsed.fiberGramsPerServing === 'number' && parsed.fiberGramsPerServing >= 0;
  // A meal-kit card with just a nutrition link is a valid result — the caller
  // follows the URL. Only fail when there's neither a fiber value nor a link.
  if (!fiberOk && !parsed.nutritionUrl) {
    throw new AiError('other', 'No dietary fiber value was found on the label.');
  }
  if (!fiberOk) parsed.fiberGramsPerServing = 0;
  return parsed;
}

// ---------------------------------------------------------------------------
// Shared helpers for the list-scan and link-import lanes
// ---------------------------------------------------------------------------

function mapApiError(err: unknown, activity: string): AiError {
  if (err instanceof Anthropic.AuthenticationError) {
    return new AiError('auth', 'The API key was rejected. Check it in Settings.');
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new AiError('rate', 'Too many requests in a short time — wait a moment and retry.');
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new AiError('network', `No connection. ${activity} needs internet.`);
  }
  if (err instanceof Anthropic.APIError) {
    return new AiError('other', `${activity} failed (${err.status ?? 'API error'}). Try again.`);
  }
  return new AiError('other', `${activity} failed. Try again.`);
}

/** Parse model output as JSON even if it arrives wrapped in prose/code fences. */
function parseJsonLoose<T>(text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(text.slice(start, end + 1)) as T;
    }
    throw new AiError('other', 'The result could not be read. Try again.');
  }
}

function finalText(response: Anthropic.Message): string {
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
  if (!text) throw new AiError('other', 'No result came back. Try again.');
  return text;
}

// ---------------------------------------------------------------------------
// Lane: photo of a handwritten/typed food list -> many foods at once
// ---------------------------------------------------------------------------

export interface ListItemExtraction {
  name: string;
  servingLabel: string; // "1 serving" when the list gives no serving size
  fiberGramsPerServing: number;
  confidence: 'high' | 'medium' | 'low';
}

export interface FoodListExtraction {
  items: ListItemExtraction[];
  notes: string | null;
}

const LIST_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Food name as written, lightly normalized' },
          servingLabel: {
            type: 'string',
            description: 'Serving size if the list states one, else exactly "1 serving"',
          },
          fiberGramsPerServing: { type: 'number', description: 'Fiber grams as written' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: ['name', 'servingLabel', 'fiberGramsPerServing', 'confidence'],
        additionalProperties: false,
      },
    },
    notes: {
      type: ['string', 'null'],
      description: 'Lines that were skipped or hard to read, else null',
    },
  },
  required: ['items', 'notes'],
  additionalProperties: false,
} as const;

const LIST_PROMPT = `This photo (or screenshot) shows a list of foods with their fiber amounts — it may be handwritten, typed, or printed.

Extract every food that has a readable fiber number:
- name: the food as written (fix obvious spelling, keep her wording otherwise).
- fiberGramsPerServing: the fiber grams written next to it. Numbers like "8g", "8 g", "8" all mean 8 grams.
- servingLabel: only if the list states a serving (e.g. "1 cup"); otherwise exactly "1 serving".
- confidence: "low" when the handwriting or number is hard to read.
Skip lines with no number, and mention them in notes. Never invent a fiber value.`;

/**
 * Read a photographed list of foods + fiber values. The caller shows a
 * review checklist before anything is saved.
 */
export async function extractFoodList(
  photo: Blob,
  apiKey: string,
  signal?: AbortSignal,
): Promise<FoodListExtraction> {
  const { data, mediaType } = await preparePhoto(photo);
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

  let response: Anthropic.Message;
  try {
    response = await client.messages.create(
      {
        model: MODEL,
        max_tokens: 8192,
        output_config: { format: { type: 'json_schema', schema: LIST_SCHEMA } },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
              { type: 'text', text: LIST_PROMPT },
            ],
          },
        ],
      },
      // Cancellable + capped: the UI shows a Cancel button during the scan,
      // and a hung request must not spin for the SDK's 10-minute default.
      { signal, timeout: 90_000 },
    );
  } catch (err) {
    throw mapApiError(err, 'List scanning');
  }

  if (response.stop_reason === 'refusal') {
    throw new AiError('refused', 'The photo could not be read. Try a clearer shot of the list.');
  }
  if (response.stop_reason === 'max_tokens') {
    // The JSON was cut off mid-array — retrying the same photo would fail the
    // same way, so tell her the one thing that actually helps.
    throw new AiError(
      'other',
      'The list is too long to read in one photo — split it into two photos and scan each half.',
    );
  }

  const parsed = parseJsonLoose<FoodListExtraction>(finalText(response));
  const items = (parsed.items ?? []).filter(
    (it) =>
      typeof it.name === 'string' &&
      it.name.trim() !== '' &&
      typeof it.fiberGramsPerServing === 'number' &&
      it.fiberGramsPerServing >= 0,
  );
  if (items.length === 0) {
    throw new AiError(
      'other',
      'No foods with fiber numbers were found in the photo. Make sure each line has a grams value.',
    );
  }
  return { items, notes: parsed.notes ?? null };
}

// ---------------------------------------------------------------------------
// Lane: recipe URL (Home Chef etc.) -> one ready-to-save meal item
// ---------------------------------------------------------------------------

export interface UrlMealExtraction {
  mealName: string | null;
  brand: string | null;
  fiberGramsPerServing: number | null; // null = the page didn't show fiber
  servingLabel: string;
  confidence: 'high' | 'medium' | 'low';
  notes: string | null;
}

const URL_SCHEMA = {
  type: 'object',
  properties: {
    mealName: { type: ['string', 'null'], description: 'Recipe/meal name from the page' },
    brand: {
      type: ['string', 'null'],
      description: 'Service or brand, e.g. "Home Chef", else null',
    },
    fiberGramsPerServing: {
      type: ['number', 'null'],
      description: 'Dietary fiber grams PER SERVING from the page nutrition info; null if not shown',
    },
    servingLabel: { type: 'string', description: 'Usually exactly "1 serving"' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    notes: {
      type: ['string', 'null'],
      description: 'e.g. fiber was per container, or the page hid nutrition behind scripts',
    },
  },
  required: ['mealName', 'brand', 'fiberGramsPerServing', 'servingLabel', 'confidence', 'notes'],
  additionalProperties: false,
} as const;

/**
 * Fetch a recipe page (Home Chef, etc.) via Claude's server-side web_fetch
 * tool — the fetch happens on Anthropic's infrastructure, so there's no CORS
 * problem and no proxy server of ours. Extracts name + dietary fiber/serving.
 */
export async function extractMealFromUrl(
  url: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<UrlMealExtraction> {
  let cleaned: URL;
  try {
    cleaned = new URL(url.trim());
  } catch {
    throw new AiError('other', 'That doesn’t look like a full link — paste the whole URL.');
  }
  if (cleaned.protocol !== 'https:' && cleaned.protocol !== 'http:') {
    throw new AiError('other', 'Only web links can be imported.');
  }

  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

  const prompt = `Fetch this recipe page and extract its dietary fiber information: ${cleaned.href}

Rules for fiberGramsPerServing (per serving, from the page's printed nutrition information only):
1. If the page lists "Dietary Fiber" (or "Fiber") directly, use that value with confidence "high".
2. Otherwise, if the page lists BOTH total "Carbohydrates" AND "Net Carbs" (Home Chef pages do this), derive fiber = carbohydrates minus net carbs. Set confidence to "medium" and state the arithmetic in notes, e.g. "Derived: 56 g carbs − 53 g net carbs = 3 g fiber — the recipe card in the box can confirm."
3. If neither is available, return null. NEVER guess fiber from the ingredients or the dish type.

Also:
- mealName: the recipe title. brand: the service name (e.g. "Home Chef").
- servingLabel: "1 serving" unless the page clearly defines something else.`;

  let messages: Anthropic.MessageParam[] = [{ role: 'user', content: prompt }];
  let response: Anthropic.Message;
  // Cancellable + capped: the UI shows a Cancel button while fetching, and a
  // hung request must not spin for the SDK's 10-minute default.
  const requestOptions = { signal, timeout: 90_000 };
  try {
    response = await client.messages.create(
      {
        model: MODEL,
        max_tokens: 2048,
        tools: [{ type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 3 }],
        output_config: { format: { type: 'json_schema', schema: URL_SCHEMA } },
        messages,
      },
      requestOptions,
    );
    // Server-side tools may pause the turn; resume until the answer is done.
    let hops = 0;
    while (response.stop_reason === 'pause_turn' && hops < 3) {
      messages = [
        ...messages,
        { role: 'assistant', content: response.content as Anthropic.ContentBlockParam[] },
      ];
      response = await client.messages.create(
        {
          model: MODEL,
          max_tokens: 2048,
          tools: [{ type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 3 }],
          output_config: { format: { type: 'json_schema', schema: URL_SCHEMA } },
          messages,
        },
        requestOptions,
      );
      hops += 1;
    }
  } catch (err) {
    throw mapApiError(err, 'Link import');
  }

  // The resume loop gave up while the turn was still paused: the content ends
  // in tool use/interim narration, not the structured answer. Parsing it can
  // even yield a fiber-less object that misreads as "no fiber on the page".
  if (response.stop_reason === 'pause_turn') {
    throw new AiError(
      'other',
      'That page took too long to read. Try again, or scan the recipe card instead.',
    );
  }

  if (response.stop_reason === 'refusal') {
    throw new AiError('refused', 'That page could not be read. Try scanning the recipe card instead.');
  }

  const parsed = parseJsonLoose<UrlMealExtraction>(finalText(response));
  if (!parsed.servingLabel) parsed.servingLabel = '1 serving';
  return parsed;
}

// ---------------------------------------------------------------------------
// Lane: spoken (or dictated) command -> structured, confirmable action
// ---------------------------------------------------------------------------

export interface VoicePlanItem {
  /** EXACT name of a library food when one matches, else null. */
  libraryName: string | null;
  /** For foods not in the library: the name she said, else null. */
  newFoodName: string | null;
  /** Only when she explicitly stated a fiber value for a new food; else null. */
  newFoodFiberPerServing: number | null;
  qty: number; // servings, 0.5 steps
}

export interface VoiceCommand {
  intent: 'add_food' | 'plan' | 'set_target' | 'unknown';
  /** One short, friendly sentence: what was understood, or what to ask. */
  say: string;
  addFood: { name: string; servingLabel: string; fiberGramsPerServing: number } | null;
  plan: {
    slot: 'breakfast' | 'lunch' | 'snack' | 'dinner';
    state: 'planned' | 'eaten';
    targetGrams: number | null;
    items: VoicePlanItem[];
  } | null;
  setTarget: { grams: number } | null;
}

export interface VoiceContext {
  date: string;
  targetGrams: number;
  gapGrams: number;
  /** Compact library digest so names can be resolved on the model side. */
  library: Array<{ name: string; fiberPerServing: number; servingLabel: string; favorite: boolean }>;
}

/** When the parser asked a clarifying question, the next utterance answers it. */
export interface VoiceFollowUp {
  /** What she said before (accumulated across rounds). */
  history: string;
  /** The clarifying question the parser asked. */
  question: string;
}

const VOICE_SCHEMA = {
  type: 'object',
  properties: {
    intent: { type: 'string', enum: ['add_food', 'plan', 'set_target', 'unknown'] },
    say: {
      type: 'string',
      description:
        'One short friendly sentence: what you understood (e.g. "Planning breakfast: oats and raspberries, 8 g"), or for unknown, the clarifying question',
    },
    addFood: {
      type: ['object', 'null'],
      properties: {
        name: { type: 'string' },
        servingLabel: { type: 'string', description: '"1 serving" if she did not say one' },
        fiberGramsPerServing: { type: 'number' },
      },
      required: ['name', 'servingLabel', 'fiberGramsPerServing'],
      additionalProperties: false,
    },
    plan: {
      type: ['object', 'null'],
      properties: {
        slot: { type: 'string', enum: ['breakfast', 'lunch', 'snack', 'dinner'] },
        state: { type: 'string', enum: ['planned', 'eaten'] },
        targetGrams: { type: ['number', 'null'] },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              libraryName: { type: ['string', 'null'] },
              newFoodName: { type: ['string', 'null'] },
              newFoodFiberPerServing: { type: ['number', 'null'] },
              qty: { type: 'number' },
            },
            required: ['libraryName', 'newFoodName', 'newFoodFiberPerServing', 'qty'],
            additionalProperties: false,
          },
        },
      },
      required: ['slot', 'state', 'targetGrams', 'items'],
      additionalProperties: false,
    },
    setTarget: {
      type: ['object', 'null'],
      properties: { grams: { type: 'number' } },
      required: ['grams'],
      additionalProperties: false,
    },
  },
  required: ['intent', 'say', 'addFood', 'plan', 'setTarget'],
  additionalProperties: false,
} as const;

/**
 * Turn a spoken/dictated sentence into a structured command. The caller
 * renders a confirm card and executes only after her approval.
 */
export async function parseVoiceCommand(
  transcript: string,
  context: VoiceContext,
  apiKey: string,
  signal?: AbortSignal,
  followUp?: VoiceFollowUp,
): Promise<VoiceCommand> {
  const digest = context.library
    .slice(0, 250)
    .map(
      (f) =>
        `${f.name} | ${f.fiberPerServing} g per ${f.servingLabel}${f.favorite ? ' | favorite' : ''}`,
    )
    .join('\n');

  const prompt = `You are the voice-command parser for Fibi, a personal fiber-planning app. Parse the user's sentence into exactly one command. Today is ${context.date}; her daily fiber target is ${context.targetGrams} g and ${context.gapGrams} g is still unplanned.

Her food library (name | fiber per serving | favorite):
${digest}

Intents:
- add_food: she wants a new food saved to her library and stated its fiber (e.g. "add green pepper to my foods, 1 gram of fiber per serving"). servingLabel is "1 serving" unless she said one.
- plan: she wants foods put into a meal slot — planning ahead ("plan my breakfast with oatmeal and some berries for 5 grams") or logging what she already ate ("I had an apple for a snack" -> state "eaten"). This ALSO covers requests that name no foods at all ("find me a 4 gram breakfast", "plan a high-fiber snack"): in that case YOU pick 1–3 fitting foods from her library — favorites and frequently-used first, sensible for that slot — with quantities landing at or slightly above the grams she asked for. When she names no foods, choose ONLY from the library (never invent foods she didn't mention). Resolve each named food to the EXACT library name when a sensible match exists ("oatmeal" -> the oats entry; "berries" -> a favorite berry). Choose qty in 0.5 steps: if she gave a gram amount for the meal, land at or slightly above it (her target is a floor); otherwise use 1 serving each. A named food that is NOT in the library: set newFoodName, and set newFoodFiberPerServing ONLY if she spoke a number — never invent fiber values.
- set_target: she explicitly changes her daily target/goal.
- unknown: anything else — put a short clarifying question in "say".

Prefer a concrete plan over a question: if the sentence asks for a meal, a slot, or a gram amount in any phrasing ("find me…", "give me…", "what should I…", "I need a…"), return a plan — she reviews and edits it on a confirm card before anything saves. Use unknown only when you truly cannot act.

Exactly one of addFood/plan/setTarget is non-null (all null for unknown). "say" is always one warm, specific sentence.
${
  followUp
    ? `
Conversation so far: she said "${followUp.history.replace(/"/g, "'")}" and you asked "${followUp.question.replace(/"/g, "'")}". Her sentence below ANSWERS that question — combine it with what she already said and produce the command. A plain affirmative ("yes", "sure", "do it") means: do exactly what your question proposed.
`
    : ''
}
Her sentence: "${transcript.replace(/"/g, "'")}"`;

  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  let response: Anthropic.Message;
  try {
    response = await client.messages.create(
      {
        model: MODEL,
        max_tokens: 1500,
        output_config: { format: { type: 'json_schema', schema: VOICE_SCHEMA } },
        messages: [{ role: 'user', content: prompt }],
      },
      { signal, timeout: 60_000 },
    );
  } catch (err) {
    throw mapApiError(err, 'Voice command');
  }

  if (response.stop_reason === 'refusal') {
    throw new AiError('refused', 'That one could not be processed — try rephrasing it.');
  }

  const parsed = parseJsonLoose<VoiceCommand>(finalText(response));
  if (!parsed.intent) {
    throw new AiError('other', 'The result could not be read. Try again.');
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Lane: look up dietary fiber for a food by name (Claude's nutrition knowledge)
// ---------------------------------------------------------------------------

export interface FoodFiberLookup {
  /** True when Claude can give a well-established generic value. */
  known: boolean;
  /** Cleaned common name, e.g. "Bell pepper, raw". */
  name: string;
  /** A common household serving, e.g. "1 medium" or "1 cup, chopped". */
  servingLabel: string;
  /** Dietary fiber grams for that serving. Meaningful only when known. */
  fiberGramsPerServing: number;
  confidence: 'high' | 'medium' | 'low';
  /** Short caveat, or why it's unknown (e.g. "brand varies — scan the label"). */
  note: string | null;
}

const FOOD_LOOKUP_SCHEMA = {
  type: 'object',
  properties: {
    known: {
      type: 'boolean',
      description:
        'true only for a common generic whole/prepared food with a well-established dietary-fiber value; false for branded/packaged products or anything you cannot give a reliable number for',
    },
    name: { type: 'string', description: 'Cleaned common food name' },
    servingLabel: {
      type: 'string',
      description: 'A common household serving, e.g. "1 medium", "1 cup, chopped", "1/2 cup cooked"',
    },
    fiberGramsPerServing: {
      type: 'number',
      description: 'Dietary fiber grams for that serving (USDA-consistent). 0 if truly unknown.',
    },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    note: {
      type: ['string', 'null'],
      description:
        'Short caveat if useful (e.g. "varies by size"), or why unknown (e.g. "branded item — scan the label for its exact value"). Else null.',
    },
  },
  required: ['known', 'name', 'servingLabel', 'fiberGramsPerServing', 'confidence', 'note'],
  additionalProperties: false,
} as const;

/**
 * Look up the dietary fiber of a food by name using Claude's nutrition
 * knowledge — so common generics ("bell pepper", "cooked quinoa") don't need
 * manual entry. The caller shows an editable confirm step before saving, and
 * anything saved this way is marked as an estimate.
 */
export async function lookupFoodFiber(
  query: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<FoodFiberLookup> {
  const term = query.trim();
  if (!term) throw new AiError('other', 'Type a food name to look up.');

  const prompt = `Give the dietary fiber content of this food: "${term.replace(/"/g, "'")}".

Rules:
- Use well-established USDA-consistent values for common generic foods (fruits, vegetables, legumes, grains, nuts, common prepared dishes). Pick a natural household serving (e.g. "1 medium", "1 cup, chopped", "1/2 cup cooked") and give the DIETARY FIBER grams for that serving.
- Set known=true only when you are confident in a real, established value. For a specific BRANDED or packaged product (a named cereal, bar, bread brand, restaurant item), set known=false, fiberGramsPerServing=0, and note that its label should be scanned for the exact value — do NOT guess a branded product's number.
- If the term is vague, pick the most common interpretation and say so in note.
- Never fabricate a precise number for something you don't actually know. Prefer known=false over a made-up value.`;

  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  let response: Anthropic.Message;
  try {
    response = await client.messages.create(
      {
        model: MODEL,
        max_tokens: 700,
        output_config: { format: { type: 'json_schema', schema: FOOD_LOOKUP_SCHEMA } },
        messages: [{ role: 'user', content: prompt }],
      },
      { signal, timeout: 45_000 },
    );
  } catch (err) {
    throw mapApiError(err, 'Fiber lookup');
  }

  if (response.stop_reason === 'refusal') {
    throw new AiError('refused', 'That one couldn’t be looked up — add it manually instead.');
  }

  const parsed = parseJsonLoose<FoodFiberLookup>(finalText(response));
  if (typeof parsed.known !== 'boolean' || typeof parsed.fiberGramsPerServing !== 'number') {
    throw new AiError('other', 'The lookup couldn’t be read. Try again, or add it manually.');
  }
  if (!parsed.servingLabel?.trim()) parsed.servingLabel = '1 serving';
  if (!parsed.name?.trim()) parsed.name = term;
  return parsed;
}
