# Ilé Asé Oluaye Osumare Yoba — plano do sistema

Decisões confirmadas com o usuário em 13/10/2026. Este documento substitui o plano anterior quanto à assistente: a personagem fornecida já deve integrar a primeira versão com animação e ajuda em Python. Nome confirmado posteriormente: **Mae Oba**. O estado atual de implementação e os itens que dependem de contas externas estão em `docs/implementation-progress.md`.

## Objetivo e apresentação

Sistema reservado aos membros aprovados do terreiro, responsivo para celular, tablet, notebook e computador. HTML, CSS e JavaScript modular com Vite; backend Python/FastAPI na Vercel; Firebase para autenticação, dados e arquivos. Visual acolhedor e elegante com branco quente, laranja, preto e cobre, preservando a logo. Menu lateral no computador, recolhível no tablet e expansível no celular. Formulários de criação e edição em modais com margens visíveis e rolagem interna.

Nome confirmado: **Ilé Asé Oluaye Osumare Yoba**. Login com Google ou e-mail/senha. Novos cadastros aguardam aprovação administrativa. Dois perfis: administrador e usuário normal.

## Telas e permissões

Ordem: Dashboard; Lista Bori & Ebó; Agenda; Comunicados; Itáns e Orixás; Localização; Quem somos nós; Ilé Asé; Usuários; Configurações. Agenda, Comunicados e Usuários são abas administrativas; membros consultam comunicados e eventos no dashboard. Botões + e canetinha são exclusivos dos administradores.

- **Dashboard:** comunicados, calendário mensal e próximos eventos.
- **Agenda:** administrador gerencia título, descrição, data e horário; fuso America/Sao_Paulo.
- **Comunicados:** classificação Importante, Menos importante ou Normal antes do editor. Quill com fontes, tamanho e cor controlados, validado no servidor. Publicar atualiza dashboard e envia e-mail aos aprovados que habilitaram notificações; editar não reenvia automaticamente.
- **Lista Bori & Ebó:** listas com checkbox à esquerda. Progresso particular, salvo por usuário e sincronizado entre aparelhos. Concluir só aparece quando todos os itens estão marcados; exibe apenas ✅ e “Função Concluir”, conservando o estado pessoal, sem avisos, tarefas ou notificações. Reiniciar limpa o próprio progresso. IDs estáveis; itens novos ou com conteúdo alterado ficam desmarcados; removidos não contam na conclusão.
- **Importação:** administrador usa modal para DOCX, XLSX ou PDF textual, revisa candidatos, adiciona/remove/edita itens e confirma. Excel permite escolher aba e colunas. PDF escaneado/sem texto explica a limitação e oferece inserção manual. Upload máximo inicial de 10 MB por documento.
- **Itáns e Orixás:** cartões verticais espaçados com imagem alternando esquerda/direita; celular empilha imagem e texto. Detalhe com leitura e música. Administrador adiciona/edita nome, descrição, foto e link Spotify em modal.
- **Ilé Asé:** mesmo padrão dos cartões de orixás para integrantes, com nome, texto, foto e música; cadastro editorial independente das contas de acesso.
- **Spotify:** Embed oficial no detalhe; tentativa de iniciar após o clique de abertura, botão Reproduzir disponível quando necessário; parar ao fechar/trocar. Não prometer autoplay universal nem exigir SDK Premium nesta versão.
- **Localização:** endereço, mapa incorporado Google Maps, foto frontal e abrir trajeto; configuração administrativa. Sem endereço fictício enquanto material não for fornecido.
- **Quem somos nós:** somente quadrado centralizado para imagem da homenageada inicialmente. A composição de textos e imagens será implementada com o material futuro do usuário, sem editor administrativo de imagens no texto nesta etapa.
- **Usuários:** administrador aprova/bloqueia, promove/rebaixa, solicita recuperação de senha, vê foto e presença verde/cinza. Impedir rebaixar/bloquear o último administrador ativo.
- **Configurações:** abas horizontais Perfil, Aparência, Notificações e Acessibilidade. Nome/foto/senha própria; tema claro/escuro/automático; acentos laranja/cobre/terracota com contraste; preferência de e-mails; tamanho de texto e redução de movimento. Senha Google gerenciada pelo Google.

## Orixás iniciais

Preservar nomes, grafias e aliases fornecidos pelo usuário, nesta ordem. Administradores poderão corrigi-los por modal. Conteúdo religioso e fotos não serão inventados.

