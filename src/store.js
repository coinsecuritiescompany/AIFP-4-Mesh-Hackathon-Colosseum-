export class IntentStore {
  #byId = new Map();
  #byIdempotency = new Map();

  create(intent) {
    const previousId = this.#byIdempotency.get(intent.idempotencyKey);
    if (previousId) return { created: false, intent: this.#byId.get(previousId) };
    this.#byId.set(intent.id, intent);
    this.#byIdempotency.set(intent.idempotencyKey, intent.id);
    return { created: true, intent };
  }

  get(id) { return this.#byId.get(id) ?? null; }
  save(intent) { this.#byId.set(intent.id, intent); return intent; }
  queued() { return [...this.#byId.values()].filter((x) => x.state === 'queued'); }
}
