// Ponte mínima entre as páginas do TuneGrab e o programa (Electron).
// As páginas não têm acesso a nada do computador por aqui: só pedem coisas da janela.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('tunegrabDesktop', {
  /** traz a janela do TuneGrab de volta */
  show: () => ipcRenderer.send('tunegrab:show'),
  // ---- app: o som fica sempre aqui; a janelinha só mostra a imagem acompanhando ----
  /** app minimizado com vídeo tocando: abre a janelinha (ou troca o vídeo dela) */
  float: info => ipcRenderer.send('tunegrab:float', info),
  /** onde o player está (segundo, tocando, volume): a janelinha acompanha */
  floatState: st => ipcRenderer.send('tunegrab:float-state', st),
  /** fecha a janelinha (a próxima música não é vídeo) */
  closeFloat: () => ipcRenderer.send('tunegrab:float-close'),
  /** botões da janelinha chegando ao player do app */
  onCmd: cb => ipcRenderer.on('tunegrab:cmd', (_e, cmd) => cb(cmd)),
  // ---- janela flutuante (mini.html) ----
  /** estado do player do app */
  onState: cb => ipcRenderer.on('tunegrab:state', (_e, st) => cb(st)),
  /** botão da janelinha (tocar/pausar, pular, volume…) → player do app */
  miniCmd: cmd => ipcRenderer.send('tunegrab:mini-cmd', cmd),
  /** "voltar ao app" */
  miniBack: () => ipcRenderer.send('tunegrab:mini-back'),
  /** fechou a janelinha (o app pausa) */
  miniClose: () => ipcRenderer.send('tunegrab:mini-close'),
})
