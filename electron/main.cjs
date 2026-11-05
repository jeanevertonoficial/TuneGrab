// TuneGrab como programa de computador (Electron).
// - Liga o servidor do TuneGrab por dentro (o mesmo do "npm run dev", já compilado) e abre a janela.
// - Fechar a janela NÃO desliga: o app fica perto do relógio (bandeja) e continua baixando.
// - Abre sozinho quando o Windows liga (escondido na bandeja), para estar sempre no ar.
// - O endereço http://localhost:47800 também funciona no Chrome enquanto o app estiver rodando.
const { app, BrowserWindow, Menu, Tray, shell, nativeImage, dialog, ipcMain } = require('electron')
const { spawn, execFile } = require('node:child_process')
const fs = require('node:fs')
const net = require('node:net')
const path = require('node:path')

const PORT_PREFERIDA = 47800 // fixa: assim as preferências salvas no navegador (pré-lista, player) continuam
const ESCONDIDO = process.argv.includes('--hidden') // aberto pelo Windows ao ligar: só a bandeja

// app de música: pode tocar sem clique (próxima faixa com o app minimizado, continuar de onde parou)
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
// o vídeo continua igual com o app minimizado: o Chrome normalmente desliga a imagem do vídeo escondido
// (e religar ao voltar dá um tranco) ou pausa vídeo sem som em segundo plano
app.commandLine.appendSwitch('disable-features', 'BackgroundVideoTrackOptimization,BackgroundVideoPauseOptimization')
app.commandLine.appendSwitch('disable-renderer-backgrounding')

// ---------- uma instância só (abrir de novo só mostra a janela) ----------
if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

const empacotado = app.isPackaged
const recursos = empacotado ? process.resourcesPath : path.join(__dirname, '..')
const caminhos = {
  servidor: empacotado ? path.join(recursos, 'server', 'server', 'index.mjs') : path.join(recursos, '.output', 'server', 'index.mjs'),
  ytdlp: path.join(recursos, 'bin', 'yt-dlp', 'yt-dlp.exe'),
  ffmpeg: empacotado ? path.join(recursos, 'bin', 'ffmpeg.exe') : path.join(recursos, 'node_modules', 'ffmpeg-static', 'ffmpeg.exe'),
  icone: empacotado ? path.join(recursos, 'icon.png') : path.join(recursos, 'public', 'icons', 'icon-512.png'),
  bandeja: empacotado ? path.join(recursos, 'tray.png') : path.join(recursos, 'public', 'icons', 'favicon-32.png'),
}
// dados do usuário (histórico, favoritas, login): %APPDATA%\TuneGrab
const dados = app.getPath('userData')
const logs = path.join(dados, 'logs')
fs.mkdirSync(logs, { recursive: true })

let janela = null
let bandeja = null
let servidor = null
let porta = PORT_PREFERIDA
let saindo = false
let avisouBandeja = false

const url = () => `http://127.0.0.1:${porta}`

function portaLivre(p) {
  return new Promise((resolve) => {
    const s = net.createServer().once('error', () => resolve(false)).once('listening', () => s.close(() => resolve(true)))
    s.listen(p, '127.0.0.1')
  })
}

async function escolherPorta() {
  if (await portaLivre(PORT_PREFERIDA)) return PORT_PREFERIDA
  // ocupada por outro programa: usa uma livre qualquer
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => resolve(port))
    })
  })
}

// ---------- servidor do TuneGrab ----------
let tentativas = 0
function ligarServidor() {
  const log = fs.createWriteStream(path.join(logs, 'servidor.log'), { flags: 'a' })
  log.write(`\n--- ${new Date().toLocaleString('pt-BR')} porta ${porta}\n`)
  servidor = spawn(process.execPath, [caminhos.servidor], {
    cwd: dados,
    windowsHide: true,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1', // o próprio Electron roda o servidor como Node (Node 24)
      NODE_ENV: 'production',
      PORT: String(porta),
      HOST: '127.0.0.1', // só este computador acessa
      NITRO_PORT: String(porta),
      NITRO_HOST: '127.0.0.1',
      TUNEGRAB_DATA: dados,
      YTDLP_PATH: caminhos.ytdlp,
      FFMPEG_PATH: caminhos.ffmpeg,
    },
  })
  servidor.stdout.pipe(log)
  servidor.stderr.pipe(log)
  servidor.on('exit', (code) => {
    servidor = null
    if (saindo) return
    // caiu: liga de novo (até 5 vezes seguidas)
    if (++tentativas <= 5) setTimeout(ligarServidor, 1500)
    else dialog.showErrorBox('TuneGrab', `O servidor do TuneGrab parou (código ${code}). Veja ${path.join(logs, 'servidor.log')}`)
  })
}

