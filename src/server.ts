import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as cheerio from "cheerio";

// ---------- Interfaces ----------

interface Listing {
  title: string;
  url: string;
  price: string;
  rooms: string;
  area: string;
  monthlyFee: string;
  description: string;
  location: string;
  imageUrl: string;
}

interface ListingDetails {
  title: string;
  location: string;
  price: string;
  pricePerSqm: string;
  propertyType: string;
  tenureType: string;
  rooms: string;
  area: string;
  balcony: string;
  patio: string;
  floor: string;
  buildYear: string;
  energyClass: string;
  monthlyFee: string;
  runningCosts: string;
  description: string;
  viewingTimes: string[];
  agentName: string;
  agentAgency: string;
  brokerUrl: string;
  imageCount: number;
  imageUrls: string[];
  visitCount: string;
  distanceToWater: string;
  downPayment: string;
  areaPriceTrend: string;
  areaAvgPricePerSqm: string;
  hasFloorPlan: boolean;
  hasBankIdBidding: boolean;
  coordinates: { lat: number; lng: number } | null;
}

interface SoldListing {
  address: string;
  location: string;
  soldPrice: string;
  priceChangePercent: string;
  saleDate: string;
  rooms: string;
  area: string;
  pricePerSqm: string;
  monthlyFee: string;
  propertyType: string;
  agency: string;
  url: string;
}

interface LocationResult {
  id: string;
  name: string;
  type: string;
}

// ---------- Constants ----------

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const COMMON_LOCATIONS: Record<string, string> = {
  botkyrka: "17885",
  danderyd: "17892",
  ekerö: "17896",
  göteborg: "17920",
  haninge: "17928",
  helsingborg: "17932",
  huddinge: "17936",
  järfälla: "17951",
  jönköping: "17748",
  lidingö: "17846",
  linköping: "17847",
  lund: "17987",
  malmö: "17989",
  nacka: "17853",
  norrköping: "18002",
  norrtälje: "18003",
  salem: "18019",
  sigtuna: "18020",
  sollentuna: "18027",
  solna: "18028",
  stockholm: "17744",
  sundbyberg: "18042",
  södertälje: "17775",
  tyresö: "17792",
  täby: "17793",
  "upplands väsby": "17798",
  "upplands-väsby": "17798",
  uppsala: "17745",
  vallentuna: "17804",
  värmdö: "17818",
  västerås: "17821",
  örebro: "17757",
  österåker: "17769",
};

const PROPERTY_TYPES: Record<string, string> = {
  villa: "villa",
  house: "villa",
  apartment: "bostadsratt",
  lägenhet: "bostadsratt",
  bostadsrätt: "bostadsratt",
  townhouse: "radhus",
  radhus: "radhus",
  holiday: "fritidsboende",
  fritidshus: "fritidsboende",
  plot: "tomt",
  tomt: "tomt",
  farm: "gard",
  gård: "gard",
};

const SORT_ORDERS: Record<string, string> = {
  newest: "newest",
  oldest: "oldest",
  cheapest: "price_asc",
  expensive: "price_desc",
  largest: "size_desc",
  smallest: "size_asc",
  lowest_fee: "fee_asc",
  highest_fee: "fee_desc",
};

// ---------- HTTP helpers ----------

// Browser render service URL (set via BROWSER_RENDER_URL env var)
let browserRenderUrl: string | undefined;

export function setBrowserRenderUrl(url: string): void {
  browserRenderUrl = url;
}

export function setBrowserRenderApiKey(key: string): void {
  browserRenderApiKey = key;
}

let browserRenderApiKey: string | undefined;

