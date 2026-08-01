const { Scene, Square, applyMatrix, BLUE, scene, params } = ctx;
const square = new Square({ sideLength: 2, color: BLUE, fillOpacity: 0.5 });
  scene.add(square);
  await scene.wait(1);

  // Animate the shear transformation
  await scene.play(
    applyMatrix(
      square,
      [
        [1, 0.5, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
      { duration: 2 },
    ),
  );

  await scene.wait(2);