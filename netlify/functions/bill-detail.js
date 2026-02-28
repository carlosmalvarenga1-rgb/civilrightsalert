// netlify/functions/bill-detail.js
//
// Fetches detailed info for a single bill from Congress.gov:
// sponsors, cosponsors, actions, summaries, committees
//
// Query params:
//   congress = 119
//   type = hr, s, hjres, etc.
//   number = 187
//
// Required env var: CONGRESS_API_KEY

const TYPE_MAP = {
  hr: "house-bill", s: "senate-bill",
  hjres: "house-joint-resolution", sjres: "senate-joint-resolution",
  hconres: "house-concurrent-resolution", sconres: "senate-concurrent-resolution",
  hres: "house-resolution", sres: "senate-resolution",
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

async function congressFetch(path, apiKey) {
  const url = new URL(`https://api.congress.gov/v3/${path}`);
  url.searchParams.set("format", "json");
  url.searchParams.set("api_key", apiKey);
  const resp = await fetch(url.toString());
  if (!resp.ok) return null;
  return resp.json();
}

export async function handler(event) {
  try {
    const apiKey = process.env.CONGRESS_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, headers: { "content-type": "application/json" },
        body: JSON.stringify({ error: "Missing CONGRESS_API_KEY" }) };
    }

    const qs = event.queryStringParameters || {};
    const congress = qs.congress || "119";
    const type = (qs.type || "").toLowerCase();
    const number = qs.number || "";

    if (!type || !number) {
      return { statusCode: 400, headers: { "content-type": "application/json" },
        body: JSON.stringify({ error: "Missing type or number. Usage: ?congress=119&type=hr&number=187" }) };
    }

    const basePath = `bill/${congress}/${type}/${number}`;

    // Fetch bill detail, actions, summaries, and cosponsors in parallel
    const [billData, actionsData, summariesData, cosponsorsData] = await Promise.all([
      congressFetch(basePath, apiKey),
      congressFetch(`${basePath}/actions`, apiKey),
      congressFetch(`${basePath}/summaries`, apiKey),
      congressFetch(`${basePath}/cosponsors`, apiKey),
    ]);

    const bill = billData?.bill || {};

    // Sponsors
    const sponsors = (bill.sponsors || []).map(s => ({
      name: s.fullName || s.firstName + " " + s.lastName,
      party: s.party || "",
      state: s.state || "",
      district: s.district || null,
      isByRequest: s.isByRequest || false,
    }));

    // Cosponsors
    const cosponsors = (cosponsorsData?.cosponsors || []).map(c => ({
      name: c.fullName || c.firstName + " " + c.lastName,
      party: c.party || "",
      state: c.state || "",
      district: c.district || null,
      date: c.sponsorshipDate || "",
    }));

    // Actions (legislative history)
    const actions = (actionsData?.actions || []).map(a => ({
      date: a.actionDate || "",
      chamber: a.chamber || "",
      text: a.text || "",
      type: a.type || "",
    })).sort((a, b) => new Date(b.date) - new Date(a.date));

    // Summaries
    const summaries = (summariesData?.summaries || []).map(s => ({
      text: s.text || "",
      date: s.actionDate || s.updateDate || "",
      versionCode: s.versionCode || "",
      actionDesc: s.actionDesc || "",
    }));

    // Get the most recent/useful summary
    const bestSummary = summaries.length > 0
      ? summaries[summaries.length - 1].text  // latest summary
      : "";

    // Committees from bill detail
    const committees = (bill.committees?.item || bill.committees || []).map(c => ({
      name: c.name || c.chamber + " " + c.type,
      chamber: c.chamber || "",
      type: c.type || "",
    }));

    // Build public URL
    const slug = TYPE_MAP[type] || (type + "-bill");
    const num = String(number).replace(/[^0-9]/g, "");
    const publicUrl = `https://www.congress.gov/bill/${ordinalSuffix(congress)}-congress/${slug}/${num}`;

    // Subjects/policy areas
    const policyArea = bill.policyArea?.name || "";
    const subjects = (bill.subjects?.legislativeSubjects || []).map(s => s.name);

    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        congress: bill.congress || congress,
        type: bill.type || type,
        number: bill.number || number,
        title: bill.title || "",
        introducedDate: bill.introducedDate || "",
        originChamber: bill.originChamber || "",
        sponsors,
        cosponsors,
        cosponsorsCount: cosponsors.length,
        actions,
        summary: bestSummary,
        summaries,
        committees,
        policyArea,
        subjects,
        publicUrl,
        latestAction: bill.latestAction || {},
      }),
    };
  } catch (err) {
    return { statusCode: 500, headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: String(err) }) };
  }
}
