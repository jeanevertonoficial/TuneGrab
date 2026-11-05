import { join } from 'node:path'

/**
 * Onde o app guarda os dados do usuário (histórico, favoritas, login, caches).
 * Rodando pelo projeto (npm run dev): .data na pasta do projeto.
 * Instalado (programa TuneGrab): a pasta do usuário (%APPDATA%\TuneGrab), definida pelo Electron —
 * a pasta de instalação (Arquivos de Programas) não aceita gravação.
 */
export const dataDir = process.env.TUNEGRAB_DATA || join(process.cwd(), '.data')
