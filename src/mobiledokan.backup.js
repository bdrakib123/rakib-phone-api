const axios = require("axios");
const cheerio = require("cheerio");

const BASE = "https://www.mobiledokan.com";
const SEARCH = `${BASE}/?s=`;

const http = axios.create({
  timeout: 20000,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/152 Mobile Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9"
  }
});

const cache = new Map();
const CACHE_TTL = 6 * 60 * 60 * 1000;

function clean(value) {
  return String(value || "")
    .replace(/\\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function absoluteUrl(href) {
  if (!href) return null;
  try {
    return new URL(href, BASE).href;
  } catch {
    return null;
  }
}

function unique(arr) {
  return [...new Set(arr.filter(Boolean))];
}

function extractTable($, root) {
  const out = {};

  $(root).find("tr").each((_, tr) => {
    const cells = $(tr)
      .find("th,td")
      .map((__, el) => clean($(el).text()))
      .get()
      .filter(Boolean);

    if (cells.length >= 2) {
      const key = cells[0].replace(/:$/, "");
      const value = cells.slice(1).join(" | ");
      if (key && value) out[key] = value;
    }
  });

  return out;
}

function sectionForHeading($, heading) {
  const result = {};
  let node = heading.next();

  // Collect tables/definition lists until the next heading of same/higher level.
  for (let i = 0; i < 20 && node.length; i++, node = node.next()) {
    const tag = String(node[0]?.name || "").toLowerCase();
    if (/^h[1-6]$/.test(tag)) break;

    if (tag === "table") {
      Object.assign(result, extractTable($, node));
    } else {
      $(node).find("table").each((_, table) => {
        Object.assign(result, extractTable($, table));
      });
    }
  }

  return result;
}

function parsePrice(text) {
  const m = clean(text).match(/(?:৳|BDT\\.?|Tk\\.?|Taka\\s*)\\s*([0-9][0-9,]*(?:\\.\\d+)?)/i);
  if (!m) return null;
  return Number(m[1].replace(/,/g, ""));
}

function findPrices($) {
  const prices = [];
  $("body *").each((_, el) => {
    const text = clean($(el).text());
    if (!text || text.length > 300) return;

    const official = /official/i.test(text);
    const unofficial = /unofficial/i.test(text);
    const p = parsePrice(text);

    if (p && (official || unofficial)) {
      prices.push({
        type: official ? "official" : "unofficial",
        price_bdt: p,
        text
      });
    }
  });

  // Prefer shorter, more specific price snippets.
  prices.sort((a, b) => a.text.length - b.text.length);
  const result = { official: [], unofficial: [] };

  for (const x of prices) {
    if (!result[x.type].some(v => v.price_bdt === x.price_bdt)) {
      result[x.type].push(x);
    }
  }

  return result;
}

function mapSpecs(raw) {
  const get = (...keys) => {
    for (const key of keys) {
      if (raw[key]) return raw[key];
    }
    return null;
  };

  return {
    general: {
      brand: get("Brand"),
      model: get("Model", "Name"),
      device_type: get("Device Type", "Category"),
      release_date: get("Release Date", "Launch Date"),
      status: get("Status", "Market Status"),
      made_by: get("Made By")
    },
    network: {
      technology: get("Network", "Network Type"),
      sim: get("SIM Slot", "Network Sim"),
      sim_size: get("SIM Size"),
      speed: get("Speed"),
      bands_2g: get("Network 2G"),
      bands_3g: get("Network 3G"),
      bands_4g: get("Network 4G"),
      bands_5g: get("Network 5G"),
      wifi: get("WLAN", "WiFi"),
      bluetooth: get("Bluetooth"),
      gps: get("GPS"),
      nfc: get("NFC"),
      usb: get("USB")
    },
    body: {
      dimensions: get("Height", "Body Dimensions", "Dimensions"),
      width: get("Width"),
      thickness: get("Thickness"),
      weight: get("Weight", "Body Weight"),
      colors: get("Colors", "Body Color")
    },
    display: {
      type: get("Display Type"),
      size: get("Screen Size", "Display Size"),
      resolution: get("Resolution", "Display Resolution"),
      pixel_density: get("Pixel Density", "Display Density"),
      refresh_rate: get("Refresh Rate"),
      protection: get("Screen Protection"),
      brightness: get("Brightness"),
      touch: get("Touch Screen", "Display Multitouch"),
      notch: get("Notch")
    },
    platform: {
      os: get("Operating System"),
      os_version: get("OS Version"),
      ui: get("User Interface"),
      chipset: get("Chipset"),
      cpu: get("CPU"),
      cpu_cores: get("CPU Cores"),
      architecture: get("Architecture"),
      fabrication: get("Fabrication"),
      gpu: get("GPU")
    },
    camera: {
      main_setup: get("Camera Setup"),
      main_resolution: get("Resolution"),
      main_features: get("Camera Features"),
      aperture: get("Aperture"),
      autofocus: get("Autofocus"),
      flash: get("Flash"),
      video: get("Video Recording"),
      video_fps: get("Video FPS"),
      selfie: get("Selfie Camera", "Front Camera")
    },
    memory: {
      ram: get("RAM"),
      ram_type: get("RAM Type"),
      storage: get("Internal Storage", "Storage"),
      storage_type: get("Storage Type"),
      expandable: get("Expandable Memory"),
      otg: get("USB OTG")
    },
    battery: {
      type: get("Battery Type"),
      capacity: get("Capacity"),
      charging: get("Quick Charging", "Charging"),
      usb: get("USB Type-C")
    },
    sensors: {
      sensors: get("Sensors", "Light Sensor"),
      fingerprint: get("Fingerprint Sensor"),
      fingerprint_position: get("Finger Sensor Position"),
      face_unlock: get("Face Unlock")
    },
    multimedia: {
      fm: get("FM Radio"),
      speaker: get("Loudspeaker"),
      audio_jack: get("Audio Jack"),
      video: get("Video"),
      document_reader: get("Document Reader")
    }
  };
}

async function searchPhones(q) {
  const url = `${SEARCH}${encodeURIComponent(q)}`;
  const { data: html } = await http.get(url);
  const $ = cheerio.load(html);

  const results = [];
  $("a[href]").each((_, a) => {
    const title = clean($(a).text());
    const href = absoluteUrl($(a).attr("href"));

    if (!title || !href) return;
    if (!/mobiledokan\.com\/mobile\//i.test(href)) return;

    if (!results.some(x => x.url === href)) {
      results.push({ title, url: href });
    }
  });

  // Some site layouts expose product links without /mobile/.
  $("a[href]").each((_, a) => {
    const title = clean($(a).text());
    const href = absoluteUrl($(a).attr("href"));
    if (!title || !href) return;
    if (!/mobiledokan\.com\//i.test(href)) return;
    if (!/(phone|xiaomi|samsung|iphone|realme|vivo|oppo|oneplus|tecno|infinix)/i.test(href)) return;

    if (!results.some(x => x.url === href)) {
      results.push({ title, url: href });
    }
  });

  return results.slice(0, 15);
}

async function getPhone(model) {
  const key = model.toLowerCase().trim();

  const cached = cache.get(key);
  if (cached && Date.now() - cached.time < CACHE_TTL) {
    return cached.data;
  }

  const searchResults = await searchPhones(model);
  if (!searchResults.length) return null;

  // Rank exact-ish title matches first.
  const words = key.split(/\\s+/).filter(Boolean);
  searchResults.sort((a, b) => {
    const at = a.title.toLowerCase();
    const bt = b.title.toLowerCase();
    const as = words.reduce((n, w) => n + (at.includes(w) ? 1 : 0), 0);
    const bs = words.reduce((n, w) => n + (bt.includes(w) ? 1 : 0), 0);
    return bs - as;
  });

  const page = await http.get(searchResults[0].url);
  const $ = cheerio.load(page.data);

  const raw = {};
  $("table tr").each((_, tr) => {
    const cells = $(tr).find("th,td").map((__, el) => clean($(el).text())).get().filter(Boolean);
    if (cells.length >= 2) raw[cells[0].replace(/:$/, "")] = cells.slice(1).join(" | ");
  });

  const prices = findPrices($);
  const title = clean($("h1").first().text()) || searchResults[0].title;

  const images = unique(
    $("img")
      .map((_, img) => $(img).attr("src") || $(img).attr("data-src"))
      .get()
      .map(absoluteUrl)
      .filter(x => x && /mobiledokan/i.test(x))
  ).slice(0, 8);

  const data = {
    name: title,
    price_bd: {
      official: prices.official[0]?.price_bdt ?? null,
      unofficial: prices.unofficial[0]?.price_bdt ?? null,
      variants: unique(
        [...prices.official, ...prices.unofficial]
          .slice(0, 10)
          .map(x => x.text)
      )
    },
    specs: mapSpecs(raw),
    images,
    source: {
      website: "MobileDokan",
      url: searchResults[0].url,
      fetched_at: new Date().toISOString()
    }
  };

  cache.set(key, { time: Date.now(), data });
  return data;
}

module.exports = { getPhone, searchPhones };