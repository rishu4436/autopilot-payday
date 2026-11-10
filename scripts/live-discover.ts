import { discoverLive } from "../src/server/hermes";

async function main() {
  const info = await discoverLive(true);
  console.log(JSON.stringify({
    service: info.service,
    endpoints: info.endpoints.map((endpoint) => ({
      method: endpoint.method,
      path: endpoint.path,
      payment: endpoint.payment,
      basePrice: endpoint.basePrice ?? null,
    })),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
