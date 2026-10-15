# Assistente animada — assets e prévia

## Entrega

- public/assets/assistant/avatar-closed.png: cópia da imagem original, sem alteração.
- public/assets/assistant/avatar-open.png: versão editada com olhos abertos, gerada com a ferramenta nativa imagegen.
- assistant-preview: apresentação independente com piscadas, movimento suave, botão flutuante e conversa com FAQ Python. Não é o portal completo.
- plano-do-sistema.md: planejamento atualizado com a personagem na primeira versão.

## Executar

Da raiz do projeto, executar `python -B assistant-preview/server.py` com Python 3. Abrir http://127.0.0.1:8765/ enquanto o processo estiver ativo. Na máquina desta sessão, foi localizado o runtime em `C:\Users\Vilela Dev\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe`.

A prévia não usa Firebase, credenciais, serviços de IA ou envio de e-mail. Não altera contas, listas ou conteúdo. O endpoint é local e deve receber autenticação Firebase na integração ao portal.

## Animação e acessibilidade

Retrato com olhos abertos como base; frame original aplicado somente na região das pálpebras por máscaras CSS. Isso evita movimentar o restante da imagem durante as piscadas. Ciclo de 7 segundos para os olhos, 5,6 segundos para movimento leve do retrato. Botão Pausar animação e respeito à preferência do sistema operacional por movimento reduzido, mantendo os olhos abertos quando parado. Quando essa preferência estiver ativa, o botão Ver animação permite ativação deliberada somente nesta prévia.

O movimento usa CSS/JavaScript no navegador. A ajuda é respondida por Python. Não há animação de boca, braços ou geração de vídeo nesta entrega.

## Verificação realizada

Em 13/10/2026: 23 testes unittest passaram; JavaScript conferido com node --check. Prévia local aberta no navegador e respostas para checklist e recuperação de senha verificadas pela interface. Imagens carregadas em 1254 × 1254; animações breathe e blink ativas e opacidade das pálpebras variando. Largura de 360 px conferida sem rolagem horizontal, incluindo painel aberto. Nenhum erro de console observado. Preferência de movimento reduzido respeitada por padrão e ativação deliberada pelo botão Ver animação conferida. Captura da apresentação salva em assistant-preview.png.

No ambiente desta sessão, o servidor precisou rodar fora do isolamento de rede para ser acessível pelo navegador, mantendo vínculo exclusivo a 127.0.0.1. Nenhuma publicação externa foi realizada. A implementação Python foi delegada a um subagente; imagens, interface, planejamento e validação integrada ficaram com o agente principal.

## Prompt final usado no imagegen

Modo: ferramenta nativa, edição de imagem, sem CLI ou chave de API própria. Referência: Avatar Ilustrado com Coroa Dourada.png. Resultado mantido também no diretório padrão de imagens geradas e copiado para o projeto.

> Use case: precise-object-edit. Edit target: the attached illustrated portrait of the crowned woman. Asset type: perfectly registered open-eye frame for a blinking web assistant animation. Primary request: OPEN ONLY BOTH CLOSED EYES naturally, showing warm dark brown irises and natural eye whites, keeping the existing downward head inclination and calm expression. The eyes must look awake, welcoming, and anatomically natural, not wide or surprised. Preserve the exact original iris/eye positions implied by the eyelids. Constraints: preserve all pixels and geometry outside the eye/eyelid area as closely as possible; same face identity, eyebrows, skin shading, mouth, head pose, hair wrap, crown, jewelry, hands, clothing, circular orange background, white background, composition, framing, and margins. Same full square canvas and same relative scale and placement. Do not zoom, crop, re-center, move the head, recolor, retouch other areas, add text, add lashes, or redesign anything. Return ONE square portrait frame matching the reference, with only the two eyes changed from closed to open. The animation will alternate eyelids, so pixel registration and facial consistency are crucial.