async function esperarServidor(ms = 40000) {
  const fim = Date.now() + ms
  while (Date.now() < fim) {
    try {
      const r = await fetch(`${url()}/api/settings`)
      if (r.ok) {
        tentativas = 0
        return true
      }
    }
    catch {}
    await new Promise(r => setTimeout(r, 300))
  }
  return false
}

/** desliga o servidor e tudo que ele abriu (yt-dlp, ffmpeg) */
function desligarServidor() {
  if (!servidor?.pid) return Promise.resolve()
  return new Promise(resolve => execFile('taskkill', ['/PID', String(servidor.pid), '/T', '/F'], { windowsHide: true }, () => resolve()))
}

// ---------- janela ----------
function abrirJanela() {
  if (janela) {
    if (janela.isMinimized()) janela.restore()
    janela.show()
    janela.focus()
    return
  }
  janela = new BrowserWindow({
    width: 1320, height: 860, minWidth: 900, minHeight: 600,
    title: 'TuneGrab', icon: caminhos.icone, backgroundColor: '#000000', show: false, autoHideMenuBar: true,
    // barra de título na cor do app (a padrão do Windows não aceita cor): o app desenha a barra
    // e o Windows só põe os botões minimizar/maximizar/fechar por cima, no canto
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#000000', symbolColor: '#b3b3b3', height: 36 },
    // (sem backgroundThrottling: false aqui — a página precisa saber quando está escondida; tocando som o Chrome já não a freia)
    webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.cjs') },
  })
  janela.loadURL(url())
  janela.once('ready-to-show', () => janela.show())
  // links de fora (YouTube, LRCLIB…) abrem no navegador padrão
  janela.webContents.setWindowOpenHandler(({ url: destino }) => {
    if (!destino.startsWith(url())) void shell.openExternal(destino)
    return { action: 'deny' }
  })
  janela.webContents.on('will-navigate', (e, destino) => {
    if (!destino.startsWith(url())) {
      e.preventDefault()
      void shell.openExternal(destino)
    }
  })
  // vídeo tocando e o app foi minimizado/escondido: a página manda o vídeo para a janela flutuante
  // (tunegrab:float). Voltou para o app (barra de tarefas, Alt+Tab, ícone do relógio): o vídeo volta.
  const aoSair = () => janela?.webContents.executeJavaScript('window.__tunegrabPip?.(true)', true).catch(() => {})
  janela.on('minimize', aoSair)
  janela.on('hide', aoSair)
  janela.on('restore', esconderMini)
  janela.on('show', esconderMini)
  janela.on('focus', esconderMini)

  // fechar = esconder na bandeja (continua baixando); sair de verdade pelo menu da bandeja
  janela.on('close', (e) => {
    if (saindo) return
    e.preventDefault()
    janela.hide()
    if (!avisouBandeja && bandeja) {
      avisouBandeja = true
      bandeja.displayBalloon({ iconType: 'info', title: 'O TuneGrab continua aberto', content: 'Ele fica aqui perto do relógio, terminando os downloads. Para fechar de vez: clique com o botão direito → Sair.' })
    }
  })
  janela.on('closed', () => (janela = null))
}

// ---------- janela flutuante do vídeo (por cima de tudo, com o nome da música) ----------
// O SOM NUNCA SAI DO APP: a janelinha é só a imagem, sem som, acompanhando o vídeo do app.
// Assim minimizar e voltar não troca quem toca: nada para, nada pula, nada repete.
// - Ao minimizar ela aparece na hora com o quadro atual (foto) e o vídeo assume por baixo.
// - Os botões dela (tocar, pular, volume) comandam o player do app.
// - Ao voltar ela só some (o app nunca parou).
// - Fica criada escondida, com o vídeo carregado: da segunda vez em diante é instantânea.
let mini = null
let miniVisivel = false
let miniPronta = null // promessa: página da janelinha carregada
const miniArquivo = path.join(dados, 'state', 'mini-janela.json')
const vivo = () => mini && !mini.isDestroyed()

