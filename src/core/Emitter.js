export class Emitter {
    #handlers = new Map();

    on(type, fn) {
        if (!this.#handlers.has(type)) this.#handlers.set(type, new Set());
        this.#handlers.get(type).add(fn);
        return () => this.#handlers.get(type)?.delete(fn);
    }

    emit(type, payload) {
        const set = this.#handlers.get(type);
        if (set) for (const fn of set) fn(payload);
    }

    clear() {
        this.#handlers.clear();
    }
}
