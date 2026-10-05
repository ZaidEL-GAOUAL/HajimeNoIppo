// Cross-fades AnimationGroups by driving their weights by hand, so any clip can blend into any other.
// All clips loop; the fighter state machine decides when a one-shot is over.

export class Animator {
    /** @param {Record<string, import('@babylonjs/core').AnimationGroup>} groups */
    constructor(groups) {
        this.groups = groups;
        /** @type {Map<string, { group: any, weight: number, target: number, fade: number }>} */
        this.layers = new Map();
        this.current = null;
        for (const g of Object.values(groups)) g.stop();
    }

    /**
     * @param {string} id clip id
     * @param {{ speed?: number, from?: number, to?: number, fade?: number, restart?: boolean, frame?: number }} [opts]
     *   frame: hold this frame (speed 0)
     */
    play(id, { speed = 1, from, to, fade = 0.12, restart = true, frame } = {}) {
        const group = this.groups[id];
        if (!group) {
            console.warn('Missing clip', id);
            return;
        }
        let layer = this.layers.get(id);
        const f0 = from ?? group.from;
        const f1 = to ?? group.to;
        if (!layer || restart || !group.isPlaying) {
            const weight = layer?.weight ?? 0;
            group.stop();
            group.start(true, speed, f0, f1);
            if (frame !== undefined) {
                group.goToFrame(frame);
                group.speedRatio = 0;
            }
            layer = { group, weight, target: 1, fade };
            this.layers.set(id, layer);
            group.setWeightForAllAnimatables(weight);
        } else {
            group.speedRatio = speed;
        }
        layer.target = 1;
        layer.fade = fade;
        for (const [otherId, other] of this.layers) {
            if (otherId === id) continue;
            other.target = 0;
            other.fade = fade;
        }
        this.current = id;
        if (fade <= 0) this.update(0);
    }

    setSpeed(speed) {
        const layer = this.layers.get(this.current);
        if (layer) layer.group.speedRatio = speed;
    }

    update(dt) {
        let total = 0;
        for (const [id, layer] of this.layers) {
            const step = layer.fade > 0 ? dt / layer.fade : 1;
            if (layer.weight < layer.target) layer.weight = Math.min(layer.target, layer.weight + step);
            else if (layer.weight > layer.target) layer.weight = Math.max(layer.target, layer.weight - step);
            if (layer.target === 0 && layer.weight <= 0) {
                layer.group.stop();
                this.layers.delete(id);
                continue;
            }
            total += layer.weight;
        }
        // Normalized so a three-way blend never sags toward the bind pose.
        for (const layer of this.layers.values()) {
            layer.group.setWeightForAllAnimatables(total > 0 ? layer.weight / total : 0);
        }
    }

    stopAll() {
        for (const layer of this.layers.values()) layer.group.stop();
        this.layers.clear();
        this.current = null;
    }
}
