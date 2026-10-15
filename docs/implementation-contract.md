# Contrato de implementação — portal Ilé Asé

Plano de produto: docs/plano-do-sistema.md. Atualização: a assistente pisca naturalmente e sorri ao abrir a conversa ou responder. Trabalho no checkout atual: repositório novo, sem HEAD nem alterações de terceiros; não é possível criar worktree a partir de um commit inexistente. Nenhuma publicação ou ativação de faturamento nesta implementação.

## Estrutura e responsabilidades

Root: shell/router, src/app.js, src/styles.css, src/lib/{api,ui}.js, package/Vite/configuração Vercel, integração/QA.
Backend: backend/{app,store,auth,models,seed}.py e testes backend; API FastAPI, Supabase principal e adaptador Firebase legado. SQLite não é um modo de aplicação.
Importador: backend/importers.py e tests/test_importers.py.
Conteúdo: src/features/{dashboard,announcements,agenda}.js e content.css.
Listas: src/features/lists.js e lists.css.
Cultura: src/features/{culture,location,about}.js e culture.css.
Firebase: src/lib/auth.js, firebase/, functions/, scripts/bootstrap_admin.py.
Root implementa Usuários, Configurações e assistente.

## Frontend compartilhado

Cada módulo exporta `async function render(container, ctx)`. Não escreve shell/global CSS. ctx: `{user, state, api, ui, auth, navigate, refresh}`. user: `{id,name,email,role:'admin'|'member',status:'approved'|'pending'|'blocked',photoUrl,preferences}`. state: `{mode, announcements,events,lists,progress,orixas,members,site,users?}`. users somente admin. progress é mapa listId -> `{checked:[itemId],completed:boolean,versions:{itemId:version}}`.

`api(path,{method='GET',body}={})` envia Bearer e JSON, resolve JSON ou lança Error com mensagem portuguesa. Caminho inclui /api. `api.upload(file,kind)` resolve `{path,url,filename}`. ui: `escape(text)`, `icon(name)`, `toast(message,type='success')`, `empty(title,description,actionHtml='')`, `openModal({title,body,onSubmit,submitLabel='Salvar',wide=false})` retorna `{element,close}`. onSubmit recebe `(form, modal)`; cancelar via close; corpo é HTML de form sem o próprio form, um botão de salvar já é incluído; seletor `modal.element.querySelector(...)`. ui.editor(element,initialDelta?) retorna `{getValue(),destroy()}`; ui.rich(delta) retorna HTML sanitizado; ui.confirm(message) Promise<boolean>. `ctx.refresh()` recarrega bootstrap e renderiza rota atual. `ctx.navigate('lists/id')` altera hash #/lists/id; Dashboard='dashboard', Agenda='agenda', Comunicados='announcements', Cultura='orixas'/'members', Local='location', Homenagem='about', Usuários='users', Config='settings'. Detalhes cultura podem usar modal de leitura; módulos podem ler `ctx.route` (array de segmentos da rota atual).

Tokens CSS globais: --bg,--surface,--surface-2,--text,--muted,--accent,--accent-soft,--line,--success,--danger,--serif,--sans. Classes comuns page-heading, page-kicker, page-title, page-description, btn, btn-primary, btn-secondary, btn-icon, card, form-field, field-grid, empty-state, badge, loading. Fontes Noto Sans/Noto Serif, fallbacks system-ui/Georgia. SVG ícones por ui.icon(name): plus,edit,calendar,check,arrow,upload,trash,search,user,bell,close,location,music,settings,home,list,book,users,logout,mail,chevron,menu.

## Dados e API

GET /api/config -> `{mode:'supabase'|'firebase',configured:boolean,supabase:{url,publishableKey}|firebase:{apiKey,authDomain,projectId,storageBucket,appId,messagingSenderId,databaseURL}}`. Sem segredos. Valores de `APP_MODE` desconhecidos, incluindo `preview`, usam Supabase; nunca criam armazenamento local nem dados de demonstração.
GET /api/session -> `{user}` autenticado; novos Firebase UIDs registrados como pending, nunca admin. GET /api/bootstrap -> state; exige approved e retorna users apenas admin. Todos endpoints conferem aprovação/perfil atuais no servidor. Firebase tokens verificados com revogação; privileges server-only, usuário não muda próprios privilégios. Produção sem configuração falha fechada com 503.

CRUD GET/POST /api/{announcements,events,lists,orixas,members}, PATCH/DELETE /api/{collection}/{id}; writes admin-only, DELETE arquiva. POST/PATCH retornam documento. Todos documentos têm id,createdAt,updatedAt e archived=false. Bootstrap exclui archived.

