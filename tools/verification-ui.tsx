import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { AppProvider, useApp } from "../src/store";
import StagePanel from "../src/components/StagePanel";
import "../src/index.css";

function Harness() {
  const {requestVerify, cancelVerification, setBbCheckEnabled} = useApp();
  const [output,setOutput] = useState("待运行");
  const normal = `const {scene,Text}=ctx; scene.add(new Text({text:'Test',fontSize:24,fontFamily:'Arial',color:'#ffffff'}));`;
  async function run() {
    setOutput("运行中");
    setBbCheckEnabled(true);
    await new Promise(r=>setTimeout(r,0));
    const first = requestVerify(1,normal,1);
    const result = await first;
    const old = requestVerify(1,"await new Promise(r=>setTimeout(r,100));",1);
    await new Promise(r=>setTimeout(r,10));
    const next = requestVerify(1,normal,1);
    const previousResult=await old, nextResult=await next;
    const cancelling=requestVerify(1,"await new Promise(r=>setTimeout(r,100));",1);
    await new Promise(r=>setTimeout(r,10)); cancelVerification();
    const cancelled=await cancelling;
    setBbCheckEnabled(false);
    await new Promise(r=>setTimeout(r,0));
    const incomplete=await requestVerify(1,normal,1);
    setOutput(`正常=${result.status}; 被替换=${previousResult.status}; 新请求=${nextResult.status}; 主动取消=${cancelled.status}; 关闭检查=${incomplete.status}`);
  }
  return <main style={{height:"100vh",background:"#151821",color:"white",display:"flex",flexDirection:"column"}}>
    <h1>批次 A/B UI 回归（StrictMode）</h1><button onClick={run}>运行 UI 验证</button><button onClick={async()=>{setBbCheckEnabled(true);await new Promise(r=>setTimeout(r,0));const r=await requestVerify(1,normal+"scene.add(new ctx.Text({text:'Overlap',fontSize:24,fontFamily:'Arial'}));",1);setOutput(`布局冲突=${r.status}`);}}>测试布局失败反馈</button><p>{output}</p>
    <div style={{flex:1,minHeight:0}}><StagePanel/></div>
  </main>;
}
createRoot(document.getElementById("root")!).render(<StrictMode><AppProvider><Harness/></AppProvider></StrictMode>);
