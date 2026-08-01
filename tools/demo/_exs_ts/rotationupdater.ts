const { scene, LEFT, Line, ORIGIN, Scene, WHITE, YELLOW } = ctx;
const updaterForth = (mobj, dt) => {
    mobj.rotateAboutOrigin(dt);
  };
  const updaterBack = (mobj, dt) => {
    mobj.rotateAboutOrigin((-dt));
  };
  const lineReference = new Line({ start: ORIGIN, end: LEFT }).setColor(WHITE);
  const lineMoving = new Line({ start: ORIGIN, end: LEFT }).setColor(YELLOW);
  lineMoving.addUpdater(updaterForth);
  scene.add(lineReference, lineMoving);
  await scene.wait(2);
  lineMoving.removeUpdater(updaterForth);
  lineMoving.addUpdater(updaterBack);
  await scene.wait(2);
  lineMoving.removeUpdater(updaterBack);
  await scene.wait(0.5);