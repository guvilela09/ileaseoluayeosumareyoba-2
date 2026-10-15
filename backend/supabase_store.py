"""PostgreSQL and private Supabase Storage adapter for the portal service.

The service keeps its existing document-shaped transaction API. This module is
the sole translation layer between those documents and the normalized schema.
"""
from __future__ import annotations

import json
import os
import re
from datetime import date, datetime, time, timezone
from typing import Any, Callable


_UTC = timezone.utc
_COLLECTIONS = {
    "users": "profiles",
    "announcements": "announcements",
    "events": "events",
    "lists": "lists",
    "orixas": "orixas",
    "members": "members",
    "site": "site_settings",
    "uploads": "uploads",
}


def _iso(value):
    if value is None:
        return None
    if isinstance(value, (datetime, date, time)):
        if isinstance(value, datetime) and value.tzinfo is None:
            value = value.replace(tzinfo=_UTC)
        if isinstance(value, time):
            return value.strftime("%H:%M")
        return value.isoformat()
    return value


def _timestamp(value):
    if value is None or isinstance(value, datetime):
        return value
    if not isinstance(value, str):
        return value
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=_UTC)


def _json(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


class SupabaseTransaction:
    """Document-shaped operations executed within one psycopg transaction."""

    def __init__(self, connection, actor_id=None):
        self.connection = connection
        self.actor_id = actor_id

    def _one(self, sql, params=()):
        with self.connection.cursor() as cursor:
            cursor.execute(sql, params)
            return cursor.fetchone()

    def _all(self, sql, params=()):
        with self.connection.cursor() as cursor:
            cursor.execute(sql, params)
            return cursor.fetchall()

    def get(self, collection, key):
        if collection.startswith("progress/"):
            pieces = collection.split("/")
            if len(pieces) != 3 or pieces[2] != "lists":
                raise ValueError(f"Coleção Supabase não suportada: {collection}")
            row = self._one(
                "select user_id, list_id, checked_items, item_versions, completed, updated_at "
                "from public.list_progress where user_id = %s and list_id = %s",
                (pieces[1], key),
            )
            return self._progress(row) if row else None

        if collection == "mailCampaigns":
            row = self._one(
                "select c.announcement_id, a.title, a.content, c.status, c.created_by, c.created_at "
                "from public.mail_campaigns c join public.announcements a on a.id = c.announcement_id "
                "where c.announcement_id = %s",
                (key,),
            )
            return self._campaign(row) if row else None

        table = self._table(collection)
        selects = {
            "profiles": "id, email, name, photo_path, role, status, preferences, archived, created_at, updated_at",
            "announcements": "id, title, priority, content, published, published_at, archived, created_at, updated_at",
            "events": "id, title, description, event_date, event_time, location, archived, created_at, updated_at",
            "lists": "id, title, description, items, archived, created_at, updated_at",
            "orixas": "id, name, alias, description, image_path, spotify_url, sort_order, archived, created_at, updated_at",
            "members": "id, name, alias, description, image_path, spotify_url, archived, created_at, updated_at",
            "site_settings": "id, address, map_url, photo_path, tribute_photo_path, updated_at",
            "uploads": "path, owner_id, kind, filename, content_type, size_bytes, expires_at, created_at",
        }
        lock = " for update" if collection == "lists" else ""
        row = self._one(f"select {selects[table]} from public.{table} where {'id' if table != 'uploads' else 'path'} = %s{lock}", (key,))
        return self._document(collection, row) if row else None

    def all(self, collection):
        table = self._table(collection)
        ordering = {
            "profiles": "created_at, id",
            "announcements": "created_at, id",
            "events": "event_date, event_time nulls first, id",
            "lists": "created_at, id",
            "orixas": "sort_order, created_at, id",
            "members": "created_at, id",
            "site_settings": "id",
            "uploads": "created_at, path",
        }[table]
        selects = {
            "profiles": "id, email, name, photo_path, role, status, preferences, archived, created_at, updated_at",
            "announcements": "id, title, priority, content, published, published_at, archived, created_at, updated_at",
            "events": "id, title, description, event_date, event_time, location, archived, created_at, updated_at",
            "lists": "id, title, description, items, archived, created_at, updated_at",
            "orixas": "id, name, alias, description, image_path, spotify_url, sort_order, archived, created_at, updated_at",
            "members": "id, name, alias, description, image_path, spotify_url, archived, created_at, updated_at",
            "site_settings": "id, address, map_url, photo_path, tribute_photo_path, updated_at",
            "uploads": "path, owner_id, kind, filename, content_type, size_bytes, expires_at, created_at",
        }
        return [self._document(collection, row) for row in self._all(f"select {selects[table]} from public.{table} order by {ordering}")]

    def put(self, collection, key, value):
        if collection.startswith("progress/"):
            pieces = collection.split("/")
            if len(pieces) != 3 or pieces[2] != "lists":
                raise ValueError(f"Coleção Supabase não suportada: {collection}")
            self._execute(
                "insert into public.list_progress (user_id, list_id, checked_items, item_versions, completed, updated_at) "
                "values (%s, %s, %s::jsonb, %s::jsonb, %s, coalesce(%s, now())) "
                "on conflict (user_id, list_id) do update set checked_items = excluded.checked_items, "
                "item_versions = excluded.item_versions, completed = excluded.completed, updated_at = excluded.updated_at",
                (pieces[1], key, _json(value.get("checked", [])), _json(value.get("versions", {})), bool(value.get("completed")), _timestamp(value.get("updatedAt"))),
            )
            return

        if collection == "mailCampaigns":
            self._put_campaign(key, value)
            return

        table = self._table(collection)
        actor = value.get("createdBy") or value.get("requestedBy") or self.actor_id
        if table == "profiles":
            self._execute(
                "insert into public.profiles (id, email, name, photo_path, role, status, preferences, archived, created_at, updated_at) "
                "values (%s,%s,%s,%s,%s,%s,%s::jsonb,%s,coalesce(%s,now()),coalesce(%s,now())) "
                "on conflict (id) do update set email=excluded.email, name=excluded.name, photo_path=excluded.photo_path, "
                "role=excluded.role, status=excluded.status, preferences=excluded.preferences, archived=excluded.archived, updated_at=excluded.updated_at",
                (key, value.get("email", ""), value.get("name", "Novo membro"), value.get("photoPath", ""), value.get("role", "member"), value.get("status", "pending"), _json(value.get("preferences", {})), bool(value.get("archived", False)), _timestamp(value.get("createdAt")), _timestamp(value.get("updatedAt"))),
            )
        elif table == "announcements":
            self._execute(
                "insert into public.announcements (id,title,priority,content,published,published_at,created_by,archived,created_at,updated_at) "
                "values (%s,%s,%s,%s::jsonb,%s,%s,%s,%s,coalesce(%s,now()),coalesce(%s,now())) "
                "on conflict (id) do update set title=excluded.title,priority=excluded.priority,content=excluded.content,published=excluded.published,published_at=excluded.published_at,archived=excluded.archived,updated_at=excluded.updated_at",
                (key, value.get("title", ""), value.get("priority", "normal"), _json(value.get("content", {})), bool(value.get("published", False)), _timestamp(value.get("publishedAt")), actor, bool(value.get("archived", False)), _timestamp(value.get("createdAt")), _timestamp(value.get("updatedAt"))),
            )
        elif table == "events":
            self._execute(
                "insert into public.events (id,title,description,event_date,event_time,location,created_by,archived,created_at,updated_at) "
                "values (%s,%s,%s,%s,%s,%s,%s,%s,coalesce(%s,now()),coalesce(%s,now())) "
                "on conflict (id) do update set title=excluded.title,description=excluded.description,event_date=excluded.event_date,event_time=excluded.event_time,location=excluded.location,archived=excluded.archived,updated_at=excluded.updated_at",
                (key, value.get("title", ""), value.get("description", ""), date.fromisoformat(value["date"]), time.fromisoformat(value["time"]) if value.get("time") else None, value.get("location", ""), actor, bool(value.get("archived", False)), _timestamp(value.get("createdAt")), _timestamp(value.get("updatedAt"))),
            )
        elif table == "lists":
            self._execute(
                "insert into public.lists (id,title,description,items,created_by,archived,created_at,updated_at) "
                "values (%s,%s,%s,%s::jsonb,%s,%s,coalesce(%s,now()),coalesce(%s,now())) "
                "on conflict (id) do update set title=excluded.title,description=excluded.description,items=excluded.items,archived=excluded.archived,updated_at=excluded.updated_at",
                (key, value.get("title", ""), value.get("description", ""), _json(value.get("items", [])), actor, bool(value.get("archived", False)), _timestamp(value.get("createdAt")), _timestamp(value.get("updatedAt"))),
            )
        elif table in ("orixas", "members"):
            cols = "id,name,alias,description,image_path,spotify_url,created_by,archived,created_at,updated_at"
            vals = (key, value.get("name", ""), value.get("alias", ""), value.get("description", ""), value.get("imagePath", ""), value.get("spotifyUrl", ""), actor, bool(value.get("archived", False)), _timestamp(value.get("createdAt")), _timestamp(value.get("updatedAt")))
            order_cols = ",sort_order" if table == "orixas" else ""
            order_value = (value.get("order", 99999),) if table == "orixas" else ()
            order_update = ",sort_order=excluded.sort_order" if table == "orixas" else ""
            self._execute(
                f"insert into public.{table} ({cols}{order_cols}) values (%s,%s,%s,%s,%s,%s,%s,%s,coalesce(%s,now()),coalesce(%s,now()){',%s' if table == 'orixas' else ''}) "
                f"on conflict (id) do update set name=excluded.name,alias=excluded.alias,description=excluded.description,image_path=excluded.image_path,spotify_url=excluded.spotify_url,archived=excluded.archived,updated_at=excluded.updated_at{order_update}",
                vals + order_value,
            )
        elif table == "site_settings":
            self._execute(
                "insert into public.site_settings (id,address,map_url,photo_path,tribute_photo_path,updated_by,updated_at) "
                "values (%s,%s,%s,%s,%s,%s,coalesce(%s,now())) on conflict (id) do update set address=excluded.address,map_url=excluded.map_url,photo_path=excluded.photo_path,tribute_photo_path=excluded.tribute_photo_path,updated_by=excluded.updated_by,updated_at=excluded.updated_at",
                (key, value.get("address", ""), value.get("mapUrl", ""), value.get("photoPath", ""), value.get("tributePhotoPath", ""), value.get("updatedBy") or actor, _timestamp(value.get("updatedAt"))),
            )
        elif table == "uploads":
            self._execute(
                "insert into public.uploads (path,owner_id,kind,filename,content_type,size_bytes,expires_at,created_at) "
                "values (%s,%s,%s,%s,%s,%s,%s,coalesce(%s,now())) on conflict (path) do update set owner_id=excluded.owner_id,kind=excluded.kind,filename=excluded.filename,content_type=excluded.content_type,size_bytes=excluded.size_bytes,expires_at=excluded.expires_at",
                (key, value.get("owner"), value.get("kind"), value.get("filename", ""), value.get("contentType", "application/octet-stream"), value.get("size", 1), _timestamp(value.get("expiresAt")), _timestamp(value.get("createdAt"))),
            )

    def _put_campaign(self, key, value):
        actor = value.get("requestedBy") or self.actor_id
        status = value.get("status", "queued")
        if status == "preview":
            raise ValueError("Campanhas preview não são persistidas no Supabase.")
        self._execute(
            "insert into public.mail_campaigns (announcement_id,status,recipient_count,created_by,created_at) "
            "values (%s,%s,%s,%s,coalesce(%s,now())) on conflict (announcement_id) do nothing",
            (key, status, int(value.get("recipientCount", 0)), actor, _timestamp(value.get("createdAt"))),
        )

    def _execute(self, sql, params):
        with self.connection.cursor() as cursor:
            cursor.execute(sql, params)

    @staticmethod
    def _table(collection):
        try:
            return _COLLECTIONS[collection]
        except KeyError:
            raise ValueError(f"Coleção Supabase não suportada: {collection}") from None

    @staticmethod
    def _progress(row):
        return {"checked": row[2] or [], "versions": row[3] or {}, "completed": bool(row[4]), "updatedAt": _iso(row[5])}

    @staticmethod
    def _campaign(row):
        return {"announcementId": str(row[0]), "title": row[1], "content": row[2], "status": row[3], "requestedBy": str(row[4]), "createdAt": _iso(row[5])}

    @classmethod
    def _document(cls, collection, row):
        if collection == "users":
            names = ("id", "email", "name", "photoPath", "role", "status", "preferences", "archived", "createdAt", "updatedAt")
            doc = dict(zip(names, row))
            doc["id"] = str(doc["id"])
            doc["createdAt"], doc["updatedAt"] = _iso(doc["createdAt"]), _iso(doc["updatedAt"])
            return doc
        if collection == "announcements":
            names = ("id", "title", "priority", "content", "published", "publishedAt", "archived", "createdAt", "updatedAt")
            doc = dict(zip(names, row))
            doc["id"] = str(doc["id"])
            for field in ("publishedAt", "createdAt", "updatedAt"):
                doc[field] = _iso(doc[field])
            return doc
        if collection == "events":
            names = ("id", "title", "description", "date", "time", "location", "archived", "createdAt", "updatedAt")
            doc = dict(zip(names, row))
            doc["id"] = str(doc["id"])
            doc["date"], doc["time"] = _iso(doc["date"]), _iso(doc["time"])
            doc["timezone"] = "America/Sao_Paulo"
            doc["createdAt"], doc["updatedAt"] = _iso(doc["createdAt"]), _iso(doc["updatedAt"])
            return doc
        if collection == "lists":
            names = ("id", "title", "description", "items", "archived", "createdAt", "updatedAt")
            doc = dict(zip(names, row))
            doc["id"] = str(doc["id"])
            doc["createdAt"], doc["updatedAt"] = _iso(doc["createdAt"]), _iso(doc["updatedAt"])
            return doc
        if collection == "orixas":
            names = ("id", "name", "alias", "description", "imagePath", "spotifyUrl", "order", "archived", "createdAt", "updatedAt")
            doc = dict(zip(names, row))
            doc["id"] = str(doc["id"])
            doc["createdAt"], doc["updatedAt"] = _iso(doc["createdAt"]), _iso(doc["updatedAt"])
            return doc
        if collection == "members":
            names = ("id", "name", "alias", "description", "imagePath", "spotifyUrl", "archived", "createdAt", "updatedAt")
            doc = dict(zip(names, row))
            doc["id"] = str(doc["id"])
            doc["createdAt"], doc["updatedAt"] = _iso(doc["createdAt"]), _iso(doc["updatedAt"])
            return doc
        if collection == "site":
            names = ("id", "address", "mapUrl", "photoPath", "tributePhotoPath", "updatedAt")
            doc = dict(zip(names, row))
            doc["updatedAt"] = _iso(doc["updatedAt"])
            doc["createdAt"] = doc["updatedAt"]
            doc["archived"] = False
            doc["photoUrl"] = ""
            doc["tributePhotoUrl"] = ""
            return doc
        if collection == "uploads":
            names = ("path", "owner", "kind", "filename", "contentType", "size", "expiresAt", "createdAt")
            doc = dict(zip(names, row))
            doc["owner"] = str(doc["owner"])
            doc["size"] = int(doc["size"])
            doc["expiresAt"], doc["createdAt"] = _iso(doc["expiresAt"]), _iso(doc["createdAt"])
            return doc
        raise ValueError(f"Coleção Supabase não suportada: {collection}")


class SupabaseStore:
    """Server-only Postgres and Storage access using Supabase credentials."""

    def __init__(self, database_url=None, secret_key=None, *, supabase_url=None, connect_factory=None, storage_client=None):
        self.database_url = database_url or os.getenv("SUPABASE_DB_URL")
        self.secret_key = secret_key or os.getenv("SUPABASE_SECRET_KEY")
        self.supabase_url = supabase_url or os.getenv("SUPABASE_URL")
        if not self.database_url:
            raise RuntimeError("Configure SUPABASE_DB_URL para conectar ao PostgreSQL.")
        if "[YOUR-PASSWORD]" in self.database_url or "<password>" in self.database_url.lower():
            raise RuntimeError("Substitua o marcador de senha em SUPABASE_DB_URL pela senha do banco.")
        injected_connection = connect_factory is not None
        if connect_factory is None:
            try:
                import psycopg
            except ImportError as error:
                raise RuntimeError("Instale psycopg[binary] para usar o banco Supabase.") from error
            connect_factory = psycopg.connect
        self._connect = connect_factory
        self._storage = storage_client
        if self._storage is None and not injected_connection and self.secret_key and self.supabase_url:
            try:
                from supabase import create_client
                self._storage = create_client(self.supabase_url, self.secret_key)
            except ImportError as error:
                raise RuntimeError("Instale o pacote supabase para acessar o Storage privado.") from error

    def atomic(self, operation: Callable[[SupabaseTransaction], Any], actor_id=None):
        connection = self._connect(self.database_url)
        try:
            with connection:
                return operation(SupabaseTransaction(connection, actor_id=actor_id))
        finally:
            connection.close()

    def read_collection(self, collection):
        return self.atomic(lambda tx: tx.all(collection))

    def _bucket(self):
        if self._storage is None:
            raise RuntimeError("Configure SUPABASE_URL e SUPABASE_SECRET_KEY para acessar arquivos privados.")
        return self._storage.storage.from_("portal-private")

    def read_bytes(self, path):
        result = self._bucket().download(path)
        if hasattr(result, "content"):
            result = result.content
        if not isinstance(result, bytes) or not result or len(result) > 10 * 1024 * 1024:
            raise ValueError("Arquivo vazio ou maior que 10 MB.")
        return result

    def image_url(self, path, uid=None):
        result = self._bucket().create_signed_url(path, 1800)
        if isinstance(result, dict):
            url = result.get("signedURL") or result.get("signedUrl")
        else:
            url = getattr(result, "signed_url", None)
        if not url:
            raise RuntimeError("O Storage não retornou uma URL assinada.")
        if url.startswith("/") and self.supabase_url:
            url = self.supabase_url.rstrip("/") + url
        return url

    def register_object(self, path, uid, kind, content_type):
        if not path.startswith(f"uploads/{uid}/") or ".." in path or "\\" in path:
            raise ValueError("O caminho do arquivo não corresponde ao proprietário.")
        info = self._bucket().info(path)
        if isinstance(info, dict):
            actual = info.get("metadata", {}).get("mimetype") or info.get("contentType") or info.get("content_type")
            size = info.get("metadata", {}).get("size") or info.get("size")
        else:
            actual = getattr(info, "mimetype", None) or getattr(info, "content_type", None)
            size = getattr(info, "size", None)
        if actual != content_type:
            raise ValueError("O tipo declarado não corresponde ao conteúdo do arquivo.")
        if size is not None and int(size) > (5 if kind == "image" else 10) * 1024 * 1024:
            raise ValueError("Arquivo maior que o limite permitido.")
