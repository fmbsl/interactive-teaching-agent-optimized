import {StrictMode, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {AppProvider,useApp} from '../src/store';
import StagePanel from '../src/components/StagePanel';
import '../src/index.css';

// Offline fixture: no backend or model requests are forwarded.
window.fetch = async () => new Response(JSON.stringify({endpoints:[],activeId:'',decompose_effort:'medium'}),{headers:{'Content-Type':'application/json'}});
function Harness() {
  const {setSceneCode,bumpStageReset,setBusyTask,clearBusyTask,busyTask} = useApp();
  const count=useRef(0);
  const [errors,setErrors]=useState<string[]>([]);
  window.onerror=(_m,_u,_l,_c,error)=>{setErrors(prev=>[...prev,String(error)]);};
  const injected=()=>`const {scene,Dot}=ctx;scene.add(new Dot());document.getElementById('playback-marker').textContent='第一段';await scene.wait(0.05);document.getElementById('playback-marker').textContent='第二段';await scene.wait(0.05); // ${++count.current}`;
  return <main style={{height:'100vh',display:'flex',flexDirection:'column',background:'#151821',color:'white'}}>
    <h1>上游整合回归（StrictMode）</h1>
    <button onClick={()=>setSceneCode(injected())}>新动画自动播放</button>
    <button onClick={()=>bumpStageReset()}>回到开头测试</button>
    <button onClick={()=>{setSceneCode('');setBusyTask({kind:'animation',label:'正在生成动画…',runId:1});}}>显示生成等待</button>
    <button onClick={()=>{setSceneCode(`const {Scene,Dot}=ctx;const scene=new Scene(container,{width:960,height:540});scene.add(new Dot());await scene.wait(0.05);document.getElementById('playback-marker').textContent='自建场景完成';`);clearBusyTask(1);}}>等待后载入自建场景</button>
    <button onClick={()=>{setBusyTask({kind:'animation',label:'新任务',runId:2});clearBusyTask(1);}}>迟到清理旧任务</button>
    <button onClick={()=>setBusyTask(null)}>清空等待</button>
    <p>当前任务：{busyTask?.label || '无'}</p><p>播放标记：<span id="playback-marker">待播放</span></p>
    <p>页面异常：{errors.length ? errors.join(';') : '无'}</p>
    <div style={{flex:1,minHeight:0}}><StagePanel/></div>
  </main>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><AppProvider><Harness/></AppProvider></StrictMode>);
