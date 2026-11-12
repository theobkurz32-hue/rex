import * as T from 'three';
import { Doors, type Door, type DoorLeaf } from './doors';
import type { BimModel } from './model';
import type { Part } from './types';

/** Adds original window sashes to the same visual/physics interaction system. */
export function prepareWindows(model: BimModel, openings: Doors) {
  const unsupported: number[] = [], adapted: number[] = [];
  let interactive = 0;
  for (const [id, parts] of model.byElement) {
    const e = model.elements.get(id);
    if (e?.type.toLowerCase() !== 'ifcwindow') continue;
    const info = e.window, name = e.name ?? '';
    const width = info?.width ?? 0, height = info?.height ?? 0;
    // Outer frame is aligned with the opening even when shutters were exported open.
    let axis: T.Vector3 | null = null, best = Infinity;
    for (const p of parts) {
      const g = model.geometry.get(p.key)!, size = g.boundingBox!.getSize(new T.Vector3()).toArray();
      const matrix = new T.Matrix4().fromArray(p.matrix);
      for (let i = 0; i < 3; i++) {
        const direction = new T.Vector3().setFromMatrixColumn(matrix, i), length = direction.length(); direction.normalize();
        if (Math.abs(direction.y) > .01 || size[i] * length < .1) continue;
        const score = Math.abs(size[i] * length - width);
        if (score < best) { best = score; axis = direction; }
      }
    }
    if (!axis || width <= 0 || height <= 0) { unsupported.push(id); continue; }
    const normal = new T.Vector3().crossVectors(axis, new T.Vector3(0, 1, 0)).normalize();
    const basis = new T.Matrix4().makeBasis(axis, new T.Vector3(0, 1, 0), normal), inverse = basis.clone().invert();
    const boxes = new Map<Part, T.Box3>();
    for (const p of parts) {
      const b = new T.Box3(), g = model.geometry.get(p.key)!, a = g.getAttribute('position'), indices = g.getIndex()!;
      const m = inverse.clone().multiply(new T.Matrix4().fromArray(p.matrix));
      for (let i = 0; i < indices.count; i++) b.expandByPoint(new T.Vector3().fromBufferAttribute(a, indices.getX(i)).applyMatrix4(m));
      boxes.set(p, b);
    }
    const whole = new T.Box3(); for (const b of boxes.values()) whole.union(b);
    const tilt = /basculante|bottomhung|tophung/i.test(`${name} ${info?.operation ?? ''}`);
    const sliding = /veneziana|sliding|correr/i.test(`${name} ${info?.operation ?? ''}`);
    const door: Door = {id, category: 'window', kind: tilt || !sliding ? 'tilt' : 'slide', leaves: [], normal, center: whole.getCenter(new T.Vector3()).applyMatrix4(basis), progress: 0, target: 0, blocked: false};
    const addLeaf = (owned: Part[], box: T.Box3, slide: T.Vector3, horizontal: boolean) => {
      const center = box.getCenter(new T.Vector3());
      const leaf: DoorLeaf = {parts: owned, originals: owned.map(p => new T.Matrix4().fromArray(p.matrix)), pivot: new T.Vector3(center.x, horizontal ? box.max.y : center.y, center.z).applyMatrix4(basis), slide, angle: horizontal ? -Math.PI / 6 : 0, axis: horizontal ? axis.clone() : undefined};
      door.leaves.push(leaf); owned.forEach(p => openings.moving.set(p, leaf));
    };
    if (sliding) {
      // Glass and its thin surrounding sash share a center; broad outer frames,
      // seals and already-open external louvres remain in their IFC positions.
      const panels = parts.filter(p => { const s = boxes.get(p)!.getSize(new T.Vector3()); return s.x > width * .2 && s.x < width * .8 && s.y > height * .7 && s.z < .06; });
      const groups: {parts: Part[]; box: T.Box3}[] = [];
      for (const p of panels) {
        const b = boxes.get(p)!, center = b.getCenter(new T.Vector3());
        let group = groups.find(g => Math.abs(g.box.getCenter(new T.Vector3()).x - center.x) < .06);
        if (!group) { group = {parts: [], box: new T.Box3()}; groups.push(group); }
        group.parts.push(p); group.box.union(b);
      }
      groups.sort((a, b) => a.box.min.x - b.box.min.x);
      if (groups.length >= 2) {
        const destination = groups[groups.length-1].box.getCenter(new T.Vector3()).x;
        for (const g of groups.slice(0, -1)) {
          // Offset slightly onto the adjacent track so the sashes never coincide.
          const offset = axis.clone().multiplyScalar(destination - g.box.getCenter(new T.Vector3()).x).addScaledVector(normal, -.045);
          addLeaf(g.parts, g.box, offset, false);
        }
      }
    } else if (tilt) {
      // Four short stacked glass slats and their individual rails tilt together.
      const panels = parts.filter(p => { const s = boxes.get(p)!.getSize(new T.Vector3()); return s.x > width * .5 && s.x < width * .94 && s.y < height * .35 && s.y > .025 && s.z < .06; });
      const groups: {parts: Part[]; box: T.Box3}[] = [];
      for (const p of panels) {
        const b = boxes.get(p)!, y = b.getCenter(new T.Vector3()).y;
        let group = groups.find(g => Math.abs(g.box.getCenter(new T.Vector3()).y - y) < .025);
        if (!group) { group = {parts: [], box: new T.Box3()}; groups.push(group); }
        group.parts.push(p); group.box.union(b);
      }
      for (const g of groups) addLeaf(g.parts, g.box, new T.Vector3(), true);
    } else {
      // Fixed showcase families receive a virtual ventilation opening of their
      // inner glass+sash. The structural outer frame and the IFC file stay intact.
      const panels = parts.filter(p => { const s = boxes.get(p)!.getSize(new T.Vector3()); return s.x > width * .6 && s.x < width - .02 && s.y > height * .45 && s.z < .06; });
      if (panels.length) {
        const box = new T.Box3(); panels.forEach(p => box.union(boxes.get(p)!));
        addLeaf(panels, box, new T.Vector3(), true); door.leaves[0].angle = -Math.PI / 10; adapted.push(id);
      }
    }
    if (door.leaves.length) { openings.items.set(id, door); interactive++; } else unsupported.push(id);
  }
  return {interactive, unsupported, virtualVentilation: adapted};
}
