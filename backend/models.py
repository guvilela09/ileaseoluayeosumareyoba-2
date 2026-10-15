"""Strict allowlists and bounded textual content at every input boundary."""
import re
import uuid
from datetime import date, datetime
from urllib.parse import urlparse
from fastapi import HTTPException

COLLECTIONS = ('announcements', 'events', 'lists', 'orixas', 'members')
DEFAULT_PREFERENCES = {'theme': 'light', 'accent': 'copper', 'fontScale': 1, 'reducedMotion': False, 'emailNotifications': True}


def invalid(message):
    raise HTTPException(422, message)


def fields(data, allowed):
    if not isinstance(data, dict) or set(data) - set(allowed):
        invalid('Campos inválidos. Altere somente os campos permitidos.')


def text(value, name, maximum=50000, required=False):
    if not isinstance(value, str) or len(value) > maximum or (required and not value.strip()):
        invalid(f'{name}: informe um texto válido' + (f' de até {maximum} caracteres.' if maximum else '.'))
    return value.strip()


def identifier(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', value):
        invalid('Identificador inválido.')
    return value


def delta(value):
    fields(value, ('ops',))
    ops = value.get('ops')
    if not isinstance(ops, list) or not 1 <= len(ops) <= 5000:
        invalid('O comunicado precisa de texto.')
    total = 0
    result = []
    for op in ops:
        fields(op, ('insert', 'attributes'))
        insert = op.get('insert')
        if not isinstance(insert, str):
            invalid('O editor aceita somente texto; imagens e HTML incorporado não são permitidos.')
        total += len(insert)
        attrs = op.get('attributes', {})
        fields(attrs, ('font', 'size', 'color', 'bold', 'italic', 'underline', 'list'))
        for key, val in attrs.items():
            if key in ('bold', 'italic', 'underline') and type(val) is not bool:
                invalid('Formato de texto inválido.')
            if key == 'font' and val not in ('sans', 'serif', 'sans-serif', 'monospace'):
                invalid('Fonte não permitida.')
            if key == 'size' and val not in ('14px', '16px', '18px', '20px', '24px', '32px', 'small', 'large', 'huge'):
                invalid('Tamanho não permitido.')
            if key == 'list' and val not in ('ordered', 'bullet'):
                invalid('Lista não permitida.')
            if key == 'color' and (not isinstance(val, str) or not re.fullmatch(r'#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?', val)):
                invalid('Cor não permitida.')
        result.append({'insert': insert, **({'attributes': attrs} if attrs else {})})
    if total > 100000 or not ''.join(op['insert'] for op in result).strip():
        invalid('O comunicado precisa ter entre 1 e 100000 caracteres de texto.')
    return {'ops': result}


def spotify(value):
    value = text(value, 'Spotify', 500)
    if value and not re.fullmatch(r'https://open\.spotify\.com/(track|playlist)/[A-Za-z0-9]{1,64}(?:\?[^\s<>]*)?', value):
        invalid('Use um link HTTPS oficial de faixa ou playlist do Spotify.')
    return value


def map_url(value):
    value = text(value, 'Mapa', 3000)
    parsed = urlparse(value)
    if value and (parsed.scheme != 'https' or parsed.hostname not in ('www.google.com', 'maps.google.com') or parsed.path not in ('/maps/embed', '/maps/embed/') or parsed.username or parsed.password):
        invalid('Use a URL HTTPS de incorporação do Google Maps.')
    return value


def preferences(data, previous):
    fields(data, DEFAULT_PREFERENCES)
    out = {**previous, **data}
    if out['theme'] not in ('light', 'dark', 'system') or out['accent'] not in ('orange', 'copper', 'terracotta') or type(out['fontScale']) not in (int, float) or out['fontScale'] not in (1, 1.1, 1.2):
        invalid('Preferências de aparência inválidas.')
    if any(type(out[key]) is not bool for key in ('reducedMotion', 'emailNotifications')):
        invalid('Preferências de acessibilidade ou notificações inválidas.')
    return out


def document(collection, data, previous=None):
    previous = previous or {}
    allowed = {'announcements': ('title', 'priority', 'content', 'published'), 'events': ('title', 'description', 'date', 'time', 'location'), 'lists': ('title', 'description', 'items'), 'orixas': ('name', 'alias', 'description', 'imagePath', 'spotifyUrl'), 'members': ('name', 'alias', 'description', 'imagePath', 'spotifyUrl')}[collection]
    fields(data, allowed)
    out = previous.copy()
    out.update(data)
    if collection in ('orixas', 'members'):
        out['name'] = text(out.get('name'), 'Nome', 200, True)
        for field in ('alias', 'description'):
            out[field] = text(out.get(field, ''), field)
        out['spotifyUrl'] = spotify(out.get('spotifyUrl', ''))
        if 'imagePath' in data:
            out['imagePath'] = text(data['imagePath'], 'Imagem', 500)
        return out
    out['title'] = text(out.get('title'), 'Título', 200, True)
    if collection == 'announcements':
        if out.get('priority', 'normal') not in ('important', 'normal', 'less'):
            invalid('Classificação de comunicado inválida.')
        out['priority'] = out.get('priority', 'normal')
        out['content'] = delta(out.get('content'))
        if 'published' in data and data['published'] is not False:
            invalid('Use a ação Publicar para publicar um comunicado.')
        out['published'] = previous.get('published', False)
    elif collection == 'events':
        out['description'] = text(out.get('description', ''), 'Descrição')
        out['location'] = text(out.get('location', ''), 'Local', 500)
        value = out.get('date')
        if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
            invalid('Data inválida; use AAAA-MM-DD.')
        try:
            date.fromisoformat(value)
        except ValueError:
            invalid('Data inválida.')
        value = out.get('time')
        if not isinstance(value, str) or not re.fullmatch(r'(?:[01]\d|2[0-3]):[0-5]\d', value):
            invalid('Horário inválido; use HH:mm.')
        out['timezone'] = 'America/Sao_Paulo'
    elif collection == 'lists':
        out['description'] = text(out.get('description', ''), 'Descrição')
        items = out.get('items')
        if not isinstance(items, list) or not 1 <= len(items) <= 1000:
            invalid('Uma lista precisa de 1 a 1000 itens.')
        old = {item['id']: item for item in previous.get('items', [])}
        seen, clean = set(), []
        for item in items:
            fields(item, ('id', 'text', 'version'))
            key = identifier(item['id']) if item.get('id') else uuid.uuid4().hex
            if key in seen:
                invalid('Itens duplicados não são permitidos.')
            seen.add(key)
            content = text(item.get('text'), 'Item', 2000, True)
            existing = old.get(key)
            version = existing['version'] + (existing['text'] != content) if existing else 1
            clean.append({'id': key, 'text': content, 'version': version})
        out['items'] = clean
    return out
