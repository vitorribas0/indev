# InDev

Espaço para transformar a ideia do InDev em um produto claro, útil e construível.

## Em uma frase

> O InDev será um ambiente de desenvolvimento com IA capaz de entender um projeto, planejar mudanças, escrever código, testar e revisar entregas — com uma experiência tão boa quanto ou melhor que a do Codex.

## Visão inicial

O objetivo não é tentar reproduzir, do zero, um modelo de IA de fronteira. O objetivo é criar um **produto de desenvolvimento assistido por IA**: uma experiência integrada que pode usar modelos disponíveis no mercado e se diferenciar pela qualidade do fluxo de trabalho, contexto do projeto, controle e confiança.

## Princípios do produto

- Entender o projeto antes de alterar qualquer arquivo.
- Mostrar um plano claro e permitir aprovação antes das mudanças relevantes.
- Executar testes e explicar o que mudou.
- Manter cada tarefa rastreável: intenção, alterações, comandos e resultado.
- Deixar a pessoa no controle de permissões, custos e dados.

## O que significa “igual ou melhor”

| Área | Meta para o InDev |
| --- | --- |
| Entendimento | Ler estrutura, documentação, dependências e histórico relevante do projeto. |
| Execução | Criar e editar arquivos, rodar comandos, testes e verificações. |
| Colaboração | Explicar decisões, pedir autorização quando necessário e manter histórico das tarefas. |
| Qualidade | Propor plano, revisar o próprio trabalho e validar antes de entregar. |
| Experiência | Ser simples para começar, mas dar visibilidade e controle a quem desenvolve. |

## Direção de interface

O InDev terá uma experiência de conversa orientada a tarefas, com uma área de contexto expansível para acompanhar o trabalho em tempo real. A referência é a clareza de ferramentas como o Codex, mas com marca, componentes e identidade visual próprios.

```
┌───────────────────────────────┬──────────────────────────────────┐
│ InDev                         │ Tarefa atual                     │
│                               │ ──────────────────────────────── │
│ Conversa                      │ Arquivos alterados               │
│                               │ • src/...                        │
│ Você: implemente X            │                                  │
│                               │ Execução                         │
│ InDev: plano + progresso      │ ✓ testes                         │
│                               │ • comando em andamento           │
│ [ Escreva uma mensagem... ]   │                                  │
│                               │ Resultado / revisão              │
└───────────────────────────────┴──────────────────────────────────┘
```

### Painel lateral de tarefa

- Pode ser aberto, fechado ou redimensionado.
- Mostra plano, progresso e arquivos envolvidos.
- Exibe comandos e testes: aguardando, em execução, concluído ou com falha.
- Reúne diffs, resultados e pontos que precisam de aprovação.
- Permite voltar a tarefas anteriores sem perder o histórico.

O primeiro preview visual está em [design/indev-preview.html](design/indev-preview.html).

## Implementação atual

A aplicação local está em `app/` e já usa o **Codex App Server público** como motor principal. A interface laranja/glass recebe respostas em streaming e mostra o trabalho do agente em tempo real.

Já estão conectados:

- Conta e catálogo de modelos do Codex local.
- Tarefas persistentes e retomada de histórico.
- Tools, comandos, terminal, plano, diffs e alterações de arquivos.
- Sandbox de leitura ou escrita limitada ao projeto.
- Pedidos de aprovação para ações protegidas.
- Upload local de arquivos e seleção de contexto com `@`.
- Catálogo de skills e envio de skills para a tarefa.
- Comandos `/new`, `/interrupt`, `/compact`, `/skills` e `/status`.
- Responses API como modo de reserva caso o App Server não esteja disponível.

### Executar localmente

Requisitos: aplicativo/CLI Codex instalado e Node.js 22 ou superior.

```bash
cd app
npm install
npm run dev
```

Abra `http://localhost:3001`. O comando inicia automaticamente o site local, o Codex App Server e uma ponte WebSocket que só aceita a origem local do InDev. Nada é publicado.

### Verificações

```bash
npm run lint
npm test
npm run test:e2e
```

O teste de ponta a ponta inicializa o Codex, carrega conta/modelos/skills, armazena um arquivo local, envia esse arquivo ao agente e confirma a resposta da LLM em streaming.

### Limite honesto

O InDev integra a superfície pública disponível no Codex App Server; ele não copia serviços proprietários internos da OpenAI nem promete paridade com partes que não foram publicadas. A base atual, porém, já é um harness funcional e não apenas uma tela simulada.

## Primeira hipótese de público

Pessoas e pequenas equipes que desenvolvem software e querem um agente de IA que trabalhe dentro do projeto, com contexto e transparência — não apenas gere trechos isolados de código.

## Mapa inicial

### 1. Problema

- Qual dor concreta queremos resolver?
- Em que momento ela aparece?
- Como as pessoas lidam com isso hoje?

### 2. Pessoas usuárias

- Quem usará o InDev primeiro?
- Quais são seus objetivos e limitações?
- O que faria essa pessoa voltar a usar o produto?

### 3. Proposta de valor

- Qual resultado o InDev entrega?
- O que o diferencia das alternativas existentes?

### 4. Primeira versão

- Qual é a menor experiência que já comprova valor?
- O que fica deliberadamente fora da versão inicial?
- Como vamos medir se ela funcionou?

## Próximos passos

1. Definir o público inicial com mais precisão.
2. Escolher o primeiro ambiente: aplicativo desktop, extensão de editor ou web.
3. Listar as três funcionalidades essenciais da primeira versão.
4. Decidir quais modelos de IA poderão ser usados inicialmente.
5. Validar a hipótese com pessoas desenvolvedoras reais.

## Decisões

| Data | Decisão | Motivo |
| --- | --- | --- |
| 2026-08-26 | Repositório criado | Centralizar o mapeamento e a evolução da ideia. |
| 2026-08-26 | InDev como ambiente de desenvolvimento com IA | Focar no produto e na experiência, combinando modelos de IA existentes em vez de tentar treinar um modelo de fronteira do zero. |
| 2026-08-26 | Interface de conversa com painel lateral de tarefa | Tornar visível o trabalho do agente: arquivos, execuções, resultados e aprovações. |
