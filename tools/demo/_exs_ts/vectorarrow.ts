const { scene, Arrow, DOWN, Dot, NumberPlane, ORIGIN, RIGHT, Scene, Text } = ctx;
const dot = new Dot({ point: ORIGIN });
  const arrow = new Arrow({ start: ORIGIN, end: [2, 2, 0], buff: 0 });
  const numberplane = new NumberPlane();
  const originText = new Text({ text: "(0, 0)" }).nextTo(dot, DOWN);
  const tipText = new Text({ text: "(2, 2)" }).nextTo(arrow.getEnd(), RIGHT);
  scene.add(numberplane, dot, arrow, originText, tipText);