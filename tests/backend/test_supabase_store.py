import unittest
from contextlib import contextmanager
from datetime import date, datetime, time, timezone

from backend.supabase_store import SupabaseStore, SupabaseTransaction


class FakeCursor:
    def __init__(self, connection):
        self.connection = connection
        self.one = None
        self.many = []

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def execute(self, sql, params=()):
        self.connection.calls.append((" ".join(sql.split()), params))
        self.one = self.connection.one
        self.many = self.connection.many
        return self

    def fetchone(self):
        return self.one

    def fetchall(self):
        return self.many


class FakeConnection:
    def __init__(self, one=None, many=None, fail_exit=False):
        self.one, self.many = one, many or []
        self.fail_exit = fail_exit
        self.calls = []
        self.closed = False
        self.committed = False
        self.rolled_back = False

    def cursor(self):
        return FakeCursor(self)

    def __enter__(self):
        return self

    def __exit__(self, exc_type, *_):
        self.committed = exc_type is None
        self.rolled_back = exc_type is not None
        if self.fail_exit and exc_type is None:
            raise RuntimeError("commit failed")
        return False

    def close(self):
        self.closed = True


class SupabaseStoreTest(unittest.TestCase):
    def store_for(self, connection):
        return SupabaseStore("postgresql://example", connect_factory=lambda *_args, **_kwargs: connection)

    def test_atomic_commits_and_closes_connection(self):
        connection = FakeConnection()
        result = self.store_for(connection).atomic(lambda tx: "done")
        self.assertEqual(result, "done")
        self.assertTrue(connection.committed)
        self.assertTrue(connection.closed)

    def test_atomic_rolls_back_and_closes_after_operation_error(self):
        connection = FakeConnection()
        with self.assertRaisesRegex(ValueError, "abort"):
            self.store_for(connection).atomic(lambda tx: (_ for _ in ()).throw(ValueError("abort")))
        self.assertTrue(connection.rolled_back)
        self.assertTrue(connection.closed)

    def test_get_maps_normalized_event_columns_to_document_shape(self):
        connection = FakeConnection(one=("event-id", "Cerimônia", "Descrição", date(2026, 10, 15), time(19, 30), "Terreiro", False, datetime(2026, 10, 1, tzinfo=timezone.utc), datetime(2026, 10, 2, tzinfo=timezone.utc)))
        value = self.store_for(connection).atomic(lambda tx: tx.get("events", "event-id"))
        self.assertEqual(value["date"], "2026-10-15")
        self.assertEqual(value["time"], "19:30")
        self.assertEqual(value["timezone"], "America/Sao_Paulo")
        self.assertEqual(value["location"], "Terreiro")
        self.assertEqual(connection.calls[0][1], ("event-id",))

    def test_put_uses_parameterized_jsonb_and_returns_compatible_record(self):
        connection = FakeConnection()
        record = {"id": "00000000-0000-0000-0000-000000000001", "title": "Aviso", "priority": "normal", "content": {"ops": [{"insert": "Olá"}]}, "published": False, "createdBy": "actor-id", "archived": False, "createdAt": "2026-10-01T00:00:00+00:00", "updatedAt": "2026-10-01T00:00:00+00:00"}
        self.store_for(connection).atomic(lambda tx: tx.put("announcements", record["id"], record))
        sql, params = connection.calls[0]
        self.assertIn("insert into public.announcements", sql.lower())
        self.assertIn("%s::jsonb", sql)
        self.assertIn("on conflict (id) do update", sql.lower())
        self.assertNotIn(record["title"], sql)
        self.assertTrue(any(isinstance(value, str) and value.startswith('{"ops"') for value in params))
        self.assertIn("actor-id", params)

    def test_profile_mapping_keeps_preferences_and_access_fields(self):
        connection = FakeConnection(one=("user-id", "person@example.com", "Pessoa", "users/user-id/p.jpg", "admin", "approved", {"theme": "dark"}, False, None, None))
        value = self.store_for(connection).atomic(lambda tx: tx.get("users", "user-id"))
        self.assertEqual(value["id"], "user-id")
        self.assertEqual(value["photoPath"], "users/user-id/p.jpg")
        self.assertEqual(value["role"], "admin")
        self.assertEqual(value["status"], "approved")
        self.assertEqual(value["preferences"], {"theme": "dark"})

    def test_progress_mapping_uses_composite_identity(self):
        connection = FakeConnection(one=("user-id", "list-id", ["a"], {"a": 2}, True, datetime(2026, 10, 1, tzinfo=timezone.utc)))
        value = self.store_for(connection).atomic(lambda tx: tx.get("progress/user-id/lists", "list-id"))
        self.assertEqual(value, {"checked": ["a"], "versions": {"a": 2}, "completed": True, "updatedAt": "2026-10-01T00:00:00+00:00"})
        self.assertEqual(connection.calls[0][1], ("user-id", "list-id"))

    def test_progress_operations_lock_the_list_row_to_prevent_lost_updates(self):
        connection = FakeConnection(one=("list-id", "Lista", "", [], False, None, None))
        self.store_for(connection).atomic(lambda tx: tx.get("lists", "list-id"))
        self.assertIn("for update", connection.calls[0][0].lower())

    def test_orixa_row_mapping_preserves_sort_order_and_image_fields(self):
        connection = FakeConnection(one=("orixa-id", "Èṣù", "Exu", "texto", "uploads/u/p.png", "https://open.spotify.com/track/abc", 4, False, None, None))
        value = self.store_for(connection).atomic(lambda tx: tx.get("orixas", "orixa-id"))
        self.assertEqual(value["order"], 4)
        self.assertEqual(value["imagePath"], "uploads/u/p.png")
        self.assertEqual(value["spotifyUrl"], "https://open.spotify.com/track/abc")

    def test_campaign_projection_joins_current_announcement_payload(self):
        connection = FakeConnection(one=("announcement-id", "Aviso", {"ops": [{"insert": "Texto"}]}, "queued", "admin-id", datetime(2026, 10, 1, tzinfo=timezone.utc)))
        value = self.store_for(connection).atomic(lambda tx: tx.get("mailCampaigns", "announcement-id"))
        self.assertEqual(value["announcementId"], "announcement-id")
        self.assertEqual(value["title"], "Aviso")
        self.assertEqual(value["content"]["ops"][0]["insert"], "Texto")
        self.assertEqual(value["requestedBy"], "admin-id")
        self.assertIn("join public.announcements", connection.calls[0][0].lower())

    def test_campaign_write_uses_actor_and_rejects_preview_persistence(self):
        connection = FakeConnection()
        store = SupabaseStore("postgresql://example", connect_factory=lambda *_args, **_kwargs: connection)
        store.atomic(lambda tx: tx.put("mailCampaigns", "announcement-id", {"status": "queued"}), actor_id="admin-id")
        self.assertIn("admin-id", connection.calls[0][1])
        preview_connection = FakeConnection()
        with self.assertRaisesRegex(ValueError, "preview"):
            self.store_for(preview_connection).atomic(lambda tx: tx.put("mailCampaigns", "announcement-id", {"status": "preview"}))
        self.assertEqual(preview_connection.calls, [])

    def test_orixa_insert_has_matching_placeholders_for_sort_order(self):
        connection = FakeConnection()
        value = {"id": "00000000-0000-0000-0000-000000000001", "name": "Èṣù", "order": 3, "createdBy": "admin-id"}
        self.store_for(connection).atomic(lambda tx: tx.put("orixas", value["id"], value))
        sql, params = connection.calls[0]
        self.assertIn("sort_order", sql)
        self.assertEqual(sql.count("%s"), len(params))

    def test_unknown_collection_is_rejected_before_sql(self):
        connection = FakeConnection()
        with self.assertRaises(ValueError):
            self.store_for(connection).atomic(lambda tx: tx.all("not-a-table"))
        self.assertEqual(connection.calls, [])


if __name__ == "__main__":
    unittest.main()
