# Iara no InDev

O InDev mantém o Codex App Server como harness de execução e troca somente o provedor de LLM:

```text
Interface InDev -> Codex App Server -> adaptador local -> SDK Iara -> modelo escolhido na Iara
                       | tools, skills, sandbox e arquivos |
```

O adaptador escuta exclusivamente em `127.0.0.1`, exige um token local aleatório e nunca grava o `client_secret`. O SDK cuida do STS e da renovação do token da Iara.

## Instalação automática

1. Copie `.env.example` para `.env.local`.
2. Use `INDEV_LLM_PROVIDER=iara`.
3. Preencha `IARA_CLIENT_ID` e `IARA_CLIENT_SECRET`.
4. Se a ACL exigir a chave Fernet do portal, preencha também `IARA_ACCESS_TOKEN`; ela é opcional e não substitui as duas credenciais OAuth.
5. Confirme o ambiente (`dev`, `homol` ou `prod`), o backend e um modelo liberado no seu ACL.
6. Dentro de `app`, execute `npm ci`, `npm run setup:iara` e `npm run dev`.

O setup usa [requirements.txt](requirements.txt), cria `.indev/iara-venv` fora da pasta versionada e instala o SDK pelos Artifactory corporativos.

## Instalação manual do SDK

Os índices configurados são:

```text
https://artifactory.prod.aws.cloud.ihf/artifactory/api/pypi/python-remotes/simple
https://artifactory.prod.aws.cloud.ihf/artifactory/api/pypi/itau-kk7-python-release/simple
```

Exemplo com um ambiente Python já ativado:

```bash
python -m pip install --trusted-host "artifactory.prod.aws.cloud.ihf" --index-url "https://artifactory.prod.aws.cloud.ihf/artifactory/api/pypi/python-remotes/simple" --extra-index-url "https://artifactory.prod.aws.cloud.ihf/artifactory/api/pypi/itau-kk7-python-release/simple" "iara_genai_sdk==0.43.0"
```

Se usar esse caminho, informe o executável Python instalado em `INDEV_IARA_PYTHON` ou mantenha o ambiente no caminho `.indev/iara-venv` esperado pelo setup.

O cadastro Iara precisa permitir, no mínimo, os escopos `controlplane-models.read`, `controlplane-providers.read`, `genaidataplane-chat-completions.read` e `genaidataplane-chat-completions.write`.

Se o ambiente corporativo usa uma autoridade certificadora própria, indique o certificado PEM com `IARA_CA_BUNDLE`. Para usar um Python já preparado, defina o caminho absoluto em `INDEV_IARA_PYTHON`.

`IARA_MODELS` controla as opções exibidas no seletor do chat. Os nomes precisam existir e estar liberados no ambiente Iara escolhido.

## Diagnóstico

```bash
npm run doctor:iara
npm run test:iara
```

O primeiro comando valida credenciais locais, Python e importação do SDK. O segundo testa os dois lados da integração sem consumir o serviço real: o adaptador Python (autenticação, Responses e streaming) e o Codex App Server usando esse mesmo contrato.

O guia completo para Windows, macOS e Linux está no [README principal](../../README.md).
