const axios = require("axios");
const cheerio = require("cheerio");

const BASE = "https://www.mobiledokan.com";
const SEARCH = `${BASE}/?s=`;

const http = axios.create({
  timeout: 20000,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/152.0.0.0 Mobile Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9"
  }
});

const cache = new Map();
const CACHE_TTL = 6 * 60 * 60 * 1000;

const clean = (v) =>
  String(v || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const absoluteUrl = (href) => {
  if (!href) return null;

  try {
    return new URL(href, BASE).href;
  } catch {
    return null;
  }
};

function normalizeModel(s) {
  return clean(s)
    .toLowerCase()
    .replace(/official|unofficial/g, "")
    .replace(/[৳$€£]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function similarity(query, title) {
  const q = normalizeModel(query);
  const t = normalizeModel(title);

  if (!q || !t) return 0;

  if (q === t) return 1000;

  if (t.includes(q)) return 800;

  const qw = new Set(q.split(" "));
  const tw = new Set(t.split(" "));

  let common = 0;

  for (const word of qw) {
    if (tw.has(word)) common++;
  }

  return (common / qw.size) * 100;
}

/*
 * Converts:
 *
 * Xiaomi Redmi 10C
 * Redmi 10C
 * Samsung Galaxy S23 Ultra
 *
 * into possible MobileDokan slugs.
 */
function generateSlugs(model) {
  const original = clean(model);

  const words = original
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean);

  const candidates = [];

  const add = (value) => {
    const slug = value
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "");

    if (slug && !candidates.includes(slug)) {
      candidates.push(slug);
    }
  };

  // Original
  add(original);

  const brandAliases = {
    redmi: ["xiaomi-redmi"],
    poco: ["xiaomi-poco"],
    mi: ["xiaomi-mi"],
    pixel: ["google-pixel"],
    iphone: ["apple-iphone"],
    galaxy: ["samsung-galaxy"],
    oneplus: ["oneplus"],
    realme: ["realme"],
    oppo: ["oppo"],
    vivo: ["vivo"],
    infinix: ["infinix"],
    tecno: ["tecno"],
    motorola: ["motorola"],
    nokia: ["nokia"],
    honor: ["honor"],
    huawei: ["huawei"],
    asus: ["asus"],
    sony: ["sony"],
    nothing: ["nothing"],
    itel: ["itel"],
    iqoo: ["iqoo"],
    lenovo: ["lenovo"],
    zte: ["zte"]
  };

  for (const [brand, aliases] of Object.entries(brandAliases)) {
    if (!words.includes(brand)) continue;

    const remaining = words.filter((w) => w !== brand);

    for (const alias of aliases) {
      if (remaining.length) {
        add(`${alias} ${remaining.join(" ")}`);
      }
    }
  }

  // Special cases
  if (words.includes("redmi")) {
    const remaining = words.filter((w) => w !== "redmi");
    add(`xiaomi redmi ${remaining.join(" ")}`);
  }

  if (words.includes("poco")) {
    const remaining = words.filter((w) => w !== "poco");
    add(`xiaomi poco ${remaining.join(" ")}`);
  }

  if (words.includes("iphone")) {
    const remaining = words.filter((w) => w !== "iphone");
    add(`apple iphone ${remaining.join(" ")}`);
  }

  if (words.includes("galaxy")) {
    const remaining = words.filter((w) => w !== "galaxy");
    add(`samsung galaxy ${remaining.join(" ")}`);
  }

  // Remove generic words
  const filtered = words.filter(
    (w) =>
      ![
        "mobile",
        "phone",
        "smartphone",
        "official",
        "unofficial"
      ].includes(w)
  );

  if (filtered.length) {
    add(filtered.join(" "));
  }

  return candidates;
}

/*
 * Validate a direct MobileDokan page.
 * This prevents a random valid page from being accepted.
 */
async function validatePhonePage(url, requestedModel) {
  try {
    const { data: html } = await http.get(url);

    const $ = cheerio.load(html);

    const title =
      clean($("h1").first().text()) ||
      clean($("title").first().text());

    const bodyText = clean($("body").text());

    const scoreTitle = similarity(requestedModel, title);

    const normalizedQuery = normalizeModel(requestedModel);
    const normalizedTitle = normalizeModel(title);

    const titleContains =
      normalizedQuery &&
      normalizedTitle &&
      (
        normalizedTitle.includes(normalizedQuery) ||
        normalizedQuery.includes(normalizedTitle)
      );

    /*
     * Also check the actual page body.
     */
    const bodyContains =
      normalizeModel(bodyText).includes(normalizedQuery);

    if (
      scoreTitle >= 80 ||
      titleContains ||
      bodyContains
    ) {
      return {
        url,
        html,
        title,
        score: Math.max(scoreTitle, bodyContains ? 85 : 0)
      };
    }

    return null;
  } catch (error) {
    return null;
  }
}

/*
 * Direct slug fallback.
 */
async function directSlugLookup(model) {
  const slugs = generateSlugs(model);

  for (const slug of slugs) {
    const url = `${BASE}/mobile/${slug}`;

    const result = await validatePhonePage(url, model);

    if (result) {
      return result;
    }
  }

  return null;
}

function extractTable($) {
  const out = {};

  $("table tr").each((_, tr) => {
    const cells = $(tr)
      .find("th,td")
      .map((__, el) => clean($(el).text()))
      .get()
      .filter(Boolean);

    if (cells.length >= 2) {
      const key = cells[0].replace(/:$/, "");
      const value = cells.slice(1).join(" | ");

      if (key && value && !out[key]) {
        out[key] = value;
      }
    }
  });

  return out;
}

function findPrice(text) {
  const match = clean(text).match(
    /(?:৳|BDT|Tk\.?|Taka)\s*([0-9][0-9,]*(?:\.\d+)?)/i
  );

  return match
    ? Number(match[1].replace(/,/g, ""))
    : null;
}

function extractPrices($) {
  const result = {
    official: null,
    unofficial: null,
    variants: []
  };

  const seen = new Set();

  $("body *").each((_, el) => {
    const text = clean($(el).text());

    if (!text || text.length > 300) return;

    const price = findPrice(text);

    if (!price) return;

    const isOfficial = /official/i.test(text);
    const isUnofficial = /unofficial/i.test(text);

    if (isOfficial && result.official === null) {
      result.official = price;
    }

    if (isUnofficial && result.unofficial === null) {
      result.unofficial = price;
    }

    /*
     * Detect variants such as:
     *
     * 4GB+64GB ৳14,999
     * 4GB+128GB ৳16,499
     * 8GB/128GB ৳20,000
     */
    const variantMatches = text.match(
      /(\d+(?:\.\d+)?\s*GB)\s*(?:\+|\/|\s+)\s*(\d+(?:\.\d+)?\s*(?:GB|TB)).{0,80}?(?:৳|BDT|Tk\.?|Taka)\s*([0-9][0-9,]*)/gi
    );

    if (variantMatches) {
      for (const item of variantMatches) {
        const match = item.match(
          /(\d+(?:\.\d+)?)\s*GB\s*(?:\+|\/|\s+)\s*(\d+(?:\.\d+)?)\s*(GB|TB).{0,80}?(?:৳|BDT|Tk\.?|Taka)\s*([0-9][0-9,]*)/i
        );

        if (!match) continue;

        const ram = `${match[1]}GB`;
        const storage = `${match[2]}${match[3].toUpperCase()}`;
        const variantPrice = Number(match[4].replace(/,/g, ""));

        const key = `${ram}-${storage}-${variantPrice}`;

        if (!seen.has(key)) {
          seen.add(key);

          result.variants.push({
            ram,
            storage,
            price: variantPrice
          });
        }
      }
    }
  });

  /*
   * Fallback:
   * If no structured variants were detected, parse the
   * common MobileDokan price sentence directly.
   */
  if (!result.variants.length) {
    const body = clean($("body").text());

    const matches = body.match(
      /\d+(?:\.\d+)?GB\s*\+\s*\d+(?:\.\d+)?(?:GB|TB)\s*(?:৳|BDT|Tk\.?|Taka)\s*[0-9,]+/gi
    ) || [];

    for (const item of matches) {
      const match = item.match(
        /(\d+(?:\.\d+)?)GB\s*\+\s*(\d+(?:\.\d+)?)(GB|TB)\s*(?:৳|BDT|Tk\.?|Taka)\s*([0-9,]+)/i
      );

      if (!match) continue;

      const ram = `${match[1]}GB`;
      const storage = `${match[2]}${match[3].toUpperCase()}`;
      const variantPrice = Number(match[4].replace(/,/g, ""));

      const key = `${ram}-${storage}-${variantPrice}`;

      if (!seen.has(key)) {
        seen.add(key);

        result.variants.push({
          ram,
          storage,
          price: variantPrice
        });
      }
    }
  }

  return result;
}

function get(raw, ...keys) {
  for (const key of keys) {
    if (raw[key]) {
      return raw[key];
    }
  }

  return null;
}

function mapSpecs(raw) {
  return {
    general: {
      brand: get(raw, "Brand"),
      model: get(raw, "Model", "Name"),
      device_type: get(raw, "Device Type", "Type"),
      release_date: get(raw, "Release Date", "Launch Date"),
      status: get(raw, "Status"),
      made_by: get(raw, "Made By", "Country")
    },

    network: {
      technology: get(raw, "Network", "Network Type"),
      sim: get(raw, "SIM Slot", "SIM"),
      sim_size: get(raw, "SIM Size"),
      speed: get(raw, "Speed"),
      bands_2g: get(raw, "2G"),
      bands_3g: get(raw, "3G"),
      bands_4g: get(raw, "4G"),
      bands_5g: get(raw, "5G"),
      wifi: get(raw, "WLAN", "WiFi", "Wi-Fi"),
      bluetooth: get(raw, "Bluetooth"),
      gps: get(raw, "GPS"),
      nfc: get(raw, "NFC"),
      usb: get(raw, "USB")
    },

    body: {
      dimensions: get(raw, "Dimensions"),
      weight: get(raw, "Weight"),
      colors: get(raw, "Colors", "Colour", "Color")
    },

    display: {
      type: get(raw, "Display Type"),
      size: get(raw, "Screen Size", "Display Size"),
      resolution: get(raw, "Resolution", "Display Resolution"),
      pixel_density: get(raw, "Pixel Density", "Display Density"),
      refresh_rate: get(raw, "Refresh Rate"),
      protection: get(raw, "Screen Protection"),
      brightness: get(raw, "Brightness"),
      touch: get(raw, "Touch Screen"),
      notch: get(raw, "Notch")
    },

    platform: {
      os: get(raw, "Operating System", "OS"),
      os_version: get(raw, "OS Version"),
      ui: get(raw, "User Interface", "UI"),
      chipset: get(raw, "Chipset"),
      cpu: get(raw, "CPU", "Processor"),
      cpu_cores: get(raw, "CPU Cores"),
      architecture: get(raw, "Architecture"),
      fabrication: get(raw, "Fabrication"),
      gpu: get(raw, "GPU")
    },

    camera: {
      main_setup: get(raw, "Camera Setup", "Main Camera"),
      main_resolution: get(raw, "Main Camera Resolution"),
      main_features: get(raw, "Camera Features"),
      aperture: get(raw, "Aperture"),
      autofocus: get(raw, "Autofocus"),
      flash: get(raw, "Flash"),
      video: get(raw, "Video Recording", "Video"),
      video_fps: get(raw, "Video FPS"),
      selfie: get(raw, "Selfie Camera", "Front Camera")
    },

    memory: {
      ram: get(raw, "RAM"),
      ram_type: get(raw, "RAM Type"),
      storage: get(raw, "Internal Storage", "Storage"),
      storage_type: get(raw, "Storage Type"),
      expandable: get(raw, "Expandable Memory"),
      otg: get(raw, "USB OTG", "OTG")
    },

    battery: {
      type: get(raw, "Battery Type"),
      capacity: get(raw, "Capacity", "Battery Capacity"),
      charging: get(raw, "Quick Charging", "Charging"),
      usb: get(raw, "USB Type-C")
    },

    sensors: {
      sensors: get(raw, "Sensors"),
      fingerprint: get(raw, "Fingerprint Sensor"),
      fingerprint_position: get(raw, "Finger Sensor Position"),
      face_unlock: get(raw, "Face Unlock")
    },

    multimedia: {
      fm: get(raw, "FM Radio"),
      speaker: get(raw, "Loudspeaker", "Speaker"),
      audio_jack: get(raw, "Audio Jack"),
      video: get(raw, "Video"),
      document_reader: get(raw, "Document Reader")
    }
  };
}

function extractImages($, model, pageUrl) {
  const images = [];

  const modelWords = normalizeModel(model)
    .split(" ")
    .filter((word) => word.length >= 2);

  let slugWords = [];

  try {
    const pathname = new URL(pageUrl).pathname;

    slugWords = pathname
      .split("/")
      .filter(Boolean)
      .pop()
      .split("-")
      .filter((word) => word.length >= 2);
  } catch {}

  /*
   * The important model identifier.
   *
   * Redmi 10C -> ["redmi", "10c"]
   * Galaxy S23 Ultra -> ["galaxy", "s23", "ultra"]
   */
  const modelIdentifiers = [
    ...new Set([
      ...modelWords,
      ...slugWords
    ])
  ];

  /*
   * Remove brand-only words.
   * These are too generic and cause unrelated phones
   * from the same brand to be included.
   */
  const genericWords = new Set([
    "xiaomi",
    "redmi",
    "samsung",
    "galaxy",
    "apple",
    "iphone",
    "google",
    "pixel",
    "phone",
    "mobile",
    "smartphone"
  ]);

  const specificIdentifiers = modelIdentifiers.filter(
    (word) => !genericWords.has(word)
  );

  $("img").each((_, img) => {
    const src =
      $(img).attr("data-src") ||
      $(img).attr("data-lazy-src") ||
      $(img).attr("data-original") ||
      $(img).attr("src");

    const url = absoluteUrl(src);

    if (!url) return;

    const lower = url.toLowerCase();

    /*
     * Ignore unrelated assets.
     */
    if (
      /logo|facebook|twitter|copy|wishlist|compare|icon|avatar|sprite|emoji|placeholder|banner|advert|ads|svg/i.test(
        lower
      )
    ) {
      return;
    }

    /*
     * Only actual image files.
     */
    if (!/\.(jpg|jpeg|png|webp)(\?|$)/i.test(lower)) {
      return;
    }

    const filename = lower
      .split("/")
      .pop()
      .split("?")[0];

    const filenameNormalized = filename
      .replace(/[-_.]/g, " ");

    /*
     * STRICT MODEL MATCH
     *
     * At least one specific model identifier must
     * appear in the filename.
     *
     * Redmi 10C:
     *   10c -> YES
     *
     * Redmi K90 Max:
     *   k90 -> NO
     *
     * Redmi Note 15:
     *   15 -> NO
     */
    if (specificIdentifiers.length) {
      const matched = specificIdentifiers.some(
        (word) => filenameNormalized.includes(word)
      );

      if (!matched) {
        return;
      }
    }

    /*
     * Extra protection:
     * If there is a numeric/model token such as 10c,
     * require that exact token.
     */
    const numericTokens = specificIdentifiers.filter(
      (word) => /\d/.test(word)
    );

    if (numericTokens.length) {
      const numericMatch = numericTokens.some(
        (word) => filenameNormalized.includes(word)
      );

      if (!numericMatch) {
        return;
      }
    }

    if (!images.includes(url)) {
      images.push(url);
    }
  });

  return images.slice(0, 10);
}

async function searchPhones(q) {
  try {
    const { data: html } = await http.get(
      `${SEARCH}${encodeURIComponent(q)}`
    );

    const $ = cheerio.load(html);
    const results = [];

    $("a[href]").each((_, a) => {
      const title = clean($(a).text());
      const href = absoluteUrl($(a).attr("href"));

      if (!title || !href) return;

      if (
        !/^https?:\/\/(www\.)?mobiledokan\.com\/mobile\//i.test(
          href
        )
      ) {
        return;
      }

      if (!results.some((x) => x.url === href)) {
        results.push({
          title,
          url: href,
          score: similarity(q, title)
        });
      }
    });

    results.sort((a, b) => b.score - a.score);

    return results.slice(0, 20);
  } catch (error) {
    return [];
  }
}

