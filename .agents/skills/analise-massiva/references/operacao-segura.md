# Operação segura

- Cada linha com texto gera aproximadamente uma chamada separada à API da OpenAI.
- O modelo padrão é `gpt-5.6-luna`; use outro somente quando o usuário pedir ou quando a qualidade exigida justificar o custo.
- O teto técnico é 8.000 linhas. `limite=0` significa todas as linhas válidas até esse teto.
- A concorrência padrão é 4 e o máximo é 10. Aumentar concorrência reduz o tempo, mas eleva o risco de rate limit.
- A aprovação deve mostrar arquivo, aba, coluna de entrada, colunas de saída, quantidade de chamadas, modelo e paralelismo.
- A aprovação também deve deixar claro que o conteúdo da coluna analisada será enviado à API da OpenAI.
- Em erro parcial, a célula recebe `[ERRO]` e o restante da planilha continua sendo produzido. Informe a quantidade de falhas.
- O arquivo original não pode ser sobrescrito. O resultado pertence somente ao chat que iniciou a execução.
- Para validar uma ideia de critério, proponha uma amostra pequena antes do arquivo inteiro, mas não aplique essa redução sem aceite do usuário.
