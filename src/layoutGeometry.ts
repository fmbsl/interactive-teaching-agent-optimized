import { THREE } from 'manim-web';

export type Rect = { left: number; right: number; top: number; bottom: number };
export type LayoutIssue = { key: string; type: 'overlap' | 'bounds'; objects: string[]; bounds: Rect[]; message: string };
const metadata = new WeakMap<object, { id?: string; role?: string }>();
const permissions = new WeakMap<object, { other: object; start: number; end: number; reason: string }[]>();
const identityCounters = new WeakMap<object,number>();
function objectId(m:any, ids:WeakMap<object,string>): string {
  if(!ids.has(m)) {
    const n=(identityCounters.get(ids)||0)+1;identityCounters.set(ids,n);
    ids.set(m,`object-${n}`);
  }
  return `${metadata.get(m)?.id || String(m.getText?.()??m.getLatex?.()??'图形').slice(0,24)}[${ids.get(m)}]`;
}
export function layoutDeclarations(scene:any, ids:WeakMap<object,string>) {
  const out:{objects:string[];start:number;end:number;reason:string}[]=[],seen=new Set<any>();
  const visit=(m:any)=>{
    if(seen.has(m))return;seen.add(m);
    for(const p of permissions.get(m)||[])out.push({objects:[objectId(m,ids),objectId(p.other,ids)],start:p.start,end:p.end,reason:p.reason});
    (m.submobjects||m._submobjects||[]).forEach(visit);
  };
  [...scene._mobjects].forEach(visit);return out;
}
const textureBounds = new WeakMap<object, {version: number; width: number; height: number; bounds: Rect | null}>();

/** Measure the rendered texture's alpha, not its transparent padding. No screenshot is taken. */
function alphaBounds(texture: any): Rect | null | undefined {
  const canvas = texture?.image;
  if (!(canvas instanceof HTMLCanvasElement)) return undefined;
  const width = canvas.width, height = canvas.height;
  const cached = textureBounds.get(texture);
  if (cached && cached.version === texture.version && cached.width === width && cached.height === height) return cached.bounds;
  if (!width || !height || width * height > 16000000) throw new Error('纹理尺寸不可可靠测量');
  const pixels = canvas.getContext('2d')?.getImageData(0,0,width,height).data;
  if (!pixels) throw new Error('纹理像素无法读取');
  let left=width, right=-1, top=height, bottom=-1;
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) if(pixels[(y*width+x)*4+3]>16) {
    left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
  }
  const bounds = right<left ? null : {left:left/width,right:(right+1)/width,top:top/height,bottom:(bottom+1)/height};
  textureBounds.set(texture,{version:texture.version,width,height,bounds});
  return bounds;
}
export function layoutRole(m: any, id: string, role = 'label') { metadata.set(m, { id, role }); return m; }
export function allowOverlap(a: object, b: object, start: number, end: number, reason: string) {
  if (typeof reason!=='string' || !reason.trim() || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || end-start>5) throw new Error('叠放声明需要原因及不超过 5 秒的有限时间窗口');
  permissions.set(a, [...(permissions.get(a) || []), { other: b, start, end, reason }]);
}
export const readable = (m: any) => typeof m.getText === 'function' || typeof m.getLatex === 'function' || typeof m._text === 'string';

