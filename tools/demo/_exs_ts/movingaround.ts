const { scene, BLUE, LEFT, ORANGE, Scene, Square } = ctx;
const square = new Square({ color: BLUE, fillOpacity: 1 });
  await scene.play(square.animate.shift(LEFT));
  await scene.play(square.animate.setFill(ORANGE));
  await scene.play(square.animate.scale(0.3));
  await scene.play(square.animate.rotate(0.4));