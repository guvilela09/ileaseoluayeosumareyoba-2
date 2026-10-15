"""Explicit first-admin bootstrap; never triggered by signup or web requests."""
import argparse
import os
from datetime import datetime, timezone
from firebase_admin import initialize_app, auth, firestore, db


def main():
    parser = argparse.ArgumentParser(description='Promover um UID existente e verificado a primeiro administrador.')
    parser.add_argument('--uid', required=True)
    parser.add_argument('--confirm-uid', required=True, help='Repita o UID após conferi-lo no Firebase Authentication')
    parser.add_argument('--project-id', required=True)
    parser.add_argument('--database-url', required=True)
    args = parser.parse_args()
    if args.uid != args.confirm_uid or not args.uid.strip():
        parser.error('O UID confirmado precisa ser idêntico ao UID selecionado.')
    if not args.database_url.startswith('https://'):
        parser.error('Use a URL HTTPS da Realtime Database deste projeto.')
    if os.environ.get('FIREBASE_AUTH_EMULATOR_HOST') or os.environ.get('FIRESTORE_EMULATOR_HOST'):
        parser.error('Remova variáveis de emulador antes do bootstrap real.')
    initialize_app(options={'projectId':args.project_id,'databaseURL':args.database_url})
    record = auth.get_user(args.uid)
    if record.disabled or not record.email_verified:
        parser.error('A conta deve estar ativa e com e-mail verificado.')
    store = firestore.client()
    ref = store.collection('users').document(args.uid)
    @firestore.transactional
    def promote(transaction):
        # Reading all admins ensures concurrent bootstraps conflict rather than choose two first admins.
        existing = list(store.collection('users').where(filter=firestore.FieldFilter('role','==','admin')).stream(transaction=transaction))
        if any(item.id != args.uid and item.to_dict().get('status') == 'approved' for item in existing):
            raise RuntimeError('Já existe administrador aprovado. Use a gestão de usuários do portal.')
        user = ref.get(transaction=transaction)
        if not user.exists:
            raise RuntimeError('Abra a sessão do portal uma vez para criar o perfil pendente antes do bootstrap.')
        transaction.update(ref, {'role':'admin','status':'approved','updatedAt':datetime.now(timezone.utc)})
    promote(store.transaction())
    # These services have no shared transaction; script is safe to repeat after a partial failure.
    claims = dict(record.custom_claims or {})
    claims.update({'role':'admin','approved':True})
    auth.set_custom_user_claims(args.uid, claims)
    db.reference(f'serverMirror/approvedUsers/{args.uid}').set({'approved':True,'admin':True})
    print('Administrador confirmado. Saia e entre novamente para atualizar as claims.')


if __name__ == '__main__':
    main()