1. Lọ́gún ẹ̀dẹ́ (Logunedé)
2. Ọba (Obá)
3. Yẹwá / Yewá (Ewá)
4. Òsanyìn (Ossain — senhor das folhas)
5. Olókun (Olokun — divindade do mar profundo)
6. Ibeji (Ibeji — os gêmeos divinos)
7. Ọ̀rúnmìlà (Orunmilá — destino e oráculo de Ifá)
8. Ọ̀ṣàgìiyàn (Oxaguiã — Oxalá jovem)
9. Ọ̀ṣàlúfọ̀n (Oxalufã — Oxalá velho)
10. Olódùmarè / Ọlọ́run (Olodumare / Olorun)
11. Èṣù (Exu)
12. Ògún (Ogum)
13. Odè (Oxóssi)
14. Ṣàngó (Xangô)
15. Ayrà (Airá)
16. Yansan / Ọya (Iansã / Oiá)
17. Ọ̀ṣun (Oxum)
18. Yemojá / Yẹmọjá (Iemanjá)
19. Nàná (Nanã)
20. Omolu / Ọbàlúwáyè (Omulu / Obaluaê)
21. Òṣùmàrè (Oxumarê)

## Assistente animada — atualização solicitada

Referência: Avatar Ilustrado com Coroa Dourada.png, fornecido pelo usuário. Preservar rosto, pele, roupas, coroa, acessórios e cores. A primeira versão terá olhos abrindo/piscando e movimento suave do retrato; não se trata de animação articulada de braços ou fala sincronizada.

Os assets de olhos abertos e fechados estão em public/assets/assistant. A animação usa CSS com máscara sobre as pálpebras, ciclo de piscadas de 7 segundos e movimento sutil de 5,6 segundos. Honrar prefers-reduced-motion e oferecer pausa manual. Botão no canto inferior direito, sem bloquear ações principais; painel de conversa recolhível, responsivo, acessível por teclado e fechável por Escape.

Foi preparado o módulo independente assistant-preview para conferir personagem, animação e FAQ antes de implementar o portal. Ajuda determinística em Python, sem provedor de IA, busca nas orientações aprovadas sobre navegação, listas, acesso e configurações. Quando desconhecer a resposta, explicar sua limitação sem inventar. A prévia usa servidor exclusivamente local; na aplicação final, migrar o endpoint para FastAPI na Vercel e exigir autenticação e aprovação Firebase. Não executar ações administrativas pela assistente.

Fluxo HTTP: POST /api/assistant/query, JSON com question; resposta com answer. A personagem é a interface; Python responde a cada requisição, sem daemon eterno na Vercel. A prévia não autentica usuários nem acessa dados reais do terreiro.

## Dados e integração

- Firebase Authentication: Google e e-mail/senha, verificação de e-mail, recuperação e vinculação segura de provedores.
- Firestore: usuários/aprovação, comunicados, eventos, listas, progresso particular, orixás, integrantes e configurações.
- Storage: fotos e arquivos temporários; upload direto. Exige Blaze com faturamento habilitado.
- Realtime Database: presença por conexão, incluindo múltiplas abas/dispositivos; consulta restrita aos administradores.
- Backend e Security Rules verificam aprovação e perfil; usuários não alteram aprovação ou privilégios.
- Primeiro administrador promovido por UID confirmado em operação única privilegiada; nunca por ser o primeiro cadastro.
- Resend com domínio verificado para e-mails. Funções Python Firebase e Cloud Tasks distribuem envios, retentativas e controle de duplicação; guardar resultados para consulta administrativa.
- Importadores: python-docx, openpyxl e pypdf. Validar formatos, tamanho e conteúdo.
- Segredos somente no servidor. Configurar alertas de orçamento e limites operacionais; cotas gratuitas não garantem custo zero.

## Sequência e aceitação

1. Conferir e integrar a assistente animada já preparada.
2. Implementar autenticação/aprovação/permissões e estrutura responsiva.
3. Dashboard, agenda, comunicados e cadastros editoriais.
4. Listas e importação com progresso por usuário.
5. Spotify, páginas da casa, configurações e presença.
6. E-mails e integração da ajuda com sessão Firebase; prévia Vercel antes da publicação.

Verificar larguras 360/768/1024/1440, teclado/foco/modais, caracteres iorubás, temas e redução de movimento. Testar login e recuperação pelos provedores, aprovação/bloqueio, API/regras contra alteração indevida de privilégios e proteção do último administrador. Testar checklist independente/sincronização/reinício/edição/conclusão, importações válidas e inválidas, múltiplas abas de presença, falhas e duplicação de e-mails, autoplay bloqueado e FAQ conhecida/desconhecida.

Usar emuladores Firebase para permissões e prévia Vercel para integração. Publicação real depende das contas/credenciais, domínio Resend verificado e UID confirmado do primeiro administrador. Fotos, endereço, textos e músicas ainda não fornecidos permanecem em espaços de preenchimento identificados.

## Referências técnicas verificadas

- https://firebase.google.com/docs/auth/admin/custom-claims
- https://firebase.google.com/docs/firestore/solutions/presence
- https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024
- https://firebase.google.com/docs/functions/task-functions
- https://developer.spotify.com/documentation/embeds/references/iframe-api
- https://vercel.com/docs/functions/runtimes/python
- https://resend.com/docs/send-with-python
