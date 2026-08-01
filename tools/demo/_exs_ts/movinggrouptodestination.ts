const { scene, Dot, LEFT, ORIGIN, RED, RIGHT, Scene, VGroup, YELLOW, scaleVec } = ctx;
const group = new VGroup(new Dot({ point: LEFT }), new Dot({ point: ORIGIN }), new Dot({ point: RIGHT, color: RED }), new Dot({ point: scaleVec(2, RIGHT) })).scale(1.4);
  const dest = new Dot({ point: [4, 3, 0], color: YELLOW });
  scene.add(group, dest);
  await scene.play(group.animate.shift(dest.getCenter() - group[2].getCenter()));
  await scene.wait(0.5);