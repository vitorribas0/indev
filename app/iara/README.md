# Iara no InDev

O InDev mantém o Codex App Server como harness de execução e troca somente o provedor de LLM:

```text
Interface InDev -> Codex App Server -> adaptador local -> SDK Iara -> modelo escolhido na Iara
                       | tools, skills, sandbox e arquivos |
```

O adaptador escuta exclusivamente em `127.0.0.1`, exige um token local aleatório e nunca grava o `client_secret`. O SDK cuida do STS e da renovação do token da Iara.

## Configuração

1. Copie `.env.example` para `.env.local`.
2. Use `INDEV_LLM_PROVIDER=iara`.
3. Preencha `IARA_CLIENT_ID` e `IARA_CLIENT_SECRET`.
4. Confirme o ambiente (`dev`, `homol` ou `prod`), o backend e um modelo liberado no seu ACL.
5. Execute `npm run setup:iara` e depois `npm run dev`.

O cadastro Iara precisa permitir, no mínimo, os escopos `controlplane-models.read`, `controlplane-providers.read`, `genaidataplane-chat-completions.read` e `genaidataplane-chat-completions.write`.

Se o ambiente corporativo usa uma autoridade certificadora própria, indique o certificado PEM com `IARA_CA_BUNDLE`. Para usar um Python já preparado, defina o caminho absoluto em `INDEV_IARA_PYTHON`.

`IARA_MODELS` controla as opções exibidas no seletor do chat. Os nomes precisam existir e estar liberados no ambiente Iara escolhido.
