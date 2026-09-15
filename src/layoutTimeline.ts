import { inspectLayout, prepareLayout, layoutDeclarations, type LayoutIssue } from './layoutGeometry';
import { LayoutObservations } from './layoutObservations';

/** Real playback, without skipping awaits or altering the renderer's clock. */
export function createLayoutTimeline() {
  const states = new Map<any, {index:number; start:number; last:number; observations:LayoutObservations}>();
  const ids = new WeakMap<object,string>();
  const failures = new Map<string, LayoutIssue & {scene:number; start:number; end:number}>();
  const declarations = new Map<string, ReturnType<typeof layoutDeclarations>[number]>();
  let samples=0, maxGapMs=0, error='';
  const register = (scene:any) => {
    if (!states.has(scene)) {
      const now=performance.now();
      states.set(scene,{index:states.size+1,start:now,last:now,observations:new LayoutObservations()});
    }
  };
  const sample = (scene:any, boundary=false, final=false) => {
    try {
      register(scene);
      const state=states.get(scene)!,now=performance.now(),time=now-state.start;
      maxGapMs=Math.max(maxGapMs,now-state.last);state.last=now;samples++;
      scene.render();
      const issues=inspectLayout(scene,time/1000,ids,boundary,final);
      for(const d of layoutDeclarations(scene,ids))declarations.set(JSON.stringify(d),d);
      for(const hit of state.observations.observe(issues.map(i=>i.key),time,boundary)) {
        const issue=issues.find(i=>i.key===hit.key)!;
        failures.set(`${state.index}:${hit.key}`,{...issue,scene:state.index,start:hit.start/1000,end:hit.end/1000});
      }
    } catch(e:any) { error=String(e?.message||e); }
  };
  return {
    register, sample,
    async boundary(scene:any, final=false) {
      try { await prepareLayout(scene); sample(scene,true,final); }
      catch(e:any) { throw Object.assign(new Error(String(e?.message||e)), {verificationStatus:'incomplete'}); }
    },
    get error(){return error || (maxGapMs>320 ? `动画采样间隙达到 ${Math.round(maxGapMs)}ms，过程覆盖不足，请保持页面运行后重试` : '');},
    get issues(){return [...failures.values()].slice(0,3);},
    get declarations(){return [...declarations.values()].slice(0,30);},
    get failure(){return [...failures.values()].slice(0,3).map(i=>`${i.message}; 场景 ${i.scene}，时间 ${i.start.toFixed(2)}–${i.end.toFixed(2)}s，已观测持续 ${(i.end-i.start).toFixed(2)}s; 屏幕边界=${JSON.stringify(i.bounds)}`).join('; ');},
    get coverage(){return {mode:'real-playback',intervalMs:80,samples,maxGapMs:Math.round(maxGapMs)};},
  };
}
