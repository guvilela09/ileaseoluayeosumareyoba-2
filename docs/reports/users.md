# Administração de usuários

`src/features/users.js` mostra cadastros somente a administradores aprovados, com busca por nome/e-mail, filtro de situação, contagem de pendências, foto, perfil e presença. O botão Atualizar consulta `GET /api/users` e a presença RTDB quando disponível. Na prévia, a indicação online vem do heartbeat calculado pelo servidor; no Firebase, uma falha de leitura é mostrada como presença indisponível.

O modal edita situação e perfil por `PATCH /api/users/{id}`. Promoção e bloqueio pedem confirmação; conflitos como a proteção do último administrador são exibidos no próprio modal pela API. A recuperação chama `POST /api/users/{id}/password-reset` e informa claramente que a prévia não envia e-mail.

Não há criação administrativa de contas nesta tela; novos cadastros seguem o fluxo de registro e aprovação.
