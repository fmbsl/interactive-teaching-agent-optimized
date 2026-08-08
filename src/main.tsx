import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import ErrorBoundary from "./ErrorBoundary.tsx";
import { applyTheme, applyCustomCss, loadTheme, loadCustomCss } from "./theme";

// 模块加载即应用持久化的主题 + 自定义 CSS(先于首次渲染,避免主题闪跳)
applyTheme(loadTheme());
applyCustomCss(loadCustomCss());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
