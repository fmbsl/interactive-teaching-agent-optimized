# 批次 B：2D 布局与重叠修复

日期：2026-09-15。基于批次 A 的 `8977a2a`，在本地项目 `interactive-teaching-agent-latest` 实施。

## 本次改变

| 范围 | 实现与用户可见效果 | 验证 |
|---|---|---|
| B1 测量 | Text、MathTexImage 按纹理可见内容计算边界，排除透明留白；向量公式按显示几何测量。使用对象世界变换和相机投影统一到屏幕坐标；公式全边界参与越界检查 | 中文、公式互相遮挡、旋转/缩放、组内标签、相机平移、透明留白样例通过 |
| B1 标签与资源 | 等待字体、公式资源；遍历坐标轴标签，轴线和刻度不作为实心遮挡物；组包络不重复检查。不可测几何返回未完成 | 轴内标签、缺少渲染几何、旧 A 异常样例通过 |
| B2 合理叠放 | 曲线/细线相交通常允许；实心图形包含文字视作内部标签，部分覆盖继续检查；支持对象 ID 和有限过渡声明，保留审计记录 | 图形内标签、部分遮挡、合法过渡、过期与末帧豁免用例通过 |
| B3 过程 | 真实播放，play/wait 前后检查；80ms 周期采样；连续观测约 200ms 的冲突阻止定稿。末帧、段落边界冲突直接报错 | 中途交叉且两端正常的动画被识别，记录约 0.55–0.87s 的冲突 |
| B3 覆盖可信 | 不跳过 await、不伪造加速时钟。单次采样间隔超过 320ms 返回未完成；对象身份不随文字更新、列表位置变化而重置 | 人工 380ms 间隙未被认证；更新文字仍能检测持续冲突 |
| B4 布局工具 | 新增 `teachingLayout`：区域、换行、纵向排列、对齐、避让、命名组替换；place 保留最低字号，空间不足要求拆分/分页 | 长中文换行、参数值、避让、替换保留坐标轴、禁止过度缩小用例通过 |
| B5 反馈与修复 | 最多 3 条冲突，含对象 ID、场景号、时间、边界、移动建议、代码哈希。提示词优先局部 patch；默认最多自动布局修复 2 轮，达到上限停止调用模型 | 服务端实际 resume 路径预算测试通过；手动入口为聊天栏“重试修复本步布局” |

另修复纹理文字透明度更新：Text 的填充透明度变化需要重绘其 Canvas 纹理；MathTexImage 同步材质透明度。避免已显示的旧文字隐藏后仍残留，支持恢复显示。

## 生成代码可用的 API

适用于默认居中、未旋转的 2D 相机布局。检测器本身支持相机及组变换；布局工具的坐标安排不是通用约束求解器，复杂相机或嵌套变换仍需要自行安排坐标并通过验证。

```js
const { scene, Text, MathTexImage, teachingLayout } = ctx;
const layout = teachingLayout(scene);
const title = new Text({
  text: '函数变化', fontSize: 24, fontFamily: 'Arial,SimSun'
});
const equation = new MathTexImage({ latex: 'y=x^2', fontSize: 24 });
await layout.place(title, 'title');
await layout.place(equation, 'formula');
layout.role(equation, 'equation-main', 'formula');
layout.replace('heading', [title]);
scene.add(equation);
```

- `place(object, zone)`：区域为 `title / plot / formula / explanation`；Text 按实测宽度换行，公式要求手工拆分。字号及对象缩放后的字号低于 20 会拒绝；不通过无限缩小达标。
- `stack(objects, center, spacing)`：纵向排列，默认间隔 0.25 场景单位。
- `align(objects, edge)`：按可见边界对齐，edge 为 `left / right / top / bottom`。
- `avoid(label, obstacles)`：寻找画幅内的分离位置，最多尝试 12 次；无空间明确报错。
- `replace(key, objects)`：只移除同名组上一批对象，保留其他对象；命名组由同一 layout 实例管理。
- `role(object, id, role)`：反馈中的稳定名称。不能通过把公式声明为背景来跳过文字检查。
- `allowOverlap(a,b,start,end,reason)`：时间从场景创建起计算，单位为实际秒；每个窗口最长 5 秒，必须有原因。窗口外及末帧恢复检查，报告保存声明。用于事先设计的转换过程，禁止自动修复通过补豁免规避错误。
- `ready()`：等待当前场景的字体/公式并渲染。