async function fetchViaRenderer(url: string): Promise<string> {
  if (!browserRenderUrl) {
    throw new Error(
      "BROWSER_RENDER_URL not configured. Set it as an environment variable."
    );
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (browserRenderApiKey) {
    headers["Authorization"] = `Bearer ${browserRenderApiKey}`;
  }

  const response = await fetch(browserRenderUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ url, timeout: 10000 }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Browser render failed (${response.status}): ${body}`);
  }

  const data = (await response.json()) as { html?: string; error?: string };
  if (data.error) {
    throw new Error(`Browser render error: ${data.error}`);
  }
  if (!data.html) {
    throw new Error("Browser render returned empty HTML");
  }
  return data.html;
}

async function fetchPage(url: string): Promise<string> {
  const html = await fetchViaRenderer(url);

  if (html.includes("Verify you are human")) {
    throw new Error(
      "Hemnet is showing a bot verification challenge. Please try again later."
    );
  }

  return html;
}

async function fetchJson(url: string): Promise<unknown> {
  // For JSON endpoints, try direct fetch first (less protected)
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
        "Accept-Language": "sv-SE,sv;q=0.9,en-US;q=0.8,en;q=0.7",
      },
    });
    if (response.ok) {
      return response.json();
    }
  } catch {
    // Direct fetch failed, fall through to renderer
  }

  // Fallback: fetch via browser renderer and extract JSON from page
  const html = await fetchViaRenderer(url);
  const preMatch = html.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
  if (preMatch) {
    try {
      return JSON.parse(preMatch[1].trim());
    } catch {
      // Not valid JSON in pre tag
    }
  }
  throw new Error(`Could not extract JSON from ${url}`);
}

// ---------- Location lookup ----------

async function findLocationId(
  location: string
): Promise<LocationResult | null> {
  const normalized = location.toLowerCase().trim();

  if (COMMON_LOCATIONS[normalized]) {
    return {
      id: COMMON_LOCATIONS[normalized],
      name: location,
      type: "kommun",
    };
  }

  try {
    const data = (await fetchJson(
      `https://www.hemnet.se/locations/show?q=${encodeURIComponent(location)}&h=1`
    )) as Array<{ id: number; name: string; location_type?: string }>;

    if (Array.isArray(data) && data.length > 0) {
      const first = data[0];
      return {
        id: String(first.id),
        name: first.name || location,
        type: first.location_type || "unknown",
      };
    }
  } catch {
    // Autocomplete failed
  }

  return null;
}

// ---------- URL builders ----------

interface SearchOptions {
  locationId?: string;
  minRooms?: number;
  maxRooms?: number;
  minPrice?: number;
  maxPrice?: number;
  minArea?: number;
  maxArea?: number;
  maxFee?: number;
  propertyTypes?: string[];
  newConstruction?: "show" | "only" | "hide";
  keywords?: string;
  openHouse?: "today" | "tomorrow" | "weekend";
  hasBalcony?: boolean;
  hasElevator?: boolean;
  daysListed?: number;
  sortOrder?: string;
}

interface SoldSearchOptions {
  locationId?: string;
  minRooms?: number;
  maxRooms?: number;
  minPrice?: number;
  maxPrice?: number;
  minArea?: number;
  maxArea?: number;
  propertyTypes?: string[];
  sortOrder?: string;
}

