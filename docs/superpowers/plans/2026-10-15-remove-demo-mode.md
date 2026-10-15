# Plano: remover o modo de demonstração

1. Mapear os usos do modo `preview` e separar dependências do produto (prévia de comunicado/importação e FAQ Mae Oba) das rotas demonstrativas.
2. Remover o caminho de inicialização SQLite/seed/sessão de demonstração da API, removendo também código exclusivo de demonstração que não tenha dependência em testes ou integrações.
3. Remover login, tokens, banner e mensagens da prévia na interface; manter autenticação Supabase/Firebase real e estados de configuração pendente.
4. Retirar `npm run local` e o script demonstrativo; atualizar README, documentação ativa e configuração de exemplo para refletir os caminhos suportados.
5. Ajustar testes: excluir cenários exclusivamente demonstrativos e adicionar/regressar casos para inicialização real fail-closed, configuração de modo inválido e ausência de sessão demonstrativa. Preservar testes de preview de comunicado/importação.
6. Rodar a suíte de frontend/backend e build de produção; revisar busca residual por modo/login/dados de demonstração.
7. Revisar `git status`, arquivos versionáveis e segredos. Antes de publicar, definir repositório GitHub e visibilidade; não enviar chaves nem `.env.local`.

## Critérios de conclusão

- Não existe login ou endpoint público de demonstração, nem seed automático de dados fictícios.
- A aplicação inicia em Supabase e indisponibilidade de configuração continua falhando de forma fechada.
- Ferramentas reais de prévia e FAQ Mae Oba seguem disponíveis.
- Testes e build passam; documentação descreve o fluxo real.
- Nenhum deploy ou push é feito até revisar o conteúdo versionado e confirmar o destino/visibilidade do GitHub.
