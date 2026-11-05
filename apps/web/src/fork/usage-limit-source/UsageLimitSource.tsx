import type { LimitAccount } from "@t3tools/shared/usageLimits";

export function UsageLimitSource({
  account,
  column,
}: {
  readonly account: LimitAccount;
  readonly column: number;
}) {
  const source =
    account.environments.length > 0
      ? account.environments.map((environment) => environment.label).join(", ")
      : account.sourceLabel;

  if (!source) return null;

  return (
    <span
      className="hidden min-w-0 px-2 text-2xs break-words text-muted-foreground @2xl/pool:block"
      style={{ gridColumn: column, gridRow: 2 }}
    >
      {account.environments.length > 0 ? "Signed in: " : "Via: "}
      {source}
    </span>
  );
}
