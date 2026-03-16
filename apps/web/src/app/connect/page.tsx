import ConnectVaultClient from "@/components/ConnectVaultClient";
import { fetchVaultConnection } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function ConnectPage() {
  const initial = await fetchVaultConnection();
  return <ConnectVaultClient initial={initial} />;
}
