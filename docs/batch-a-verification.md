# 批次 A：验证可信性修复与验收

日期：2026-09-15。基线：`38a41ea`；分支：`fix/batch-a-verification`。

## 已实施

### A1 验证结果与版本

- `passed / failed / incomplete / cancelled` 四种状态。仅完整覆盖要求且代码 SHA-256 匹配时，后端允许定稿。
- 超时返回未完成；定时器、取消监听和本次收集的场景在结束时清理。晚到回调不能解锁后续请求。
- 结果附带代码指纹、检查列表和未覆盖项；任务 nonce 由现有回传字段关联。
- 后端在启动恢复任务前拒绝过期 nonce/代码。commit 工具再次验证报告，不能仅凭旧 `ok:true` 定稿。
- 未完成/取消不恢复模型自动重试，不写入新通过版本；界面显示原因，可以手动预览未验证草稿。
- 播放模式允许用户长时间暂停，与离屏验证的 30 秒截止时间分开；播放退出使用取消信号。

### A2 统一场景入口

- 注入 `ctx.scene` 使用惰性创建；自建 `Scene/ThreeDScene` 通过本次执行的词法绑定和 ctx 构造器收集。
- 统一检查所有收集到的场景，包括自建构造器别名，避免修改全局构造器影响其他场景。
- 等待已跟踪的 play/wait 等异步操作结束，捕获未显式 await 的场景操作异常。
- 无场景、提前释放、不可读取/测量、未跟踪的画布、关闭布局检查，均不会直接报告通过。
- 3D 记录运行和对象检查，屏幕布局未覆盖，因此不能作为完整布局验证通过；保留手动草稿预览。
- 现有普通文字/几何的末帧重叠与越界检测复用原算法。本批没有实现公式专用测量或运动中途采样。

### A3 可重复样例

- `tests/verification.test.ts`：执行超时、延迟异常、监听清理、请求替换、取消、资源释放、构造器隔离、代码指纹。
- `backend/tests/test_verification.py`：真实 API 入口、真实 commit 工具的定稿门槛、过期回传拒绝、未知协议和覆盖不足处理。测试只使用虚构代码，不调用模型。
- `tools/verification-fixtures.html`：真实 manim-web 场景验证，含普通/自建/别名、重叠、测量异常、提前释放、超时、取消及 3D。
- `tools/verification-ui.html`：真实 AppProvider + StagePanel，在 React StrictMode 下验证请求、替换、取消和未验证预览。

## 协议摘要

`POST /api/render_result` 保留 session_id、step_id、nonce、ok、error、frame，同时增加 verification：

```json
{
  "schemaVersion": 1,
  "status": "passed",
  "ok": true,
  "error": "",
  "codeVersion": "源代码的 SHA-256",
  "checks": ["execution", "scene-access", "measurements", "mathtex", "nan", "layout-final", "bounds-final"],
  "missing": []
}
```

未知状态/版本、缺失必要检查、代码不符不算成功；缺少完整报告的旧布尔成功返回未完成，旧失败可以继续按失败处理。缺失或过期任务 nonce 返回 409，防止恢复错误任务。可选辅助截帧缺失只记录 `optional-visual-frame`，不伪装成已做视觉检查。

浏览器回传不能充当安全鉴权；执行隔离和 API 访问控制仍属于后续批次 E。

## 验证方式

```powershell
npm run test:verification
npm run build
python -m pytest backend/tests -q
python backend/manage.py check
```

Node 测试使用内置 TypeScript 类型擦除，需要支持该功能的 Node（本机 Node 24.17.0）。后端依赖仍需补齐原清单缺少的 LangGraph/LangChain 和 pytest；此项属于 E4。本次使用之前安装在独立审查目录的依赖，未改系统全局包。

浏览器：启动 `npm run dev -- --host 127.0.0.1 --port 5183`，打开 `/tools/verification-fixtures.html` 并点击运行。UI 集成在 `/tools/verification-ui.html`。两页均不会调用 LLM，测试入口不在正式 Vite 构建入口内。

## 验收结果

- 前端执行与请求管理：10 项通过。
- 后端：34 项通过（含原有测试）。
- 真实 manim-web：13/13 通过；重叠案例确认为重叠诊断，不以任意运行异常冒充通过。
- StrictMode 集成：正常 passed、旧请求 cancelled、新请求 passed、主动取消 cancelled、关闭检查 incomplete；手动预览显示“不会保存为通过版本”。
- 生产构建及 Django 检查通过。构建仍有原有的大文件提示。

## 实际边界

- `layout-final` 仅表示现有末帧检测完成，不代表整段动画无重叠，也不代表数学正确。公式及轴标签漏检、过程采样属于 B。
- 本批不能抢占主线程同步死循环；AbortSignal 是协作式取消。任意用户脚本自己创建的定时器、全局访问等不能视为已隔离，属于 E3。
- 无法通过受支持构造器/场景接口收集的脚本不予认证；旧脚本仍可预览。复杂动态构造与跨容器代码不保证兼容。
- 结束画面为空时返回未完成，因为当前末帧算法没有证据检查已移除内容；后续过程验证可改善这一限制。
- 3D 新草稿不会获得完整布局通过，需要明确的后续 3D 检查才能解除；可使用未验证预览。
- 未使用真实模型密钥，未做真实生成成功率或数学正确率评测。
- 代码指纹使用浏览器 Web Crypto；请通过 localhost 或 HTTPS 访问。无法计算指纹时返回未完成，不会跳过版本检查。
- 没有实施批次 C 的后台模型请求取消/全局状态提交隔离；这里只处理验证请求与回传身份，停止后台线程的问题仍待 C。

## 发布与回退

前后端需一起更新并重启后端、刷新前端；旧页面仅发送布尔成功时会被标为未完成。旧会话数据不做批量迁移或删除。修复独立保存在本分支，回退可撤销本批提交；不覆盖旧项目目录。
