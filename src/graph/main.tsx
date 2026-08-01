import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import GraphApp from "./GraphApp.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <GraphApp />
  </StrictMode>
);
