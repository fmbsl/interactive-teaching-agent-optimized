const { Scene, MathTex, Transform, BLACK, WHITE, scene, params } = ctx;
const duration = 2.5;
  const fontSize = 120;
  const spacing = 1.5;

  const pairs: Array<{ start: MathTex; target: MathTex }> = [];
  for (let n = 0; n <= 8; n++) {
    const start = new MathTex({
      latex: String(n),
      color: WHITE,
      fillOpacity: 1,
      fontSize,
    });
    const target = new MathTex({
      latex: String(n + 1),
      color: WHITE,
      fillOpacity: 1,
      fontSize,
    });
    pairs.push({ start, target });
  }

  await Promise.all(
    pairs.flatMap(({ start, target }) => [start.waitForRender(), target.waitForRender()]),
  );

  const cols = 3;
  const xStart = -spacing;
  const yStart = spacing;

  pairs.forEach(({ start, target }, i) => {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const pos: [number, number, number] = [xStart + col * spacing, yStart - row * spacing, 0];
    start.moveTo(pos);
    target.moveTo(pos);
    scene.add(start);
  });

  for (const { start, target } of pairs) {
    await scene.play(new Transform(start, target, { duration }));
  }