## 验证协议与重试

沿用 A 的状态协议，并新增必需的 `layout-temporal` 检查及 `sampling` 记录。后端缺少这些数据时不能定稿。报告包含：

- `sampling`：实际播放模式、目标间隔、采样次数、最大间隙。
- `layoutIssues`：最多 3 条结构化问题；屏幕边界为 NDC（左右上下通常在 -1 到 1 内），不是 CSS 像素。
- `overlapDeclarations`：最多 30 条过渡声明记录。
- `codeVersion`：原代码的 SHA256；保留 A 的 nonce/过期结果校验。

布局失败以 `[layout]` 标记；首次失败后最多自动修复两轮，即最多 3 次相关送检。可用服务端环境变量 `LAYOUT_MAX_RETRIES` 配置 0–12，缺失或无效值默认为 2。预算在回传结果处计数，避免 LangGraph 重放 commit 时重复累计。

手动重试通过现有修改接口开启新一轮，按最近已保存内容及失败反馈重新修复。它不承诺恢复尚未落盘的全部失败草稿；草稿/通过版本的完整保存属于批次 C。

舞台支持展开失败详情和预览未验证草稿，明确显示“不会保存为通过版本”。通过文案为“布局采样检查通过”。

## 已执行的验收

| 检查 | 结果 |
|---|---|
| `npm run test:verification` | 12/12；包含持续遮挡、短暂冲突、采样断点策略 |
| `python -m pytest backend/tests -q` | 44/44；包含缺少时间覆盖、异常采样、默认两轮预算和诊断协议 |
| `python backend/manage.py check` | 无问题 |
| 真实 manim-web 的 B 样例 | 32/32，见 `tools/layout-fixtures.html` |
| A 的真实场景回归 | 13/13，见 `tools/verification-fixtures.html` |
| React StrictMode UI | 正常通过、替换取消、主动取消、关闭检查未完成；失败详情及未验证预览标记正确 |
| 生产构建 | `npm run build`；保留既有大包警告 |

复验方式：在项目目录运行 `npm run dev -- --host 127.0.0.1 --port 5183`，打开以上 tools 页面及 `tools/verification-ui.html` 点击运行。它们是开发用例页，不在生产构建入口中。

本次后端验证使用外部本地测试依赖目录：

```powershell
$env:PYTHONPATH='D:\math\interactive-teaching-agent-review\python-deps'
python -m pytest backend/tests -q
python backend/manage.py check
```

未调用真实语言/视觉模型；UI 验证未执行截图、PNG 读取或录制导出。纹理 alpha 测量是应用内的几何检测逻辑，不依赖截图模型。

## 边界与后续

1. 采样不是连续碰撞证明，不能保证抓到任意短瞬间。200ms、12% 面积比例、320ms 间隙等为当前人工样例校准的启发式阈值。
2. 可见内容的投影矩形仍可能包含字间空白或旋转后的空角；复杂图形遮挡不做逐像素语义判断。普通曲线/细线不作为严重矩形冲突；不是所有曲线与文字交叉都能发现。
3. 自定义/跨源不可读纹理、特殊 UV、极大纹理等缺少可靠测量时返回未完成；3D 仍不完整验证。
4. 公共布局工具的字号保护仅约束使用工具的内容；不会替任意旧脚本做排版重写。参数示例通过不代表穷举所有参数组合。
5. “保留核心公式与参数”由生成提示词约束；几何检测不能证明数学语义未被模型改动。尚未进行真实模型成功率对照评测。
6. 视觉模型沿用原有可选配置，未增加默认调用；没有将视觉结果当作几何检测替代，也没有为视觉辅助实现独立的新预算。
7. 同步死循环隔离、后台任务真正停止、版本持久化、响应式 UI 和录制尺寸复验分别继续按 C/D/E/F 计划处理。

部署必须前后端一起更新、重启后端并刷新前端；旧 A 客户端报告缺少过程数据会返回未完成。旧目录及远程箭头分支未修改。本批次使用独立本地提交，可用 Git revert 回退；未推送远程。
