#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { chromium, Browser, BrowserContext } from "playwright";

interface Listing {
  title: string;
  url: string;
  price: string;
  rooms: string;
  area: string;
  monthlyFee: string;
  description: string;
  location: string;
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
  imageCount: number;
  visitCount: string;
  distanceToWater: string;
  // New fields
  downPayment: string;
  areaPriceTrend: string;
  areaAvgPricePerSqm: string;
  hasFloorPlan: boolean;
  hasBankIdBidding: boolean;
  coordinates: { lat: number; lng: number } | null;
}

interface LocationResult {
  id: string;
  name: string;
  type: string;
}

let browser: Browser | null = null;
let context: BrowserContext | null = null;

async function getBrowserContext(): Promise<BrowserContext> {
  if (!browser) {
    browser = await chromium.launch({
      headless: true,
      args: ["--disable-blink-features=AutomationControlled"],
    });
  }
  if (!context) {
    context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      viewport: { width: 1920, height: 1080 },
    });
  }
  return context;
}

// Common Swedish location IDs for quick lookup
const COMMON_LOCATIONS: Record<string, string> = {
  "stockholm": "18031",
  "göteborg": "17920",
  "malmö": "17744",
  "uppsala": "17903",
  "upplands väsby": "17798",
  "upplands-väsby": "17798",
  "sollentuna": "17858",
  "solna": "17832",
  "sundbyberg": "17842",
  "nacka": "17829",
  "huddinge": "17923",
  "järfälla": "17893",
  "täby": "17836",
  "linköping": "17773",
  "örebro": "17849",
  "västerås": "17864",
  "helsingborg": "17761",
  "norrköping": "17774",
  "jönköping": "17770",
  "lund": "17746",
};

async function findLocationId(location: string): Promise<LocationResult | null> {
  const normalizedLocation = location.toLowerCase().trim();

  // Check common locations first
  if (COMMON_LOCATIONS[normalizedLocation]) {
    return {
      id: COMMON_LOCATIONS[normalizedLocation],
      name: location,
      type: "kommun",
    };
  }

  // Try to fetch from Hemnet's autocomplete API
  const ctx = await getBrowserContext();
  const page = await ctx.newPage();

  try {
    // Use the autocomplete endpoint
    const response = await page.request.get(
      `https://www.hemnet.se/locations/show?q=${encodeURIComponent(location)}&h=1`,
      {
        headers: {
          Accept: "application/json",
          "Accept-Language": "sv-SE,sv;q=0.9,en-US;q=0.8,en;q=0.7",
        },
      }
    );

    if (response.ok()) {
      const data = await response.json();
      if (Array.isArray(data) && data.length > 0) {
        const first = data[0];
        return {
          id: String(first.id),
          name: first.name || location,
          type: first.location_type || "unknown",
        };
      }
    }
  } catch {
    // Fallback: try to search and extract from redirect
  } finally {
    await page.close();
  }

  return null;
}

interface SearchOptions {
  locationId: string;
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

// Property type mappings
const PROPERTY_TYPES: Record<string, string> = {
  "villa": "villa",
  "house": "villa",
  "apartment": "lagenhet",
  "lägenhet": "lagenhet",
  "townhouse": "radhus",
  "radhus": "radhus",
  "holiday": "fritidsboende",
  "fritidshus": "fritidsboende",
  "plot": "tomt",
  "tomt": "tomt",
  "farm": "gard",
  "gård": "gard",
};

// Sort order mappings
const SORT_ORDERS: Record<string, string> = {
  "newest": "newest",
  "oldest": "oldest",
  "cheapest": "price_asc",
  "expensive": "price_desc",
  "largest": "size_desc",
  "smallest": "size_asc",
  "lowest_fee": "fee_asc",
  "highest_fee": "fee_desc",
};

function buildSearchUrl(options: SearchOptions): string {
  const params = new URLSearchParams();
  params.append("location_ids[]", options.locationId);

  if (options.minRooms) params.append("rooms_min", String(options.minRooms));
  if (options.maxRooms) params.append("rooms_max", String(options.maxRooms));
  if (options.minPrice) params.append("price_min", String(options.minPrice));
  if (options.maxPrice) params.append("price_max", String(options.maxPrice));
  if (options.minArea) params.append("living_area_min", String(options.minArea));
  if (options.maxArea) params.append("living_area_max", String(options.maxArea));
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
    const ohMap = { today: "today", tomorrow: "tomorrow", weekend: "weekend" };
    params.append("upcoming_open_house", ohMap[options.openHouse]);
  }

