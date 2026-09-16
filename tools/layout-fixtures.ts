import { verifyScene } from '../src/verifyScene';
const text = `const {scene,Text,MathTexImage,Axes,VGroup,Line,Rectangle,teachingLayout}=ctx;
const t=(s)=>new Text({text:s,fontSize:24,fontFamily:'Arial,SimSun'});
const pause=(ms)=>new Promise(r=>setTimeout(r,ms));`;
const cases = [
  {name:'错峰动画的空调度对象不误报',body:`const a=t('第一项').moveTo([-2,0,0]),b=t('第二项').moveTo([2,0,0]);await scene.play(new ctx.LaggedStart([new ctx.FadeIn(a,{duration:.2}),new ctx.FadeIn(b,{duration:.2})],{lagRatio:.3}));`,status:'passed'},
  {name:'只有空调度对象仍不能通过',body:`scene.add(new ctx.AnimationGroup([]).mobject);`,status:'incomplete'},

  {name:'超宽公式组自动分行',body:`const l=teachingLayout(scene),terms=['f(t)=','\\sin t','+0.6\\sin 3t','+0.35\\sin 6t'].map(latex=>new MathTexImage({latex,fontSize:28}));await Promise.all(terms.map(t=>t.waitForRender()));const g=new VGroup(...terms).arrange([1,0,0],.06);await l.place(g,'formula');scene.add(g);`,status:'passed'},
  {name:'命名说明替换自动定位',body:`const l=teachingLayout(scene);scene.add(t('图中标签'));await l.replace('explanation',[t('第一段说明')]);await l.replace('explanation',[t('第二段说明')]);if(scene._mobjects.size!==2)throw Error('replacement failed');`,status:'passed'},

  {name:'中文长标签重叠',body:`scene.add(t('这是较长的中文标题'),t('这里是第二段说明'));`,status:'failed'},
  {name:'两个公式重叠',body:`scene.add(new MathTexImage({latex:'x^2+y^2=1',fontSize:24}),new MathTexImage({latex:'a^2+b^2=c^2',fontSize:24}));`,status:'failed'},
  {name:'公式与正文重叠',body:`scene.add(new MathTexImage({latex:'x^2',fontSize:24}),t('公式说明'));`,status:'failed'},
  {name:'缩放旋转公式越界',body:`const e=new MathTexImage({latex:'a+b+c+d+e=f',fontSize:24});await e.waitForRender();e.scale(2).rotate(0.4).moveTo([6.8,0,0]);scene.add(e);`,status:'failed'},
  {name:'轴内标签重叠',body:`const a=new Axes();a.add(t('标签甲'));a.add(t('标签乙'));scene.add(a);`,status:'failed'},
  {name:'变换组内标签重叠',body:`const g=new VGroup(t('标签甲'),t('标签乙'));g.shift([2,1,0]).scale(1.2).rotate(0.3);scene.add(g);`,status:'failed'},
  {name:'曲线相交允许',body:`scene.add(new Line({start:[-2,-2,0],end:[2,2,0]}),new Line({start:[-2,2,0],end:[2,-2,0]}),t('曲线说明').moveTo([0,2,0]));`,status:'passed'},
  {name:'图形内标签允许',body:`scene.add(new Rectangle({width:4,height:2,fillOpacity:1}),t('按钮'));`,status:'passed'},
  {name:'中途持续重叠而末帧正常',body:`const a=t('Label A').moveTo([-2,0,0]),b=t('Label B').moveTo([2,0,0]);scene.add(a,b);await scene.wait(0.1);await scene.play(a.animate.moveTo([2,0,0]).withDuration(0.4));await scene.wait(0.3);a.moveTo([-2,0,0]);`,status:'failed'},
  {name:'非 scene.wait 的中途重叠',body:`const a=t('A'),b=t('B').moveTo([2,0,0]);scene.add(a,b);await pause(100);b.moveTo([0,0,0]);scene.render();await pause(400);b.moveTo([2,0,0]);`,status:'failed'},
  {name:'短暂过渡不阻断',body:`const a=t('A'),b=t('B').moveTo([2,0,0]);scene.add(a,b);await pause(100);b.moveTo([0,0,0]);scene.render();await pause(30);b.moveTo([2,0,0]);`,status:'passed'},
  {name:'限定公式过渡允许',body:`const l=teachingLayout(scene),a=new MathTexImage({latex:'x',fontSize:24}),b=new MathTexImage({latex:'y',fontSize:24});await Promise.all([a.waitForRender(),b.waitForRender()]);l.allowOverlap(a,b,0,1,'公式替换过渡');scene.add(a,b);await scene.wait(0.25);scene.remove(a);`,status:'passed'},
  {name:'过期豁免仍阻断',body:`const l=teachingLayout(scene),a=t('A'),b=t('B');l.allowOverlap(a,b,0,0.1,'过渡');scene.add(a,b);await scene.wait(0.4);`,status:'failed'},
  {name:'已移除标签不检测',body:`const a=t('A'),b=t('B');scene.add(a,b);scene.remove(b);`,status:'passed'},
  {name:'透明标签不检测',body:`const a=t('A'),b=t('B');b.setFillOpacity(0);scene.add(a,b);`,status:'passed'},
  {name:'公共布局短标题和公式',body:`const l=teachingLayout(scene),a=t('函数变化'),e=new MathTexImage({latex:'y=x^2',fontSize:24});await l.place(a,'title');await l.place(e,'formula');l.replace('heading',[a]);scene.add(e);`,status:'passed'},
  {name:'公共布局中文长标题换行',body:`const l=teachingLayout(scene),a=t('这是用于检查换行的较长中文标题'.repeat(4));await l.place(a,'title');scene.add(a);if(!a.getText().includes('\\n'))throw Error('没有换行');`,status:'passed'},
  {name:'空间不足要求分页',body:`const l=teachingLayout(scene),a=t('中文说明'.repeat(200));await l.place(a,'explanation');scene.add(a);`,status:'failed',reason:'空间不足'},
  {name:'缺少渲染几何不能通过',body:`const a=t('A');scene.add(a);a.getThreeObject=()=>new ctx.THREE.Group();`,status:'incomplete'},
  {name:'中途交叉且两端正常',body:`const a=t('moving label').moveTo([-2,0,0]),b=t('fixed label');scene.add(a,b);await scene.play(a.animate.moveTo([2,0,0]).withDuration(1.4));`,status:'failed'},
  {name:'透明留白不算公式重叠',body:`scene.add(new MathTexImage({latex:'x^2',fontSize:24}).moveTo([0,0.4,0]),new MathTexImage({latex:'y^2',fontSize:24}).moveTo([0,-0.4,0]));`,status:'passed'},
  {name:'已显示文字隐藏并恢复',body:`const a=t('A'),b=t('B');scene.add(a);scene.render();a.setFillOpacity(0);scene.add(b);await scene.wait(0.1);scene.remove(b);a.setFillOpacity(1);`,status:'passed'},
  {name:'公共避让不删除内容',body:`const l=teachingLayout(scene),a=t('标签甲'),b=t('标签乙');scene.add(a,b);l.avoid(a,[b]);if(scene._mobjects.size!==2)throw Error('objects removed');`,status:'passed'},
  {name:'末帧不能使用过渡豁免',body:`const l=teachingLayout(scene),a=t('A'),b=t('B');l.allowOverlap(a,b,0,5,'transition');scene.add(a,b);`,status:'failed'},
  {name:'参数边界布局',body:`const l=teachingLayout(scene),a=t('参数='+ctx.params.value);await l.place(a,'title');scene.add(a);`,status:'passed',params:{value:100}},
  {name:'相机平移后的越界',body:`const a=t('远处标签').moveTo([4,0,0]);scene.add(a);scene.camera.getCamera().position.x=-4;`,status:'failed'},
  {name:'采样长间隙不认证',body:`scene.add(t('A'));await scene.wait(0.1);const until=performance.now()+380;while(performance.now()<until){};`,status:'incomplete'},
  {name:'实心图形部分遮住文字',body:`scene.add(new Rectangle({width:2,height:1,fillOpacity:1}),t('说明文字').moveTo([0.9,0,0]));`,status:'failed'},
  {name:'更新文字的持续碰撞',body:`const a=t('A'),b=t('B');scene.add(a,b);for(let i=0;i<8;i++){a.setText('count='+i);await pause(80);}a.moveTo([-2,0,0]);`,status:'failed'},
  {name:'对齐后保持行间距',body:`const l=teachingLayout(scene),a=t('短标题').moveTo([1,1,0]),b=t('较长中文标题').moveTo([-1,-1,0]);scene.add(a,b);l.align([a,b],'left');`,status:'passed'},
  {name:'禁止无限缩小字号',body:`const l=teachingLayout(scene),a=t('重要说明').scale(0.1);await l.place(a,'title');scene.add(a);`,status:'failed'},
  {name:'命名说明替换保留坐标轴',body:`const l=teachingLayout(scene),axis=new Axes();scene.add(axis);l.replace('note',[t('旧说明')]);l.replace('note',[t('新说明')]);if(!scene._mobjects.has(axis)||scene._mobjects.size!==2)throw Error('replacement lost objects');`,status:'passed'},
];
document.querySelector<HTMLButtonElement>('#run')!.onclick=async()=>{
  const button=document.querySelector<HTMLButtonElement>('#run')!,out=document.querySelector('#results')!;
  button.disabled=true;out.textContent='运行中\n';let passed=0;
  for(const c of cases){
    const r=await verifyScene(text+c.body,c.params||{}, {signal:new AbortController().signal,layout:true,vision:false,background:'#0a0c14',timeoutMs:10000});
    const ok=r.status===c.status && (c.status!=='failed'||r.error.includes(c.reason||'[layout]'));
    if(ok)passed++;out.textContent+=`${ok?'PASS':'FAIL'} ${c.name}: ${r.status}; ${r.error}; ${JSON.stringify(r.sampling||{})}\n`;
  }
  out.textContent+=`总计 ${passed}/${cases.length} 通过`;button.disabled=false;
};
