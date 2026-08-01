const { Arrow, DOWN, Dot, NumberPlane, ORIGIN, RIGHT, Scene, Text, YELLOW, scene, params } = ctx;
const dot = new Dot({ point: ORIGIN, radius: 0.12, color: YELLOW });
  const arrow = new Arrow({ start: ORIGIN, end: [2, 2, 0] });
  const numberplane = new NumberPlane();
  const originText = new Text({ text: '(0, 0)' }).nextTo(dot, DOWN);
  const tipText = new Text({ text: '(2, 2)' }).nextTo(arrow.getEnd(), RIGHT);
  scene.add(numberplane, dot, arrow, originText, tipText);