# Contribuir com o TuneGrab

Obrigado pelo interesse! Ideias, relatos de erro e código são bem-vindos. (English is fine too.)

## Relatar um erro ou sugerir algo

Abra uma [issue](https://github.com/jeanevertonoficial/TuneGrab/issues/new/choose) usando um dos modelos.
Para erros, ajuda muito mandar:

- a versão (Configurações → Sobre, ou botão direito no ícone perto do relógio);
- o que você fez, o que esperava e o que aconteceu;
- o trecho de `%APPDATA%\TuneGrab\logs\servidor.log` perto do horário do erro (tire dados pessoais antes).

**Não envie** o arquivo `cookies.txt` nem nada da pasta `state` — eles têm a sua sessão do YouTube.

## Rodar pelo código

```bash
npm install        # também baixa o yt-dlp
npm run dev        # http://localhost:3000
npm run desktop    # o programa (Electron) sem instalar
npm run build      # confere se tudo compila
```

A estrutura de pastas está no [README](README.md#estrutura-do-código).

## Enviar código (pull request)

1. Faça um fork e crie um branch a partir de `main`.
2. Mantenha o estilo do projeto: textos da interface em **português do Brasil**, simples e diretos;
   comentários explicando o *porquê*, não o *como*.
3. Teste o que mudou (no navegador com `npm run dev` e, se mexer no `electron/`, com `npm run desktop`).
4. Descreva no pull request o que muda para quem usa.

Ao contribuir, você concorda que o seu código seja distribuído sob a mesma licença do projeto (GPL-3.0-or-later).

## O que não entra

- Nada que contorne proteção de cópia (DRM) ou baixe de serviços pagos diretamente.
- Nada que esconda o app de verificações dos serviços ("não sou um robô") de forma abusiva.
- Conteúdo protegido em testes, prints ou demonstrações — use músicas com licença livre.