function buildSearchUrl(options: SearchOptions): string {
  const params = new URLSearchParams();
  if (options.locationId) params.append("location_ids[]", options.locationId);

  if (options.minRooms) params.append("rooms_min", String(options.minRooms));
  if (options.maxRooms) params.append("rooms_max", String(options.maxRooms));
  if (options.minPrice) params.append("price_min", String(options.minPrice));
  if (options.maxPrice) params.append("price_max", String(options.maxPrice));
  if (options.minArea)
    params.append("living_area_min", String(options.minArea));
  if (options.maxArea)
    params.append("living_area_max", String(options.maxArea));
  if (options.maxFee) params.append("fee_max", String(options.maxFee));

  if (options.propertyTypes && options.propertyTypes.length > 0) {
    for (const type of options.propertyTypes) {
      const mapped = PROPERTY_TYPES[type.toLowerCase()] || type;
      params.append("item_types[]", mapped);
    }
  }

  if (options.newConstruction) {
    const ncMap = { show: "1", only: "2", hide: "0" };
    params.append("new_construction", ncMap[options.newConstruction]);
  }

  if (options.keywords) params.append("keywords", options.keywords);

  if (options.openHouse) {
    params.append("upcoming_open_house", options.openHouse);
  }

  if (options.hasBalcony) params.append("balcony", "1");
  if (options.hasElevator) params.append("elevator", "1");

  if (options.daysListed) {
    const daysMap: Record<number, string> = {
      1: "1d",
      3: "3d",
      7: "1w",
      14: "2w",
      30: "1m",
    };
    params.append(
      "published",
      daysMap[options.daysListed] || String(options.daysListed)
    );
  }

  if (options.sortOrder) {
    const mapped =
      SORT_ORDERS[options.sortOrder.toLowerCase()] || options.sortOrder;
    params.append("order", mapped);
  }

  return `https://www.hemnet.se/bostader?${params.toString()}`;
}

function buildSoldSearchUrl(options: SoldSearchOptions): string {
  const params = new URLSearchParams();
  if (options.locationId) params.append("location_ids[]", options.locationId);

  if (options.minRooms) params.append("rooms_min", String(options.minRooms));
  if (options.maxRooms) params.append("rooms_max", String(options.maxRooms));
  if (options.minPrice) params.append("price_min", String(options.minPrice));
  if (options.maxPrice) params.append("price_max", String(options.maxPrice));
  if (options.minArea)
    params.append("living_area_min", String(options.minArea));
  if (options.maxArea)
    params.append("living_area_max", String(options.maxArea));

  if (options.propertyTypes && options.propertyTypes.length > 0) {
    for (const type of options.propertyTypes) {
      const mapped = PROPERTY_TYPES[type.toLowerCase()] || type;
      params.append("item_types[]", mapped);
    }
  }

  if (options.sortOrder) {
    const mapped =
      SORT_ORDERS[options.sortOrder.toLowerCase()] || options.sortOrder;
    params.append("order", mapped);
  }

  return `https://www.hemnet.se/salda/bostader?${params.toString()}`;
}

// ---------- Scrapers ----------

async function searchHemnet(
  location: string | null,
  options: Partial<Omit<SearchOptions, "locationId">> = {}
): Promise<{ listings: Listing[]; locationName: string }> {
  let locationId: string | undefined;
  let locationName = "Sverige";

  if (location) {
    const locationResult = await findLocationId(location);
    if (!locationResult) {
      throw new Error(
        `Could not find location "${location}". Try a Swedish municipality name like "Stockholm", "Göteborg", or "Upplands Väsby".`
      );
    }
    locationId = locationResult.id;
    locationName = locationResult.name;
  }

  const searchUrl = buildSearchUrl({
    locationId,
    ...options,
  });
  const html = await fetchPage(searchUrl);
  const $ = cheerio.load(html);

  const listings: Listing[] = [];

  $('a[href*="/bostad/"]')
    .slice(0, 25)
    .each((_i, el) => {
      try {
        const $el = $(el);
        const href = $el.attr("href");
        if (!href || !href.includes("/bostad/")) return;

        const allText = $el.text();
        const title = $el.find("h2").first().text().trim();
        const description = $el
          .find("p")
          .first()
          .text()
          .trim()
          .substring(0, 200);

        const priceMatch = allText.match(/(\d[\d\s]*\d)\s*kr(?!\/)/);
        const roomsMatch = allText.match(/(\d+)\s*rum/);
        const areaMatch = allText.match(/(\d+)\s*m²/);
        // Extract fee from individual text nodes to avoid adjacent digits merging
        let feeMatch: RegExpMatchArray | null = null;
        $el.find("*").each((_j, node) => {
          if (feeMatch) return false;
          const nodeText = $(node).contents().filter(function() { return this.type === "text"; }).text();
          const m = nodeText.match(/(\d[\d\s]*)\s*kr\/mån/);
          if (m) { feeMatch = m; return false; }
        });

        // Extract thumbnail image URL (check src, srcset, data-src — Hemnet lazy-loads)
        let imageUrl = "";
        $el.find("img").each((_j, imgNode) => {
          if (imageUrl) return false; // already found one
          const src = $(imgNode).attr("src") || "";
          const srcset = $(imgNode).attr("srcset") || "";
          const dataSrc = $(imgNode).attr("data-src") || "";
          // First srcset entry (highest priority — often has real URL before lazy load)
          const srcsetFirst = srcset.split(",")[0]?.trim().split(/\s+/)[0] || "";
          for (const candidate of [src, srcsetFirst, dataSrc]) {
            if (candidate.startsWith("http") && candidate.includes("hemnet")) {
              imageUrl = candidate;
              return false;
            }
          }
        });

        if (title || href) {
          listings.push({
            title,
            url: href.startsWith("http")
              ? href
              : `https://www.hemnet.se${href}`,
            price: priceMatch ? priceMatch[0].trim() : "",
            rooms: roomsMatch ? roomsMatch[0] : "",
            area: areaMatch ? areaMatch[0] : "",
            monthlyFee: feeMatch ? feeMatch[0] : "",
            description,
            location: locationName,
            imageUrl,
          });
        }
      } catch {
        // Skip malformed listing
      }
    });

  return { listings, locationName };
}