  if (options.hasBalcony) params.append("balcony", "1");
  if (options.hasElevator) params.append("elevator", "1");

  if (options.daysListed) {
    const daysMap: Record<number, string> = { 1: "1d", 3: "3d", 7: "1w", 14: "2w", 30: "1m" };
    params.append("published", daysMap[options.daysListed] || String(options.daysListed));
  }

  if (options.sortOrder) {
    const mapped = SORT_ORDERS[options.sortOrder.toLowerCase()] || options.sortOrder;
    params.append("order", mapped);
  }

  return `https://www.hemnet.se/bostader?${params.toString()}`;
}

async function searchHemnet(
  location: string,
  options: Partial<Omit<SearchOptions, "locationId">> = {}
): Promise<{ listings: Listing[]; locationName: string }> {
  // Find location ID
  const locationResult = await findLocationId(location);

  if (!locationResult) {
    throw new Error(
      `Could not find location "${location}". Try a Swedish municipality name like "Stockholm", "Göteborg", or "Upplands Väsby".`
    );
  }

  const searchUrl = buildSearchUrl({ locationId: locationResult.id, ...options });
  const ctx = await getBrowserContext();
  const page = await ctx.newPage();
  page.setDefaultTimeout(3000); // 3 second timeout for all operations

  try {
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 5000 });
    await page.waitForTimeout(1000);

    // Check for Cloudflare challenge
    const pageContent = await page.content();
    if (pageContent.includes("Verify you are human")) {
      throw new Error(
        "Hemnet is showing a bot verification challenge. Please try again later."
      );
    }

    const listings: Listing[] = [];
    const listingLinks = page.locator('a[href*="/bostad/"]');
    const linkCount = await listingLinks.count();

    for (let i = 0; i < Math.min(linkCount, 25); i++) {
      try {
        const listing = listingLinks.nth(i);
        const href = await listing.getAttribute("href");

        if (!href || !href.includes("/bostad/")) continue;

        const allText = (await listing.textContent()) || "";
        const titleEl = listing.locator("h2").first();
        const title = (await titleEl.textContent().catch(() => "")) || "";

        // Extract data using regex patterns
        const priceMatch = allText.match(/(\d[\d\s]*\d)\s*kr(?!\/)/);
        const roomsMatch = allText.match(/(\d+)\s*rum/);
        const areaMatch = allText.match(/(\d+)\s*m²/);
        const feeMatch = allText.match(/(\d[\d\s]*)\s*kr\/mån/);

        // Try to get description from paragraph
        const descEl = listing.locator("p").first();
        const description = (await descEl.textContent().catch(() => "")) || "";

        if (title || href) {
          listings.push({
            title: title.trim(),
            url: href.startsWith("http")
              ? href
              : `https://www.hemnet.se${href}`,
            price: priceMatch ? priceMatch[0].trim() : "",
            rooms: roomsMatch ? roomsMatch[0] : "",
            area: areaMatch ? areaMatch[0] : "",
            monthlyFee: feeMatch ? feeMatch[0] : "",
            description: description.trim().substring(0, 200),
            location: locationResult.name,
          });
        }
      } catch {
        continue;
      }
    }

    return { listings, locationName: locationResult.name };
  } finally {
    await page.close();
  }
}

