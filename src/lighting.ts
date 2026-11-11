import * as T from 'three';
import type { BimModel } from './model';
import type { Physics } from './physics';
import { appearanceFor } from './appearance';

interface Emitter {id: number; position: T.Vector3; glow: T.Sprite;}
/** Small shared halos and a fixed budget of nearby, non-shadow-casting lights. */
export class LightDetails {
  root = new T.Group();
  emitters: Emitter[] = [];
  private glowTexture: T.DataTexture;
  private glowMaterial: T.SpriteMaterial;
  private pool: T.PointLight[] = [];
  private lastUpdate = -Infinity;
  constructor() {
    const size = 32, data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const r = Math.hypot((x + .5) / size * 2 - 1, (y + .5) / size * 2 - 1), offset = (y * size + x) * 4;
      data.set([255, 222, 166, Math.round(Math.pow(Math.max(0, 1 - r), 3) * 110)], offset);
    }
    this.glowTexture = new T.DataTexture(data, size, size); this.glowTexture.colorSpace = T.SRGBColorSpace; this.glowTexture.needsUpdate = true;
    this.glowMaterial = new T.SpriteMaterial({map: this.glowTexture, transparent: true, depthWrite: false, depthTest: true, blending: T.AdditiveBlending, toneMapped: false});
    for (let i = 0; i < 4; i++) { const light = new T.PointLight('#ffdeb0', 0, 3, 2); this.pool.push(light); this.root.add(light); }
  }
  attach(model: BimModel) {
    const seen = new Set<number>();
    for (const p of model.parts) {
      if (!appearanceFor(model.elements.get(p.id), p).emissive || seen.has(p.id)) continue;
      seen.add(p.id);
      const geometry = model.geometry.get(p.key)!, matrix = new T.Matrix4().fromArray(p.matrix);
      const position = geometry.boundingBox!.getCenter(new T.Vector3()).applyMatrix4(matrix);
      const size = geometry.boundingBox!.getSize(new T.Vector3());
      // Strip emitters already show their full original luminous line; keep their
      // halo tiny rather than adding large decorative orbs to the architecture.
      const strip = Math.max(size.x, size.y, size.z) > .8;
      const glow = new T.Sprite(this.glowMaterial); glow.position.copy(position); glow.scale.setScalar(strip ? .065 : .14); glow.raycast = () => {};
      this.root.add(glow); this.emitters.push({id: p.id, position, glow});
    }
  }
  update(model: BimModel, physics: Physics, camera: T.Camera, walking: boolean, quality: number, now: number) {
    if (now - this.lastUpdate < 180) return; this.lastUpdate = now;
    const position = camera.getWorldPosition(new T.Vector3());
    const visible = this.emitters.filter(e => {
      const show = model.visible.has(e.id) && (model.clip == null || e.position.y <= model.clip);
      e.glow.visible = show; return show;
    });
    const halos = new Set(visible.filter(e => e.position.distanceToSquared(position) < 144).sort((a, b) => a.position.distanceToSquared(position) - b.position.distanceToSquared(position)).slice(0, quality < 1 ? 12 : 24));
    for (const e of this.emitters) e.glow.visible = halos.has(e);
    const nearest = walking && quality >= 1 ? visible.filter(e => e.position.distanceToSquared(position) < 36 && Math.abs(e.position.y - position.y) < 2.8).sort((a, b) => a.position.distanceToSquared(position) - b.position.distanceToSquared(position)).slice(0, 10) : [];
    const chosen: Emitter[] = [];
    for (const e of nearest) {
      const direction = e.position.clone().sub(position), distance = direction.length();
      const obstruction = distance > .1 ? physics.doorHit(position, direction.normalize(), Math.max(0, distance - .08)) : null;
      if (obstruction != null && obstruction !== e.id) continue;
      chosen.push(e); if (chosen.length === this.pool.length) break;
    }
    this.pool.forEach((light, i) => { const e = chosen[i]; light.intensity = e ? 4 : 0; if (e) light.position.copy(e.position); });
  }
  dispose() {
    this.root.clear(); this.emitters = []; this.pool = []; this.glowMaterial.dispose(); this.glowTexture.dispose();
  }
}
