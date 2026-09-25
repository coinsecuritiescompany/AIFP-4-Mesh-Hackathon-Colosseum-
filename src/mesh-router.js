function totalCostMinor(route, amountMinor) {
  const variable = Math.ceil((amountMinor * route.feeBps) / 10_000);
  return route.fixedFeeMinor + variable;
}

export function rankRoutes(intent, routes) {
  return routes
    .filter((route) => route.asset === intent.asset)
    .filter((route) => route.minAmountMinor <= intent.amountMinor && intent.amountMinor <= route.maxAmountMinor)
    .map((route) => ({ ...route, estimatedFeeMinor: totalCostMinor(route, intent.amountMinor) }))
    .sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1;
      if (a.estimatedFeeMinor !== b.estimatedFeeMinor) return a.estimatedFeeMinor - b.estimatedFeeMinor;
      return a.latencyMs - b.latencyMs;
    });
}

export function chooseRoute(intent, routes, allowedRails) {
  const ranked = rankRoutes(intent, routes).filter((r) => allowedRails.includes(r.rail));
  const online = ranked.find((r) => r.online);
  if (online) return { mode: 'online', route: online, alternatives: ranked };
  const queueable = ranked.find((r) => r.supportsOfflineQueue);
  if (queueable) return { mode: 'queued', route: queueable, alternatives: ranked };
  return { mode: 'unavailable', route: null, alternatives: ranked };
}
