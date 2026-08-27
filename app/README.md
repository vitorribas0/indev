# InDev — aplicação local

Esta pasta contém a interface, as rotas locais, a ponte WebSocket, o inicializador do harness e os testes do InDev.

Arquivos Excel `.xlsx` são convertidos localmente em contexto textual estruturado antes do envio ao agente; o arquivo original também é preservado.

## Requisitos

- Node.js 22.13 ou superior.
- Internet na primeira instalação e para usar os modelos da OpenAI.
- Login da OpenAI ou uma chave em `.env.local`.

O Codex CLI não precisa estar instalado globalmente: `@openai/codex` faz parte das dependências do projeto.

## Executar

```bash
npm install
npm run setup
npm run dev
```

O InDev estará em `http://localhost:3001`. Nada é publicado.

## Verificar

```bash
npm run doctor
npm run lint
npm test
npm run test:e2e
```

O teste de ponta a ponta usa o Codex do `node_modules`, abre portas isoladas, grava e lê um arquivo pelo App Server e confirma uma resposta real da LLM em streaming.

## Dados privados

O login, o histórico operacional e os uploads ficam em `../.indev/`, que é ignorada pelo Git. O arquivo `.env.local` também é ignorado. Use `.env.example` apenas como modelo.

Mais detalhes estão no [README principal](../README.md).
