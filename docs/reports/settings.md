# Configurações

Implementados `src/features/settings.js` e `settings.css` com abas horizontais Perfil, Aparência, Notificações e Acessibilidade; administradores também veem Integrações em modo somente leitura.

Perfil salva nome e foto por `api.upload(file, 'image')` seguido de `PATCH /api/profile`. Preferências preservam campos existentes e usam `PATCH /api/profile`, com retorno aplicado por `ctx.onUserUpdated`. Contas reais podem alterar senha com reautenticação via `ctx.auth.changePassword` ou solicitar recuperação por `ctx.auth.resetPassword`. A prévia avisa explicitamente que não envia e-mail nem altera senha.

As abas seguem o padrão ARIA de teclado com setas, Home e End. Os formulários apresentam feedback de sucesso e erro; os estados de integração consultam `/api/config` sem exibir valores de credenciais.

Também corrigido `dashboard.js`: membro e admin podem abrir comunicados completos, expandir todos os comunicados publicados, abrir detalhes de próximos eventos, expandir todos os próximos eventos e abrir os eventos de qualquer dia marcado no calendário. Essas ações são apenas de leitura.

Verificação local: `node --check src/features/settings.js` e `node --check src/features/dashboard.js`, ambos com código de saída 0. Integração visual e HTTP fica na validação conjunta do shell/backend.
