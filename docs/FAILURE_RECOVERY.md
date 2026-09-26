# Failure recovery

**Peer or transport failure:** a signed HELLO fails; the local link is marked offline and a new advertisement is gossiped. For an in-flight send, the forwarding node excludes the failed peer immediately and reruns the shortest-path planner. The next intent uses an alternate path. Both local TCP shutdown and node B shutdown are covered by multi-process tests.

**No route:** the origin persists `queued_for_mesh`, preserving its signed intent, policy snapshot and expiry. Every tick discovers peers and retries eligible queued intents. After C returns, A forwards the original intent unchanged. Expired intents transition to `expired` and do not settle.

**Duplicate or lost response:** C's persistent payment record and in-process settlement lock allow one execution and one Mesh receipt per intent ID/hash. It returns the cached receipt on a later delivery. A verifies C's signature before recording success. A previously `executing` state whose external outcome is uncertain remains locked; a human must inspect the rail before any recovery. This favors avoiding duplicate transfers over automatic liveness.

**Restart:** each node reads its own identity, replay IDs, advertisements, queue and payment file from its own volume. The integration test restarts C and checks its peer ID remains the same. There is no shared database, distributed lock or multi-replica settlement node; those need dedicated engineering before production.