/** Reject text that only becomes unreadable after it is nested/scaled in a group. */
export function assertReadableTypography(scene:any, root:any, minimum=20) {
  scene.camera?.getCamera?.()?.updateMatrixWorld?.(true);
  root.getThreeObject?.()?.updateWorldMatrix?.(true,true);
  const seen=new Set<any>();
  const visit=(m:any) => {
    if(seen.has(m))return;seen.add(m);
    if(readable(m) && typeof m.getFontSize==='function') {
      const three=m.getThreeObject?.();three?.updateWorldMatrix?.(true,true);
      const matrix=three?.matrixWorld?.elements;
      if(!matrix)throw new Error('[layout] 无法测量文字的屏幕字号');
      const scale=Math.min(
        Math.hypot(matrix[0],matrix[1],matrix[2]),
        Math.hypot(matrix[4],matrix[5],matrix[6]),
      );
      const size=m.getFontSize()*scale;
      if(!Number.isFinite(size) || size<minimum) {
        const label=String(m.getText?.() ?? m.getLatex?.() ?? '文字').slice(0,32);
        throw new Error(`[layout] “${label}”实际字号 ${Number.isFinite(size)?size.toFixed(1):'不可测'}，低于 ${minimum}；请分段展示或减少同屏内容，不要缩小字体`);
      }
    }
    for(const child of m.submobjects || m._submobjects || [])visit(child);
  };
  visit(root);
}
export async function prepareLayout(scene: any) {
  const seen = new Set<any>();
  const visit = async (m: any): Promise<void> => {
    if (seen.has(m)) return; seen.add(m);
    if (typeof m.getFontFamily === 'function' && typeof m.getFontSize === 'function') {
      const font=`${m.getFontSize()}px ${m.getFontFamily()}`,text=m.getText?.() || '数学';
      const wasReady=document.fonts.check(font,text);
      await document.fonts.load(font,text);
      if(!wasReady && typeof m.setText==='function')m.setText(m.getText());
    }
    if (typeof m.waitForRender === 'function') await m.waitForRender();
    await Promise.all((m.submobjects || m._submobjects || []).map(visit));
  };
  await Promise.all([...scene._mobjects].map(visit));
  await document.fonts.ready;
  scene.render();
}

/** Project actual display geometry, including parent transforms and camera, into NDC. */
export function screenBounds(scene: any, m: any, strict = true): Rect | null {
  const camera = scene.camera?.getCamera?.();
  const root = m.getThreeObject?.();
  if (!camera || !root) throw new Error('无法读取渲染对象或相机');
  camera.updateMatrixWorld(true); root.updateWorldMatrix(true, true);
  const points: any[] = [];
  let observed = false;
  // Descendant textures must use their own mobject's text metadata, including inside VGroup.
  const owners = new WeakMap<object, any>();
  const collect = (object:any) => {
    const three=object.getThreeObject?.();
    if(three)owners.set(three,object);
    for(const child of object.submobjects || object._submobjects || [])collect(child);
  };
  collect(m);
  const visit = (o: any, inherited = m) => {
    const owner=owners.get(o) || inherited;
    if (!o.visible) { observed = true; return; }
    const materials = Array.isArray(o.material) ? o.material : [o.material];
    if (o.geometry && materials.some((v:any)=>v)) observed = true;
    if (o.geometry && materials.some((v: any) => v && v.visible !== false && v.opacity > 0.05)) {
      o.geometry.computeBoundingBox();
      const b = o.geometry.boundingBox?.clone();
      if (b && readable(owner) && o.geometry.type === 'PlaneGeometry' && materials.length===1) {
        const texture=materials[0]?.map;
        const alpha=alphaBounds(texture);
        if (alpha === null) {
          if (strict && (owner.fillOpacity ?? 1)>0.05 && String(owner.getText?.()??owner.getLatex?.()??'').trim()) throw new Error('文字/公式纹理为空，无法确认可读内容');
          return;
        }
        if (alpha) {
          if(texture.rotation || texture.offset.x || texture.offset.y || texture.repeat.x!==1 || texture.repeat.y!==1) throw new Error('不支持变换过的文字纹理 UV');
          const width=b.max.x-b.min.x,height=b.max.y-b.min.y,x=b.min.x,y=b.min.y;
          b.min.x=x+width*alpha.left;b.max.x=x+width*alpha.right;
          b.min.y=y+height*(texture.flipY?1-alpha.bottom:alpha.top);
          b.max.y=y+height*(texture.flipY?1-alpha.top:alpha.bottom);
        }
      }
      if (b && !b.isEmpty()) for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
        points.push(new THREE.Vector3(x,y,z).applyMatrix4(o.matrixWorld).project(camera));
      }
    }
    o.children.forEach((child:any)=>visit(child,owner));
  };
  for (let parent = root.parent; parent; parent = parent.parent) if (!parent.visible) return null;
  visit(root);
  if (!points.length) {
    if (!observed && strict) throw new Error('可见对象缺少可测量的渲染几何');
    return null;
  }
  if (points.some(p => ![p.x,p.y,p.z].every(Number.isFinite))) throw new Error('屏幕投影不可测量');
  return { left: Math.min(...points.map(p=>p.x)), right: Math.max(...points.map(p=>p.x)), bottom: Math.min(...points.map(p=>p.y)), top: Math.max(...points.map(p=>p.y)) };
}

