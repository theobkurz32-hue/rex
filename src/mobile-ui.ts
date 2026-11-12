export interface MobileUIOptions { pause:()=>void; }

/** Compact tools and mutually exclusive sheets; the scene never needs rotation. */
export function initMobileUI({pause}:MobileUIOptions){
  const compact=matchMedia('(max-width:760px), (pointer:coarse)');
  const panels=['levels','properties','settings'].map(id=>document.getElementById(id)!).filter(Boolean);
  const viewport=document.getElementById('viewport')!,main=document.querySelector('main')!;
  const controls=new Map([['levels','toggle-levels'],['properties','toggle-props'],['settings','settings-button']]);
  const open=(panel:HTMLElement)=>!panel.hidden&&!panel.classList.contains('collapsed');
  const close=(panel:HTMLElement)=>{if(panel.id==='settings'){if(!panel.hidden)panel.hidden=true;}else if(!panel.classList.contains('collapsed'))panel.classList.add('collapsed');};
  const closeAll=()=>{panels.forEach(close);};
  let previous=new Set<HTMLElement>(),handling=false;
  const scrim=document.createElement('button');scrim.id='sheet-scrim';scrim.className='sheet-scrim';scrim.type='button';scrim.hidden=true;scrim.setAttribute('aria-label','Fechar painel');scrim.onclick=closeAll;main.append(scrim);

  for(const panel of panels){
    const heading=panel.querySelector<HTMLElement>('.panel-heading');
    if(panel.id!=='settings'&&heading){
      const button=document.createElement('button');button.type='button';button.className='sheet-close';button.textContent='×';button.setAttribute('aria-label',`Fechar ${panel.id==='levels'?'pavimentos':'detalhes'}`);button.onclick=()=>close(panel);heading.append(button);
    }
    const toggle=document.getElementById(controls.get(panel.id)!);
    toggle?.setAttribute('aria-controls',panel.id);toggle?.setAttribute('aria-label',panel.id==='levels'?'Pavimentos':panel.id==='properties'?'Detalhes do modelo':'Ajustes');
    // Inputs and sheet scrolling must not reach scene gesture handlers.
    for(const type of ['pointerdown','pointermove','pointerup','touchstart','touchmove'])panel.addEventListener(type,event=>event.stopPropagation(),{passive:true});
  }
  const closeSettings=document.getElementById('close-settings');closeSettings?.setAttribute('aria-label','Fechar ajustes');

  let arrangeSettings=()=>{};
  const settingsBody=document.querySelector<HTMLElement>('#settings .panel-body');
  if(settingsBody){
    const originalOrder=[...settingsBody.children] as HTMLElement[];
    const sectionFor=(id:string)=>{let node=document.getElementById(id);while(node&&node.parentElement!==settingsBody)node=node.parentElement;return node;};
    const preferences=['quality','input-mode','sensitivity','fov','motion','invert-y'].map(sectionFor).filter((node):node is HTMLElement=>!!node);
    const advancedNodes=[...new Set(['grid','transparent','edges','cut','cut-height','debug','stats','char-height'].map(sectionFor).filter((node):node is HTMLElement=>!!node))];
    const guide=originalOrder.find(node=>node.tagName==='DETAILS'&&node.querySelector('summary')?.textContent?.includes('Guia'));
    const advanced=document.createElement('details');advanced.className='mobile-advanced';advanced.id='mobile-advanced';
    const advancedTitle=document.createElement('summary');advancedTitle.textContent='Ferramentas avançadas';advanced.append(advancedTitle);
    const edges=document.getElementById('edges') as HTMLInputElement|null,edgesDisabled=edges?.disabled??false;
    const edgeNote=edges?.closest('label')?.querySelector('small'),edgeText=edgeNote?.textContent??'';
    const sensitivity=document.getElementById('sensitivity')?.closest('label')?.firstChild,sensitivityText=sensitivity?.textContent??'';
    const tools=document.createElement('details');tools.className='mobile-tools';tools.id='mobile-tools';
    const title=document.createElement('summary');title.textContent='Modos e ferramentas do modelo';tools.append(title);
    const modes=document.createElement('div');modes.className='mobile-tool-grid';
    const actions=document.createElement('div');actions.className='mobile-tool-grid';
    const copyButton=(original:HTMLButtonElement,label:string,container:HTMLElement)=>{
      const copy=document.createElement('button');copy.type='button';copy.textContent=label;copy.classList.toggle('active',original.classList.contains('active'));copy.setAttribute('aria-pressed',String(original.classList.contains('active')));
      copy.onclick=()=>{closeAll();original.click();};container.append(copy);
      new MutationObserver(()=>{const active=original.classList.contains('active');copy.classList.toggle('active',active);copy.setAttribute('aria-pressed',String(active));}).observe(original,{attributes:true,attributeFilter:['class']});
    };
    for(const [mode,label] of [['orbit','Vista externa'],['walk','Caminhar'],['fly','Voar']]){
      const original=document.querySelector<HTMLButtonElement>(`#modes [data-mode="${mode}"]`);if(original)copyButton(original,label,modes);
    }
    for(const [id,label] of [['fit','Enquadrar hotel'],['focus','Ver seleção'],['measure','Medir superfícies'],['restore','Restaurar modelo']]){
      const original=document.getElementById(id) as HTMLButtonElement|null;if(original)copyButton(original,label,actions);
    }
    tools.append(modes,actions);settingsBody.prepend(tools);
    arrangeSettings=()=>{
      if(compact.matches){
        const chosen=new Set<HTMLElement>([...preferences,...advancedNodes,tools,advanced,...(guide?[guide]:[])]);
        const remaining=[...settingsBody.children].filter(node=>!chosen.has(node as HTMLElement));
        advanced.append(...advancedNodes);
        settingsBody.replaceChildren(...preferences,...(guide?[guide]:[]),tools,advanced,...remaining);
        if(edges)edges.disabled=true;if(edgeNote)edgeNote.textContent='Disponível no computador';
        if(sensitivity?.nodeType===Node.TEXT_NODE)sensitivity.textContent='Sensibilidade do olhar';
      }else{
        const remaining=[...settingsBody.children].filter(node=>!originalOrder.includes(node as HTMLElement)&&node!==tools&&node!==advanced);
        settingsBody.replaceChildren(tools,...originalOrder,...remaining);
        if(edges)edges.disabled=edgesDisabled;if(edgeNote)edgeNote.textContent=edgeText;
        if(sensitivity?.nodeType===Node.TEXT_NODE)sensitivity.textContent=sensitivityText;
      }
    };
    arrangeSettings();
  }

  const sync=()=>{
    if(handling)return;handling=true;
    const visible=panels.filter(open);
    if(compact.matches){
      const added=visible.filter(panel=>!previous.has(panel));
      const chosen=added[added.length-1]??visible[visible.length-1];
      if(chosen){for(const panel of panels)if(panel!==chosen)close(panel);if(added.length)pause();}
      document.body.classList.toggle('sheet-open',!!chosen);scrim.hidden=!chosen;
      previous=new Set(chosen?[chosen]:[]);
    }else{document.body.classList.remove('sheet-open');scrim.hidden=true;previous=new Set(visible);}
    for(const panel of panels){const expanded=open(panel);document.getElementById(controls.get(panel.id)!)?.setAttribute('aria-expanded',String(expanded));panel.setAttribute('aria-label',panel.id==='levels'?'Pavimentos':panel.id==='properties'?'Detalhes BIM':'Ajustes da visita');}
    handling=false;
  };
  const observer=new MutationObserver(sync);for(const panel of panels)observer.observe(panel,{attributes:true,attributeFilter:['class','hidden']});
  const entry=document.getElementById('entry');
  if(entry){const syncPause=()=>viewport.classList.toggle('paused',!entry.hidden);new MutationObserver(syncPause).observe(entry,{attributes:true,attributeFilter:['hidden']});syncPause();}
  const updateHeight=()=>{if(compact.matches){const height=Math.max(1,Math.round(Math.min(innerHeight,window.visualViewport?.height??innerHeight)));document.documentElement.style.setProperty('--app-height',`${height}px`);}else document.documentElement.style.removeProperty('--app-height');};
  let resizeFrame=0,settleTimer=0;
  const settleHeight=()=>{updateHeight();cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(updateHeight);clearTimeout(settleTimer);settleTimer=window.setTimeout(updateHeight,180);};
  const onLayout=()=>{if(compact.matches){closeAll();pause();}arrangeSettings();updateHeight();sync();};
  if(typeof compact.addEventListener==='function')compact.addEventListener('change',onLayout);else compact.addListener(onLayout);
  window.visualViewport?.addEventListener('resize',settleHeight);window.addEventListener('resize',settleHeight);window.addEventListener('orientationchange',settleHeight);
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&compact.matches)closeAll();});
  if(compact.matches)closeAll();updateHeight();sync();
  return {closePanels:closeAll};
}
