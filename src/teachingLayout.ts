import { layoutRole, allowOverlap, prepareLayout, screenBounds } from './layoutGeometry';

/** World-space layout helpers for the default, unrotated 2D camera. Never silently shrink content. */
export function teachingLayout(scene: any) {
  const w=scene.camera.frameWidth, h=scene.camera.frameHeight, gap=0.25;
  const zones = {
    title: {x:0,y:h/2-0.7,width:w-1,height:0.9},
    plot: {x:-w*0.19,y:0,width:w*0.52,height:h-2.6},
    formula: {x:w*0.29,y:0,width:w*0.32,height:h-2.6},
    explanation: {x:0,y:-h/2+0.75,width:w-1,height:1},
  };
  const groups=new Map<string,any[]>();
  return {
    zones, role:layoutRole, allowOverlap,
    async place(m:any, zone: keyof typeof zones) {
      if(typeof m.waitForRender==='function') await m.waitForRender();
      await document.fonts.ready;
      const z=zones[zone];
      if(typeof m.getFontSize==='function' && m.getFontSize()<20) throw new Error('[layout] 布局字号低于 20，请分页');
      // Canvas Text accepts newlines. Wrap by measuring actual constructed text, including CJK.
      if(typeof m.getText==='function' && typeof m.setText==='function') {
        const original=m.getText(); let line='',lines:string[]=[];
        for(const char of original) {
          if(char==='\n'){lines.push(line);line='';continue;}
          m.setText(line+char);
          if(m.getBoundingBox().width>z.width && line){lines.push(line);line=char;}else line+=char;
        }
        lines.push(line); m.setText(lines.join('\n'));
      }
      m.getBoundingBox(); // synchronize mobject transforms before inspecting display geometry
      const matrix=m.getThreeObject().matrixWorld.elements;
      const scale=Math.min(Math.hypot(matrix[0],matrix[1],matrix[2]),Math.hypot(matrix[4],matrix[5],matrix[6]));
      if(typeof m.getFontSize==='function' && m.getFontSize()*scale<20) throw new Error('[layout] 缩放后字号低于 20，请拆分内容或分页');
      const rendered=screenBounds(scene,m);
      if(!rendered)throw new Error('[layout] 布局对象不可见');
      const b={width:(rendered.right-rendered.left)*w/2,height:(rendered.top-rendered.bottom)*h/2};
      if(b.width>z.width || b.height>z.height) throw new Error(`[layout] 布局空间不足(${zone})，请拆分公式、调整排列或分步显示`);
      m.moveTo([z.x,z.y,0]); return m;
    },
    stack(objects:any[], center=[0,0,0], spacing=gap) {
      const heights=objects.map(m=>m.getBoundingBox().height);
      const total=heights.reduce((a,b)=>a+b,0)+Math.max(0,objects.length-1)*spacing;
      if(total>h-1)throw new Error('[layout] 纵向空间不足，请分页');
      let y=center[1]+total/2;
      objects.forEach((m,i)=>{m.moveTo([center[0],y-heights[i]/2,center[2]||0]);y-=heights[i]+spacing;});
    },
    align(objects:any[], edge:'left'|'right'|'top'|'bottom'='left') {
      const boxes=objects.map(m=>{m.getBoundingBox();return screenBounds(scene,m);});
      if(boxes.some(b=>!b))throw new Error('[layout] 对齐对象不可见');
      const values=boxes.map(b=>b![edge]);
      const target=(edge==='left'||edge==='bottom'?Math.min:Math.max)(...values);
      objects.forEach((m,i)=>m.shift(edge==='left'||edge==='right'?[(target-values[i])*w/2,0,0]:[0,(target-values[i])*h/2,0]));
    },
    avoid(m:any, obstacles:any[]) {
      // Choose a separating move that keeps the label on screen; do not hide/shrink anything.
      for(let attempt=0;attempt<12;attempt++) {
        m.getBoundingBox();const b=screenBounds(scene,m);
        if(!b)throw new Error('[layout] 避让对象不可见');
        const hit=obstacles.filter(o=>o!==m).map(o=>{o.getBoundingBox();return screenBounds(scene,o);}).find(o=>o && Math.min(o.right,b.right)>Math.max(o.left,b.left) && Math.min(o.top,b.top)>Math.max(o.bottom,b.bottom));
        if(!hit)return m;
        const moves=[[hit.left-b.right-0.03,0],[hit.right-b.left+0.03,0],[0,hit.bottom-b.top-0.03],[0,hit.top-b.bottom+0.03]];
        const move=moves.filter(([x,y])=>b.left+x>=-0.95 && b.right+x<=0.95 && b.bottom+y>=-0.95 && b.top+y<=0.95).sort((a,b)=>Math.hypot(...a)-Math.hypot(...b))[0];
        if(!move)break;m.shift([move[0]*w/2,move[1]*h/2,0]);
      }
      throw new Error('[layout] 无可用避让空间，请调整排列或分页');
    },
    replace(key:string, objects:any[]) {
      for(const old of groups.get(key)||[]) if(!objects.includes(old))scene.remove(old);
      scene.add(...objects); groups.set(key,[...objects]);
    },
    async ready(){await prepareLayout(scene);},
  };
}
