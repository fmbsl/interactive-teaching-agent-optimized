import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";

// 端口优先取环境变量 PORT(供 preview_start 的 autoPort 指定),未设则回落到默认 5173。
const requestedPort = Number(process.env.PORT);
const DEV_PORT = Number.isInteger(requestedPort) && requestedPort > 0 && requestedPort <= 65535 ? requestedPort : 5173;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: DEV_PORT,
    host: true,
    // 前端走同源相对 /api,dev 时由 Vite 代理到后端 8000(公网/生产由统一入口反代)
    proxy: {
      "/api": "http://127.0.0.1:8000",
    },
    watch: {
      // 整个 backend/ 不监听:后端运行时频繁写 sessions/*.jsonl、*.state.json、
      // step_codes.log、debug.log、llm_endpoints.json 等,这些都不在 import 图里,
      // 但 Vite 在某些平台/版本下监到 root 内文件变动会触发整页 reload
      // (用户反馈"点知识点 list 跳步就整页刷新"——跳步 MISS cache 时后端写
      // sessions jsonl,疑似由此触发)。一并排除,根因防御。
      ignored: [
        "**/backend/**",
        "**/.portable-venv/**",
        "**/build/**",
        "**/release/**",
        "**/.tmp/**",
      ],
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        standalone: resolve(__dirname, "standalone.html"),
        graph: resolve(__dirname, "graph.html"),
        templates: resolve(__dirname, "templates.html"),
        webExamples: resolve(__dirname, "web-examples.html"),
      },
    },
  },
});
