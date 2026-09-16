/** Completion requires a fresh accepted animation for this run and step. */
export class AnimationAcceptance {
  private versions = new Map<string, number>();
  clear() { this.versions.clear(); }
  version(run: number, step: string | number) { return this.versions.get(`${run}:${step}`) || 0; }
  observe(run: number, event: {kind:string;stepId?:string|number|null;sceneCode?:string}) {
    if(event.kind !== 'explain' || !event.sceneCode || event.stepId == null)return;
    this.versions.set(`${run}:${event.stepId}`,this.version(run,event.stepId)+1);
  }
  completed(run:number,step:string|number,before:number,error:string) {
    return !error && this.version(run,step)>before;
  }
}
