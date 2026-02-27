function toPublicCongressUrl(apiUrl) {
  // Example API URL: https://api.congress.gov/v3/bill/118/hr/123?format=json
  try {
    const u = new URL(apiUrl);
    const parts = u.pathname.split("/").filter(Boolean);
    // parts looks like: ["v3","bill","118","hr","123"]
    const i = parts.indexOf("bill");
    if (i >= 0 && parts.length >= i + 4) {
      const congress = parts[i + 1];
      const type = parts[i + 2];
      const number = parts[i + 3];
      return `https://www.congress.gov/bill/${congress}th-congress/${type.toLowerCase()}-bill/${number}`;
    }
  } catch {}
  return "https://www.congress.gov/";
}

export async function handler(event) {
  try {
    const url = new URL("https://api.congress.gov/v3/bill");
    url.searchParams.set("format", "json");
    url.searchParams.set("congress", "118");
    url.searchParams.set("limit", event.queryStringParameters?.limit || "50");
    url.searchParams.set("offset", event.queryStringParameters?.offset || "0");

    if (!process.env.CONGRESS_API_KEY) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Missing CONGRESS_API_KEY env var in Netlify." }),
      };
    }
    url.searchParams.set("api_key", process.env.CONGRESS_API_KEY);

    const resp = await fetch(url.toString());
    const data = await resp.json();

    const bills = (data?.bills || data?.results || []).map(b => {
      const apiLink = b?.url || b?.apiUrl || "";
      return {
        ...b,
        // keep the API url for internal use if needed
        api_url: apiLink,
        // add a public web url that never needs an API key
        public_url: apiLink ? toPublicCongressUrl(apiLink) : "https://www.congress.gov/",
      };
    });

    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bills, source: "congress.gov" }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: String(err) }) };
  }
}
