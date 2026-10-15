import os
import unittest
from unittest.mock import patch

from backend.app import create_app
from backend.store import SQLiteStore


class NoDemoModeTest(unittest.TestCase):
    def test_legacy_preview_environment_falls_back_to_supabase_without_local_store(self):
        environment = {
            'APP_MODE': 'preview',
            'SUPABASE_SECRET_KEY': '',
            'SUPABASE_URL': '',
            'SUPABASE_PUBLISHABLE_KEY': '',
        }
        with patch.dict(os.environ, environment):
            app = create_app()

        self.assertEqual(app.state.mode, 'supabase')
        self.assertIsNone(app.state.store)

    def test_demo_session_endpoint_is_not_available(self):
        environment = {
            'APP_MODE': 'supabase',
            'SUPABASE_SECRET_KEY': '',
            'SUPABASE_URL': '',
            'SUPABASE_PUBLISHABLE_KEY': '',
        }
        with patch.dict(os.environ, environment):
            app = create_app(mode='supabase')

        paths = {route.path for route in app.routes}
        self.assertNotIn('/api/preview/session', paths)

    def test_sqlite_test_adapter_does_not_persist_demo_sessions(self):
        self.assertFalse(hasattr(SQLiteStore, 'save_session'))
        self.assertFalse(hasattr(SQLiteStore, 'resolve_session'))


if __name__ == '__main__':
    unittest.main()
