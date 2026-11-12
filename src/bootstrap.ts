// A small independent entry can report WebGL/module failures instead of a blank page.
void import('./main').catch(error=>{
  const app=document.querySelector<HTMLElement>('#app')!;app.replaceChildren();
  const panel=document.createElement('section');panel.style.cssText='max-width:520px;margin:12vh auto;padding:28px;font:16px/1.6 system-ui;color:#eee7db;background:#172b32;border-radius:12px';
  const title=document.createElement('h1');title.textContent='Não foi possível iniciar o Hotel Rex';
  const detail=document.createElement('p');detail.textContent=/webgl|context/i.test(String(error))?'O Safari não conseguiu iniciar a visualização 3D. Feche outras abas, reabra esta página e confira se o sistema está atualizado. O jogo precisa de WebGL 2.':'O carregamento da aplicação foi interrompido. Confira a conexão e tente novamente.';
  const retry=document.createElement('button');retry.textContent='Tentar novamente';retry.onclick=()=>location.reload();retry.style.cssText='padding:12px 18px;cursor:pointer';
  panel.append(title,detail,retry);app.append(panel);console.error('Inicialização do Hotel Rex:',error);
});