async function getListingDetails(url: string): Promise<ListingDetails> {
  if (!url.includes("hemnet.se/bostad/")) {
    throw new Error("Invalid Hemnet listing URL. URL must contain 'hemnet.se/bostad/'");
  }

  const ctx = await getBrowserContext();
  const page = await ctx.newPage();
  page.setDefaultTimeout(3000); // 3 second timeout for all operations

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 5000 });
    await page.waitForTimeout(1000);

    // Check for Cloudflare challenge or removed listing
    const pageContent = await page.content();
    if (pageContent.includes("Verify you are human")) {
      throw new Error("Hemnet is showing a bot verification challenge. Please try again later.");
    }
    if (pageContent.includes("Sidan hittades inte") || pageContent.includes("Den här bostaden finns inte längre")) {
      throw new Error("This listing has been removed from Hemnet.");
    }

    // Helper function to get text by term label
    async function getDefinitionByTerm(term: string): Promise<string> {
      try {
        const termEl = page.locator(`dt:has-text("${term}")`).first();
        const defEl = termEl.locator("xpath=following-sibling::dd[1]");
        return (await defEl.textContent())?.trim() || "";
      } catch {
        return "";
      }
    }

    // Extract title
    const title = await page.locator("h1").first().textContent().catch(() => "") || "";

    // Extract location (text after title)
    const locationEl = page.locator('a:has-text("Visa på karta")').locator("xpath=preceding-sibling::*[1]");
    const location = await locationEl.textContent().catch(() => "") || "";

    // Extract price
    const priceEl = page.locator("text=/\\d[\\d\\s]*kr$/").first();
    const price = await priceEl.textContent().catch(() => "") || "";

    // Extract property details
    const propertyType = await getDefinitionByTerm("Bostadstyp");
    const tenureType = await getDefinitionByTerm("Upplåtelseform");
    const rooms = await getDefinitionByTerm("Antal rum");
    const area = await getDefinitionByTerm("Boarea");
    const balcony = await getDefinitionByTerm("Balkong");
    const patio = await getDefinitionByTerm("Uteplats");
    const floor = await getDefinitionByTerm("Våning");
    const buildYear = await getDefinitionByTerm("Byggår");
    const energyClass = await getDefinitionByTerm("Energiklass");
    const monthlyFee = await getDefinitionByTerm("Avgift");
    const runningCosts = await getDefinitionByTerm("Driftkostnad");
    const pricePerSqm = await getDefinitionByTerm("Pris/m²");
    const visitCount = await getDefinitionByTerm("Antal besök");

    // Extract full description - look for the long paragraph in the info region
    let description = "";
    try {
      // The description is typically a long paragraph after the property details
      const allParagraphs = page.locator('p');
      const pCount = await allParagraphs.count();
      for (let i = 0; i < pCount; i++) {
        const text = await allParagraphs.nth(i).textContent().catch(() => "") || "";
        // Description paragraphs are usually long and start with "Välkommen" or similar
        if (text.length > 200) {
          description = text;
          break;
        }
      }
    } catch {
      // Fallback
    }

    // Extract viewing times
    const viewingTimes: string[] = [];
    try {
      // Look for viewing times section
      const viewingSection = page.locator('h2:has-text("Visningstider")').locator("xpath=following-sibling::*");
      const viewingText = await viewingSection.first().textContent().catch(() => "") || "";
      // Use \S+ instead of \w+ to capture Swedish chars (Sön, Mån, etc.)
      const timeMatches = viewingText.match(/\S+\s+\d+\s+\S+\s+kl\s+[\d:]+\s*-\s*[\d:]+/g);
      if (timeMatches) {
        viewingTimes.push(...timeMatches);
      }
    } catch {
      // Fallback: try button text
      const viewingButtons = page.locator('button:has-text("kl")');
      const viewingCount = await viewingButtons.count();
      for (let i = 0; i < viewingCount; i++) {
        const text = await viewingButtons.nth(i).textContent().catch(() => "");
        if (text) {
          // Use \S+ to match any non-whitespace (handles Swedish ö, ä, å)
          const timeMatch = text.match(/\S+\s+\d+\s+\S+\s+kl\s+[\d:]+\s*-?\s*[\d:]*/);
          if (timeMatch) viewingTimes.push(timeMatch[0].trim());
        }
      }
    }

    // Extract agent info - look for agent link with heading
    let agentName = "";
    try {
      const agentLink = page.locator('a[href*="/maklare/"][href*="/salda"] h2').first();
      agentName = await agentLink.textContent().catch(() => "") || "";
    } catch {
      // Fallback
    }

    // Extract agency name
    let agentAgency = "";
    try {
      const agencyLink = page.locator('a[href*="/maklare/"]:not([href*="/salda"]) p').first();
      agentAgency = await agencyLink.textContent().catch(() => "") || "";
    } catch {
      // Fallback
      const agencyEl = page.locator('p:has-text("Mäklarbyrå"), p:has-text("Fastighetsbyrå")').first();
      agentAgency = await agencyEl.textContent().catch(() => "") || "";
    }

    // Extract image count
    let imageCount = 0;
    const imageCountText = await page.locator('text=/\\d+\\s*bilder/').first().textContent().catch(() => "");
    const imageMatch = imageCountText?.match(/(\d+)\s*bilder/);
    if (imageMatch) imageCount = parseInt(imageMatch[1], 10);

    // Extract distance to water
    const waterEl = page.locator('text=/km till vatten/').first();
    const distanceToWater = await waterEl.textContent().catch(() => "") || "";

    // NEW: Extract down payment (kontantinsats)
    let downPayment = "";
    try {
      const downPaymentEl = page.locator('text=/kontantinsats/i').locator("xpath=following-sibling::*").first();
      downPayment = await downPaymentEl.textContent().catch(() => "") || "";
      if (!downPayment) {
        // Alternative: look for the value after "Minsta kontantinsats"
        const allText = await page.content();
        const dpMatch = allText.match(/kontantinsats[^>]*>([^<]*\d+[^<]*kr)/i);
        if (dpMatch) downPayment = dpMatch[1].trim();
      }
    } catch {
      // Not available
    }

    // NEW: Extract area price trend
    let areaPriceTrend = "";
    let areaAvgPricePerSqm = "";
    try {
      // Look for percentage pattern (e.g., "-5,6%" or "+3,2%") in the area stats section
      const allText = await page.content();

      // Find price trend - typically appears near "Prisutveckling" as a percentage
      const trendMatch = allText.match(/Prisutveckling[^%]*?([+-]?\d+[,.]?\d*\s*%)/);
      if (trendMatch) {
        areaPriceTrend = trendMatch[1].trim();
      }

      // Find average price per sqm in area - typically appears near "Kvadratmeterpris" or "kr/m²"
      const avgPriceMatch = allText.match(/snitt[^>]*>([^<]*\d[\d\s]*kr\/m)/i);
      if (avgPriceMatch) {
        areaAvgPricePerSqm = avgPriceMatch[1].trim();
      } else {
        // Alternative: look for the pattern in market data section
        const altMatch = allText.match(/(\d[\d\s]*kr\/m²)[^>]*snitt/i);
        if (altMatch) {
          areaAvgPricePerSqm = altMatch[1].trim();
        }
      }
    } catch {
      // Not available
    }

    // NEW: Check for floor plan
    const hasFloorPlan = await page.locator('button:has-text("Planritning")').isVisible().catch(() => false);

    // NEW: Check for BankID bidding
    const hasBankIdBidding = await page.locator('text=/budgivning med BankID/i').isVisible().catch(() => false);

    // NEW: Extract coordinates from Google Maps link
    let coordinates: { lat: number; lng: number } | null = null;
    try {
      const mapsLink = page.locator('a[href*="maps.google.com"]').first();
      const href = await mapsLink.getAttribute("href").catch(() => "") || "";
      const coordMatch = href.match(/ll=([\d.-]+),([\d.-]+)/);
      if (coordMatch) {
        coordinates = {
          lat: parseFloat(coordMatch[1]),
          lng: parseFloat(coordMatch[2]),
        };
      }
    } catch {
      // Not available
    }

    return {
      title: title.trim(),
      location: location.trim(),
      price: price.trim(),
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
      description: description.trim(),
      viewingTimes,
      agentName: agentName.trim(),
      agentAgency: agentAgency.trim(),
      imageCount,
      visitCount,
      distanceToWater: distanceToWater.trim(),
      // New fields
      downPayment: downPayment.trim(),
      areaPriceTrend: areaPriceTrend.trim(),
      areaAvgPricePerSqm: areaAvgPricePerSqm.trim(),
      hasFloorPlan,
      hasBankIdBidding,
      coordinates,
    };
  } finally {
    await page.close();
  }
}