async function getPhone(model) {
  const key = normalizeModel(model);

  if (!key) {
    return null;
  }

  const cached = cache.get(key);

  if (
    cached &&
    Date.now() - cached.time < CACHE_TTL
  ) {
    return cached.data;
  }

  let page = null;

  /*
   * STEP 1
   * Normal MobileDokan search.
   */
  const results = await searchPhones(model);

  if (results.length) {
    const best = results[0];

    /*
     * Only accept a strong match.
     */
    if (best.score >= 80) {
      page = await validatePhonePage(
        best.url,
        model
      );
    }
  }

  /*
   * STEP 2
   * If search failed, use direct slug.
   */
  if (!page) {
    page = await directSlugLookup(model);
  }

  /*
   * Nothing found.
   */
  if (!page) {
    return null;
  }

  const $ = cheerio.load(page.html);

  const raw = extractTable($);
  const prices = extractPrices($);

  const title =
    clean($("h1").first().text()) ||
    page.title;

  const data = {
    name: title,

    price_bd: {
      official: prices.official,
      unofficial: prices.unofficial,
      variants: prices.variants.slice(0, 10)
    },

    specs: mapSpecs(raw),

    images: extractImages($, model, page.url),

    source: {
      website: "MobileDokan",
      url: page.url,
      fetched_at: new Date().toISOString()
    }
  };

  cache.set(key, {
    time: Date.now(),
    data
  });

  return data;
}

module.exports = {
  getPhone,
  searchPhones,
  directSlugLookup,
  generateSlugs
};
