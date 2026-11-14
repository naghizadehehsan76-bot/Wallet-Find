/**
 * Financial integration tests mutate shared wallet/prize accounting rows.
 * They must never run against production or a normal development database.
 *
 * Required opt-in:
 *   WALLET_FIND_ALLOW_FINANCIAL_INTEGRATION_TESTS=true
 *   DATABASE_URL=postgresql://.../wallet_find_test
 *
 * The database name must clearly identify an isolated test/CI database.
 */
export function shouldRunFinancialIntegrationTests(): boolean {
  if (process.env.WALLET_FIND_ALLOW_FINANCIAL_INTEGRATION_TESTS !== "true") return false;
  if (process.env.NODE_ENV === "production") return false;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return false;

  try {
    const databaseName = decodeURIComponent(new URL(connectionString).pathname.replace(/^\//, ""));
    return /(?:^|[_-])(test|testing|ci|integration)(?:$|[_-])/i.test(databaseName);
  } catch {
    return false;
  }
}
