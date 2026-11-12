import * as T from 'three';
import type { ElementInfo, Part } from './types';

export interface Finish {
  key: string;
  color: T.Color;
  roughness: number;
  metalness: number;
  opacity: number;
  surface?: 'wood' | 'tile' | 'carpet' | 'stone';
  emissive?: boolean;
}
const finish = (key: string, color: string, roughness = .85, metalness = 0, opacity = 1): Finish => ({key, color: new T.Color(color), roughness, metalness, opacity});
export function appearanceFor(element: ElementInfo | undefined, part: Part): Finish {
  const type = (element?.type ?? '').toLowerCase(), name = (element?.name ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const c = part.color;
  const cloth = part as Part & {curtainCloth?: boolean; curtainHemMin?: number; curtainHemMax?: number};
  if (cloth.curtainCloth) return finish(`curtain-cloth|${Math.max(.35, c[3]).toFixed(2)}|${cloth.curtainHemMin ?? -1.3}|${cloth.curtainHemMax ?? 1.3}`, '#e8e3d8', .96, 0, Math.max(.35, c[3]));
  if (/fita.*led|led.*strip/.test(name) || /luminaria|lightfixture|lamp/.test(name) && c[3] < .95) return {...finish('warm-emitter', '#fff1cf', .35), emissive: true};
  if (c[3] < .5 && !/cortina|tecido|curtain/.test(name) || /vidro/.test(name) && /wall|curtain/.test(type)) return finish('glass', '#c6e1e5', .12, .08, .24);
  if (/slab|stairflight|stair|ramp/.test(type) || /covering/.test(type) && !/forro|teto|ceiling/.test(name)) {
    const surface: Finish['surface'] = /laminado|madeira|wood/.test(name) ? 'wood' : /carpete|carpet/.test(name) ? 'carpet' : /molhad|porcelanato|ceramic|tile/.test(name) ? 'tile' : 'stone';
    // The shader separates the upper floor, neutral slab edge, and white underside.
    return {...finish(`floor-${surface}`, '#ffffff', surface === 'tile' ? .48 : .88), surface};
  }
  if (/covering/.test(type) || /forro|ceiling/.test(name)) return finish('ceiling', '#f8f6ee', .96);
  if (/wall/.test(type)) return /pedra/.test(name) ? finish('wall-stone', '#a89c88', .93) : finish('wall-plaster', '#e4ddd0', .94);
  if (type === 'ifcwindow') return /veneziana/.test(name) ? finish('window-timber', '#a58a65', .76) : finish('window-metal', '#626c6c', .4, .5);
  if (type === 'ifcdoor') {
    if (c[0] - c[2] > .08 || /semi-oca/.test(name) && Math.max(...c.slice(0, 3)) - Math.min(...c.slice(0, 3)) > .04) return finish('door-timber', '#b18c64', .7);
    return finish('door-hardware', '#79817f', .38, .55);
  }
  if (/member|railing/.test(type) || /inox|stainless|metalon/.test(name)) return finish('brushed-metal', '#707b7b', .42, .65);
  if (/furnishing/.test(type)) {
    if (/verde/.test(name)) return finish('textile-green', '#768270', .95);
    if (/carpete|tapete/.test(name)) return finish('rug', '#b4a89a', 1);
    if (/branco/.test(name)) return finish(`textile-ivory-${Math.max(.35, c[3]).toFixed(2)}`, '#e8e3d8', .92, 0, Math.max(.35, c[3]));
    if (/preto/.test(name)) return finish('furniture-charcoal', '#333b3b', .8);
    if (/madeira|mesa|armario|estante/.test(name) && c[0] >= c[2]) return finish('furniture-oak', '#aa8968', .79);
    if (/cama|puff|sofa|travesseiro/.test(name)) return finish('textile-sand', '#c8b9a4', .95);
  }
  return {key: `source-${c.map(v => v.toFixed(3)).join(',')}`, color: new T.Color(c[0], c[1], c[2]), roughness: .86, metalness: 0, opacity: Math.max(.12, c[3])};
}

export function createFinishMaterial(f: Finish) {
  const material = new T.MeshStandardMaterial({color: f.color, roughness: f.roughness, metalness: f.metalness, side: T.DoubleSide, shadowSide: T.DoubleSide, transparent: f.opacity < .99, opacity: f.opacity, depthWrite: f.opacity >= .99});
  material.forceSinglePass = true;
  material.userData.finish = f.key;
  if (f.emissive) { material.emissive.set('#ffd69a'); material.emissiveIntensity = .8; }
  if (f.surface) {
    const top = new T.Color(({wood: '#b8956d', tile: '#c8c2b3', carpet: '#9d9487', stone: '#b0aca1'})[f.surface]);
    material.userData.floorColor = top; material.userData.ceilingColor = new T.Color('#f5f2e9');
    material.customProgramCacheKey = () => `rex-surface-v1-${f.surface}`;
    material.onBeforeCompile = shader => {
      shader.uniforms.rexFloor = {value: top};
      shader.uniforms.rexCeiling = {value: material.userData.ceilingColor};
      shader.uniforms.rexEdge = {value: new T.Color('#a49e92')};
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vRexWorld;').replace('#include <project_vertex>', `#include <project_vertex>
        vec4 rexPosition = vec4(transformed, 1.0);
        #ifdef USE_BATCHING
          rexPosition = batchingMatrix * rexPosition;
        #endif
        #ifdef USE_INSTANCING
          rexPosition = instanceMatrix * rexPosition;
        #endif
        vRexWorld = (modelMatrix * rexPosition).xyz;`);
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vRexWorld;\nuniform vec3 rexFloor;\nuniform vec3 rexCeiling;\nuniform vec3 rexEdge;');
      const pattern = f.surface === 'wood' ? `
        float row = floor(vRexWorld.x / .18);
        vec2 cell = fract(vec2(vRexWorld.x / .18, (vRexWorld.z + mod(row, 2.0) * .65) / 1.3));
        vec2 aa = max(fwidth(cell), vec2(.001));
        float seam = (1.0 - smoothstep(.012, .012 + aa.x, min(cell.x, 1.0 - cell.x))) + (1.0 - smoothstep(.004, .004 + aa.y, min(cell.y, 1.0 - cell.y)));
        float grain = sin(vRexWorld.x * 210.0 + sin(vRexWorld.z * 4.0) * 2.0) * .018;
        rexTop *= 1.0 + grain - min(seam, 1.0) * .12;` : f.surface === 'tile' ? `
        vec2 cell = fract(vRexWorld.xz / .9);
        vec2 edge = min(cell, 1.0 - cell);
        vec2 aa = max(fwidth(cell), vec2(.001));
        float grout = 1.0 - smoothstep(.006, .006 + max(aa.x, aa.y), min(edge.x, edge.y));
        rexTop *= 1.0 - grout * .13;` : '';
      shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        vec3 rexWorldNormal = inverseTransformDirection(normal, viewMatrix);
        vec3 rexTop = rexFloor;
        ${pattern}
        vec3 rexSurface = mix(rexEdge, rexTop, smoothstep(.55, .85, rexWorldNormal.y));
        rexSurface = mix(rexSurface, rexCeiling, smoothstep(.55, .85, -rexWorldNormal.y));
        diffuseColor.rgb *= rexSurface;`);
    };
  }
  return material;
}
