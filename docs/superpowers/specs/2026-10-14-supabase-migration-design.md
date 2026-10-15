# Migração do portal Ilé Asé para Supabase

## Objetivo

Substituir Firebase como plataforma principal do portal por Supabase, preservando o visual e os fluxos existentes, mantendo a hospedagem planejada na Vercel e permitindo até 70 pessoas usarem o sistema. O projeto Firebase existente permanece intacto durante e após a migração.

## Decisões aprovadas

- Supabase será a plataforma de autenticação, banco PostgreSQL, arquivos e presença em tempo real.
- A Vercel continuará hospedando o frontend e a API Python.
- Mae Oba continuará implementada em Python.
- A migração acontecerá antes do cadastro de conteúdo real, portanto não há dados de produção a importar.
- Não apagar nem alterar o projeto Firebase existente.
- O projeto Supabase atual está no plano Free e sem tabelas.
- O público esperado é de no máximo 70 pessoas.

## Abordagens avaliadas

1. Usar Supabase para Auth, PostgreSQL, Storage e Realtime, mantendo a API FastAPI como camada de negócio. Recomendado porque preserva a validação centralizada já existente e permite migrar o adaptador de persistência sem expor credenciais privilegiadas no navegador.
2. Acessar as tabelas diretamente do navegador com políticas RLS para toda a lógica. Isso reduz o backend, mas exigiria deslocar e reimplementar transações e fluxos administrativos do serviço Python.
3. Dividir responsabilidades entre Firebase e Supabase. Isso evita uma migração completa no curto prazo, mas mantém autenticação, perfis, dados e regras duplicadas; não é escolhido.

## Arquitetura proposta

O frontend usa `supabase-js` para autenticação e envia o access token Supabase à API FastAPI. A API valida o token, carrega o perfil aprovado e aplica as regras de membro/administrador; acessa PostgreSQL e Storage com segredo de servidor guardado apenas na Vercel ou em variáveis locais ignoradas pelo Git. Segredos nunca aparecem em variáveis `VITE_*` nem no bundle do navegador.

PostgreSQL substitui as coleções `users`, `announcements`, `events`, `lists`, `listProgress`, `orixas`, `members`, `settings`, outboxes e tarefas correspondentes por tabelas relacionais e JSONB apenas onde o conteúdo rico exige flexibilidade. A API continua responsável por validar campos, impedir que usuários promovam a si próprios, preservar o último administrador e registrar progresso individual das listas. RLS será ativada para todas as tabelas expostas; operações da chave de serviço serão restritas à API e só poderão ser chamadas após autenticação e autorização explícitas.

Supabase Auth fará login Google e e-mail/senha. O papel e estado de acesso ficam em perfil protegido do lado do servidor, sem usar `user_metadata` editável pelo usuário para decisões de autorização. O cadastro inicial continua pendente até aprovação administrativa; o primeiro administrador é provisionado por procedimento seguro de bootstrap.

Supabase Storage terá buckets privados para fotos e arquivos importados. O acesso a imagens seguirá a autorização atual do portal; importações continuarão limitadas por formato e tamanho e terão expiração. Realtime Presence substituirá Realtime Database para indicador online, sem compartilhar credenciais de Firebase.

O envio de comunicados e recuperação administrativa por e-mail manterá o provedor transacional Resend, com outbox durável e idempotência adaptadas a funções Supabase ou a um worker seguro. E-mails de autenticação do Supabase usarão SMTP configurado separadamente. Não será prometida entrega em caixa postal apenas porque o provedor aceitou uma solicitação.

## Plano Free e limite de uso

As cotas oficiais consultadas listam até 50.000 usuários ativos mensais, 500 MB de banco por projeto, 1 GB de arquivos e 10 GB de tráfego combinado (5 GB em cache e 5 GB sem cache). Assim, 70 contas ficam bem abaixo da cota de usuários ativos, mas imagens, documentos, leituras e tráfego precisam ser monitorados. Projetos Free com pouca atividade de banco por sete dias podem ser pausados automaticamente; ao receber uso real recorrente, avaliar atividade, cotas e a necessidade de plano pago. Não habilitar plano pago sem decisão explícita do usuário.

Referências oficiais: [planos e cotas Supabase](https://supabase.com/docs/guides/platform/billing-on-supabase), [tráfego de Storage](https://supabase.com/docs/guides/storage/serving/bandwidth), [pausa por inatividade](https://supabase.com/docs/guides/platform/free-project-pausing).

## Domínios funcionais

- Autenticação: login Google, e-mail/senha, confirmação de e-mail, recuperação de senha e sessão.
- Perfis e presença: aprovação, bloqueio, papel administrador/membro, preferências pessoais e presença online.
- Conteúdo: comunicados formatados e publicados, agenda, listas e progresso por usuário, Orixás, integrantes, localização e homenagem.
- Arquivos: fotos privadas e importações DOCX, XLSX e PDF com validação de conteúdo, limite e expiração.
- E-mail: campanha para comunicados publicados e solicitação administrativa de recuperação de acesso.
- Mae Oba: interface e comportamento em Python preservados; respostas continuam documentadas e funcionais sem fornecer ações privilegiadas ao bot.

## Segurança e privacidade

- Validar JWT no servidor e consultar sempre o perfil atual antes de autorizar operações privilegiadas.
- Nunca confiar em `user_metadata` para papel, aprovação ou bloqueio.
- Habilitar RLS em tabelas acessíveis pelo Data API e políticas restritas por perfil e propriedade.
- Nunca expor `service_role`/secret key no cliente; usar publishable key somente com RLS.
- Buckets privados; não tornar fotos e importações públicas por conveniência.
- Segredos Resend e do Supabase são armazenados somente em secrets de servidor.
- Não copiar dados nem apagar recursos no Firebase durante a migração.

## Estratégia de entrega

Entregar em etapas verificáveis: primeiro schema/migrações e testes de segurança; depois cliente Supabase Auth e sessão; em seguida persistência PostgreSQL e API; depois Storage/Presence; por fim e-mail, configuração Vercel e validação ponta a ponta. A aplicação local continua oferecendo prévia de demonstração até que configuração real esteja completa. O domínio de produção só será considerado pronto após login Google, aprovação, leitura/escrita por papel, progresso de lista, uploads privados, presença, recuperação de senha e e-mail de comunicado serem validados com o projeto Supabase real.

## Critérios de aceite

1. Build de produção funciona e a prévia local continua disponível.
2. Usuário consegue entrar com Google no domínio local e no domínio autorizado da Vercel.
3. Conta nova permanece pendente até aprovação; usuário comum não acessa rotas administrativas nem altera seu próprio papel.
4. Administrador pode publicar comunicados, criar eventos e listas e editar conteúdos; os registros persistem no PostgreSQL após novo login.
5. Usuários comuns veem o conteúdo permitido, marcam itens, concluem lista e só alteram seu próprio progresso.
6. Uploads privados e fotos respeitam autorização; importações expiram conforme regra do sistema.
7. Estado online reflete conexões em tempo real e desconexões limpam somente a conexão correspondente.
8. E-mail de publicação e recuperação usa destinatários elegíveis, não revela listas de e-mails e registra aceite/falha do provedor.
9. Testes cobrem políticas RLS, privilégios, validação da API e os fluxos ponta a ponta sem acesso acidental ao Firebase de produção.
10. Configuração de servidor não contém credenciais privadas em arquivos versionados ou no bundle do frontend.
