"""Insert the 21 user-provided Orixá names into the configured Supabase project."""
import argparse
import os
import re
import sys
import uuid
from pathlib import Path
from urllib.parse import urlsplit

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]


def main(argv=None):
    load_dotenv(ROOT / '.env.local', override=False)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project-ref', required=True, help='Referência exata do projeto Supabase.')
    parser.add_argument('--admin-id', required=True, help='UID da conta aprovada como administradora.')
    args = parser.parse_args(argv)
    project_ref = args.project_ref.strip().lower()
    if not re.fullmatch(r'[a-z0-9-]{5,50}', project_ref):
        parser.error('Referência do projeto inválida.')
    try:
        uuid.UUID(args.admin_id)
        host = urlsplit(os.environ.get('SUPABASE_URL', '')).hostname
    except ValueError:
        parser.error('--admin-id precisa ser um UID UUID válido.')
    if host != f'{project_ref}.supabase.co':
        parser.error('--project-ref não corresponde a SUPABASE_URL.')
    try:
        from backend.seed import seed_cultural
        from backend.supabase_store import SupabaseStore
        store = SupabaseStore()
        actor = store.atomic(lambda tx: tx.get('users', args.admin_id))
        if not actor or actor.get('role') != 'admin' or actor.get('status') != 'approved' or actor.get('archived'):
            raise ValueError('O UID informado não pertence a um administrador aprovado e ativo.')
        count = seed_cultural(store, actor_id=args.admin_id)
    except Exception as error:
        if isinstance(error, ValueError) and str(error).startswith('O UID informado'):
            print(str(error), file=sys.stderr)
        else:
            print('Falha ao cadastrar os nomes. Confira as variáveis, o schema e o banco do Supabase.', file=sys.stderr)
        return 1
    print(f'{count} nomes cadastrados; descrições existentes foram preservadas.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
