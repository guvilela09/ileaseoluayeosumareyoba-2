# Remover o modo de demonstração

## Objetivo

Preparar o portal para produção removendo completamente o modo local de demonstração, sem alterar os fluxos reais do Supabase nem ferramentas de prévia que fazem parte do produto.

## Decisões

- Remover o modo `preview` da configuração e do ciclo de inicialização da API.
- Remover autenticação/sessão de demonstração, perfis fictícios, seed de dados de demonstração, seleção de SQLite no app e rotas de sessão/assets demonstrativos. O adapter SQLite usado somente por testes não emite nem persiste sessões.
- Remover a interface de login de teste, indicadores de prévia local, mensagens de demonstração em configurações/usuários e o comando `npm run local` com seu script.
- Atualizar README e documentação operacional para descrever apenas os modos reais ainda suportados e a configuração Supabase.
- Preservar as prévias de comunicado e importação de listas, pois são ferramentas reais para revisar conteúdo antes de publicar/salvar.
- Preservar a base de conhecimento da Mae Oba usada pela API. A apresentação independente da personagem não é usada para autenticar ou popular o portal e deve permanecer fora desta remoção funcional, salvo dependência encontrada na implementação.
- Manter a inicialização em Supabase por padrão e o comportamento fail-closed quando variáveis/serviços obrigatórios estiverem indisponíveis.
- Preservar suporte Firebase legado quando necessário para não ampliar a mudança além da demonstração.

## Fora de escopo

- Alterar schema, políticas, OAuth, e-mail ou dados já hospedados no Supabase.
- Remover prévias funcionais de comunicado/importação.
- Alterar a personagem ou as respostas da Mae Oba.
- Fazer deploy ou enviar o repositório ao GitHub antes de revisar o conteúdo e confirmar o destino/visibilidade.

## Validação

- Testes devem provar que não há login/rota de demonstração nem seed automático de dados fictícios.
- Fluxos Supabase e Firebase existentes devem continuar cobertos pelos testes relevantes.
- Build de produção, suíte de frontend e backend devem passar.
- Busca final no código/docs deve encontrar apenas usos de “preview/prévia” que sejam ferramentas de produto ou referências históricas claramente identificadas.
- Revisar `git status`, arquivos ignorados e conteúdo versionável para detectar credenciais antes da publicação.

## Revisão da especificação

- O escopo exclui prévias reais de conteúdo e mantém a FAQ utilizada pela Mae Oba.
- A inicialização da aplicação não usa SQLite. O adapter SQLite pode permanecer isolado nos testes de contrato da API, sem lógica de sessão ou seed demonstrativo.
- Nenhuma mudança em banco remoto, deploy ou publicação é necessária para concluir a remoção local.
