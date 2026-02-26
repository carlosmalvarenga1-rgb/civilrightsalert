// netlify/functions/get-bills.js
export async function handler(event) {
  try {
    const url = new URL("https://api.congress.gov/v3/bill");
    // Defaults: 118th Congress, current bills, 50 results (we will raise this next)
    url.searchParams.set("format", "json");
    url.searchParams.set("congress", "118");
    url.searchParams.set("limit", event.queryStringParameters?.limit || "250");
    url.searchParams.set("offset", event.queryStringParameters?.offset || "0");
    url.searchParams.set("api_key", process.env.CONGRESS_API_KEY || "");

    if (!process.env.CONGRESS_API_KEY) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Missing CONGRESS_API_KEY env var in Netlify." })
      };
    }

    const resp = await fetch(url.toString());
    const data = await resp.json();

    // Normalize to your frontend expectation: { bills: [...] }
    const bills = data?.bills || data?.results || [];
    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bills, source: "congress.gov" })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: String(err) }) };
  }
}
