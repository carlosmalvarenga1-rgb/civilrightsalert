// netlify/functions/get-bills.js
//
// Fetches federal bills from Congress.gov API (119th Congress)
// Returns { bills: [...] } with public_url pointing to Congress.gov bill pages
//
// Required Netlify env var: CONGRESS_API_KEY

// Map API bill type codes to Congress.gov URL slugs
const TYPE_MAP = {
  hr:      "house-bill",
  s:       "senate-bill",
  hjres:   "house-joint-resolution",
  sjres:   "senate-joint-resolution",
  hconres: "house-concurrent-resolution",
  sconres: "senate-concurrent-resolution",
  hres:    "house-resolution",
  sres:    "senate-resolution",
};

function ordinalSuffix(n) {
  const num = Number(n);
  const mod100 = num % 100;
  if (mod100 >= 11 && mod100 <= 13) return num + "th";
  const mod10 = num % 10;
  if (mod10 === 1) return num + "st";
  if (mod10 === 2) return num + "nd";
  if (mod10 === 3) return num + "rd";
  return num + "th";
}

// Build a public Congress.gov URL from bill fields or API URL
function buildPublicUrl(bill) {
  // First try using the bill's own fields (most reliable)
  const congress = bill.congress || "";
  const type = (bill.type || "").toLowerCase();
  const number = bill.number || "";

  if (congress && type && number) {
    const slug = TYPE_MAP[type];
    if (slug) {
      // bill.number is often "H.R.1234" — extract just the digits
      const num = String(number).replace(/[^0-9]/g, "");
      if (num) {
        return `https://www.congress.gov/bill/${ordinalSuffix(congress)}-congress/${slug}/${num}`;
      }
    }
  }

  // Fallback: parse the API URL
  try {
    const u = new URL(bill.url || bill.apiUrl || "");
    const parts = u.pathname.split("/").filter(Boolean);
    const i = parts.indexOf("bill");
    if (i >= 0 && parts.length >= i + 4) {
      const c = parts[i + 1];
      const t = parts[i + 2].toLowerCase();
      const n = parts[i + 3];
      const slug = TYPE_MAP[t] || (t + "-bill");
      return `https://www.congress.gov/bill/${ordinalSuffix(c)}-congress/${slug}/${n}`;
    }
  } catch {}

  return "https://www.congress.gov/";
}

// Simple urgency ranking for UI sorting
function statusPriority(bill) {
  const action = (bill.latestAction?.text || "").toLowerCase();
  if (action.includes("became public law") || action.includes("signed by president")) return 10;
  if (action.includes("passed") || action.includes("agreed to")) return 8;
  if (action.includes("cloture") || action.includes("floor")) return 7;
  if (action.includes("reported") || action.includes("ordered to be reported")) return 6;
  if (action.includes("committee") || action.includes("referred")) return 5;
  if (action.includes("introduced")) return 3;
  return 4;
}

export async function handler(event) {
  try {
    if (!process.env.CONGRESS_API_KEY) {
      return {
        statusCode: 500,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ error: "Missing CONGRESS_API_KEY env var in Netlify." }),
      };
    }

    const qs = event.queryStringParameters || {};
    const limit = qs.limit || "50";
    const offset = qs.offset || "0";

    const url = new URL("https://api.congress.gov/v3/bill");
    url.searchParams.set("format", "json");
    url.searchParams.set("congress", "119");
    url.searchParams.set("sort", "updateDate+desc");
    url.searchParams.set("limit", limit);
    url.searchParams.set("offset", offset);
    url.searchParams.set("api_key", process.env.CONGRESS_API_KEY);

    const resp = await fetch(url.toString());
    const data = await resp.json();

    const rawBills = data?.bills || data?.results || [];

    const bills = rawBills.map(b => {
      const publicUrl = buildPublicUrl(b);
      const actionText = b.latestAction?.text || "";
      const actionDate = b.latestAction?.actionDate || b.updateDate || "";

      return {
        id: `${b.congress}-${b.type}-${b.number}`.toLowerCase().replace(/[^a-z0-9-]/g, ""),
        number: b.number || "",
        title: b.title || "",
        howItAffectsYou: b.title || "",
        date: actionDate,
        status: actionText,
        statusDisplay: actionText || "In progress",
        statusPriority: statusPriority(b),
        url: publicUrl,
        public_url: publicUrl,
        congress_url: publicUrl,
        api_url: b.url || "",
        type: b.type || "",
        congress: b.congress || 119,
      };
    });

    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bills, source: "congress.gov" }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: String(err) }),
    };
  }
}
