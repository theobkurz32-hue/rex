export type QualityMode='auto'|'low'|'medium'|'high';
export class Quality {
  mode:QualityMode='auto';tier:'low'|'medium'|'high';ratio=1;private time=0;private frames=0;private applied=0;fps=0;
  constructor(public mobile=false,public dpr=1){this.tier=mobile?'low':'medium';this.reset();}
  get zombies(){return this.tier==='low'?3:this.tier==='high'?8:5;}
  get lightQuality(){return this.tier==='low'?.75:this.tier==='high'?1.5:1;}
  get shadows(){return this.tier==='high';}
  get target(){return this.mobile?30:60;}
  reset(){this.tier=this.mode==='auto'?(this.mobile?'low':'medium'):this.mode;this.ratio=Math.min(this.dpr,this.tier==='high'?1.5:this.tier==='low'?.85:1.1);this.time=0;this.frames=0;this.applied=0;}
  set(mode:QualityMode){this.mode=mode;this.reset();}
  sample(dt:number,active:boolean){if(!active){this.time=0;this.frames=0;return false;}this.time+=dt;this.frames++;if(this.time<2.5)return false;
    this.fps=this.frames/this.time;this.time=0;this.frames=0;const old=this.ratio;
    if(this.mode==='auto'){if(this.fps<this.target*.78)this.ratio=Math.max(.7,this.ratio-.1);else if(this.fps>this.target*1.12)this.ratio=Math.min(this.mobile?1:1.3,this.dpr,this.ratio+.05);}
    return Math.abs(this.ratio-old)>.001;
  }
}
