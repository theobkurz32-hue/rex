export type QualityMode='auto'|'low'|'medium'|'high';
export class Quality {
  mode:QualityMode='auto';tier:'low'|'medium'|'high';private desiredRatio=1;private time=0;private frames=0;private width=1;private height=1;fps=0;
  constructor(public mobile=false,public dpr=1){this.tier=mobile?'low':'medium';this.reset();}
  get lightQuality(){return this.mobile||this.tier==='low'?.75:this.tier==='high'?1.5:1;}
  get shadows(){return !this.mobile&&this.tier==='high';}
  get reducedGeometry(){return this.mobile||this.tier!=='high';}
  get pixelBudget(){return this.mobile?700000:3000000;}
  get ratio(){const dpr=Number.isFinite(this.dpr)&&this.dpr>0?this.dpr:1;return Math.min(this.desiredRatio,dpr,Math.sqrt(this.pixelBudget/(this.width*this.height)));}
  get target(){return this.mobile?30:60;}
  setViewport(width:number,height:number){const old=this.ratio;this.width=Number.isFinite(width)&&width>0?width:1;this.height=Number.isFinite(height)&&height>0?height:1;return Math.abs(old-this.ratio)>.001;}
  reset(){this.tier=this.mode==='auto'?(this.mobile?'low':'medium'):this.mode;this.desiredRatio=this.mobile?(this.mode==='high'?1:this.mode==='low'?.7:.8):this.tier==='high'?1.5:this.tier==='low'?.85:1.1;this.time=0;this.frames=0;}
  set(mode:QualityMode){this.mode=['auto','low','medium','high'].includes(mode)?mode:'auto';this.reset();}
  sample(dt:number,active:boolean){if(!active){this.time=0;this.frames=0;return false;}if(!Number.isFinite(dt)||dt<=0)return false;this.time+=dt;this.frames++;if(this.time<2.5)return false;
    this.fps=this.frames/this.time;this.time=0;this.frames=0;const old=this.ratio;
    if(this.mode==='auto'){if(this.fps<this.target*.78)this.desiredRatio=Math.max(this.mobile?.6:.7,this.desiredRatio-.1);else if(this.fps>this.target*1.12)this.desiredRatio=Math.min(this.mobile?1:1.3,this.desiredRatio+.05);}
    return Math.abs(this.ratio-old)>.001;
  }
}
