import { createRoot } from "react-dom/client";
import "../index.css";
import TemplateReview from "./TemplateReview.tsx";

// 注意:不用 StrictMode —— 本页是模板检查工具,StrictMode 会让 effect 双挂载,
// 与"创建/销毁 manim 场景"的命令式生命周期互相打架(旧场景 dispose 未完成就重建),
// 导致 scene.play 的 promise 悬置、状态卡在"运行中"。
createRoot(document.getElementById("root")!).render(
  <TemplateReview />
);