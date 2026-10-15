"""Deterministic Portuguese FAQ for a standalone preview of a planned portal."""

import re
import unicodedata


SUGGESTIONS = ["Como concluir uma lista?", "Como recuperar minha senha?",
               "O que tem no dashboard?", "Como importar uma lista?"]


def validate_question(question):
    """Accept only a nonblank string with 1–500 characters."""
    if not isinstance(question, str) or not 1 <= len(question) <= 500 or not question.strip():
        raise ValueError("Envie uma pergunta de 1 a 500 caracteres.")
    return question.strip()


def answer_question(question):
    """Explain planned portal usage; never perform an operation or invent an answer."""
    question = validate_question(question)
    normalized = unicodedata.normalize("NFKD", question.casefold())
    normalized = "".join(char for char in normalized if not unicodedata.combining(char))
    words = set(re.findall(r"[a-z0-9]+", normalized))

    def has(*keywords):
        return bool(words.intersection(keywords))

    # Requests for privilege changes or unrelated belief guidance remain out of scope.
    if has("ignore", "invadir", "burlar", "orixa", "orixas", "ritual", "rituais") or (
        has("torne", "promova", "transforme") and has("admin", "administrador")):
        detail = None
    elif has("senha", "senhas", "password") and has("google"):
        detail = ("a senha da conta Google é recuperada no próprio Google. A recuperação "
                  "da senha própria do portal é separada e usa “Esqueci minha senha”.")
    elif has("senha", "senhas", "password", "recuperar", "recuperacao"):
        detail = ("use “Esqueci minha senha” para a senha própria do portal e siga as "
                  "instruções enviadas ao seu e-mail. Quem entra com Google recupera "
                  "a senha no próprio Google; são processos separados.")
    elif has("aprovar", "aprovacao", "aprovado", "pendente", "cadastro", "registrar"):
        detail = ("o acesso após o cadastro depende da aprovação do administrador. "
                  "Aguarde essa aprovação; esta prévia não aprova contas nem altera permissões.")
    elif has("google", "login", "entrar", "acesso"):
        detail = ("o acesso terá entrada com Google ou com e-mail e senha própria do portal. "
                  "O cadastro precisa da aprovação do administrador. Esta prévia não realiza login.")
    elif has("reiniciar", "resetar", "redefinir", "zerar", "limpar", "recomecar") and has(
            "lista", "listas", "checklist", "itens", "marcacoes"):
        detail = ("você poderá reiniciar sua própria checklist, sem alterar as marcações "
                  "de outras pessoas. Seu progresso ficará salvo e sincronizado entre dispositivos "
                  "da mesma conta. Esta prévia só explica esse comportamento.")
    elif has("concluir", "concluida", "concluido", "finalizar", "terminar"):
        detail = ("marque todos os itens da lista e pressione “Concluir”. A lista concluída "
                  "mostrará ✅. A “Função Concluir” também aparecerá, sem executar ação.")
    elif has("importar", "importacao", "docx", "xlsx", "pdf", "arquivo", "arquivos"):
        detail = ("a importação de listas aceitará DOCX, XLSX e PDF com texto selecionável. "
                  "Depois da leitura, revise os itens antes de salvar. PDF escaneado sem texto "
                  "não faz parte dessa importação. Esta prévia não recebe arquivos.")
    elif has("spotify", "musica", "musicas", "player", "tocar"):
        detail = ("o player Spotify dependerá das permissões do navegador. Se a reprodução "
                  "automática não funcionar, clique no botão de reproduzir do player.")
    elif has("perfil", "foto", "imagem", "aparencia", "tema", "notificacao", "notificacoes"):
        detail = ("as configurações do perfil permitirão ajustar a imagem, a aparência, "
                  "o tema e as notificações. Esta prévia não salva preferências de conta.")
    elif has("editar", "edicao", "adicionar", "criar", "gerenciar", "administrar", "admin", "administrador"):
        detail = ("o administrador poderá criar conteúdos pelo botão + e editar pelo ícone "
                  "de caneta. As alterações serão feitas em modais. Esta prévia de ajuda não "
                  "cria, edita ou salva conteúdos.")
    elif has("dashboard", "inicio", "painel", "calendario", "comunicado", "comunicados", "evento", "eventos"):
        detail = ("o dashboard reunirá comunicados e calendário. Consulte os comunicados "
                  "para avisos e o calendário para os eventos cadastrados.")
    elif has("lista", "listas", "checklist", "dispositivo", "dispositivos", "sincronizar"):
        detail = ("cada pessoa terá sua própria checklist. As marcações ficarão salvas e "
                  "sincronizadas entre dispositivos da mesma conta. Marque todos os itens "
                  "antes de pressionar “Concluir”; a conclusão mostrará ✅ e “Função Concluir” "
                  "aparecerá sem executar ação.")
    else:
        detail = None

    if detail is None:
        return {"answer": "Posso ajudar somente com o uso do portal planejado. Não tenho uma "
                "resposta confiável para essa pergunta. Escolha um dos temas de ajuda abaixo.",
                "suggestions": list(SUGGESTIONS)}
    return {"answer": "No portal planejado, " + detail}
