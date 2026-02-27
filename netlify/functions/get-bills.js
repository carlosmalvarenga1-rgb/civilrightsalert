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

// Build a public Congress.gov URL from bill fields
function buildPublicUrl(bill) {
  const congress = bill.congress || "";
  const type = (bill.type || "").toLowerCase();
  const number = bill.number || "";

  if (congress && type && number) {
    const slug = TYPE_MAP[type];
    if (slug) {
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

// Determine bill STAGE (what citizens care about) from the latest action text
function deriveBillStage(actionText) {
  const t = (actionText || "").toLowerCase();

  if (t.includes("became public law") || t.includes("signed by president") || t.includes("enacted")) {
    return { display: "Signed Into Law", priority: 10 };
  }
  if (t.includes("vetoed")) {
    return { display: "Vetoed", priority: 9 };
  }
  if (t.includes("passed house") || t.includes("passed senate") || t.includes("agreed to in")) {
    return { display: "Passed Chamber", priority: 8 };
  }
  if (t.includes("cloture") || t.includes("floor consideration") || t.includes("placed on calendar")) {
    return { display: "Floor Vote Pending", priority: 7 };
  }
  if (t.includes("reported by") || t.includes("ordered to be reported")) {
    return { display: "Reported by Committee", priority: 6 };
  }
  if (t.includes("hearing") || t.includes("markup")) {
    return { display: "Committee Hearing", priority: 5 };
  }
  if (t.includes("referred to") || t.includes("subcommittee")) {
    return { display: "In Committee", priority: 4 };
  }
  if (t.includes("introduced") || t.includes("read twice") || t.includes("sponsor introductory")) {
    return { display: "Introduced", priority: 3 };
  }

  return { display: "In Progress", priority: 3 };
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

    // IMPORTANT: congress is a PATH parameter, not a query parameter
    // Correct:   /v3/bill/119
    // Wrong:     /v3/bill?congress=119
    const url = new URL("https://api.congress.gov/v3/bill/119");
    url.searchParams.set("format", "json");
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
      const stage = deriveBillStage(actionText);

      // Build readable bill number like "H.R. 1234"
      const TYPE_DISPLAY = {
        HR: "H.R.", S: "S.", HJRES: "H.J.Res.", SJRES: "S.J.Res.",
        HCONRES: "H.Con.Res.", SCONRES: "S.Con.Res.", HRES: "H.Res.", SRES: "S.Res."
      };
      const typeUpper = (b.type || "").toUpperCase();
      const typeLabel = TYPE_DISPLAY[typeUpper] || typeUpper;
      const displayNumber = b.number ? `${typeLabel} ${b.number}` : "";

      return {
        id: `${b.congress}-${(b.type||"").toLowerCase()}-${b.number}`,
        number: displayNumber,
        title: b.title || "",
        howItAffectsYou: b.title || "",
        date: actionDate,
        status: actionText,
        statusDisplay: stage.display,
        statusPriority: stage.priority,
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
