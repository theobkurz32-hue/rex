export const SURVIVAL = {maxLife:100,maxCondition:100,maxAdrenaline:100,runDrain:20,walkRecovery:12,restRecovery:22,adrenalineRise:24,adrenalineFall:10,adrenalineRunBonus:.12,attackDamage:14,attackInterval:1.35};
export class Vitals {
  life=100;condition=100;adrenaline=0;exhausted=false;damageAge=10;elapsed=0;
  get dead(){return this.life<=0;}
  get canRun(){return !this.exhausted&&!this.dead;}
  get runBonus(){return 1+this.adrenaline/SURVIVAL.maxAdrenaline*SURVIVAL.adrenalineRunBonus;}
  step(dt:number,running:boolean,moving:boolean,danger:boolean){
    if(this.dead)return;this.elapsed+=dt;this.damageAge+=dt;
    this.condition=Math.max(0,Math.min(SURVIVAL.maxCondition,this.condition+(running&&moving?-SURVIVAL.runDrain:moving?SURVIVAL.walkRecovery:SURVIVAL.restRecovery)*dt));
    if(this.condition===0)this.exhausted=true;else if(this.condition>=15)this.exhausted=false;
    this.adrenaline=Math.max(0,Math.min(SURVIVAL.maxAdrenaline,this.adrenaline+(danger?SURVIVAL.adrenalineRise:-SURVIVAL.adrenalineFall)*dt));
  }
  damage(amount=SURVIVAL.attackDamage){if(this.dead)return;this.life=Math.max(0,this.life-amount);this.damageAge=0;}
  reset(){this.life=SURVIVAL.maxLife;this.condition=SURVIVAL.maxCondition;this.adrenaline=0;this.exhausted=false;this.damageAge=10;this.elapsed=0;}
}
