function distances(origin, links, excluded=[]) {
  const distance = new Map([[origin, 0]]), predecessor = new Map(), pending = new Set([origin]);
  const blocked = new Set(excluded);
  while (pending.size) {
    const at = [...pending].sort((a,b) => distance.get(a)-distance.get(b) || a.localeCompare(b))[0]; pending.delete(at);
    for (const edge of links.filter(e => e.from === at && e.online && !blocked.has(e.to))) {
      const cost = Math.max(1, edge.cost ?? 20) + Math.max(0, edge.errors ?? 0) * 20 + (1 - (edge.reliability ?? 1)) * 100;
      const candidate = distance.get(at) + cost;
      if (candidate < (distance.get(edge.to) ?? Infinity)) { distance.set(edge.to,candidate); predecessor.set(edge.to,edge); pending.add(edge.to); }
    }
  }
  return {distance,predecessor};
}
function trace(origin,destination,distance,predecessor) {
  if(!distance.has(destination)) return null;
  const edges=[]; let at=destination;
  while(at!==origin) { const edge=predecessor.get(at); if(!edge || edges.length>16) return null; edges.unshift(edge); at=edge.from; }
  return {destinationNodeId:destination,edges,score:distance.get(destination)};
}
export function planNodeRoute(origin,destination,links,excluded=[]) {
  const {distance,predecessor}=distances(origin,links,excluded);
  return trace(origin,destination,distance,predecessor);
}
export function planRoute(origin, asset, links, capabilities, excluded = []) {
  const {distance,predecessor}=distances(origin,links,excluded);
  const blocked=new Set(excluded);
  const destinations = capabilities.filter(c => c.canSettle && c.assets.includes(asset) && c.expiresAt > Date.now() && distance.has(c.nodeId) && !blocked.has(c.nodeId));
  destinations.sort((a,b) => (distance.get(a.nodeId) + (a.feeBps ?? 0)) - (distance.get(b.nodeId) + (b.feeBps ?? 0)) || a.nodeId.localeCompare(b.nodeId));
  const destination = destinations[0]; if (!destination) return null;
  const result=trace(origin,destination.nodeId,distance,predecessor);
  return {...result,score:result.score+(destination.feeBps??0)};
}
