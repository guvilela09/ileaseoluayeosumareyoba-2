# Ilé Asé Oluaye Osumare Yoba

Portal interno do terreiro para comunicados, agenda, listas, conteúdos culturais e materiais da casa. A interface usa português e adapta-se a celular, tablet e computador. O assistente Mae Oba responde dúvidas sobre o uso do sistema.

## Desenvolvimento e produção

Requisitos: Node.js 24 ou superior e Python 3.12 ou superior. Para instalar dependências e validar a compilação do frontend:

```powershell
npm ci
npm run build
```

O portal não possui contas, dados ou modo de demonstração. A API usa Supabase e exige configuração real do ambiente; sem as credenciais necessárias, o acesso fica indisponível. Para testar o sistema completo localmente, configure um ambiente de desenvolvimento da Vercel ligado ao projeto e use variáveis locais fora do controle de versão.

## Configuração

`.env.example` lista somente nomes de variáveis e está sem credenciais. Consulte o [guia de configuração do Supabase](docs/supabase-setup.md) para aplicar o schema, ajustar o login Google, cadastrar a primeira conta administradora e configurar a API na Vercel. O backend ainda mantém suporte legado Firebase, mas o frontend e o ambiente de produção usam Supabase.

Não coloque chaves privadas no frontend, no Git ou em mensagens. Não configure variáveis `VITE_*` com credenciais administrativas.
