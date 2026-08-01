// 直接用 manim-web TS 写 AlexNet,测试 Arrow3D 连线能否显示
import * as MW from "https://cdn.jsdelivr.net/npm/manim-web@0.3.24/dist/manim-web.browser.js";

const container = document.getElementById('c')!;
const s = new MW.ThreeDScene(container, { backgroundColor: '#0a0c14', width: 900, height: 650 });
s.setCameraOrientation(70 * Math.PI / 180, -60 * Math.PI / 180, 18);

const layers = [
  ["Conv1", 1.6, MW.BLUE_C], ["MaxPool1", 1.2, MW.BLUE_D],
  ["Conv2", 1.6, MW.BLUE_C], ["MaxPool2", 1.2, MW.BLUE_D],
  ["Conv3", 1.0, MW.BLUE_E], ["Conv4", 1.0, MW.BLUE_E], ["Conv5", 1.0, MW.BLUE_E],
  ["MaxPool5", 0.7, MW.BLUE_D], ["FC6", 0.5, MW.BLUE_B], ["FC7", 0.5, MW.BLUE_B], ["FC8", 0.5, MW.BLUE],
];
const boxes = new MW.VGroup();
let y = 6.0;
for (const [name, size, color] of layers) {
  const box = new MW.Cube({ sideLength: size as number, fillOpacity: 0.4, fillColor: color as any, strokeColor: color as any });
  box.shift(MW.scaleVec(y, MW.UP));
  boxes.add(box);
  y = y - (size as number) - 0.3;
}
s.add(boxes);

// 尝试 Arrow3D 连接相邻 box
for (let i = 0; i < boxes.length - 1; i++) {
  const start = boxes.get(i).getCenter();
  const end = boxes.get(i + 1).getCenter();
  // 方式1: Arrow3D
  const arrow = new MW.Arrow3D({ start, end, color: MW.BLUE_B, thickness: 0.05 });
  s.add(arrow);
}
await s.wait(1);

// 方式2: 也加一条 Line3D 对比
const lineTest = new MW.Line3D({ start: [-3, -3, 0], end: [3, 3, 0], color: MW.YELLOW, thickness: 0.05 });
s.add(lineTest);

await s.wait(2);