function lerPosicaoMini() {
  try {
    return JSON.parse(fs.readFileSync(miniArquivo, 'utf8'))
  }
  catch {
    // primeira vez: canto de baixo à direita da tela, no formato 16:9
    const { screen } = require('electron')
    const area = screen.getPrimaryDisplay().workArea
    return { width: 420, height: 236, x: area.x + area.width - 440, y: area.y + area.height - 256 }
  }
}
function salvarPosicaoMini() {
  if (!vivo() || !miniVisivel) return
  try {
    fs.mkdirSync(path.dirname(miniArquivo), { recursive: true })
    fs.writeFileSync(miniArquivo, JSON.stringify(mini.getBounds()))
  }
  catch {}
}

function criarMini() {
  if (vivo()) return
  mini = new BrowserWindow({
    ...lerPosicaoMini(), minWidth: 240, minHeight: 135, frame: false, resizable: true, alwaysOnTop: true,
    skipTaskbar: true, backgroundColor: '#000000', show: false, title: 'TuneGrab', icon: caminhos.icone,
    webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.cjs'), backgroundThrottling: false },
  })
  mini.setAlwaysOnTop(true, 'floating') // por cima até de janelas em tela cheia comuns
  miniPronta = new Promise(resolve => mini.webContents.once('did-finish-load', resolve))
  mini.loadURL(`${url()}/mini.html`)
  mini.on('moved', salvarPosicaoMini)
  mini.on('resized', salvarPosicaoMini)
  mini.on('closed', () => {
    mini = null
    miniVisivel = false
  })
}

/** formato do vídeo (16:9 na maioria; Shorts em pé): sem faixas pretas, sempre dentro da tela */
function ajustarFormato(w, h) {
  if (!vivo() || !w || !h) return
  const ratio = w / h
  const b = mini.getBounds()
  const { screen } = require('electron')
  const area = screen.getDisplayMatching(b).workArea
  let width = b.width
  let height = Math.round(width / ratio)
  const maxH = Math.round(area.height * 0.6) // vídeo em pé numa janela larga ficaria enorme
  if (height > maxH) {
    height = maxH
    width = Math.round(height * ratio)
  }
  const x = Math.min(Math.max(b.x, area.x), area.x + area.width - width)
  const y = Math.min(Math.max(b.y, area.y), area.y + area.height - height)
  mini.setAspectRatio(ratio)
  if (b.width !== width || b.height !== height || b.x !== x || b.y !== y) mini.setBounds({ x, y, width, height })
}

let fade = null
function aparecer() {
  if (miniVisivel) return
  miniVisivel = true
  clearInterval(fade)
  // surge suave (junto com a animação de minimizar do Windows), sem tirar o foco de ninguém
  let o = 0
  mini.setOpacity(0)
  mini.showInactive()
  fade = setInterval(() => {
    o = Math.min(1, o + 0.2)
    if (vivo()) mini.setOpacity(o)
    if (o >= 1) clearInterval(fade)
  }, 16)
}

async function abrirMini(info) {
  criarMini()
  await miniPronta
  if (!vivo()) return
  ajustarFormato(info.w, info.h)
  // a foto do quadro atual já está pronta antes de a janela aparecer: nunca aparece preta
  await mini.webContents.executeJavaScript(`window.__miniShow(${JSON.stringify(info)})`).catch(() => {})
  // o app pode ter voltado enquanto isso: aí não aparece
  if (janela && !janela.isMinimized() && janela.isVisible() && janela.isFocused()) return
  aparecer()
}

/** some (o app nunca parou de tocar: não há nada para devolver) */
function esconderMini() {
  if (!vivo() || !miniVisivel) return
  salvarPosicaoMini()
  miniVisivel = false
  clearInterval(fade)
  mini.hide()
  void mini.webContents.executeJavaScript('window.__miniHide?.()').catch(() => {})
  janela?.webContents.send('tunegrab:cmd', { type: 'float-closed' })
}

const doApp = e => janela && e.sender === janela.webContents
const daMini = e => vivo() && e.sender === mini.webContents

