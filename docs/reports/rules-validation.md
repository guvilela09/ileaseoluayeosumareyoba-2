# Validação local das regras Firebase

Executada em 13/10/2026, às 20:41 (America/Sao_Paulo), no projeto `demo-ilease`, com os emuladores oficiais Firestore, Realtime Database e Storage. Resultado: **5 testes passaram, 0 falhas, 0 cancelados, 0 ignorados**, em 7363 ms. O processo de testes e `emulators:exec` terminaram com código 0; os emuladores foram encerrados pela CLI.

Não houve login Firebase, criação de conta/projeto, configuração de credenciais, Auth/Functions reais, publicação, deploy ou envio de e-mail. `demo-*` impede acesso aos serviços não emulados desse projeto. Os erros `PERMISSION_DENIED` no log são recusas esperadas pelos testes `assertFails`.

## Ambiente efetivamente usado

- Node.js 24.16.0; Firebase CLI 15.33.0 instalada localmente em `.runtime/firebase-tools` pelo pacote oficial `firebase-tools`.
- Eclipse Temurin OpenJDK 21.0.12.1+1 portátil, em `.runtime/jdk`, obtido pela API oficial Adoptium. SHA-256 do arquivo ZIP conferido com o checksum publicado: `f9d6e191ab098c0d416e7d588a24420a8621cd2f4720dab2459b8b7b2d2d8b4e`. Antes da extração foram verificados caminhos dentro do destino e ausência de symlinks/tipos especiais.
- Firestore Emulator 1.22.0; Database Emulator 4.11.2; Storage Rules Runtime 1.1.3. Binários oficiais armazenados em `.runtime/firebase-tools/emulators`.
- `firebase` 13.0.0 e `@firebase/rules-unit-testing` 6.0.0, já instalados nas dependências do projeto.

## Cobertura executada

1. Pendentes, bloqueados, não verificados e não autenticados não leem conteúdo aprovado.
2. Membro lê somente comunicado publicado; administrador lê rascunho; consulta sem filtros falha e consulta com `published == true`/`archived == false` passa.
3. Writes diretos são negados; progresso próprio pode ser lido e progresso de outro usuário/outbox privada são negados.
4. Presença admite somente conexão própria; mirror é privilegiado; leitura global é administrativa; revogação de aprovação impede nova conexão.
5. Upload exige aprovação, proprietário, MIME/tamanho permitidos e papel administrativo para importação.

## Reprodução neste workspace

O comando funcional da suite, executado a partir da pasta `firebase`, é:

```powershell
firebase emulators:exec --project demo-ilease --only firestore,database,storage 'node --test tests/rules.test.mjs'
```

Neste ambiente Windows/Codex, a primeira tentativa restrita falhou na porta local 4400. A execução fora desse sandbox inicializou o hub e baixou o Firestore, mas Java falhou com `Unable to establish loopback connection` / `UnixDomainSockets: Invalid argument: connect` antes dos testes. Uma propriedade Java somente do processo, `jdk.net.unixdomain.tmpdir`, apontando para `.runtime/jdk/t`, resolveu o inicializador: `Selector.open()` passou e, em seguida, a suite completa passou. Nenhuma alteração de firewall, variável persistente ou configuração do Windows foi feita.

Para repetir usando os runtimes portáteis já preparados, executar em PowerShell dentro de `firebase`:

```powershell
$jdkHome = Get-ChildItem -LiteralPath '../.runtime/jdk' -Directory |
  Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'bin/java.exe') } |
  Select-Object -First 1 -ExpandProperty FullName
$env:JAVA_HOME = $jdkHome
$env:PATH = (Join-Path $jdkHome 'bin') + ';' + $env:PATH
$jdkSocketTemp = [IO.Path]::GetFullPath((Join-Path (Get-Location).Path '../.runtime/jdk/t'))
$env:JAVA_TOOL_OPTIONS = '-Djdk.net.unixdomain.tmpdir="' + $jdkSocketTemp + '"'
$env:FIREBASE_EMULATORS_PATH = [IO.Path]::GetFullPath((Join-Path (Get-Location).Path '../.runtime/firebase-tools/emulators'))
$env:XDG_CONFIG_HOME = [IO.Path]::GetFullPath((Join-Path (Get-Location).Path '../.runtime/firebase-tools/config'))
$env:CI = 'true'
$env:FIREBASE_CLI_DISABLE_UPDATE_CHECK = 'true'
node '../.runtime/firebase-tools/node_modules/firebase-tools/lib/bin/firebase.js' emulators:exec --project demo-ilease --only firestore,database,storage 'node --test tests/rules.test.mjs'
```

A CLI registrou uma mensagem `Unexpected rules runtime error: Picked up JAVA_TOOL_OPTIONS` ao capturar a linha informativa do Java no stderr. O Storage inicializou, executou todos os testes e terminou com código 0; essa mensagem não correspondeu a falha da suite.

## Arquivos efetivamente validados (SHA-256)

| Arquivo | Hash |
| --- | --- |
| `firebase/firestore.rules` | `5DADCAA8B3525F83D350B236FDC78C2D5658A7F2460F4882C3524B3151ED5B81` |
| `firebase/database.rules.json` | `3DC3C80AF0EF428B8EA466CAD3F0AA67690CFB176A0E4B1EF0D968D9D903800E` |
| `firebase/storage.rules` | `6ACEB8154EC63E77EFE8544CE3A179B4F2571D588C7CA285F4A64B9F87FC8B90` |
| `firebase/tests/rules.test.mjs` | `65E5A3E70067B8494BEA287F88187CD0E4A8C813B2D2B2D9D13AC61BAC33BC43` |

A aprovação desta suite cobre as regras/casos acima em emuladores; não valida serviços, credenciais, IAM ou integração de um projeto Firebase real ainda não criado.

Referências oficiais usadas para preparar o runtime: [Adoptium API em CI](https://adoptium.net/installation/ci-scripts), [Firebase Emulator Suite](https://firebase.google.com/docs/emulator-suite/install_and_configure), [propriedade Java para diretório de sockets Unix](https://docs.oracle.com/en/java/javase/17/core/java-networking.html).
