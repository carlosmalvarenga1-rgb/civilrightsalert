export async function handler(event) {
  const state = event.queryStringParameters?.state || "";
  const limit = Number(event.queryStringParameters?.limit || "50");
  const offset = Number(event.queryStringParameters?.offset || "0");

  // Placeholder until you pick a state data provider.
  // UI expects: { bills: [...] }
  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      bills: [],
      note: `State bills are not wired yet for "${state}". Add a provider (LegiScan/OpenStates) in netlify/functions/state-bills.js.`,
      limit,
      offset
    }),
  };
}
