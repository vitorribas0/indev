---
name: analise-massiva
description: "Classifique, categorize, valide ou extraia campos de muitas linhas de uma planilha Excel com uma chamada de modelo por registro. Use quando o usuário pedir análise em massa, por linha, de todos os relatos ou registros; não use para somas, filtros ou estatísticas que podem ser calculados sem LLM."
---

# Análise massiva

Use a tool `analise_massiva_llm` para executar a classificação. A skill decide quando e como usar; a tool lê e grava o Excel.

1. Identifique o arquivo `.xlsx`, a aba, a coluna textual, o critério e as colunas que o usuário quer criar.
2. Não use LLM por linha para cálculos determinísticos, agrupamentos, filtros ou limpeza simples.
3. Preserve o arquivo original. A tool sempre cria outro Excel na pasta de entregas do chat.
4. Respeite exatamente o limite solicitado. Se o usuário não informou amostra, não reduza silenciosamente a quantidade.
5. Chame `analise_massiva_llm` uma vez com os parâmetros completos. A interface mostrará quantidade de linhas, modelo e chamadas previstas e exigirá aprovação do usuário antes de começar.
6. Nunca tente contornar, presumir ou responder pela aprovação visual.
7. Ao concluir, informe linhas processadas, colunas criadas, falhas parciais e somente o caminho do Excel final.

Leia [operação segura](references/operacao-segura.md) quando precisar escolher limite, concorrência ou tratar falhas parciais.
