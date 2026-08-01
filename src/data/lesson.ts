// 教学脚本 schema —— 主 agent 的产出,驱动三栏。
// MVP 阶段硬编码为"梯度下降";后端接通后由 LLM 生成同结构 JSON。

export interface LessonParam {
  name: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
}

export interface LessonStep {
  id: number;
  title: string;
  intent: string;          // 动画意图,Animator 据此生成 manim-web 代码
  formula: string;         // KaTeX 公式(兼容旧;新流程从 explanation 提取)
  narration: string;       // 右栏讲解(兼容旧;新流程用 explanation)
  explanation?: string;    // 讲解正文 Markdown(文字+$...$/$$...$$公式),新流程主用
  paramsUsed: string[];    // 该步绑定的参数名
}

export interface Lesson {
  title: string;
  summary: string;
  params: LessonParam[];
  steps: LessonStep[];
}

export const gradientDescentLesson: Lesson = {
  title: "梯度下降",
  summary: "沿损失函数的负梯度方向迭代更新参数,寻找最小值。学习率 η 控制步长。",
  params: [
    { name: "lr", label: "学习率 η", min: 0.02, max: 1.2, step: 0.02, default: 0.1 },
    { name: "start", label: "起点 x₀", min: -3, max: 3, step: 0.1, default: -2.5 },
  ],
  steps: [
    {
      id: 1,
      title: "直观:沿山坡下山",
      intent: "3D 损失曲面 + 小球从起点滚向最低点,η 控制每步跨度",
      formula: "w_{t+1} = w_t - \eta\,\nabla L(w_t)",
      narration:
        "想象你站在山坡上,蒙着眼,目标是谷底。你能感受到脚下哪边最陡,于是朝最陡的下坡方向迈一步。梯度下降做的就是这件事——只不过是在高维空间里。",
      paramsUsed: ["lr", "start"],
    },
    {
      id: 2,
      title: "损失函数与梯度",
      intent: "展示 1D 抛物线 L(w)=(w-1)²/2,标出当前点的切线斜率即梯度",
      formula: "L(w) = \tfrac{1}{2}(w - 1)^2 \quad\Rightarrow\quad \nabla L(w) = w - 1",
      narration:
        "我们用最简单的二次损失 L(w)=½(w−1)²。它的梯度就是 w−1。当前点离最小值越远,梯度越大,该迈的步也越大——这正是梯度下降的自适应之处。",
      paramsUsed: ["start"],
    },
    {
      id: 3,
      title: "更新法则",
      intent: "数轴上 w 一步步跳向最小值,每步长度=η×|梯度|,旁边数字同步变化",
      formula: "w_{t+1} = w_t - \eta\,(w_t - 1)",
      narration:
        "把梯度代入更新法则:w 每次减去 η 乘以 (w−1)。η 大则步大、收敛快但易过头;η 小则稳但慢。拖动学习率滑块,亲手感受这个权衡。",
      paramsUsed: ["lr", "start"],
    },
    {
      id: 4,
      title: "学习率的影响",
      intent: "并排对比 η=0.1(稳)与 η=0.9(震荡)两条轨迹",
      formula: "\eta \text{ 过大} \Rightarrow w_{t+1} \text{ 跳过最小值,来回震荡}",
      narration:
        "η 太大时,下一步会直接跨过谷底跳到对面山坡,然后又跳回来——这就是震荡。极端情况甚至发散。这是梯度下降最常被误解的点:大不等于快。",
      paramsUsed: ["lr"],
    },
    {
      id: 5,
      title: "收敛轨迹",
      intent: "在损失曲面上画完整轨迹,随 η 变化实时重绘路径长短与震荡",
      formula: "\lim_{t\to\infty} w_t = \arg\min_w L(w)",
      narration:
        "随着迭代,w 逐步逼近最小值点 w=1。好的 η 让轨迹又短又稳;坏的 η 让轨迹弯绕、甚至不收敛。这条轨迹本身就是诊断学习率好坏的 X 光片。",
      paramsUsed: ["lr", "start"],
    },
    {
      id: 6,
      title: "多维推广",
      intent: "2D 等高线 + 箭头指向负梯度方向,小球沿等高线下滑",
      formula: "\nabla L(\mathbf{w}) = \mathbf{w} - \mathbf{w}^*",
      narration:
        "现实中参数是高维向量。梯度变成向量,更新法则形式不变——只是每一步都是沿着损失曲面上最陡的方向走。3b1b 讲线性变换时,你看的就是这种等高线。",
      paramsUsed: ["lr"],
    },
    {
      id: 7,
      title: "小结与陷阱",
      intent: "三张缩略图并列:正常收敛 / 震荡 / 发散,点击可回放对应参数",
      formula: "\text{好 } \eta: \text{快而稳} \quad \text{坏 } \eta: \text{震荡或发散}",
      narration:
        "记住三个陷阱:η 太小慢得让人睡着;η 太大震荡甚至发散;局部最小值会困住非凸损失。下一节我们会看到动量法怎么缓解后两个问题。",
      paramsUsed: ["lr"],
    },
  ],
};

// 空 lesson:无会话/新会话时的初始占位,不显示任何知识点
export const emptyLesson: Lesson = {
  title: "",
  summary: "",
  params: [],
  steps: [],
};