async function searchSoldHemnet(
  location: string | null,
  options: Partial<Omit<SoldSearchOptions, "locationId">> = {}
): Promise<{ listings: SoldListing[]; locationName: string }> {
  let locationId: string | undefined;
  let locationName = "Sverige";

  if (location) {
    const locationResult = await findLocationId(location);
    if (!locationResult) {
      throw new Error(
        `Could not find location "${location}". Try a Swedish municipality name like "Stockholm", "Göteborg", or "Upplands Väsby".`
      );
    }
    locationId = locationResult.id;
    locationName = locationResult.name;
  }

  const searchUrl = buildSoldSearchUrl({
    locationId,
    ...options,
  });
  const html = await fetchPage(searchUrl);
  const $ = cheerio.load(html);

  const listings: SoldListing[] = [];
  const soldSelectors =
    'a[href*="/salda/lagenhet-"], a[href*="/salda/villa-"], a[href*="/salda/radhus-"], a[href*="/salda/fritidshus-"], a[href*="/salda/tomt-"]';

  $(soldSelectors)
    .slice(0, 25)
    .each((_i, el) => {
      try {
        const $el = $(el);
        const href = $el.attr("href");
        if (!href || !href.includes("/salda/")) return;

        const allText = $el.text();
        const title = $el.find("h2").first().text().trim();

        let propertyType = "";
        if (href.includes("/villa-")) propertyType = "villa";
        else if (href.includes("/lagenhet-")) propertyType = "lägenhet";
        else if (href.includes("/radhus-")) propertyType = "radhus";
        else if (href.includes("/fritidshus-")) propertyType = "fritidshus";
        else if (href.includes("/tomt-")) propertyType = "tomt";

        const soldPriceMatch = allText.match(/Slutpris\s+([\d\s]+)\s*kr/i);
        const soldPrice = soldPriceMatch
          ? `${soldPriceMatch[1].replace(/\s/g, " ").trim()} kr`
          : "";

        let priceChangePercent = "";
        const priceChangeMatch = allText.match(
          /([+\-±]\s*\d+(?:[,.]\d+)?)\s*%/
        );
        if (priceChangeMatch) {
          priceChangePercent = `${priceChangeMatch[1].replace(/\s/g, "")}%`;
        }

        const roomsMatch = allText.match(/(\d+(?:[,.]\d+)?)\s*rum/);
        const rooms = roomsMatch ? roomsMatch[1] : "";

        let area = "";
        $el.find("p").each((_j, pEl) => {
          const pText = $(pEl).text().trim();
          const areaOnly = pText.match(/^(\d+(?:[+,]\d+)?)\s*m²$/);
          if (areaOnly) {
            area = areaOnly[0];
            return false;
          }
        });
        if (!area) {
          const areaFallback = allText.match(
            /(\d+(?:\+\d+)?(?:,\d+)?)\s*m²(?!\s*Slutpris)/
          );
          if (areaFallback && !areaFallback[0].includes("kr")) {
            area = areaFallback[0];
          }
        }

        const pricePerSqmMatch = allText.match(/([\d\s]+)\s*kr\/m²/);
        const pricePerSqm = pricePerSqmMatch
          ? `${pricePerSqmMatch[1].replace(/\s/g, " ").trim()} kr/m²`
          : "";

        const feeMatch = allText.match(/([\d\s]+)\s*kr\/mån/);
        const monthlyFee = feeMatch
          ? `${feeMatch[1].replace(/\s/g, " ").trim()} kr/mån`
          : "";

        let agency = "";
        const agencyImg = $el
          .find(
            'img[alt*="Mäklar"], img[alt*="Fastighet"], img[alt*="byrå"], img[alt*="Bjurfors"], img[alt*="Notar"]'
          )
          .first();
        if (agencyImg.length) {
          agency = agencyImg.attr("alt") || "";
        }

        const dateMatch = allText.match(/Såld\s+(\d+\s+\w+\.?\s+\d{4})/);
        const saleDate = dateMatch ? dateMatch[1].trim() : "";

        if (title || href) {
          listings.push({
            address: title,
            location: locationName,
            soldPrice,
            priceChangePercent,
            saleDate,
            rooms,
            area,
            pricePerSqm,
            monthlyFee,
            propertyType,
            agency,
            url: href.startsWith("http")
              ? href
              : `https://www.hemnet.se${href}`,
          });
        }
      } catch {
        // Skip malformed listing
      }
    });

  return { listings, locationName };
}

