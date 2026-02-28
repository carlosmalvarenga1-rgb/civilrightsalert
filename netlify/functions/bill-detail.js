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
    const rawSponsors = Array.isArray(bill.sponsors) ? bill.sponsors : [];
    const sponsors = rawSponsors.map(s => ({
      name: s.fullName || ((s.firstName || '') + " " + (s.lastName || '')).trim(),
      party: s.party || "",
      state: s.state || "",
      district: s.district || null,
      isByRequest: s.isByRequest || false,
    }));

    // Cosponsors
    const rawCosponsors = Array.isArray(cosponsorsData?.cosponsors) ? cosponsorsData.cosponsors : [];
    const cosponsors = rawCosponsors.map(c => ({
      name: c.fullName || ((c.firstName || '') + " " + (c.lastName || '')).trim(),
      party: c.party || "",
      state: c.state || "",
      district: c.district || null,
      date: c.sponsorshipDate || "",
    }));

    // Actions (legislative history)
    const rawActions = Array.isArray(actionsData?.actions) ? actionsData.actions : [];
    const actions = rawActions.map(a => ({
      date: a.actionDate || "",
      chamber: a.chamber || "",
      text: a.text || "",
      type: a.type || "",
    })).sort((a, b) => new Date(b.date) - new Date(a.date));

    // Summaries
    const rawSummaries = Array.isArray(summariesData?.summaries) ? summariesData.summaries : [];
    const summaries = rawSummaries.map(s => ({
      text: s.text || "",
      date: s.actionDate || s.updateDate || "",
      versionCode: s.versionCode || "",
      actionDesc: s.actionDesc || "",
    }));

    // Get the most recent/useful summary
    const bestSummary = summaries.length > 0
      ? summaries[summaries.length - 1].text  // latest summary
      : "";

    // Generate plain-English summary using Claude API if available
    let plainEnglishSummary = "";
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (anthropicKey && (bestSummary || bill.title)) {
      try {
        const prompt = bestSummary
          ? `Here is a Congressional Research Service summary of a bill called "${bill.title || ''}":\n\n${bestSummary.replace(/<[^>]*>/g, '')}\n\nRewrite this in 2 short paragraphs that a regular citizen can understand. Use plain, conversational English. Explain what the bill actually does in practical terms and why it matters to everyday people. Do not use legal jargon. Do not start with "This bill" — start with something more engaging. Do not include any preamble like "Here's a summary" — just give the summary directly.`
          : `A bill called "${bill.title || ''}" was introduced in the ${ordinalSuffix(congress)} Congress. Based only on the title, write 1-2 short paragraphs explaining what this bill likely does in plain English that a regular citizen can understand. Be honest that this is based on the title only. Do not include any preamble — just give the summary directly.`;

        const aiResp = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": anthropicKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 400,
            messages: [{ role: "user", content: prompt }],
          }),
        });

        if (aiResp.ok) {
          const aiData = await aiResp.json();
          const text = aiData?.content?.[0]?.text || "";
          if (text.length > 20) plainEnglishSummary = text;
        }
      } catch (e) {
        console.log("AI summary generation failed:", e.message);
      }
    }

    // Committees from bill detail — can be object with nested arrays
    let committees = [];
    try {
      const rawCommittees = bill.committees;
      if (Array.isArray(rawCommittees)) {
        committees = rawCommittees.map(c => ({ name: c.name || '', chamber: c.chamber || '', type: c.type || '' }));
      } else if (rawCommittees && typeof rawCommittees === 'object') {
        // Congress.gov often returns { url: "...", count: N } — need to fetch separately
        if (rawCommittees.url) {
          try {
            const commData = await congressFetch(rawCommittees.url.replace('https://api.congress.gov/v3/', ''), apiKey);
            const commList = commData?.committees || [];
            committees = commList.map(c => ({ name: c.name || '', chamber: c.chamber || '', type: c.type || '' }));
          } catch (e) {
            console.log('Committee fetch failed:', e.message);
          }
        } else if (rawCommittees.item) {
          committees = (Array.isArray(rawCommittees.item) ? rawCommittees.item : [rawCommittees.item])
            .map(c => ({ name: c.name || '', chamber: c.chamber || '', type: c.type || '' }));
        }
      }
    } catch (e) {
      console.log('Committee parsing error:', e.message);
    }

    // Build public URL
    const slug = TYPE_MAP[type] || (type + "-bill");
    const num = String(number).replace(/[^0-9]/g, "");
    const publicUrl = `https://www.congress.gov/bill/${ordinalSuffix(congress)}-congress/${slug}/${num}`;

    // Subjects/policy areas — handle various structures
    const policyArea = bill.policyArea?.name || "";
    let subjects = [];
    try {
      const rawSubjects = bill.subjects?.legislativeSubjects;
      if (Array.isArray(rawSubjects)) {
        subjects = rawSubjects.map(s => s.name || s);
      }
    } catch (e) {
      console.log('Subjects parsing error:', e.message);
    }

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
        plainEnglishSummary,
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
