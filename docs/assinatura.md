# Assinar o instalador (SignPath Foundation, grátis para código aberto)

Com a assinatura, o Windows deixa de mostrar "editor desconhecido" e o SmartScreen confia mais no instalador.
O certificado é emitido em nome da **SignPath Foundation**, que aparece como editora (é assim que o programa funciona).

## O que já está pronto no projeto

- Licença aberta (GPL-3.0) e repositório público.
- Instalador gerado **nos servidores do GitHub** a partir do código (`.github/workflows/instalador.yml`), já com o passo
  de assinatura — ele só liga quando as credenciais do SignPath forem cadastradas.
- Seção **Code signing policy** (com a política de privacidade) no README e link dela em cada release nova.
- O app pergunta antes de abrir com o Windows, e a desinstalação tira esse item do sistema.
- A procura de atualizações pode ser desligada (menu do ícone → Procurar atualizações sozinho).

## O que só você pode fazer

1. **Verificação em duas etapas no GitHub** (obrigatória): github.com → Settings → Password and authentication.
2. **Pedir a adesão**: https://signpath.org/apply — preencha com:
   - Projeto: TuneGrab — https://github.com/jeanevertonoficial/TuneGrab
   - Licença: GPL-3.0-or-later
   - Download: https://github.com/jeanevertonoficial/TuneGrab/releases
   - Build: GitHub Actions (`.github/workflows/instalador.yml`), runner `windows-latest`
   - O que assinar: o instalador NSIS `TuneGrab-Setup.exe`
3. **Esperar a análise.** A SignPath Foundation escolhe os projetos e pede **reputação verificável** para programas
   executáveis (projeto conhecido, com usuários, estrelas e releases). Projeto muito novo pode ser recusado ou pedirem
   para tentar mais tarde — divulgar antes ajuda.
4. **Depois de aprovado**, no painel do SignPath.io:
   - crie o projeto com o slug `TuneGrab` e ligue o **Trusted Build System** do GitHub Actions;
   - crie a **artifact configuration** abaixo (padrão do projeto);
   - crie a **signing policy** `release-signing` (com aprovação manual);
   - gere um **API token** para um usuário de CI com permissão de enviar pedidos.
5. **Cadastre no GitHub** (repositório → Settings → Secrets and variables → Actions):
   - Secrets: `SIGNPATH_API_TOKEN`
   - Variables: `SIGNPATH_ORGANIZATION_ID`, `SIGNPATH_PROJECT_SLUG` = `TuneGrab`, `SIGNPATH_SIGNING_POLICY_SLUG` = `release-signing`
6. Tire o aviso "Situação: pedido de adesão… em andamento" da seção Code signing policy do README.

### Artifact configuration (SignPath)

O GitHub envia um `.zip` com o instalador dentro:

```xml
<?xml version="1.0" encoding="utf-8"?>
<artifact-configuration xmlns="http://signpath.io/artifact-configuration/v1">
  <zip-file>
    <pe-file path="TuneGrab-Setup.exe" product-name="TuneGrab" product-version="${version}">
      <authenticode-sign />
    </pe-file>
  </zip-file>
</artifact-configuration>
```

(Se o painel não aceitar `${version}`, use só `product-name="TuneGrab"`.)

## Depois disso, publicar uma versão é

```bash
# aumente "version" no package.json
npm run release -- notas.md
```

O GitHub gera o instalador, pede a assinatura (você aprova no SignPath), calcula o `latest.yml` sobre o arquivo
assinado e publica a release. Os apps instalados recebem o aviso "Atualizar agora".
