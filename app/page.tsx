// The dashboard (SPEC.md sections 3, 9 and 10). Server component: passes the public rules and the
// gateway's public wallet address to the client dashboard. No secret ever leaves this file.
import rulesJson from "@/config/rules.json";
import Dashboard from "@/components/dashboard/Dashboard";
import type { Rules } from "@/lib/dashboard/model";

export const dynamic = "force-dynamic";

export default function Page() {
  return <Dashboard rules={rulesJson as Rules} gatewayWallet={process.env.GATEWAY_WALLET_ADDRESS ?? null} />;
}
