const { Angle, Line3D, ThreeDAxes, ThreeDScene, WHITE, YELLOW, GREEN, scene, params } = ctx;
const axes = new ThreeDAxes({
    xRange: [-4, 4, 1],
    yRange: [-4, 4, 1],
    zRange: [-3, 3, 1],
    axisColor: '#ffffff',
    tipLength: 0.3,
    tipRadius: 0.12,
    shaftRadius: 0.008,
  });

  const origin: [number, number, number] = [0, 0, 0];
  const p1: [number, number, number] = [2, 0, 0];
  const p2: [number, number, number] = [0, 1.5, 2];

  const line1 = new Line3D({ start: origin, end: p1, color: YELLOW });
  const line2 = new Line3D({ start: origin, end: p2, color: GREEN });

  const angle = new Angle({ points: [p1, origin, p2] }, { radius: 0.8, color: WHITE });

  scene.add(axes, line1, line2, angle);
  await scene.wait(Infinity);