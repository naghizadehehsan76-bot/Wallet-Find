const baseUrl = (process.env.BASE_URL || "https://wallet-find.onrender.com").replace(/\/$/, "");
const readinessUrl = baseUrl + "/api/stats/site";
const deadline = Date.now() + 12 * 60 * 1000;
let lastError = "site has not responded yet";

while (Date.now() < deadline) {
  try {
    const response = await fetch(readinessUrl, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (response.ok) {
      const body = await response.json();
      if (body?.success === true && body?.data) {
        console.log("Wallet-Find public API is ready:", readinessUrl);
        process.exit(0);
      }
      lastError = "readiness endpoint returned an unexpected response";
    } else {
      lastError = "readiness endpoint returned HTTP " + response.status;
    }
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
  }

  console.log("Waiting for Wallet-Find:", lastError);
  await new Promise((resolve) => setTimeout(resolve, 15_000));
}

throw new Error("Wallet-Find did not become ready within 12 minutes: " + lastError);
