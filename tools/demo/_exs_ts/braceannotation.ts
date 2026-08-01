const { scene, Brace, Dot, Line, ORANGE, Scene } = ctx;
const dot = new Dot({ point: [-2, -1, 0] });
  const dot2 = new Dot({ point: [2, 1, 0] });
  const line = new Line({ start: dot.getCenter(), end: dot2.getCenter() }).setColor(ORANGE);
  const b1 = new Brace({ mobject: line });
  const b1text = b1.getText("Horizontal distance");
  const b2 = new Brace({ mobject: line, direction: line.copy().rotate(Math.PI / 2).getUnitVector() });
  const b2text = b2.getTex("x-x_1");
  scene.add(line, dot, dot2, b1, b2, b1text, b2text);