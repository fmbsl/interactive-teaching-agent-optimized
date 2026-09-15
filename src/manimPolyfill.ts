// manim-web 运行时 polyfill:补 manim CE 常用但 manim-web 缺的方法。
// 只在原型上挂缺失方法,不改 node_modules 文件。
import * as manimWeb from "manim-web";

const anyMW = manimWeb as any;

// Text bakes fill alpha into its canvas; MathTexImage uses material opacity.
// Upstream only marks transform dirty, leaving an already drawn Text texture stale.
for (const name of ['Text', 'MathTexImage']) {
  const proto = anyMW[name]?.prototype;
  if (proto && !Object.prototype.hasOwnProperty.call(proto, '__teachingFillOpacity')) {
    const original = proto.setFillOpacity;
    Object.defineProperty(proto, '__teachingFillOpacity', {value:true});
    proto.setFillOpacity = function (value: number) {
      original.call(this,value);
      if (name === 'Text') this._canvasDirty = true;
      else this.opacity = value;
      return this;
    };
  }
}

// Line.putStartAndEndOn(start, end):manim CE 常用(更新线段端点),manim-web Line 没有此方法
// 但有 setStart/setEnd,组合实现。DashedLine 同理(若有 setStart/setEnd)。
for (const cls of ["Line", "DashedLine", "Arrow", "DoubleArrow"]) {
  const Ctor = anyMW[cls];
  if (Ctor && Ctor.prototype && !Ctor.prototype.putStartAndEndOn) {
    if (typeof Ctor.prototype.setStart === "function" && typeof Ctor.prototype.setEnd === "function") {
      Ctor.prototype.putStartAndEndOn = function (start: any, end: any) {
        this.setStart(start);
        this.setEnd(end);
        return this;
      };
    }
  }
}