export function inspectLayout(scene: any, time = 0, ids = new WeakMap<object,string>(), strict = true, final = false): LayoutIssue[] {
  const objects: { m: any; id: string; key:string; text: boolean; b: Rect }[] = [];
  const seen = new Set<any>();
  const visit = (m: any, axis = false) => {
    if (seen.has(m)) return; seen.add(m);
    const text = readable(m), kids = m.submobjects || m._submobjects || [];
    if(text)assertReadableTypography(scene,m);
    const isAxis = axis || typeof m.c2p === 'function' || typeof m.p2c === 'function';
    const role = metadata.get(m)?.role;
    const pts = m.getPoints?.() || [];
    const shape = !kids.length && !isAxis && !m.getStart && pts.length > 0 && (pts.length <= 40 || typeof m.getRadius==='function') && (m.fillOpacity ?? 0) > 0.05;
    if ((text || shape) && (text || role !== 'background')) {
      // Preserve explicit legacy geometry failures instead of certifying unknown observations.
      if (!strict && m.isRendering?.()) return;
      m.getBoundingBox();
      const b = screenBounds(scene,m,strict);
      if (b && b.right>b.left && b.top>b.bottom) {
        objects.push({ m, id: objectId(m,ids), key:ids.get(m)!, text, b });
      }
    }
    if (!text) kids.forEach((c: any)=>visit(c,isAxis));
  };
  [...scene._mobjects].forEach(m=>visit(m));
  if(objects.length>500)throw new Error('可测布局对象超过 500 个，需拆分场景');
  const out: LayoutIssue[] = [];
  for (const a of objects) if (a.text && (a.b.left < -1.025 || a.b.right > 1.025 || a.b.bottom < -1.025 || a.b.top > 1.025)) out.push({key:`bounds:${a.key}`, type:'bounds',objects:[a.id],bounds:[a.b],message:`${a.id} 越界：移入画幅或换行/分页，保留可读字号`});
  for (let i=0;i<objects.length;i++) for (let j=i+1;j<objects.length;j++) {
    const a=objects[i],b=objects[j];
    if (!a.text && !b.text) continue;
    if (!final && ([...(permissions.get(a.m)||[]).map(p=>({...p,match:p.other===b.m})),...(permissions.get(b.m)||[]).map(p=>({...p,match:p.other===a.m}))].some(p=>p.match && time>=p.start && time<=p.end))) continue;
    const x=Math.min(a.b.right,b.b.right)-Math.max(a.b.left,b.b.left), y=Math.min(a.b.top,b.b.top)-Math.max(a.b.bottom,b.b.bottom);
    const area=(r:Rect)=>(r.right-r.left)*(r.top-r.bottom);
    if(x<=0 || y<=0 || x*y/Math.min(area(a.b),area(b.b))<0.12) continue;
    // Fully contained text in a filled shape is a conventional label/button.
    if(a.text!==b.text) {
      const t=a.text?a.b:b.b,s=a.text?b.b:a.b;
      if(t.left>=s.left && t.right<=s.right && t.bottom>=s.bottom && t.top<=s.top) continue;
    }
    const dx=(a.b.left+a.b.right)<=(b.b.left+b.b.right)?b.b.left-a.b.right-0.02:b.b.right-a.b.left+0.02;
    const dy=(a.b.top+a.b.bottom)<=(b.b.top+b.b.bottom)?b.b.bottom-a.b.top-0.02:b.b.top-a.b.bottom+0.02;
    const horizontal=Math.abs(dx)<Math.abs(dy);
    const dist=Math.abs(horizontal?dx:dy)/2*(horizontal?scene.camera.frameWidth:scene.camera.frameHeight);
    out.push({key:`overlap:${[a.key,b.key].sort().join(':')}`,type:'overlap',objects:[a.id,b.id],bounds:[a.b,b.b],message:`${a.id} 与 ${b.id} 重叠：建议前者往${horizontal?(dx<0?'左':'右'):(dy<0?'下':'上')}移 ${dist.toFixed(2)} 场景单位（相机旋转时按屏幕方向换算）`});
  }
  return out;
}