ipcMain.on('tunegrab:float', (e, info) => {
  if (doApp(e) && info?.src) void abrirMini(info)
})
// o app conta onde está (segundo, tocando/pausado, volume): a imagem da janelinha acompanha
ipcMain.on('tunegrab:float-state', (e, st) => {
  if (doApp(e) && vivo()) mini.webContents.send('tunegrab:state', st)
})
ipcMain.on('tunegrab:float-close', (e) => {
  if (doApp(e)) esconderMini()
})
// botões da janelinha → player do app (que é quem toca)
ipcMain.on('tunegrab:mini-cmd', (e, cmd) => {
  if (daMini(e) && cmd?.type) janela?.webContents.send('tunegrab:cmd', cmd)
})
ipcMain.on('tunegrab:mini-back', (e) => {
  if (!daMini(e)) return
  esconderMini()
  abrirJanela()
  // traz para a frente de tudo (o Windows às vezes deixa a janela restaurada atrás das outras)
  if (janela) {
    janela.setAlwaysOnTop(true)
    janela.focus()
    janela.setAlwaysOnTop(false)
  }
})
ipcMain.on('tunegrab:mini-close', (e) => {
  if (!daMini(e)) return
  janela?.webContents.send('tunegrab:cmd', { type: 'pause' }) // fechou: o app pausa, ainda minimizado
  esconderMini()
})

// ---------- atualização pelo próprio app ----------
// Confere a última versão publicada no GitHub (ao abrir e a cada 6 h). Tem nova? Avisa na tela do app;
// com um clique baixa o instalador, confere se o arquivo veio inteiro (sha512 do latest.yml) e instala
// sozinho, sem perguntas, abrindo o TuneGrab de novo no final. Histórico, login e preferências ficam.
const REPO = 'jeanevertonoficial/TuneGrab'
let atualizacao = null // { version, notes, exe, yml, size }
let instalando = false

/** 1.2.10 > 1.2.9 */
function maisNova(a, b) {
  const pa = String(a).split('.').map(n => Number.parseInt(n) || 0)
  const pb = String(b).split('.').map(n => Number.parseInt(n) || 0)
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0)
  return false
}

async function checarAtualizacao(manual = false) {
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { 'User-Agent': 'TuneGrab', 'Accept': 'application/vnd.github+json' } })
    if (!r.ok) throw new Error(`GitHub respondeu ${r.status}`)
    const rel = await r.json()
    const version = String(rel.tag_name || '').replace(/^v/, '')
    const exe = rel.assets?.find(a => /\.exe$/i.test(a.name))
    const yml = rel.assets?.find(a => a.name === 'latest.yml')
    if (version && exe && yml && maisNova(version, app.getVersion())) {
      const nova = !atualizacao || atualizacao.version !== version
      atualizacao = { version, notes: rel.body || '', exe: exe.browser_download_url, yml: yml.browser_download_url, size: exe.size }
      janela?.webContents.send('tunegrab:update', atualizacao)
      if (nova && bandeja && (!janela || !janela.isVisible())) {
        bandeja.displayBalloon({ iconType: 'info', title: `TuneGrab ${version} disponível`, content: 'Abra o TuneGrab e clique em "Atualizar agora".' })
      }
      montarMenuBandeja()
    }
    else if (manual) {
      dialog.showMessageBox({ type: 'info', title: 'TuneGrab', message: `Você já está na versão mais nova (${app.getVersion()}).` })
    }
  }
  catch (e) {
    if (manual) dialog.showMessageBox({ type: 'warning', title: 'TuneGrab', message: 'Não deu para procurar atualizações agora.', detail: String(e.message || e) })
  }
}