announcement: `{id,title,priority:'important'|'normal'|'less',content:{ops:[...]},published:boolean,publishedAt?}`. Quill Delta textual somente, formatos font,size,color,bold,italic,underline,lista. Normal lê somente published. POST /api/announcements/{id}/publish marca published e enfileira mailCampaigns/{id} uma única vez; edição não reenfileira. Resposta `{announcement,emailStatus:'queued'|'already-published'}`.
event: `{id,title,description,date:'YYYY-MM-DD',time:'HH:mm',location?}`. Fuso America/Sao_Paulo.
list: `{id,title,description,items:[{id,text,version:int}]}`. IDs estáveis, edição textual incrementa version. Salvar 1..1000 itens não vazios, título obrigatório. Mudanças em versão invalidam marcação correspondente. PATCH /api/progress/{listId} `{itemId,checked:boolean}` -> progresso; POST /api/progress/{listId}/complete -> progresso, rejeita lista vazia/incompleta; POST /api/progress/{listId}/reset -> progresso. UID vem do token; não aceitar UID de terceiro. Complete altera somente estado pessoal, sem outbox/notificação.
cultural: `{id,name,alias,description,imagePath?,imageUrl?,spotifyUrl?}` para orixas/members. Nome/alias Unicode preservados. Spotify somente links https://open.spotify.com/track/<id> ou /playlist/<id>, embed derivado do ID, nunca iframe HTML recebido do usuário.
site: `{address,mapUrl,photoPath?,photoUrl?}`; GET/PATCH /api/site (PATCH admin). mapUrl somente https Google Maps /maps/embed; sem iframe HTML arbitrário. About permanece quadrado centralizado sem gestão de texto.
GET /api/users admin; PATCH /api/users/{id} `{status?,role?}` protege último admin por transação; POST /api/users/{id}/password-reset nunca retorna link de reset ao navegador nem password.
PATCH /api/profile `{name?,photoPath?,preferences?}` -> `{user}`; preferências theme light/dark/system,accent orange/copper/terracotta,fontScale 1/1.1/1.2,reducedMotion boolean,emailNotifications boolean. Nomes de campos privilegiados rejeitados.
Presença Supabase é gerenciada por canais privados de conexão no cliente. O endpoint de heartbeat da antiga prévia local não existe.
POST /api/assistant/query `{question}` -> `{answer,suggestions?}`: ajuda somente ao usuário approved. Reutiliza FAQ prévia adaptada para dizer "No sistema". Sem LLM ou ações.

## Arquivos e importador

api.upload usa Supabase Storage privado em `uploads/{uid}/{uuid}-{filename}` e então chama POST /api/uploads/register `{path,filename,kind}`. Backend verifica prefixo UID, existência, tipo/tamanho. Imagem PNG/JPEG/WebP máximo5MB; doc DOCX/XLSX/PDF máximo10MB; objetos de importação privados e temporários, não publicar tokens permanentes para eles. URL de imagem é temporária e ownership metadata é server-side.
POST /api/imports/preview `{path,filename,sheet?,columns?:[int]}` -> `{items:[{text}],sheets:[string],columns:[{index,label}],warnings:[string]}`. Só admin. Extrair somente objeto pertencente ao UID. `extract_candidates(content:bytes,filename:str,sheet:str|None=None,columns:list[int]|None=None)` tem essa mesma saída. Primeira aba/primeira coluna como default; a prévia de importação permite escolher e revisar os candidatos. DOCX parágrafos e tabelas; PDF textual até100páginas, erro amigável se escaneado; XLSX valores em cache, sem executar fórmulas/macros. Revisão humana obrigatória; extração não cria lista. Limite1000itens, checar ZIP expandido para arquivos Office.

## Firebase/Functions

Coleções Firestore users,announcements,events,lists,orixas,members,site/config,progress/{uid}/lists/{listId},mailCampaigns,deliveryJobs. Role/status user doc source of truth + custom claims sincronizadas pelo servidor. Browser tem reads aprovados pertinentes; writes somente pelo backend. RTDB presence/{uid}/connections e serverMirror/approvedUsers para autorização imediata e admin para leitura global. Regras e bootstrap devem refletir schema real.
mailCampaigns/{announcementId}: `{announcementId,title,content,createdAt,status:'queued',requestedBy}`. Trigger Firestore distribui tasks por usuário aprovado com prefs.emailNotifications=true; worker idempotente Resend e entrega isolada por destinatário, sem revelar lista de e-mails. Secrets só server. Admin recovery também usa job server-only. Não instalar extensão Firebase descontinuada.

## Verificação e entrega

Testes significativos de autorização, pending/blocked, último admin, progresso isolado e revisão, arquivamento, publicação idempotente, importações e FAQ. Browser360/768/1024/1440, teclado/modais, temas, Spotify, avatar feliz por clique e piscadas. Build Vite e Python unittest. Não existem sessões nem seed de demonstração; produção exige configuração real. Sem inventar conteúdo religioso ou integrante real. Seed cultural só21nomes/aliases do plano, descrição vazia.
