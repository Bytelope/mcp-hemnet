#!/usr/bin/env npx ts-node

/**
 * Script to fetch correct location IDs from Hemnet's GraphQL API
 * Run with: npx ts-node scripts/fetch-location-ids.ts
 */

const LOCATIONS_TO_VERIFY = [
  "Stockholm",
  "Göteborg",
  "Malmö",
  "Uppsala",
  "Upplands Väsby",
  "Sollentuna",
  "Solna",
  "Sundbyberg",
  "Nacka",
  "Huddinge",
  "Järfälla",
  "Täby",
  "Linköping",
  "Örebro",
  "Västerås",
  "Helsingborg",
  "Norrköping",
  "Jönköping",
  "Lund",
  // Additional Stockholm-area municipalities
  "Vallentuna",
  "Sigtuna",
  "Danderyd",
  "Lidingö",
  "Tyresö",
  "Haninge",
  "Botkyrka",
  "Salem",
  "Ekerö",
  "Värmdö",
  "Österåker",
  "Norrtälje",
  "Södertälje",
];

interface LocationHit {
  location: {
    id: string;
    fullName: string;
    parentFullName: string;
    type: string;
  };
}

interface GraphQLResponse {
  data: {
    autocompleteLocations: {
      hits: LocationHit[];
    };
  };
}

async function fetchLocationId(searchString: string): Promise<{ id: string; name: string; type: string } | null> {
  const query = {
    operationName: "locationSearch",
    variables: { searchString, limit: 40 },
    query: `query locationSearch($searchString: String!, $limit: Int!) {
      autocompleteLocations(
        query: $searchString
        limit: $limit
        highlightOptions: {escapeHTML: false, preTag: "", postTag: ""}
      ) {
        hits {
          location {
            id
            fullName
            parentFullName
            type
          }
        }
      }
    }`,
  };

  const response = await fetch("https://www.hemnet.se/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:145.0) Gecko/20100101 Firefox/145.0",
      "Accept": "*/*",
      "Accept-Language": "en-US,en;q=0.5",
      "hemnet-application-version": "www-0.0.1",
      "Origin": "https://www.hemnet.se",
      "Referer": "https://www.hemnet.se/bostader",
    },
    body: JSON.stringify(query),
  });

  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as GraphQLResponse;
  const hits = data?.data?.autocompleteLocations?.hits || [];

  // Find best match - prefer municipality type with exact name match
  const searchLower = searchString.toLowerCase();

  // First try: exact municipality match
  const exactMunicipality = hits.find(
    (hit) =>
      hit.location.type === "municipality" &&
      hit.location.fullName.toLowerCase() === searchLower
  );
  if (exactMunicipality) {
    return {
      id: exactMunicipality.location.id,
      name: exactMunicipality.location.fullName,
      type: exactMunicipality.location.type,
    };
  }

  // Second try: municipality containing the search string
  const partialMunicipality = hits.find(
    (hit) =>
      hit.location.type === "municipality" &&
      hit.location.fullName.toLowerCase().includes(searchLower)
  );
  if (partialMunicipality) {
    return {
      id: partialMunicipality.location.id,
      name: partialMunicipality.location.fullName,
      type: partialMunicipality.location.type,
    };
  }

  // Fallback: first result
  if (hits.length > 0) {
    return {
      id: hits[0].location.id,
      name: hits[0].location.fullName,
      type: hits[0].location.type,
    };
  }

  return null;
}

async function main() {
  console.log("Fetching location IDs from Hemnet GraphQL API...\n");

  const results: Record<string, { id: string; name: string; type: string }> = {};
  const errors: string[] = [];

  for (const location of LOCATIONS_TO_VERIFY) {
    const result = await fetchLocationId(location);

    if (result) {
      const key = location.toLowerCase().replace(/\s+/g, " ");
      results[key] = result;
      console.log(`✓ ${location}: ${result.id} (${result.name}, ${result.type})`);
    } else {
      errors.push(location);
      console.log(`✗ ${location}: NOT FOUND`);
    }
  }

  // Output the TypeScript code
  console.log("\n" + "=".repeat(60));
  console.log("COMMON_LOCATIONS dictionary (copy this to index.ts):");
  console.log("=".repeat(60) + "\n");

  console.log("const COMMON_LOCATIONS: Record<string, string> = {");

  const sortedKeys = Object.keys(results).sort();
  for (const key of sortedKeys) {
    const { id, name } = results[key];
    console.log(`  "${key}": "${id}", // ${name}`);
  }

  console.log("};");

  if (errors.length > 0) {
    console.log("\n⚠️  Could not find IDs for:", errors.join(", "));
  }
}

main().catch(console.error);
