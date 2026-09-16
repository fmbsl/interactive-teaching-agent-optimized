import {useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {AppProvider,useApp} from '../src/store';
import GraphApp from '../src/graph/GraphApp';
import '../src/index.css';
window.fetch=async()=>new Response(JSON.stringify({endpoints:[],activeId:''}),{headers:{'Content-Type':'application/json'}});
function Harness(){
const {setDecomposeGraph}=useApp();
useEffect(()=>{setDecomposeGraph({question:'傅里叶变换',root_title:'图谱箭头回归',snapshot:{nodes:[{id:'a',title:'从周期函数理解傅里叶级数的长中文标题',sets:['数学分析'],aliases:['基础概念']},{id:'b',title:'频率分量与函数分解',sets:['数学分析']},{id:'c',title:'傅里叶变换的数学定义',sets:['数学分析']}],edges:[{from:'a',to:'b'},{from:'b',to:'c'}]}});},[]);
return <div style={{height:'100vh'}}><GraphApp embedded/></div>;
}
createRoot(document.getElementById('root')!).render(<AppProvider><Harness/></AppProvider>);