async function getListingDetails(url: string): Promise<ListingDetails> {
  if (!url.includes("hemnet.se/bostad/")) {
    throw new Error(
      "Invalid Hemnet listing URL. URL must contain 'hemnet.se/bostad/'"
    );
  }

  const html = await fetchPage(url);
  const $ = cheerio.load(html);

  if (
    html.includes("Sidan hittades inte") ||
    html.includes("Den här bostaden finns inte längre")
  ) {
    throw new Error("This listing has been removed from Hemnet.");
  }

  function getDefinitionByTerm(term: string): string {
    let value = "";
    $("dt").each((_i, el) => {
      if ($(el).text().includes(term)) {
        value = $(el).next("dd").text().trim();
        return false;
      }
    });
    return value;
  }

  const title = $("h1").first().text().trim();

  let location = "";
  const mapLink = $('a:contains("Visa på karta")');
  if (mapLink.length) {
    location = mapLink.parent().text().replace("Visa på karta", "").trim();
  }

  let price = "";
  $("*")
    .contents()
    .filter(function () {
      return (
        this.type === "text" && /\d[\d\s]*kr$/.test($(this).text().trim())
      );
    })
    .each((_i, el) => {
      const text = $(el).text().trim();
      if (text.match(/^\d[\d\s]*kr$/) && !text.includes("/")) {
        price = text;
        return false;
      }
    });
  if (!price) {
    const priceMatch = html.match(
      /(?:Pris|price)[^>]*>[\s]*(\d[\d\s]+kr)(?:<|[\s]*$)/im
    );
    if (priceMatch) price = priceMatch[1].trim();
  }

  const propertyType = getDefinitionByTerm("Bostadstyp");
  const tenureType = getDefinitionByTerm("Upplåtelseform");
  const rooms = getDefinitionByTerm("Antal rum");
  const area = getDefinitionByTerm("Boarea");
  const balcony = getDefinitionByTerm("Balkong");
  const patio = getDefinitionByTerm("Uteplats");
  const floor = getDefinitionByTerm("Våning");
  const buildYear = getDefinitionByTerm("Byggår");
  const energyClass = getDefinitionByTerm("Energiklass");
  const monthlyFee = getDefinitionByTerm("Avgift");
  const runningCosts = getDefinitionByTerm("Driftkostnad");
  const pricePerSqm = getDefinitionByTerm("Pris/m²");
  const visitCount = getDefinitionByTerm("Antal besök");

  let description = "";
  $("p").each((_i, el) => {
    const text = $(el).text().trim();
    if (text.length > 200) {
      description = text;
      return false;
    }
  });

  const viewingTimes: string[] = [];
  const viewingHeader = $('h2:contains("Visningstider")');
  if (viewingHeader.length) {
    const viewingText = viewingHeader.next().text();
    const timeMatches = viewingText.match(
      /\S+\s+\d+\s+\S+\s+kl\s+[\d:]+\s*-\s*[\d:]+/g
    );
    if (timeMatches) viewingTimes.push(...timeMatches);
  }
  if (viewingTimes.length === 0) {
    $('button:contains("kl")').each((_i, el) => {
      const text = $(el).text().trim();
      const timeMatch = text.match(
        /\S+\s+\d+\s+\S+\s+kl\s+[\d:]+\s*-?\s*[\d:]*/
      );
      if (timeMatch) viewingTimes.push(timeMatch[0].trim());
    });
  }

  let agentName = "";
  const agentLink = $('a[href*="/maklare/"][href*="/salda"] h2').first();
  if (agentLink.length) {
    agentName = agentLink.text().trim();
  }

  let agentAgency = "";
  let brokerUrl = "";
  const agencyLink = $(
    'a[href*="/maklare/"]:not([href*="/salda"])'
  ).first();
  if (agencyLink.length) {
    const agencyP = agencyLink.find("p").first();
    if (agencyP.length) agentAgency = agencyP.text().trim();
    const agencyHref = agencyLink.attr("href");
    if (agencyHref) {
      brokerUrl = agencyHref.startsWith("http")
        ? agencyHref
        : `https://www.hemnet.se${agencyHref}`;
    }
  }
  if (!agentAgency) {
    const agencyEl = $(
      'p:contains("Mäklarbyrå"), p:contains("Fastighetsbyrå")'
    ).first();
    if (agencyEl.length) {
      agentAgency = agencyEl.text().trim();
    }
  }

  // Extract image URLs from listing gallery
  const imageUrls: string[] = [];
  $('img[src*="bilder.hemnet.se"], img[src*="images.hemnet.se"]').each((_i, el) => {
    const src = $(el).attr("src");
    if (src && !imageUrls.includes(src) && imageUrls.length < 10) {
      imageUrls.push(src);
    }
  });
  // Also check for data-src (lazy loaded) and srcset
  if (imageUrls.length === 0) {
    $('img[data-src*="hemnet"]').each((_i, el) => {
      const src = $(el).attr("data-src");
      if (src && !imageUrls.includes(src) && imageUrls.length < 10) {
        imageUrls.push(src);
      }
    });
  }

  let imageCount = 0;
  $("*").each((_i, el) => {
    const text = $(el).text().trim();
    const match = text.match(/^(\d+)\s*bilder$/);
    if (match) {
      imageCount = parseInt(match[1], 10);
      return false;
    }
  });

  let distanceToWater = "";
  $("*").each((_i, el) => {
    const text = $(el).text().trim();
    if (text.includes("km till vatten")) {
      distanceToWater = text;
      return false;
    }
  });

  let downPayment = "";
  const dpMatch = html.match(/kontantinsats[^>]*>([^<]*\d+[^<]*kr)/i);
  if (dpMatch) downPayment = dpMatch[1].trim();

  let areaPriceTrend = "";
  const trendMatch = html.match(
    /Prisutveckling[^%]*?([+-]?\d+[,.]?\d*\s*%)/
  );
  if (trendMatch) areaPriceTrend = trendMatch[1].trim();

  let areaAvgPricePerSqm = "";
  const avgPriceMatch = html.match(/snitt[^>]*>([^<]*\d[\d\s]*kr\/m)/i);
  if (avgPriceMatch) {
    areaAvgPricePerSqm = avgPriceMatch[1].trim();
  } else {
    const altMatch = html.match(/(\d[\d\s]*kr\/m²)[^>]*snitt/i);
    if (altMatch) areaAvgPricePerSqm = altMatch[1].trim();
  }

  const hasFloorPlan = $('button:contains("Planritning")').length > 0;

  const hasBankIdBidding =
    html.toLowerCase().includes("budgivning med bankid");

  let coordinates: { lat: number; lng: number } | null = null;
  const mapsLink = $('a[href*="maps.google.com"]').first();
  if (mapsLink.length) {
    const mapsHref = mapsLink.attr("href") || "";
    const coordMatch = mapsHref.match(/ll=([\d.-]+),([\d.-]+)/);
    if (coordMatch) {
      coordinates = {
        lat: parseFloat(coordMatch[1]),
        lng: parseFloat(coordMatch[2]),
      };
    }
  }

  return {
    title,
    location,
    price,
    pricePerSqm,
    propertyType,
    tenureType,
    rooms,
    area,
    balcony,
    patio,
    floor,
    buildYear,
    energyClass,
    monthlyFee,
    runningCosts,
    description,
    viewingTimes,
    agentName,
    agentAgency,
    brokerUrl,
    imageCount,
    imageUrls,
    visitCount,
    distanceToWater,
    downPayment,
    areaPriceTrend,
    areaAvgPricePerSqm,
    hasFloorPlan,
    hasBankIdBidding,
    coordinates,
  };
}

