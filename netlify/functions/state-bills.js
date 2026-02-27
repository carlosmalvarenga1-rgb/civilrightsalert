// netlify/functions/state-bills.js
//
// Uses LegiScan "getMasterList" to return a paginated list of bills for a state.
// UI contract: returns { bills: [...] } where each bill has id, number, title, url, date, statusDisplay, statusPriority.
//
// Required Netlify env var:
//   LEGISCAN_API_KEY = your LegiScan API key
//
// Query params:
//   state = "Arizona" or "AZ" (required)
//   limit = number (optional, default 50)
//   offset = number (optional, default 0)

const STATE_NAME_TO_ABBR = {
  "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR", "california": "CA",
  "colorado": "CO", "connecticut": "CT", "delaware": "DE", "florida": "FL", "georgia": "GA",
  "hawaii": "HI", "idaho": "ID", "illinois": "IL", "indiana": "IN", "iowa": "IA",
  "kansas": "KS", "kentucky": "KY", "louisiana": "LA", "maine": "ME", "maryland": "MD",
  "massachusetts": "MA", "michigan": "MI", "minnesota": "MN", "mississippi": "MS", "missouri": "MO",
  "montana": "MT", "nebraska": "NE", "nevada": "NV", "new hampshire": "NH", "new jersey": "NJ",
  "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", "ohio": "OH",
  "oklahoma": "OK", "oregon": "OR", "pennsylvania": "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", "tennessee": "TN", "texas": "TX", "utah": "UT", "vermont": "VT",
  "virginia": "VA", "washington": "WA", "west virginia": "WV", "wisconsin": "WI", "wyoming": "WY",
  "district of columbia": "DC"
};

function normalizeState(input) {
  const s = String(input || "").trim();
  if (!s) return "";
  if (s.length === 2) return s.toUpperCase();
  const key = s.toLowerCase();
  return STATE_NAME_TO_ABBR[key] || "";
}

function toInt(x, dflt) {
  const n = Number(x);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : dflt;
}

// A simple urgency rank for UI sorting (rough heuristic)
function statusPriorityFromStatusText(statusText) {
  const t = String(statusText || "").toLowerCase();

  // High priority keywords
  if (t.includes("signed") || t.includes("chaptered") || t.includes("enacted")) return 10; // law
  if (t.includes("passed") || t.includes("adopted")) return 8; // passed chamber / adopted
  if (t.includes("on floor") || t.includes("third reading") || t.includes("second reading")) return 7;
  if (t.includes("committee") || t.includes("hearing") || t.includes("referred")) return 5;

  return 3; // introduced / other
}

async function callLegiScan(op, params, apiKey) {
  const u = new URL("https://api.legiscan.com/");
  u.searchParams.set("key", apiKey);
  u.searchParams.set("op", op);
  for (const [k, v] of Object.entries(params || {})) u.searchParams.set(k, String(v));

  const resp = await fetch(u.toString());
  const data = await resp.json();

  // LegiScan often returns { status: "OK", ... } or { status:"ERROR", alert:{...} }
  if (!data || data.status !== "OK") {
    const msg = data?.alert?.message || data?.alert || data?.status || "LegiScan error";
    throw new Error(`LegiScan ${op} failed: ${msg}`);
  }
  return data;
}

export async function handler(event) {
  try {
    const apiKey = process.env.LEGISCAN_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ error: "Missing LEGISCAN_API_KEY env var in Netlify." })
      };
    }

    const qs = event.queryStringParameters || {};
    const stateAbbr = normalizeState(qs.state);
    if (!stateAbbr) {
      return {
        statusCode: 400,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ error: "Missing/invalid state. Use 'AZ' or 'Arizona'." })
      };
    }

    const limit = Math.min(toInt(qs.limit, 50), 200);  // keep responses reasonable
    const offset = toInt(qs.offset, 0);

    // Get master list (current session list of bills + basic fields)
    const ml = await callLegiScan("getMasterList", { state: stateAbbr }, apiKey);

    // ml.masterlist is an object keyed by bill_id plus a "session" key
    const masterlist = ml.masterlist || {};
    const billsRaw = Object.entries(masterlist)
      .filter(([k, v]) => k !== "session" && v && typeof v === "object")
      .map(([, v]) => v);

    // Paginate
    const page = billsRaw.slice(offset, offset + limit);

    // Normalize into what your UI expects
    const bills = page.map((b) => {
      const number = b.number || b.bill_number || b.bill || "";
      const title = b.title || b.description || "";
      const statusText = b.status || b.status_text || b.status_detail || "";
      const statusPriority = statusPriorityFromStatusText(statusText);

      // LegiScan provides a "url" to the bill page on LegiScan
      const url = b.url || "";

      // Use last_action_date if present
      const date = b.last_action_date || b.last_action || b.introduced_date || "";

      return {
        id: String(b.bill_id || b.id || number || url),
        number,
        title,
        howItAffectsYou: title,          // your UI falls back to title; keep simple
        date,
        status: statusText,
        statusDisplay: statusText || "In progress",
        statusPriority,
        url,                              // keep this as the "Read" link
        legiscan_url: url,                // explicit field for frontend fallback chain
        state: stateAbbr
      };
    });

    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        bills,
        pagination: { limit, offset, returned: bills.length, total_estimate: billsRaw.length },
        source: "legiscan"
      })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: String(err) })
    };
  }
}
