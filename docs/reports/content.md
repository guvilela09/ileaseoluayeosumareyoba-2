# Módulos de conteúdo

Implementados `dashboard.js`, `announcements.js`, `agenda.js` e `content.css` conforme `docs/implementation-contract.md`.

- Dashboard: saudação com o primeiro nome disponível, comunicados publicados ordenados por prioridade, calendário mensal navegável com marcadores de eventos, próximos eventos filtrados pela data atual em `America/Sao_Paulo`.
- Comunicados: lista de rascunhos e publicados para admin, somente publicados para membro; criação/edição em modal com classificação antes do editor Quill; prévia; publicação explícita pelo endpoint dedicado; aviso exato para estados de e-mail `queued`, `preview` e `already-published`; arquivamento. A edição nunca invoca publicação.
- Agenda: visualização de próximos e anteriores, com criação/edição/arquivamento administrativo por modal. Datas e horários são lidos como valores locais de São Paulo, sem conversão UTC no formulário.
- CSS restrito a classes `content-*`, reutilizando tokens globais; layout responsivo, estados de foco e preferência por movimento reduzido.

Dependências do shell: `ctx.ui` deve fornecer `escape`, `icon`, `empty`, `rich`, `editor`, `openModal`, `confirm`, `toast` conforme contrato; `ctx.refresh()` recarrega os dados depois de writes. O modal deve remover seu elemento do DOM no fechamento para o editor Quill ser destruído pelo observador. Cada módulo importa `content.css` diretamente.

Verificação executada: `node --check` nos três módulos JavaScript, todos com saída 0. A integração visual e as operações HTTP dependem do shell e backend em desenvolvimento, portanto ficam para o teste integrado do agente principal.