async function instalarAtualizacao() {
  if (!atualizacao || instalando) return { ok: false }
  instalando = true
  const progresso = p => janela?.webContents.send('tunegrab:update-progress', p)
  try {
    const crypto = require('node:crypto')
    // sha512 esperado (o latest.yml é gerado junto com o instalador)
    const yml = await (await fetch(atualizacao.yml, { headers: { 'User-Agent': 'TuneGrab' } })).text()
    const esperado = /^sha512:\s*(\S+)/m.exec(yml)?.[1]
    if (!esperado) throw new Error('A versão publicada não tem a conferência do arquivo (latest.yml).')

    const destino = path.join(app.getPath('temp'), `TuneGrab-Setup-${atualizacao.version}.exe`)
    const r = await fetch(atualizacao.exe, { headers: { 'User-Agent': 'TuneGrab' } })
    if (!r.ok || !r.body) throw new Error(`Download falhou (${r.status})`)
    const total = Number(r.headers.get('content-length')) || atualizacao.size || 0
    const hash = crypto.createHash('sha512')
    const out = fs.createWriteStream(destino)
    let baixado = 0
    let ultimo = 0
    for await (const parte of r.body) {
      hash.update(parte)
      baixado += parte.length
      if (!out.write(parte)) await new Promise(res => out.once('drain', res))
      if (Date.now() - ultimo > 200) {
        ultimo = Date.now()
        progresso({ fase: 'baixando', pct: total ? Math.round(baixado / total * 100) : 0 })
      }
    }
    await new Promise((res, rej) => out.end(err => (err ? rej(err) : res())))
    if (hash.digest('base64') !== esperado) {
      fs.rmSync(destino, { force: true })
      throw new Error('O arquivo baixado não confere com o publicado. Tente de novo.')
    }

    progresso({ fase: 'instalando', pct: 100 })
    // instala sem perguntas (/S) e abre o TuneGrab de novo no final (--force-run)
    spawn(destino, ['/S', '--updated', '--force-run'], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
    setTimeout(() => void sair(), 300)
    return { ok: true }
  }
  catch (e) {
    instalando = false
    progresso({ fase: 'erro', erro: String(e.message || e) })
    return { ok: false, erro: String(e.message || e) }
  }
}

ipcMain.handle('tunegrab:update-info', () => ({ current: app.getVersion(), update: atualizacao }))
ipcMain.handle('tunegrab:update-install', e => (janela && e.sender === janela.webContents ? instalarAtualizacao() : { ok: false }))

// ---------- bandeja (perto do relógio) ----------
function iniciaComWindows() {
  return app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin
}
function definirInicio(ligar) {
  app.setLoginItemSettings({ openAtLogin: ligar, args: ['--hidden'] })
}

function montarMenuBandeja() {
  if (!bandeja) return
  bandeja.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir o TuneGrab', click: abrirJanela },
    { label: 'Abrir no navegador', click: () => void shell.openExternal(url().replace('127.0.0.1', 'localhost')) },
    { type: 'separator' },
    {
      label: 'Iniciar com o Windows', type: 'checkbox', checked: iniciaComWindows(),
      click: (item) => {
        definirInicio(item.checked)
        montarMenuBandeja()
      },
    },
    { label: 'Pasta de dados (histórico, login)', click: () => void shell.openPath(dados) },
    { type: 'separator' },
    atualizacao
      ? { label: `Atualizar para a versão ${atualizacao.version}`, click: () => void instalarAtualizacao() }
      : { label: 'Procurar atualizações', enabled: empacotado, click: () => void checarAtualizacao(true) },
    { label: `Versão ${app.getVersion()}`, enabled: false },
    { type: 'separator' },
    { label: 'Sair', click: () => sair() },
  ]))
}

function montarBandeja() {
  bandeja = new Tray(nativeImage.createFromPath(caminhos.bandeja))
  bandeja.setToolTip('TuneGrab')
  montarMenuBandeja()
  bandeja.on('click', abrirJanela)
}

async function sair() {
  saindo = true
  await desligarServidor()
  bandeja?.destroy()
  app.quit()
}

// ---------- início ----------
app.on('second-instance', abrirJanela)
// a página pediu para mostrar a janela (ex.: "voltar" no vídeo flutuante)
ipcMain.on('tunegrab:show', (e) => {
  if (janela && e.sender === janela.webContents) abrirJanela()
})
app.on('window-all-closed', () => { /* continua na bandeja */ })
app.on('before-quit', () => {
  saindo = true
  if (servidor?.pid) execFile('taskkill', ['/PID', String(servidor.pid), '/T', '/F'], { windowsHide: true }, () => {})
})

app.whenReady().then(async () => {
  app.setAppUserModelId('com.jeaneverton.tunegrab') // nome certo nas notificações do Windows
  Menu.setApplicationMenu(null)

  // 1ª vez: liga o "iniciar com o Windows" (o app fica sempre no ar); dá para desligar no menu da bandeja
  const marca = path.join(dados, 'state', '.primeira-vez')
  if (empacotado && !fs.existsSync(marca)) {
    definirInicio(true)
    fs.mkdirSync(path.dirname(marca), { recursive: true })
    fs.writeFileSync(marca, new Date().toISOString())
  }

  montarBandeja()
  porta = await escolherPorta()
  ligarServidor()
  if (!(await esperarServidor())) {
    dialog.showErrorBox('TuneGrab', `O TuneGrab não conseguiu iniciar. Veja ${path.join(logs, 'servidor.log')}`)
    return sair()
  }
  if (!ESCONDIDO) abrirJanela()
  criarMini() // já pronta (escondida): ao minimizar aparece na hora
  // atualizações: confere logo depois de abrir e a cada 6 h (só no programa instalado)
  if (empacotado) {
    setTimeout(() => void checarAtualizacao(), 8000)
    setInterval(() => void checarAtualizacao(), 6 * 60 * 60 * 1000)
  }
})
