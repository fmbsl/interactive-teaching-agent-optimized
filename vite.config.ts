import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    host: true,
    watch: {
      // 整个 backend/ 不监听:后端运行时频繁写 sessions/*.jsonl、*.state.json、
      // step_codes.log、debug.log、llm_endpoints.json 等,这些都不在 import 图里,
      // 但 Vite 在某些平台/版本下监到 root 内文件变动会触发整页 reload
      // (用户反馈"点知识点 list 跳步就整页刷新"——跳步 MISS cache 时后端写
      // sessions jsonl,疑似由此触发)。一并排除,根因防御。
      ignored: ["**/backend/**"],
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        standalone: resolve(__dirname, "standalone.html"),
        graph: resolve(__dirname, "graph.html"),
      },
    },
  },
});
