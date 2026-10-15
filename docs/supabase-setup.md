# Configuração do Supabase

Este guia prepara a integração do portal. A configuração local não aplica migrations ao projeto remoto nem publica o site.

## 1. Conferir o provedor Google

Em **Authentication → Sign In / Providers → Google**, mantenha o provedor habilitado e deixe **Skip nonce checks** desligado. Copie o callback mostrado pelo Supabase e cadastre-o no cliente OAuth do Google Cloud em **Authorized redirect URIs**. No Supabase, adicione o domínio de desenvolvimento e o domínio Vercel em **Authentication → URL Configuration → Redirect URLs**, por exemplo `http://localhost:5173/` e `https://SEU-DOMINIO.vercel.app/`.

## 2. Aplicar o banco

O schema e as políticas estão em `supabase/migrations/202610140001_portal_schema.sql`; os testes de regras ficam em `supabase/tests/portal_rls.test.sql`. Aplique a migration ao projeto Supabase somente após conferir o projeto ativo no SQL Editor. O bucket de arquivos privados `portal-private` é criado pela migration. Em **Realtime → Settings**, desative **Allow public access** para que as regras do canal privado de presença sejam aplicadas.

O banco deve usar a senha real do projeto na URI de conexão. Não compartilhe essa senha; se ela já apareceu em conversa, redefina-a no Supabase antes de continuar. Use a URI **Transaction pooler** para a aplicação e para o bootstrap do primeiro administrador.

## 3. Variáveis privadas

Crie `.env.local` a partir de `.env.example` e preencha:

- `APP_MODE=supabase`
- `SUPABASE_URL` e `SUPABASE_PUBLISHABLE_KEY` do projeto
- `SUPABASE_SECRET_KEY` para Storage privado do backend
- `SUPABASE_DB_URL` com a URI do Transaction pooler e a senha real
- `RESEND_API_KEY` e `RESEND_FROM_EMAIL` de um remetente verificado no Resend
- `SUPABASE_AUTH_REDIRECT_URLS` com a lista exata de destinos aceitos, separados por vírgulas
- `SUPABASE_PASSWORD_RESET_REDIRECT_URL` com o destino exato da redefinição de senha (inclua também esse valor na allowlist acima)

Não use a chave `secret`/`service_role` no navegador ou em variáveis `VITE_*`. A aplicação só entrega ao navegador URL e chave publicável.

## 4. Criar o primeiro administrador

Com o schema aplicado, a senha real do banco e o login Google configurados, inicie a API em um terminal e a interface em outro:

```powershell
node scripts/python.mjs -m uvicorn backend.app:app --host 127.0.0.1 --port 8000
npm run dev
```

Abra `http://localhost:5173/`, solicite acesso e entre com a conta Google. O cadastro inicial fica pendente. Depois que as dependências Python estiverem instaladas, confira a conta e promova apenas o e-mail Google verificado que você controla:

```powershell
python scripts/bootstrap_supabase_admin.py --project-ref xjnkfealkybuwebfiihf --email SEU_EMAIL_GOOGLE --dry-run
python scripts/bootstrap_supabase_admin.py --project-ref xjnkfealkybuwebfiihf --email SEU_EMAIL_GOOGLE
```

O comando só funciona se ainda não existir outro administrador aprovado. Ele não imprime nem recebe a senha do banco pela linha de comando; lê `SUPABASE_DB_URL` de `.env.local`.

Depois da promoção, cadastre os nomes base fornecidos para os 21 orixás:

```powershell
python scripts/seed_supabase_orixas.py --project-ref xjnkfealkybuwebfiihf --admin-id UID_DA_CONTA
```

Descrições, fotos, integrantes, textos e músicas continuam vazios até o administrador inserir os conteúdos reais.

## 5. Rodar e publicar

Instale as dependências e gere a interface conforme o README. Não há modo de demonstração ou contas locais: para testar a aplicação completa, use um ambiente de desenvolvimento da Vercel conectado ao Supabase. Para a API, instale `requirements.txt`. No projeto Vercel, configure `APP_MODE=supabase` e as variáveis Supabase (sem expor `SUPABASE_SECRET_KEY` ou `SUPABASE_DB_URL` ao frontend); faça um deploy de preview da Vercel e valide login Google, aprovação, leitura e escrita antes de promover para produção.

O banco Firebase não é removido nem modificado por esta migração. A recuperação administrativa pode enviar um link pelo Resend quando as três variáveis de e-mail e o banco estiverem configurados. O envio de comunicados ainda depende de completar o processamento durável da fila; por enquanto, não trate o status `queued` como e-mail entregue.
