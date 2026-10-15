# Módulo Lista Bori & Ebó

Implementado em `src/features/lists.js` e `lists.css`, usando `render(container, ctx)` do contrato compartilhado.

- Cartões e detalhe por `#/lists/{id}`, progresso individual enviado a `/api/progress/{listId}` e bloqueio dos controles enquanto cada resposta está pendente.
- Conclusão disponível somente com todos os itens válidos marcados. Após concluir, o estado exibe `✅ Função Concluir`; reinício pede confirmação e afeta somente o próprio progresso.
- Edição administrativa por modal com título, descrição, itens editáveis e reordenação. IDs e versões existentes seguem no payload; o servidor decide versões finais.
- Importação DOCX, XLSX e PDF com upload, prévia, avisos, escolha de aba e colunas de Excel e revisão manual antes de salvar. Arquivos sem texto podem ser preenchidos manualmente.
- Erros de API aparecem no modal sem apagar os dados digitados. A lista também permanece editável após falha de extração.
- Respostas de progresso só redesenham o detalhe se aquela mesma renderização e rota ainda estiverem ativas. A resposta continua atualizando o estado pessoal capturado pelo módulo.
- Upload e prévia bloqueiam arquivo, aba, colunas e salvamento enquanto pendentes. Uma geração crescente ignora respostas antigas ou recebidas depois do fechamento do modal.

Validação: `node --check src/features/lists.js` passou após as correções da revisão. Os cenários de resposta fora de ordem e troca de rota ainda precisam de teste DOM/browser integrado.
