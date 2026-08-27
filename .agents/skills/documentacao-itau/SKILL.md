---
name: documentacao-itau
description: "Produza relatórios, manuais e documentos institucionais no padrão visual Itaú, com conteúdo em Markdown e renderização HTML consistente. Use quando o usuário pedir explicitamente padrão, identidade ou documentação Itaú; não aplique a marca a documentos genéricos."
---

# Documentação Itaú

1. Confirme o objetivo e use somente fatos, números e fontes presentes no contexto ou fornecidos pelo usuário. Não invente indicadores para preencher o layout.
2. Escreva apenas o conteúdo semântico em Markdown: títulos, parágrafos, listas, tabelas, citações e blocos de código quando necessários.
3. Não gere HTML, CSS, capa, cabeçalho, rodapé ou outra versão da logo. O perfil visual versionado cuida desses elementos.
4. Estruture documentos executivos com resumo, contexto ou escopo, análise, conclusões, recomendações e fontes quando essas seções fizerem sentido; não force seções irrelevantes.
5. Chame `renderizar_documento` com `perfil="itau"`, `formato="html"`, título, subtítulo opcional, conteúdo Markdown e a classificação adequada. Na dúvida, use `Documento interno`.
6. A tool produz o HTML standalone na pasta de entregas do chat. Informe somente o resultado final, sem expor o Markdown ou arquivos auxiliares.

O perfil contém um asset de marca substituível. Não trate a presença da logo como autorização para uso externo ou comercial da marca.
