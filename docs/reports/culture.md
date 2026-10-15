# Páginas culturais

- `culture.js`: Itáns e Orixás e Ilé Asé usam os dados do bootstrap, cartões alternados, detalhe de leitura e Spotify oficial quando há link válido. Administração permite criar, editar, enviar imagem e arquivar com confirmação.
- `location.js`: mostra endereço, foto, mapa e trajeto apenas quando configurados; administração edita via `PATCH /api/site`.
- `about.js`: reserva somente o quadrado centralizado para a imagem da homenageada, sem conteúdo fictício ou editor.
- `culture.css`: estilos limitados às páginas culturais, com empilhamento no celular.

Links Spotify aceitos: HTTPS de `open.spotify.com/track/{id}` ou `/playlist/{id}` com ID de 22 caracteres alfanuméricos. Ao abrir o primeiro detalhe com música, a página carrega a [API oficial de iFrame do Spotify](https://developer.spotify.com/documentation/embeds/references/iframe-api), cria um controlador a partir do ID validado e chama `play()` no evento `ready`. O botão “Reproduzir música” chama `play()` após gesto explícito; os controles oficiais permanecem visíveis. Se a API não carregar, o iframe oficial já renderizado serve como alternativa manual. Ao fechar, o controlador é pausado e destruído e o iframe é removido.

O Spotify documenta que `play()` sem interação pode ser bloqueado pelo navegador. A interface não promete início automático nem exige Premium. A verificação local cobriu a sintaxe; a reprodução permitida/bloqueada depende de teste no navegador com acesso ao Spotify.

Fotos, textos e endereço ausentes exibem espaços de preenchimento explícitos. Os 21 nomes iniciais vêm exclusivamente do seed do backend.
