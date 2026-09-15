import { verifyScene } from "../src/verifyScene";
import { isSelfBuildCode } from "../src/runScript";

const normal = `const {scene, Text}=ctx; scene.add(new Text({text:'测试 A',fontSize:24,fontFamily:'Arial',color:'#ffffff'}));`;
const overlap = `const {scene, Text}=ctx; scene.add(new Text({text:'Label one',fontSize:24,fontFamily:'Arial',color:'#ffffff'}), new Text({text:'Label two',fontSize:24,fontFamily:'Arial',color:'#ffffff'}));`;
const self = `const {Scene: Builder, container, Text}=ctx; const s=new Builder(container, {width:960,height:540}); s.add(new Text({text:'Test',fontSize:24,fontFamily:'Arial',color:'#ffffff'}));`;
const cases = [
  {name:"注入场景正常", code:normal, expected:"passed"},
  {name:"自建场景别名正常", code:self, expected:"passed"},
  {name:"自由构造器正常", code:`const s=new Scene(container,{width:960,height:540}); s.add(new Text({text:'Test',fontSize:24,fontFamily:'Arial',color:'#ffffff'}));`,expected:"passed"},
  {name:"注入场景重叠", code:overlap, expected:"failed", reason:"重叠"},
  {name:"自建场景重叠", code:`const {Scene,container,Text}=ctx; const scene=new Scene(container,{width:960,height:540}); scene.add(new Text({text:'Label one',fontSize:24,fontFamily:'Arial',color:'#ffffff'}),new Text({text:'Label two',fontSize:24,fontFamily:'Arial',color:'#ffffff'}));`,expected:"failed"},
  {name:"没有创建场景", code:`const x=1;`,expected:"incomplete"},
  {name:"关闭布局检查", code:normal,layout:false,expected:"incomplete"},
  {name:"测量异常", code:`const {scene,Text}=ctx; const t=new Text({text:'Test',fontSize:24,fontFamily:'Arial'}); scene.add(t); t.getBoundingBox=()=>{throw new Error('unmeasurable');};`,expected:"incomplete"},
  {name:"结束前释放场景", code:`const {scene}=ctx; scene.dispose();`,expected:"incomplete"},
  {name:"超时后抛错", code:`await new Promise(r=>setTimeout(r,80)); throw new Error('late error');`,timeoutMs:20,expected:"incomplete"},
  {name:"超时后下一次验证", code:normal,expected:"passed"},
  {name:"提前取消", code:normal,cancel:true,expected:"cancelled"},
  {name:"3D 覆盖明确", code:`const {ThreeDScene,container,Sphere}=ctx; const s=new ThreeDScene(container,{width:960,height:540}); s.add(new Sphere());`,expected:"incomplete"},
];
document.querySelector<HTMLButtonElement>("#run")!.onclick = async () => {
  const button = document.querySelector<HTMLButtonElement>("#run")!;
  const out = document.querySelector("#results")!;
  button.disabled=true; out.textContent="运行中\n";
  let passed=0;
  if (!isSelfBuildCode(self)) throw new Error("自建场景别名未被播放入口识别");
  for (const fixture of cases) {
    const controller=new AbortController();
    if (fixture.cancel) controller.abort();
    const result=await verifyScene(fixture.code,{}, {signal:controller.signal,background:"#0a0c14",layout:fixture.layout!==false,vision:false,timeoutMs:fixture.timeoutMs??5000});
    const ok=result.status===fixture.expected && (!fixture.reason || result.error.includes(fixture.reason));
    if(ok)passed++;
    out.textContent += `${ok?'PASS':'FAIL'} ${fixture.name}: ${result.status}; ${result.error}; checks=${result.checks.join(',')}; missing=${result.missing.join(',')}\n`;
  }
  out.textContent += `总计 ${passed}/${cases.length} 通过\n`;
  button.disabled=false;
};


