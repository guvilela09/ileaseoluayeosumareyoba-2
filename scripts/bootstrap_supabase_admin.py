"""Safely provision the first approved Supabase administrator by verified email."""
import argparse
import os
import re
import sys
from pathlib import Path
from urllib.parse import urlsplit

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
PROJECT_REF_PATTERN = re.compile(r'^[a-z0-9-]{5,50}$')


class BootstrapError(ValueError):
    pass


def _configuration(project_ref, env):
    project_ref = project_ref.strip().lower() if isinstance(project_ref, str) else ''
    if not PROJECT_REF_PATTERN.fullmatch(project_ref):
        raise BootstrapError('Informe a referência válida do projeto Supabase.')
    supabase_url = env.get('SUPABASE_URL', '').strip()
    database_url = env.get('SUPABASE_DB_URL', '').strip()
    if '[YOUR-PASSWORD]' in database_url:
        raise BootstrapError('Configure SUPABASE_DB_URL no .env.local com a senha real do banco.')
    try:
        app_host = urlsplit(supabase_url).hostname
        database = urlsplit(database_url)
    except ValueError as error:
        raise BootstrapError('As URLs Supabase estão inválidas.') from error
    if app_host != f'{project_ref}.supabase.co':
        raise BootstrapError('A referência informada não corresponde ao projeto em SUPABASE_URL.')
    if not database_url or not database.hostname or not database.username:
        raise BootstrapError('Configure SUPABASE_DB_URL no .env.local.')
    if database.username != f'postgres.{project_ref}':
        raise BootstrapError('SUPABASE_DB_URL deve usar o pooler do projeto selecionado.')
    if database.port != 6543:
        raise BootstrapError('Use a URI Transaction pooler (porta 6543) em SUPABASE_DB_URL.')
    return database_url


def bootstrap_admin(email, project_ref, *, env=None, connect=None, dry_run=False):
    env = os.environ if env is None else env
    email = email.strip().lower() if isinstance(email, str) else ''
    if not email or len(email) > 320 or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
        raise BootstrapError('Informe o e-mail Google verificado da conta que acabou de entrar no portal.')
    database_url = _configuration(project_ref, env)
    if connect is None:
        import psycopg
        connect = psycopg.connect

    connection = connect(database_url, connect_timeout=15, sslmode='require', prepare_threshold=None)
    try:
        with connection.cursor() as cursor:
            cursor.execute("select pg_advisory_xact_lock(hashtextextended('portal-approved-admins', 0))")
            cursor.execute("""
                select count(*) from public.profiles
                where role = 'admin' and status = 'approved' and not archived
            """)
            if cursor.fetchone()[0]:
                raise BootstrapError('Já existe um administrador aprovado; o bootstrap inicial foi encerrado.')

            cursor.execute("""
                select u.id::text, u.email, u.email_confirmed_at, u.raw_app_meta_data
                from auth.users u
                join public.profiles p on p.id = u.id
                where lower(u.email) = %s and not p.archived
                for update of p
            """, (email,))
            user = cursor.fetchone()
            if not user:
                raise BootstrapError('Nenhuma conta ativa foi encontrada com esse e-mail. Entre primeiro com Google.')
            user_id, stored_email, email_confirmed_at, app_metadata = user
            app_metadata = app_metadata if isinstance(app_metadata, dict) else {}
            providers = app_metadata.get('providers', [])
            provider = app_metadata.get('provider')
            if email_confirmed_at is None or not (provider == 'google' or 'google' in providers):
                raise BootstrapError('A conta precisa ter e-mail verificado e ter entrado com Google.')

            if not dry_run:
                cursor.execute("""
                    update public.profiles
                    set role = 'admin', status = 'approved', email = %s, updated_at = now()
                    where id = %s::uuid and not archived
                """, (stored_email, user_id))
                if cursor.rowcount != 1:
                    raise BootstrapError('O perfil não pôde ser promovido; nenhuma alteração foi confirmada.')

        if dry_run:
            connection.rollback()
        else:
            connection.commit()
        return {'id': user_id, 'email': stored_email, 'status': 'approved' if not dry_run else 'dry-run', 'role': 'admin'}
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def main(argv=None):
    load_dotenv(ROOT / '.env.local', override=False)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project-ref', required=True, help='Referência do projeto, validada contra SUPABASE_URL.')
    parser.add_argument('--email', required=True, help='E-mail Google verificado da conta recém-cadastrada.')
    parser.add_argument('--dry-run', action='store_true', help='Valida a conta e a configuração sem promover o perfil.')
    args = parser.parse_args(argv)
    try:
        result = bootstrap_admin(args.email, args.project_ref, dry_run=args.dry_run)
    except BootstrapError as error:
        print(str(error), file=sys.stderr)
        return 1
    except Exception:
        print('Falha ao conectar ou atualizar o perfil. Confira as variáveis locais e tente novamente.', file=sys.stderr)
        return 1
    action = 'verificada (dry-run)' if args.dry_run else 'promovida'
    print(f"Conta {result['email']} {action} como administradora aprovada. UID: {result['id']}")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
