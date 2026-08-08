import { createRoot } from "react-dom/client";
import "../index.css";
import WebExamplesReview from "./WebExamplesReview.tsx";

// 不用 StrictMode(同 templates 检查页):命令式创建/销毁 manim 场景与 StrictMode 双挂载冲突。
createRoot(document.getElementById("root")!).render(
  <WebExamplesReview />
);