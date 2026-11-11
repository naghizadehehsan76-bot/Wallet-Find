const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const ALLOWED_HOSTNAMES = new Set(["wallet-find.com", "www.wallet-find.com"]);

type TurnstileResponse = {
  success?: boolean;
  hostname?: string;
  action?: string;
};

export async function verifyTurnstileToken(
  token: string,
): Promise<"VERIFIED" | "REJECTED" | "NOT_CONFIGURED"> {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret) return "NOT_CONFIGURED";

  try {
    const response = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return "REJECTED";

    const result = await response.json() as TurnstileResponse;
    return result.success === true &&
      result.action === "signup" &&
      typeof result.hostname === "string" &&
      ALLOWED_HOSTNAMES.has(result.hostname.toLowerCase())
      ? "VERIFIED"
      : "REJECTED";
  } catch {
    return "REJECTED";
  }
}
