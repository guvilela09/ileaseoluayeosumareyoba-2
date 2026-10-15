import unittest

from backend.seed import NAMES, seed_cultural


class SupabaseStore:
    def __init__(self):
        self.values = {}
        self.actor_id = None

    def atomic(self, operation, actor_id=None):
        self.actor_id = actor_id
        class Transaction:
            def __init__(inner):
                inner.values = self.values

            def get(inner, collection, key):
                return inner.values.get((collection, key))

            def put(inner, collection, key, value):
                inner.values[(collection, key)] = value
        return operation(Transaction())


class SupabaseSeedTest(unittest.TestCase):
    def test_supabase_seed_uses_uuid_ids_and_actor_without_overwriting(self):
        store = SupabaseStore()
        actor = '00000000-0000-0000-0000-000000000001'
        self.assertEqual(seed_cultural(store, actor_id=actor), len(NAMES))
        first = list(store.values.values())[0]
        self.assertEqual(first['createdBy'], actor)
        self.assertEqual(len(first['id']), 36)
        self.assertEqual(seed_cultural(store, actor_id=actor), 0)
        self.assertEqual(len(store.values), len(NAMES))

    def test_supabase_seed_requires_explicit_admin_actor(self):
        with self.assertRaisesRegex(ValueError, 'UID'):
            seed_cultural(SupabaseStore())


if __name__ == '__main__':
    unittest.main()
