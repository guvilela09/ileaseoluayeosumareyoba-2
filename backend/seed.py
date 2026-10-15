"""User-supplied names; no generated religious descriptions or real members."""
import uuid
from .store import now

NAMES = [
    ('Lọ́gún ẹ̀dẹ́', 'Logunedé'), ('Ọba', 'Obá'), ('Yẹwá / Yewá', 'Ewá'),
    ('Òsanyìn', 'Ossain — senhor das folhas'), ('Olókun', 'Olokun — divindade do mar profundo'),
    ('Ibeji', 'Ibeji — os gêmeos divinos'), ('Ọ̀rúnmìlà', 'Orunmilá — destino e oráculo de Ifá'),
    ('Ọ̀ṣàgìiyàn', 'Oxaguiã — Oxalá jovem'), ('Ọ̀ṣàlúfọ̀n', 'Oxalufã — Oxalá velho'),
    ('Olódùmarè / Ọlọ́run', 'Olodumare / Olorun'), ('Èṣù', 'Exu'), ('Ògún', 'Ogum'),
    ('Odè', 'Oxóssi'), ('Ṣàngó', 'Xangô'), ('Ayrà', 'Airá'), ('Yansan / Ọya', 'Iansã / Oiá'),
    ('Ọ̀ṣun', 'Oxum'), ('Yemojá / Yẹmọjá', 'Iemanjá'), ('Nàná', 'Nanã'),
    ('Omolu / Ọbàlúwáyè', 'Omulu / Obaluaê'), ('Òṣùmàrè', 'Oxumarê'),
]


def seed_cultural(store, actor_id=None):
    """Create only missing fixed IDs; never overwrite administrator content."""
    supabase = store.__class__.__name__ == 'SupabaseStore'
    if supabase and not actor_id:
        raise ValueError('Informe o UID de um administrador aprovado para cadastrar os nomes base.')
    def seed(tx):
        timestamp = now()
        created = 0
        for index, (name, alias) in enumerate(NAMES, 1):
            key = str(uuid.uuid5(uuid.NAMESPACE_URL, f'https://ileaseoluayeosumareyoba/orixa/{index:02}')) if supabase else f'orixa-{index:02}'
            if tx.get('orixas', key) is not None:
                continue
            record = {'id': key, 'name': name, 'alias': alias, 'description': '', 'imageUrl': '', 'spotifyUrl': '', 'order': index, 'createdAt': timestamp, 'updatedAt': timestamp, 'archived': False}
            if supabase:
                record['createdBy'] = actor_id
            tx.put('orixas', key, record)
            created += 1
        return created
    return store.atomic(seed, actor_id=actor_id) if supabase else store.atomic(seed)
if __name__ == '__main__':
    import argparse
    import os
    from .store import FirebaseStore
    parser = argparse.ArgumentParser(description='Cadastrar somente os 21 nomes culturais fornecidos; não sobrescreve documentos existentes.')
    parser.add_argument('--confirm-project', required=True, help='ID exato do projeto Firebase autorizado para esta operação.')
    args = parser.parse_args()
    configured_project = os.environ.get('FIREBASE_PROJECT_ID')
    if not configured_project or args.confirm_project != configured_project:
        parser.error('--confirm-project deve corresponder a FIREBASE_PROJECT_ID.')
    print(f'{seed_cultural(FirebaseStore())} nomes novos cadastrados; documentos existentes preservados.')
