import * as T from 'three';
import type { BimModel } from './model';
import type { Part } from './types';
import type { Physics } from './physics';

export interface DoorLeaf {
  parts: Part[];
  originals: T.Matrix4[];
  pivot: T.Vector3;
  slide: T.Vector3;
  angle: number;
  axis?: T.Vector3;
}
export interface Door {
  id: number;
  kind: 'swing' | 'double' | 'slide' | 'tilt';
  category?: 'window';
  leaves: DoorLeaf[];
  normal: T.Vector3;
  center: T.Vector3;
  progress: number;
  target: number;
  blocked: boolean;
}
const up = new T.Vector3(0, 1, 0);
export const DOOR_REACH = 2;

/** Classifies the original IFC parts; frames never join a moving leaf. */
export class Doors {
  items = new Map<number, Door>();
  moving = new Map<Part, DoorLeaf>();
  unsupported: number[] = [];
  private nextKey = -1;

  prepare(model: BimModel) {
    for (const [id, parts] of model.byElement) {
      const element = model.elements.get(id);
      if (element?.type.toLowerCase() !== 'ifcdoor') continue;
      const info = element.door;
      // Use the longest horizontal axis of a tall panel to establish a local frame,
      // including doors placed at 45 degrees and mirrored IFC instances.
      let axis: T.Vector3 | null = null, score = 0;
      for (const p of parts) {
        const g = model.geometry.get(p.key)!, size = g.boundingBox!.getSize(new T.Vector3());
        const m = new T.Matrix4().fromArray(p.matrix);
        const columns = [0, 1, 2].map(i => new T.Vector3().setFromMatrixColumn(m, i));
        const lengths = size.toArray();
        const vertical = columns.findIndex(v => Math.abs(v.clone().normalize().y) > .99);
        if (vertical < 0 || lengths[vertical] * columns[vertical].length() < 1.4) continue;
        for (let i = 0; i < 3; i++) {
          const width = lengths[i] * columns[i].length();
          if (i !== vertical && Math.abs(columns[i].clone().normalize().y) < .01 && width > score) {
            axis = columns[i].clone().normalize(); score = width;
          }
        }
      }
      if (!axis) { this.unsupported.push(id); continue; }
      const normal = new T.Vector3().crossVectors(axis, up).normalize();
      const basis = new T.Matrix4().makeBasis(axis, up, normal), inverse = basis.clone().invert();
      const bounds = (p: Part) => {
        // Transform actual vertices, not a world AABB (which expands rotated doors).
        const b = new T.Box3(), a = model.geometry.get(p.key)!.getAttribute('position');
        const m = inverse.clone().multiply(new T.Matrix4().fromArray(p.matrix));
        for (let i = 0; i < a.count; i++) b.expandByPoint(new T.Vector3().fromBufferAttribute(a, i).applyMatrix4(m));
        return b;
      };
      const boxes = new Map(parts.map(p => [p, bounds(p)]));
      const whole = new T.Box3(); for (const b of boxes.values()) whole.union(b);
      const width = info?.width || whole.getSize(new T.Vector3()).x;
      const label = `${info?.operation ?? ''} ${element.name ?? ''}`;
      const kind: Door['kind'] = /SLIDING|correr/i.test(label) ? 'slide' : /DOUBLE_DOOR|Double-Panel/i.test(label) ? 'double' : 'swing';
      if (info?.operation && !/NOTDEFINED|SWING|SLIDING/.test(info.operation)) { this.unsupported.push(id); continue; }
      const tall = parts.filter(p => {
        const s = boxes.get(p)!.getSize(new T.Vector3());
        return s.y > 1.4 && s.z < .09 && s.x > .35 && s.x <= width + .015;
      });
      const door: Door = {id, kind, leaves: [], normal, center: whole.getCenter(new T.Vector3()).applyMatrix4(basis), progress: 0, target: 0, blocked: false};
      const leaf = (owned: Part[], box: T.Box3, hinge: number, slide = new T.Vector3()) => {
        const center = box.getCenter(new T.Vector3());
        const entry: DoorLeaf = {parts: owned, originals: owned.map(p => new T.Matrix4().fromArray(p.matrix)), pivot: new T.Vector3(hinge, center.y, center.z).applyMatrix4(basis), slide, angle: Math.PI / 2};
        door.leaves.push(entry); owned.forEach(p => this.moving.set(p, entry)); return entry;
      };
      if (kind === 'swing') {
        // A solid, thinner inner panel distinguishes the leaf from the U-shaped frame.
        const candidates = tall.filter(p => boxes.get(p)!.getSize(new T.Vector3()).x < width - .02);
        candidates.sort((a, b) => boxes.get(b)!.getSize(new T.Vector3()).x - boxes.get(a)!.getSize(new T.Vector3()).x);
        const panel = candidates[0];
        if (panel) {
          const b = boxes.get(panel)!;
          const hardware = parts.filter(p => { const s = boxes.get(p)!.getSize(new T.Vector3()); return s.y < .4 && s.x < .3; });
          const handleX = hardware.length ? hardware.reduce((n, p) => n + boxes.get(p)!.getCenter(new T.Vector3()).x, 0) / hardware.length : b.max.x;
          leaf([panel, ...hardware], b, handleX > b.getCenter(new T.Vector3()).x ? b.min.x : b.max.x);
        }
      } else if (kind === 'slide') {
        // Match glazing and its surrounding panel by horizontal center. The outer
        // frame spans the complete opening and remains static.
        const groups: {parts: Part[]; box: T.Box3}[] = [];
        for (const p of tall.filter(p => boxes.get(p)!.getSize(new T.Vector3()).x < width * .8)) {
          const b = boxes.get(p)!, x = b.getCenter(new T.Vector3()).x;
          let group = groups.find(g => Math.abs(g.box.getCenter(new T.Vector3()).x - x) < .08);
          if (!group) { group = {parts: [], box: new T.Box3()}; groups.push(group); }
          group.parts.push(p); group.box.union(b);
        }
        if (groups.length >= 2) {
          groups.sort((a, b) => a.box.min.x - b.box.min.x);
          const end = groups.at(-1)!.box.getCenter(new T.Vector3()).x;
          for (const group of groups) {
            const distance = end - group.box.getCenter(new T.Vector3()).x;
            if (distance > .05) leaf(group.parts, group.box, group.box.min.x, axis.clone().multiplyScalar(distance));
          }
        }
      } else {
        // IFC may put both leaves in one geometry. Split its triangle index into
        // two instances without mutating any shared source geometry.
        const middle = whole.getCenter(new T.Vector3()).x;
        const sides: Part[][] = [[], []], sideBounds = [new T.Box3(), new T.Box3()];
        for (const p of tall) {
          const b = boxes.get(p)!;
          if (b.min.x < middle - .02 && b.max.x > middle + .02) {
            const g = model.geometry.get(p.key)!, a = g.getAttribute('position'), ix = g.getIndex()!;
            const m = inverse.clone().multiply(new T.Matrix4().fromArray(p.matrix)), indices: number[][] = [[], []];
            for (let i = 0; i < ix.count; i += 3) {
              let x = 0; for (let j = 0; j < 3; j++) x += new T.Vector3().fromBufferAttribute(a, ix.getX(i + j)).applyMatrix4(m).x;
              indices[x / 3 < middle ? 0 : 1].push(ix.getX(i), ix.getX(i + 1), ix.getX(i + 2));
            }
            const replacements: Part[] = [];
            for (let side = 0; side < 2; side++) if (indices[side].length) {
              const geometry = new T.BufferGeometry();
              geometry.setAttribute('position', g.getAttribute('position')); geometry.setAttribute('normal', g.getAttribute('normal'));
              geometry.setIndex(indices[side]);
              // Only referenced vertices belong to this leaf. Shared attributes
              // still contain both sides of the original IFC geometry.
              geometry.boundingBox = new T.Box3();
              for (const index of indices[side]) geometry.boundingBox.expandByPoint(new T.Vector3().fromBufferAttribute(a, index));
              geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new T.Sphere());
              const copy = {...p, key: this.nextKey--, matrix: [...p.matrix]}; model.geometry.set(copy.key, geometry);
              sides[side].push(copy); replacements.push(copy);
              for (const index of indices[side]) sideBounds[side].expandByPoint(new T.Vector3().fromBufferAttribute(a, index).applyMatrix4(m));
            }
            model.parts.splice(model.parts.indexOf(p), 1, ...replacements);
            parts.splice(parts.indexOf(p), 1, ...replacements);
          } else {
            const side = b.getCenter(new T.Vector3()).x < middle ? 0 : 1;
            sides[side].push(p); sideBounds[side].union(b);
          }
        }
        if (sides.every(s => s.length)) for (let side = 0; side < 2; side++) leaf(sides[side], sideBounds[side], side ? sideBounds[side].max.x : sideBounds[side].min.x);
      }
      if (door.leaves.length) this.items.set(id, door); else this.unsupported.push(id);
    }
  }

  target(model: BimModel, physics: Physics, camera: T.Camera) {
    camera.updateMatrixWorld(true);
    const ray = new T.Raycaster(); ray.setFromCamera(new T.Vector2(), camera); ray.far = DOOR_REACH;
    // Physics performs the obstruction test without raycasting eight million visual triangles.
    const hit = physics.doorHit(ray.ray.origin, ray.ray.direction, DOOR_REACH);
    return hit != null && model.visible.has(hit) && !model.inspection() ? this.items.get(hit) ?? null : null;
  }

  toggle(door: Door, viewer: T.Vector3) {
    if (door.progress === 0 && door.target === 0 && (door.kind === 'swing' || door.kind === 'double')) {
      const side = viewer.clone().sub(door.center).dot(door.normal) >= 0 ? 1 : -1;
      for (const leaf of door.leaves) {
        // Open away from the viewer. Each leaf has its own outside hinge.
        const arm = new T.Vector3().setFromMatrixPosition(leaf.originals[0]).sub(leaf.pivot);
        const velocity = new T.Vector3().crossVectors(up, arm).dot(door.normal);
        leaf.angle = (velocity * side > 0 ? -1 : 1) * Math.PI / 2;
      }
    }
    door.target = door.target === 1 ? 0 : 1; door.blocked = false;
  }

  update(model: BimModel, physics: Physics, dt: number, onBlocked: () => void) {
    const changed = new Set<number>();
    for (const door of this.items.values()) {
      if (door.progress === door.target) continue;
      const old = door.progress, direction = Math.sign(door.target - old);
      const end = T.MathUtils.clamp(old + direction * Math.min(dt, .1) / .5, 0, 1);
      const steps = Math.max(1, Math.ceil(Math.abs(end - old) / .01));
      for (let step = 1; step <= steps; step++) {
        const progress = T.MathUtils.lerp(old, end, step / steps), transforms = door.leaves.map(l => this.transform(l, progress));
        if (!physics.moveDoor(door.leaves, transforms)) {
          door.target = door.progress; door.blocked = true; onBlocked(); break;
        }
        door.leaves.forEach((leaf, i) => leaf.parts.forEach((part, j) => model.setPartMatrix(part, transforms[i].clone().multiply(leaf.originals[j]))));
        door.progress = progress; changed.add(door.id);
      }
    }
    if (changed.size) model.finishMovingParts(changed);
  }

  transform(leaf: DoorLeaf, progress: number) {
    const t = progress * progress * (3 - 2 * progress);
    if (leaf.slide.lengthSq()) return new T.Matrix4().makeTranslation(leaf.slide.clone().multiplyScalar(t));
    return new T.Matrix4().makeTranslation(leaf.pivot).multiply(new T.Matrix4().makeRotationAxis(leaf.axis ?? up, leaf.angle * t)).multiply(new T.Matrix4().makeTranslation(leaf.pivot.clone().negate()));
  }
}