// ---------- MCP Server factory ----------

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "mcp-hemnet",
    version: "2.0.0",
  });

  server.tool(
    "search_hemnet",
    "Search for real estate listings on Hemnet.se (Swedish property site)",
    {
      location: z
        .string()
        .optional()
        .describe(
          "Swedish location/municipality to search (e.g., 'Stockholm', 'Göteborg'). Omit for nationwide search."
        ),
      min_rooms: z
        .number()
        .optional()
        .describe("Minimum number of rooms (e.g., 2 for at least 2 rooms)"),
      max_rooms: z.number().optional().describe("Maximum number of rooms"),
      min_price: z.number().optional().describe("Minimum price in SEK"),
      max_price: z
        .number()
        .optional()
        .describe(
          "Maximum price in SEK (e.g., 3000000 for max 3 million SEK)"
        ),
      min_area: z.number().optional().describe("Minimum living area in m²"),
      max_area: z.number().optional().describe("Maximum living area in m²"),
      max_fee: z
        .number()
        .optional()
        .describe("Maximum monthly fee in SEK (for apartments)"),
      property_types: z
        .array(
          z.enum([
            "villa",
            "apartment",
            "townhouse",
            "holiday",
            "plot",
            "farm",
          ])
        )
        .optional()
        .describe("Property types to include"),
      new_construction: z
        .enum(["show", "only", "hide"])
        .optional()
        .describe(
          "Filter new construction: 'show' (include), 'only' (only new), 'hide' (exclude)"
        ),
      keywords: z
        .string()
        .optional()
        .describe(
          "Keywords to search for — property subtypes (slott, herrgård, torp, stuga, penthouse, vindsvåning) or features (pool, öppen spis, sjötomt, havsutsikt, garage)"
        ),
      open_house: z
        .enum(["today", "tomorrow", "weekend"])
        .optional()
        .describe("Filter by upcoming open house viewings"),
      has_balcony: z
        .boolean()
        .optional()
        .describe("Require balcony/patio/terrace"),
      has_elevator: z.boolean().optional().describe("Require elevator"),
      days_listed: z
        .number()
        .optional()
        .describe("Max days listed on Hemnet (1, 3, 7, 14, or 30)"),
      sort_by: z
        .enum([
          "newest",
          "oldest",
          "cheapest",
          "expensive",
          "largest",
          "smallest",
          "lowest_fee",
          "highest_fee",
        ])
        .optional()
        .describe("Sort order for results"),
    },
    async (args) => {
      try {
        const result = await searchHemnet(args.location || null, {
          minRooms: args.min_rooms,
          maxRooms: args.max_rooms,
          minPrice: args.min_price,
          maxPrice: args.max_price,
          minArea: args.min_area,
          maxArea: args.max_area,
          maxFee: args.max_fee,
          propertyTypes: args.property_types,
          newConstruction: args.new_construction,
          keywords: args.keywords,
          openHouse: args.open_house,
          hasBalcony: args.has_balcony,
          hasElevator: args.has_elevator,
          daysListed: args.days_listed,
          sortOrder: args.sort_by,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  location: result.locationName,
                  count: result.listings.length,
                  listings: result.listings,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "list_hemnet_locations",
    "List commonly supported Swedish locations for Hemnet search",
    {},
    async () => {
      const locations = Object.entries(COMMON_LOCATIONS)
        .filter(([key]) => !key.includes("-"))
        .map(([name, id]) => ({
          name: name.charAt(0).toUpperCase() + name.slice(1),
          id,
        }));

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                locations,
                note: "You can also search for any Swedish municipality by name.",
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  server.tool(
    "get_hemnet_listing",
    "Get detailed information about a specific Hemnet listing",
    {
      url: z
        .string()
        .describe(
          "Full Hemnet listing URL (e.g., 'https://www.hemnet.se/bostad/lagenhet-2rum-...')"
        ),
    },
    async (args) => {
      try {
        const details = await getListingDetails(args.url);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ url: args.url, ...details }, null, 2),
            },
          ],
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "search_sold_hemnet",
    "Search for sold apartment prices (slutpriser) on Hemnet.se",
    {
      location: z
        .string()
        .optional()
        .describe(
          "Swedish location/municipality to search (e.g., 'Stockholm', 'Göteborg'). Omit for nationwide search."
        ),
      min_rooms: z.number().optional().describe("Minimum number of rooms"),
      max_rooms: z.number().optional().describe("Maximum number of rooms"),
      min_price: z
        .number()
        .optional()
        .describe("Minimum sold price in SEK"),
      max_price: z
        .number()
        .optional()
        .describe("Maximum sold price in SEK"),
      min_area: z.number().optional().describe("Minimum living area in m²"),
      max_area: z.number().optional().describe("Maximum living area in m²"),
      property_types: z
        .array(
          z.enum([
            "villa",
            "apartment",
            "townhouse",
            "holiday",
            "plot",
            "farm",
          ])
        )
        .optional()
        .describe("Property types to include"),
      sort_by: z
        .enum([
          "newest",
          "oldest",
          "cheapest",
          "expensive",
          "largest",
          "smallest",
        ])
        .optional()
        .describe("Sort order for results"),
    },
    async (args) => {
      try {
        const result = await searchSoldHemnet(args.location || null, {
          minRooms: args.min_rooms,
          maxRooms: args.max_rooms,
          minPrice: args.min_price,
          maxPrice: args.max_price,
          minArea: args.min_area,
          maxArea: args.max_area,
          propertyTypes: args.property_types,
          sortOrder: args.sort_by,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  location: result.locationName,
                  count: result.listings.length,
                  listings: result.listings,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    }
  );

  return server;
}
