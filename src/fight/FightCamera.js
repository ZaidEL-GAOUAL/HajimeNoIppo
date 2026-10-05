import { FreeCamera, Vector3, Scalar } from '@babylonjs/core';

/**
 * Broadcast-style camera that keeps both boxers framed from the side (P1 on the left),
 * a behind-the-player view for solo fights, plus scripted shots (intro orbit, knockdown, KO).
 * Shake uses a decaying "trauma" value.
 */
export class FightCamera {
    constructor(scene) {
        this.scene = scene;
        this.camera = new FreeCamera('fightCam', new Vector3(0, 2, -6), scene);
        this.camera.minZ = 0.05;
        this.camera.maxZ = 400;
        this.camera.fov = 0.72;
        scene.activeCamera = this.camera;
        this.mode = 'broadcast';
        this.pos = new Vector3(0, 2, -6);
        this.target = new Vector3(0, 1.2, 0);
        this.side = -1;
        this.trauma = 0;
        this.time = 0;
        this.shot = null;
        this.fovTarget = 0.72;
        this.fovKick = 0;
    }

    setMode(mode) {
        this.mode = mode;
    }

    toggleMode() {
        this.mode = this.mode === 'broadcast' ? 'behind' : 'broadcast';
        return this.mode;
    }

    shake(amount) {
        this.trauma = Math.min(1, this.trauma + amount);
    }

    kickFov(amount) {
        this.fovKick = Math.max(this.fovKick, amount);
    }

    /** Scripted shot; `update` blends back to gameplay framing when it ends. */
    playShot(shot) {
        this.shot = { t: 0, ...shot };
    }

    clearShot() {
        this.shot = null;
    }

    /** Orbit used behind menus. */
    orbit(dt, center = new Vector3(0, 1.1, 0), radius = 6.5, height = 2.4, speed = 0.12) {
        this.time += dt;
        const a = this.time * speed;
        const desired = new Vector3(center.x + Math.sin(a) * radius, height, center.z - Math.cos(a) * radius);
        this.moveTo(desired, center, dt, 3);
        this.apply(dt);
    }

    /** @param {import('./Fighter.js').Fighter} a P1  @param {import('./Fighter.js').Fighter} b P2 */
    follow(dt, a, b, realDt = dt) {
        this.time += realDt;
        const pa = a.position;
        const pb = b.position;
        const mid = pa.add(pb).scale(0.5);
        const axis = pb.subtract(pa);
        axis.y = 0;
        const sep = Math.max(0.5, axis.length());
        axis.normalize();
        // Perpendicular to the fighters' line; pick the side that keeps P1 on the left of the screen.
        const perp = new Vector3(-axis.z, 0, axis.x);
        let desired;
        let look;
        if (this.shot) {
            this.shot.t += realDt;
            const s = this.shot;
            const subject = s.subject?.position ?? mid;
            if (s.type === 'knockdown' || s.type === 'ko') {
                const ang = s.t * (s.type === 'ko' ? 0.25 : 0.4) + (s.angle ?? 0);
                const r = s.type === 'ko' ? 2.6 : 3.4;
                desired = new Vector3(subject.x + Math.sin(ang) * r, s.type === 'ko' ? 1.0 : 1.6, subject.z - Math.cos(ang) * r);
                look = subject.add(new Vector3(0, 0.45, 0));
            } else if (s.type === 'intro') {
                // Crane shot sweeping along the near side of the ring, inside the ropes.
                const k = Math.min(1, s.t / (s.duration ?? 3));
                const ease = k * k * (3 - 2 * k);
                desired = new Vector3(-1.4 + ease * 2.8, 0.9 + ease * 1.1, -2.35 + ease * 0.25);
                look = new Vector3(-0.4 + ease * 0.8, 1.25, 0);
            } else if (s.type === 'closeup') {
                const f = s.subject.forward;
                desired = subject.add(f.scale(1.35)).add(new Vector3(0, 1.55, 0)).add(perp.scale(0.35));
                look = subject.add(new Vector3(0, 1.4, 0));
            }
            if (s.duration && s.t >= s.duration) this.shot = null;
            this.moveTo(desired, look, realDt, s.snap ?? 4);
        } else if (this.mode === 'behind') {
            const back = axis.scale(-1);
            desired = pa.add(back.scale(1.75)).add(perp.scale(-0.55)).add(new Vector3(0, 1.85, 0));
            look = pb.add(new Vector3(0, 1.2, 0)).add(axis.scale(-0.3));
            this.moveTo(desired, look, realDt, 6);
        } else {
            const dist = Scalar.Clamp(2.5 + sep * 1.05, 3.1, 6.2);
            desired = mid.add(perp.scale(-dist)).add(new Vector3(0, 1.55 + sep * 0.08, 0));
            // Keep inside the arena so the ropes don't fill the screen when fighting in a corner.
            look = mid.add(new Vector3(0, 1.15, 0));
            this.moveTo(desired, look, realDt, 5);
        }
        this.apply(realDt);
    }

    moveTo(desired, look, dt, rate) {
        const k = 1 - Math.exp(-dt * rate);
        this.pos.addInPlace(desired.subtract(this.pos).scale(k));
        this.target.addInPlace(look.subtract(this.target).scale(Math.min(1, k * 1.3)));
    }

    apply(dt) {
        this.trauma = Math.max(0, this.trauma - dt * 1.6);
        const s = this.trauma * this.trauma;
        const t = this.time * 40;
        const offset = new Vector3(
            (Math.sin(t * 1.3) + Math.sin(t * 2.7)) * 0.04 * s,
            (Math.sin(t * 1.7 + 1) + Math.sin(t * 3.1)) * 0.035 * s,
            (Math.sin(t * 1.1 + 2)) * 0.03 * s,
        );
        this.camera.position.copyFrom(this.pos).addInPlace(offset);
        this.camera.setTarget(this.target.add(offset.scale(0.5)));
        this.fovKick = Math.max(0, this.fovKick - dt * 0.6);
        this.camera.fov = this.fovTarget - this.fovKick;
    }

    snap() {
        this.camera.position.copyFrom(this.pos);
        this.camera.setTarget(this.target);
    }
}
