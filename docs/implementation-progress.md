# Andamento da implementação

Atualizado em 15/10/2026. Este registro descreve o código local; não representa implantação nem validação com contas externas.

## Implementado no repositório

- [x] Portal responsivo, navegação por perfil, login Supabase Google/e-mail, dashboard, agenda e comunicados. O modo de demonstração foi removido.
- [x] Listas com progresso individual, conclusão sem notificação e importação revisável de DOCX, XLSX e PDF.
- [x] Itáns e Orixás, integrantes, localização, espaço da homenagem, usuários e configurações.
- [x] Assistente Mae Oba em Python com imagens de olhos fechados, abertos e felizes, animação e respostas locais de ajuda.
- [x] API FastAPI, Supabase principal, adaptador Firebase legado e validação de acesso no servidor. SQLite permanece apenas como adapter isolado de testes, sem sessões ou seed demonstrativo.
- [x] Regras Firebase, presença em tempo real, funções de e-mail, recuperação de senha e regras de armazenamento.
- [x] Expiração de importações após 24 horas, com bloqueio imediato na API e limpeza agendada no Storage.
- [x] Limpeza também de arquivos de importação abandonados antes do registro, com varredura paginada.
- [x] Presença versionada para que a limpeza de um bloqueio antigo preserve conexões posteriores à reaprovação.
- [x] Exemplo de variáveis sem segredos e instruções de build em `README.md`.
- [x] Migração inicial Supabase: schema/PostgreSQL, RLS, Storage privado, adapter da API, validação de JWT Google/Email e bootstrap explícito do primeiro administrador.
- [x] Login do navegador migrado para Supabase (Google, e-mail/senha e recuperação de senha); cadastro de conta aguarda aprovação administrativa.
- [x] Nomes base dos 21 orixás podem ser inseridos no Supabase com IDs UUID estáveis, sem descrições inventadas.
- [x] Presença online usa Supabase Realtime e política privada para membros aprovados.
- [x] Correções de RLS: caminhos do Storage seguem `uploads/<uid>/...`, foto do perfil não aceita edição direta, conteúdo arquivado e progresso de outros membros ficam ocultos.

## Validação local

- Build Vite de produção passou após a remoção do modo demonstrativo.
- 16 testes de frontend, 61 de backend, 13 de importação, 23 da assistente e 10 de funções passaram. Os testes cobrem ausência de sessão demonstrativa e fall-back seguro de configurações antigas para Supabase sem banco local.
- Migration SQL (89 statements), teste pgTAP (28 statements) e `supabase/config.toml` foram analisados sintaticamente.
- Compilação sintática de `backend/store.py`, `backend/service.py` e `functions/main.py` passou após as correções; `git diff --check` também passou.
- 67 testes automatizados passaram na execução registrada em 14/10/2026, antes da migração Supabase.
- 5 testes agregados de regras passaram nos emuladores Firebase em 13/10/2026.
- A prévia isolada de Mae Oba foi aberta e conferida em telas desktop e celular.

Os testes não validam autenticação Google, recursos remotos ou publicação; a validação integrada com Supabase e Vercel continua pendente.

## Ainda depende de configuração externa

- Validar a migration `supabase/migrations/202610140001_portal_schema.sql` e as regras RLS no projeto remoto ou em um banco Supabase local/temporário.
- Substituir o marcador `[YOUR-PASSWORD]` em `SUPABASE_DB_URL` pela senha real do banco; conferir URL, chaves e `APP_MODE=supabase` sem divulgar os valores.
- Adicionar URLs de redirecionamento locais e Vercel no Supabase; validar Google OAuth de ponta a ponta.
- Configurar o projeto Vercel com as variáveis de ambiente Supabase e testar em deploy de preview.
- Criar a conta inicial, promover o e-mail Google verificado com o script protegido e popular os 21 nomes fornecidos.
- Integrar e validar entrega de comunicados e recuperação administrativa via Resend.
- Instalar/testar o SDK de Storage no runtime de deploy e validar upload privado ponta a ponta.
- Executar testes de RLS/Realtime numa instância Supabase local ou projeto de staging e testar concorrência no PostgreSQL real.
- Receber do usuário endereço, foto do barracão, foto da homenageada, músicas/links e textos religiosos para preencher os conteúdos reais.

## Próxima sequência

1. Criar ou selecionar um repositório GitHub privado e revisar os arquivos versionados para excluir credenciais.
2. Corrigir a URI de conexão, confirmar a migration, validar login e provisionar a primeira administradora.
3. Concluir email/Storage, configurar Vercel e validar os fluxos reais antes de divulgar o endereço.