// Create MCP server
const server = new McpServer({
  name: "mcp-hemnet",
  version: "1.0.0",
});

// Register the search tool
server.tool(
  "search_hemnet",
  "Search for real estate listings on Hemnet.se (Swedish property site)",
  {
    location: z
      .string()
      .describe(
        "Swedish location/municipality to search (e.g., 'Upplands Väsby', 'Stockholm', 'Göteborg')"
      ),
    min_rooms: z
      .number()
      .optional()
      .describe("Minimum number of rooms (e.g., 2 for at least 2 rooms)"),
    max_rooms: z
      .number()
      .optional()
      .describe("Maximum number of rooms"),
    min_price: z
      .number()
      .optional()
      .describe("Minimum price in SEK"),
    max_price: z
      .number()
      .optional()
      .describe("Maximum price in SEK (e.g., 3000000 for max 3 million SEK)"),
    min_area: z
      .number()
      .optional()
      .describe("Minimum living area in m²"),
    max_area: z
      .number()
      .optional()
      .describe("Maximum living area in m²"),
    max_fee: z
      .number()
      .optional()
      .describe("Maximum monthly fee in SEK (for apartments)"),
    property_types: z
      .array(z.string())
      .optional()
      .describe("Property types: 'villa', 'apartment', 'townhouse', 'holiday', 'plot', 'farm'"),
    new_construction: z
      .enum(["show", "only", "hide"])
      .optional()
      .describe("Filter new construction: 'show' (include), 'only' (only new), 'hide' (exclude)"),
    keywords: z
      .string()
      .optional()
      .describe("Keywords to search for (e.g., 'pool', 'fireplace', 'garage')"),
    open_house: z
      .enum(["today", "tomorrow", "weekend"])
      .optional()
      .describe("Filter by upcoming open house viewings"),
    has_balcony: z
      .boolean()
      .optional()
      .describe("Require balcony/patio/terrace"),
    has_elevator: z
      .boolean()
      .optional()
      .describe("Require elevator"),
    days_listed: z
      .number()
      .optional()
      .describe("Max days listed on Hemnet (1, 3, 7, 14, or 30)"),
    sort_by: z
      .enum(["newest", "oldest", "cheapest", "expensive", "largest", "smallest", "lowest_fee", "highest_fee"])
      .optional()
      .describe("Sort order for results"),
  },
  async ({ location, min_rooms, max_rooms, min_price, max_price, min_area, max_area, max_fee, property_types, new_construction, keywords, open_house, has_balcony, has_elevator, days_listed, sort_by }) => {
    try {
      const { listings, locationName } = await searchHemnet(location, {
        minRooms: min_rooms,
        maxRooms: max_rooms,
        minPrice: min_price,
        maxPrice: max_price,
        minArea: min_area,
        maxArea: max_area,
        maxFee: max_fee,
        propertyTypes: property_types,
        newConstruction: new_construction,
        keywords,
        openHouse: open_house,
        hasBalcony: has_balcony,
        hasElevator: has_elevator,
        daysListed: days_listed,
        sortOrder: sort_by,
      });

      const result = {
        location: locationName,
        count: listings.length,
        listings,
      };

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
          },
        ],
        isError: true,
      };
    }
  }
);

// Register a tool to list supported locations
server.tool(
  "list_hemnet_locations",
  "List commonly supported Swedish locations for Hemnet search",
  {},
  async () => {
    const locations = Object.entries(COMMON_LOCATIONS)
      .map(([name, id]) => ({ name: name.charAt(0).toUpperCase() + name.slice(1), id }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ locations, note: "You can also search for any Swedish municipality by name." }, null, 2),
        },
      ],
    };
  }
);

// Register the get listing details tool
server.tool(
  "get_hemnet_listing",
  "Get detailed information about a specific Hemnet listing",
  {
    url: z
      .string()
      .describe("Full Hemnet listing URL (e.g., 'https://www.hemnet.se/bostad/lagenhet-2rum-...')"),
  },
  async ({ url }) => {
    try {
      const details = await getListingDetails(url);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ ...details, url }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
          },
        ],
        isError: true,
      };
    }
  }
);

// Cleanup on exit
async function cleanup() {
  if (context) {
    await context.close();
    context = null;
  }
  if (browser) {
    await browser.close();
    browser = null;
  }
}

process.on("SIGINT", async () => {
  await cleanup();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await cleanup();
  process.exit(0);
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
