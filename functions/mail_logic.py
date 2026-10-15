"""Pure, network-free parts of the mail pipeline."""
from hashlib import sha256
from html import escape
import re


def eligible(user):
    return (user.get('status') == 'approved'
            and user.get('preferences', {}).get('emailNotifications') is True
            and bool(user.get('email')))


def job_id(kind, source_id, uid):
    return sha256(f'{kind}:{source_id}:{uid}'.encode()).hexdigest()


def announcement_payload(campaign, email, sender):
    text = ''.join(op.get('insert', '') for op in campaign.get('content', {}).get('ops', [])
                   if isinstance(op.get('insert'), str)).strip()
    return {'from': sender, 'to': [email], 'subject': str(campaign.get('title', 'Comunicado'))[:200],
            'text': text, 'html': safe_delta_html(campaign.get('content', {}))}


def safe_delta_html(delta):
    """Build mail HTML from textual Delta operations and strict formatting values."""
    lines, current = [], []
    for op in delta.get('ops', []):
        value = op.get('insert')
        if not isinstance(value, str):
            continue
        attributes = op.get('attributes') or {}
        parts = value.split('\n')
        for index, part in enumerate(parts):
            if part:
                fragment = escape(part)
                styles = []
                fonts = {'sans':'Arial, sans-serif', 'serif':'Georgia, serif'}
                if attributes.get('font') in fonts:
                    styles.append('font-family:' + fonts[attributes['font']])
                if attributes.get('size') in {'14px','16px','18px','20px','24px','32px'}:
                    styles.append('font-size:' + attributes['size'])
                color = attributes.get('color')
                if isinstance(color, str) and re.fullmatch(r'#[0-9a-fA-F]{6}', color):
                    styles.append('color:' + color)
                if styles:
                    fragment = '<span style="' + ';'.join(styles) + '">' + fragment + '</span>'
                for key, tag in [('bold','strong'), ('italic','em'), ('underline','u')]:
                    if attributes.get(key) is True:
                        fragment = f'<{tag}>{fragment}</{tag}>'
                current.append(fragment)
            if index < len(parts)-1:
                kind = attributes.get('list')
                lines.append((''.join(current) or '<br>', kind if kind in {'ordered','bullet'} else None))
                current = []
    if current:
        lines.append((''.join(current), None))
    output, opened = [], None
    for line, kind in lines:
        container = {'ordered':'ol', 'bullet':'ul'}.get(kind)
        if opened != container:
            if opened:
                output.append(f'</{opened}>')
            if container:
                output.append(f'<{container}>')
            opened = container
        output.append(f'<li>{line}</li>' if container else f'<p>{line}</p>')
    if opened:
        output.append(f'</{opened}>')
    return '<div>' + ''.join(output) + '</div>'


def retryable(status):
    return status in (408, 409, 429) or status >= 500


def should_retry(attempts, first_attempt, now):
    # Resend retains idempotency keys for 24 h; never retry outside that window.
    return attempts < 5 and (now - first_attempt).total_seconds() < 23 * 3600
