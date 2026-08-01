const { BLUE, Camera2D, Circle, Create, RED, Scene, SplitScreenCamera, Square, YELLOW, scene, params } = ctx;
// Two independent Camera2D instances framing the same scene at
  // different zoom levels. With `aspectMode: 'contain'` the per-camera
  // frameWidth/frameHeight is honoured at render time (the viewport
  // letterboxes if it doesn't match), so the zoom intent — wide
  // overview on the left, tight zoom on the right — actually shows up
  // on screen.
  const leftCamera = new Camera2D({
    frameWidth: 14,
    frameHeight: 8,
    position: [-3, 0, 10],
    aspectMode: 'contain',
  });
  const rightCamera = new Camera2D({
    frameWidth: 4,
    frameHeight: 4,
    position: [3, 0, 10],
    aspectMode: 'contain',
  });

  const split = new SplitScreenCamera({
    leftCamera,
    rightCamera,
    split: 'horizontal',
    splitRatio: 0.5,
  });
  const mc = split.getMultiCamera();
  // Draw a thin border around each pane so the split is visible even
  // when one side renders the scene background edge-to-edge.
  mc.setViewportBorder(0, { borderColor: '#888888', borderWidth: 2 });
  mc.setViewportBorder(1, { borderColor: '#888888', borderWidth: 2 });
  scene.useMultiCamera(mc);

  const circle = new Circle({ radius: 1, color: RED, strokeWidth: 4 });
  circle.shift([-3, 0, 0]);
  const square = new Square({ sideLength: 1.5, color: BLUE, strokeWidth: 4 });
  square.shift([3, 0, 0]);
  const marker = new Circle({ radius: 0.15, color: YELLOW, strokeWidth: 3 });

  scene.add(marker);
  await scene.play(new Create(circle));
  await scene.play(new Create(square));
  await scene.wait(0.8);