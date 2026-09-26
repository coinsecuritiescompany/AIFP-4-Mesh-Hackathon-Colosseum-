export function rankRoutes(intent, routes) {
  return routes.filter(r => r.asset === intent.asset && r.minAmountMinor <= intent.amountMinor && intent.amountMinor <= r.maxAmountMinor)
    .map(r => {
      const estimatedFeeMinor = r.fixedFeeMinor + Math.ceil(intent.amountMinor * r.feeBps / 10000);
      const feeScore = Math.max(0, 100 - estimatedFeeMinor * 10000 / intent.amountMinor);
      const latencyScore = Math.max(0, 100 - r.latencyMs / 10);
      const availabilityScore = r.online ? 100 : 0;
      return { ...r, estimatedFeeMinor, routeScore: Math.round(feeScore * .45 + latencyScore * .2 + availabilityScore * .3 + 5), scoreBreakdown: { feeScore: Math.round(feeScore), latencyScore: Math.round(latencyScore), availabilityScore, policyScore: 100 } };
    }).sort((a, b) => b.routeScore - a.routeScore || a.id.localeCompare(b.id));
}
export function chooseRoute(intent, routes, allowedRails) {
  const ranked = rankRoutes(intent, routes).filter(r => allowedRails.includes(r.rail));
  const online = ranked.find(r => r.online);
  if (online) return { mode: 'online', route: online, alternatives: ranked };
  const queued = ranked.find(r => r.supportsOfflineQueue);
  return queued ? { mode: 'queued', route: queued, alternatives: ranked } : { mode: 'unavailable', route: null, alternatives: ranked };
}
